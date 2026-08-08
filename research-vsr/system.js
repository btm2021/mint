import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// HỆ THỐNG 2 ATRBOT + VSR: BIAS (slow) + ENTRY (fast) + TP/SL
// - Bias  : ATRBot chậm — chỉ giao dịch khi fast trend CÙNG hướng slow state
// - Entry : fast ATRBot đảo + VSR(10,10) xuôi-confirm (8 nến) + EMA20 pullback (16 nến)
// - Exit  : Stage A: fast flip hoặc slow flip (bias chết) | Stage B: TP/SL grid
const FEE = 0.1;
const W_CONFIRM = 8;
const W_PULL = 16;

const SLOW = [
  { id: "S1", atrLen: 20, mult: 2, maLen: 30, maType: "ema" },
  { id: "S2", atrLen: 30, mult: 2, maLen: 30, maType: "vidya" },
  { id: "S3", atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
];
const FAST = [
  { id: "F1", atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  { id: "F2", atrLen: 10, mult: 2, maLen: 10, maType: "vidya" },
  { id: "F3", atrLen: 14, mult: 2, maLen: 14, maType: "ema" },
];

function parseArgs(argv) {
  const args = {
    symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
    interval: "15m",
    bars: 200000,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
      if (val) { args[key] = val; i++; }
    }
  }
  args.symbols = args.symbols.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  args.bars = parseInt(args.bars, 10) || 200000;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

function cyclesOf(states) {
  const n = states.length;
  const cycles = [];
  let cur = { s: states[0], start: 0, end: 0 };
  for (let i = 1; i < n; i++) {
    if (states[i] !== cur.s) { cur.end = i - 1; cycles.push(cur); cur = { s: states[i], start: i, end: i }; }
    else cur.end = i;
  }
  cur.end = n - 1;
  cycles.push(cur);
  return cycles;
}

// ATR Wilder (seed TR0) — khớp indicators.js
function atrOf(bars, len) {
  const n = bars.length;
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    const tr = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}

// Tìm lệnh entry (fast flip + VSR xuôi-confirm + EMA20 pullback) — trả mảng rows
function findEntries(bars, statesFast, uppers, lowers, ema20) {
  const n = bars.length;
  const cycles = cyclesOf(statesFast);
  const rows = [];
  const finite = (arr, i) => Number.isFinite(arr[i]);
  for (let c = 0; c < cycles.length - 1; c++) {
    const cy = cycles[c];
    const cs = cy.start, ce = cy.end, S = cy.s;
    if (ce - cs < 2) continue;
    let cf = -1;
    for (let i = cs; i <= Math.min(ce - 1, cs + W_CONFIRM - 1); i++) {
      const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
      const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
      if (xuoi && emaOk) { cf = i; break; }
    }
    if (cf === -1 || cf >= ce) continue;
    let emaT = -1;
    for (let t = cf + 1; t <= Math.min(ce, cf + W_PULL); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
    }
    const entryIdx = emaT !== -1 ? emaT : cf;
    const entryPx = bars[entryIdx].close;
    rows.push({ S, entryIdx, entryPx, exitFastIdx: ce, cycleStart: cs });
  }
  return rows;
}

const stageARows = {}; // key slowId|fastId -> rows
for (const s of SLOW) for (const f of FAST) stageARows[`${s.id}|${f.id}`] = [];

console.log(`HỆ THỐNG 2 ATRBOT + VSR — ${args.symbols.length} symbol, phí ${FEE}%`);
console.log(`Slow (bias): ${SLOW.map((s) => s.id).join(", ")} | Fast (entry): ${FAST.map((f) => f.id).join(", ")} | VSR(10,10)`);
console.log("=".repeat(100));

for (const symbol of args.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${args.interval}.json`;
  let bars;
  try {
    bars = await fetchBars({ symbol, interval: args.interval, total: args.bars, cacheFile, delayMs: 450 });
  } catch (e) {
    console.log(`BỎ QUA ${symbol}: ${e.message}`);
    continue;
  }
  if (bars.length < 5000) continue;
  const ema20 = calcEma(bars, 20);
  const { uppers, lowers } = calculateVSR(bars, 10, 10);

  const slowStates = {};
  for (const s of SLOW) slowStates[s.id] = calculateTrendStates(bars, s.atrLen, s.maLen, s.mult, s.maType);
  const fastStates = {};
  for (const f of FAST) fastStates[f.id] = calculateTrendStates(bars, f.atrLen, f.maLen, f.mult, f.maType);

  for (const s of SLOW) {
    const slowSt = slowStates[s.id];
    for (const f of FAST) {
      const rows = findEntries(bars, fastStates[f.id], uppers, lowers, ema20);
      for (const r of rows) {
        const entryPx = r.entryPx;
        const exitFastPx = bars[r.exitFastIdx].close;
        const pnlFast = r.S * (exitFastPx / entryPx - 1) * 100 - FEE;
        // exit tại slow flip (bias chết)
        let exitSlowIdx = -1;
        for (let t = r.entryIdx + 1; t < bars.length; t++) {
          if (slowSt[t] !== r.S) { exitSlowIdx = t; break; }
        }
        const pnlSlow = exitSlowIdx !== -1
          ? r.S * (bars[exitSlowIdx].close / entryPx - 1) * 100 - FEE
          : pnlFast;
        const biasOk = slowSt[r.entryIdx] === r.S;
        stageARows[`${s.id}|${f.id}`].push({
          symbol, S: r.S, entryIdx: r.entryIdx, entryPx, exitFastIdx: r.exitFastIdx,
          pnlFast: +pnlFast.toFixed(3), pnlSlow: +pnlSlow.toFixed(3), biasOk: biasOk ? 1 : 0,
        });
      }
    }
  }
}

// ==================== STAGE A — chọn cặp ====================
console.log(`\n${"#".repeat(100)}`);
console.log("STAGE A — BIAS (slow) × ENTRY (fast) — exit = fast flip / slow flip:");
  console.log(`  ${"Pair".padEnd(12)} ${"N".padStart(7)} ${"NoBiasW%".padStart(9)} ${"BiasN".padStart(6)} ${"BiasW%".padStart(8)} ${"BiasTB%".padStart(8)} ${"BiasTot%".padStart(9)} ${"BiasSlowW%".padStart(11)} ${"BiasSlowTB%".padStart(11)}`);
const stageASummary = [];
for (const s of SLOW) for (const f of FAST) {
  const key = `${s.id}|${f.id}`;
  const rows = stageARows[key];
  if (!rows.length) continue;
  const nAll = rows.length;
  const nBias = rows.filter((r) => r.biasOk).length;
  const nbW = rows.filter((r) => r.pnlFast > 0).length;
  const bRows = rows.filter((r) => r.biasOk);
  const bW = bRows.filter((r) => r.pnlFast > 0).length;
  const bT = bRows.reduce((a, r) => a + r.pnlFast, 0) / bRows.length;
  const bTot = bRows.reduce((a, r) => a + r.pnlFast, 0);
  const bsW = bRows.filter((r) => r.pnlSlow > 0).length;
  const bsT = bRows.reduce((a, r) => a + r.pnlSlow, 0) / bRows.length;
  console.log(`  ${`${s.id}+${f.id}`.padEnd(12)} ${String(nAll).padStart(7)} ${pct(nbW, nAll).padStart(9)} ${String(nBias).padStart(6)} ${pct(bW, nBias).padStart(8)} ${bT.toFixed(2).padStart(8)} ${bTot.toFixed(0).padStart(9)} ${pct(bsW, nBias).padStart(11)} ${bsT.toFixed(2).padStart(11)}`);
  stageASummary.push({ pair: key, slow: s.id, fast: f.id, nAll, nBias, noBiasWin: (100 * nbW) / nAll, biasWin: nBias ? (100 * bW) / nBias : NaN, biasTB: bT, biasTotal: bTot, biasSlowWin: nBias ? (100 * bsW) / nBias : NaN, biasSlowTB: bsT });
}
writeCsv("output/system/stageA_pairs.csv", stageASummary.map((r) => ({ ...r, noBiasWin: +r.noBiasWin.toFixed(2), biasWin: +r.biasWin.toFixed(2), biasTB: +r.biasTB.toFixed(3), biasTotal: +r.biasTotal.toFixed(1), biasSlowWin: +r.biasSlowWin.toFixed(2), biasSlowTB: +r.biasSlowTB.toFixed(3) })));

// ==================== STAGE B — TP/SL trên cặp tốt nhất ====================
const best = stageASummary
  .filter((r) => r.nBias >= 1000 && Number.isFinite(r.biasTB))
  .sort((a, b) => b.biasTB - a.biasTB)[0];

if (best) {
  const slowCfg = SLOW.find((s) => s.id === best.slow);
  const fastCfg = FAST.find((f) => f.id === best.fast);
  console.log(`\n${"#".repeat(100)}`);
  console.log(`STAGE B — TP/SL GRID — cặp tốt nhất: ${best.pair} (bias TB ${best.biasTB.toFixed(2)}%, win ${best.biasWin.toFixed(1)}%, N=${best.nBias})`);

  const TP_GRID = [0.5, 1, 1.5, 2, 3].map((tp) => ({ tp, sl: 0.5 }));
  const SL_GRID = [1, 1.5, 2].map((sl) => ({ tp: 2, sl }));
  const ATR_GRID = [
    { tp: 1, sl: 0.5 }, { tp: 1.5, sl: 0.5 }, { tp: 1.5, sl: 1 }, { tp: 2, sl: 1 }, { tp: 3, sl: 1 }, { tp: 3, sl: 1.5 },
  ];
  const rules = [
    ...TP_GRID.map((g) => ({ id: `TP${g.tp}_SL${g.sl}`, tpPct: g.tp, slPct: g.sl, atrBased: false })),
    ...SL_GRID.map((g) => ({ id: `TP${g.tp}_SL${g.sl}`, tpPct: g.tp, slPct: g.sl, atrBased: false })),
    ...ATR_GRID.map((g) => ({ id: `A${g.tp}ATR_SL${g.sl}ATR`, tpA: g.tp, slA: g.sl, atrBased: true })),
    { id: "EXIT_FAST", exitMode: "fast" },
    { id: "EXIT_SLOW", exitMode: "slow" },
  ];
  const gridResults = [];

  for (const symbol of args.symbols) {
    const cacheFile = `cache/${symbol.toLowerCase()}_${args.interval}.json`;
    let bars;
    try {
      bars = await fetchBars({ symbol, interval: args.interval, total: args.bars, cacheFile, delayMs: 450 });
    } catch (e) { continue; }
    if (bars.length < 5000) continue;
    const ema20 = calcEma(bars, 20);
    const { uppers, lowers } = calculateVSR(bars, 10, 10);
    const slowSt = calculateTrendStates(bars, slowCfg.atrLen, slowCfg.maLen, slowCfg.mult, slowCfg.maType);
    const fastSt = calculateTrendStates(bars, fastCfg.atrLen, fastCfg.maLen, fastCfg.mult, fastCfg.maType);
    const atrF = atrOf(bars, fastCfg.atrLen);
    const entries = findEntries(bars, fastSt, uppers, lowers, ema20).filter((r) => slowSt[r.entryIdx] === r.S);

    for (const r of entries) {
      const entry = r.entryPx;
      const long = r.S === 1;
      const atrAtEntry = atrF[r.entryIdx];
      const end = Math.min(r.exitFastIdx, bars.length - 1);
      // exit slow: nến đầu tiên slow state khác hướng
      let endSlow = end;
      for (let t = r.entryIdx + 1; t < bars.length; t++) {
        if (slowSt[t] !== r.S) { endSlow = t; break; }
      }
      if (endSlow > end) endSlow = end;
      for (const rule of rules) {
        let pnl = null;
        if (rule.exitMode === "fast") {
          pnl = r.S * (bars[end].close / entry - 1) * 100 - FEE;
        } else if (rule.exitMode === "slow") {
          pnl = r.S * (bars[endSlow].close / entry - 1) * 100 - FEE;
        } else {
          let tpPct, slPct;
          if (rule.atrBased) { tpPct = (rule.tpA * atrAtEntry) / entry; slPct = (rule.slA * atrAtEntry) / entry; }
          else { tpPct = rule.tpPct / 100; slPct = rule.slPct / 100; }
          const tpLv = long ? entry * (1 + tpPct) : entry * (1 - tpPct);
          const slLv = long ? entry * (1 - slPct) : entry * (1 + slPct);
          for (let t = r.entryIdx + 1; t <= end; t++) {
            if (long ? bars[t].low <= slLv : bars[t].high >= slLv) { pnl = -slPct * 100 - FEE; break; }
            if (long ? bars[t].high >= tpLv : bars[t].low <= tpLv) { pnl = tpPct * 100 - FEE; break; }
          }
          if (pnl === null) pnl = r.S * (bars[end].close / entry - 1) * 100 - FEE;
        }
        gridResults.push({ symbol, ruleId: rule.id, pnl: +pnl.toFixed(3) });
      }
    }
  }

  const ruleRows = new Map();
  for (const g of gridResults) {
    if (!ruleRows.has(g.ruleId)) ruleRows.set(g.ruleId, []);
    ruleRows.get(g.ruleId).push(g.pnl);
  }
  console.log(`\n  ${"Rule".padEnd(16)} ${"N".padStart(7)} ${"Win%".padStart(7)} ${"TB%".padStart(8)} ${"Tổng%".padStart(9)} ${"PF".padStart(6)}`);
  const all = [];
  for (const [id, pnls] of ruleRows) {
    const n = pnls.length;
    const win = pnls.filter((p) => p > 0).length;
    const avg = pnls.reduce((a, b) => a + b, 0) / n;
    const total = pnls.reduce((a, b) => a + b, 0);
    const gpos = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
    const gneg = Math.abs(pnls.filter((p) => p <= 0).reduce((a, b) => a + b, 0));
    const pf = gneg > 0 ? gpos / gneg : Infinity;
    all.push({ id, n, win: (100 * win) / n, avg, total, pf });
    console.log(`  ${id.padEnd(16)} ${String(n).padStart(7)} ${((100 * win) / n).toFixed(1).padStart(7)} ${avg.toFixed(2).padStart(8)} ${total.toFixed(0).padStart(9)} ${pf.toFixed(2).padStart(6)}`);
  }
  all.sort((a, b) => b.avg - a.avg);
  writeCsv("output/system/stageB_tpsl.csv", all.map((r) => ({ ...r, win: +r.win.toFixed(2), avg: +r.avg.toFixed(3), total: +r.total.toFixed(1), pf: +r.pf.toFixed(2) })));

  // ==================== STAGE C — hệ thống hoàn chỉnh ====================
  const bestWin = all.filter((r) => r.n >= 2000).sort((a, b) => b.win - a.win)[0];
  const bestAvg = all.filter((r) => r.n >= 2000).sort((a, b) => b.avg - a.avg)[0];
  const bestRule = bestWin;
  console.log(`\n${"#".repeat(100)}`);
  console.log(`STAGE C — HỆ THỐNG HOÀN CHỈNH: BIAS ${best.slow} + ENTRY ${best.fast} + VSR(10,10) + ${bestRule.id}`);
  console.log(`  (Winrate tối đa: ${bestWin.id} — win ${bestWin.win.toFixed(1)}%, TB ${bestWin.avg.toFixed(2)}% | Expectancy tối đa: ${bestAvg.id} — win ${bestAvg.win.toFixed(1)}%, TB ${bestAvg.avg.toFixed(2)}%)`);
  const brAtr = bestRule.id.startsWith("A");
  const brExit = bestRule.id.startsWith("EXIT_");
  const m = bestRule.id.match(/^(?:TP)?(\d+(?:\.\d+)?)(?:ATR)?_SL(\d+(?:\.\d+)?)(?:ATR)?$/);
  const brTp = m ? parseFloat(m[1]) : null, brSl = m ? parseFloat(m[2]) : null;

  console.log(`\nTHEO SYMBOL (winrate & TB của TP/SL ${bestRule.id}):`);
  console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(6)} ${"Win%".padStart(7)} ${"TB%".padStart(8)} ${"Tổng%".padStart(9)}`);
  const bySym = new Map();
  for (const g of gridResults.filter((x) => x.ruleId === bestRule.id)) {
    if (!bySym.has(g.symbol)) bySym.set(g.symbol, []);
    bySym.get(g.symbol).push(g.pnl);
  }
  for (const [sym, pnls] of [...bySym.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const n = pnls.length;
    const win = pnls.filter((p) => p > 0).length;
    const avg = pnls.reduce((a, b) => a + b, 0) / n;
    const total = pnls.reduce((a, b) => a + b, 0);
    console.log(`  ${sym.padEnd(12)} ${String(n).padStart(6)} ${((100 * win) / n).toFixed(1).padStart(7)} ${avg.toFixed(2).padStart(8)} ${total.toFixed(0).padStart(9)}`);
  }

  console.log(`\nTÓM TẮT HỆ THỐNG ĐỀ XUẤT:`);
  console.log(`  BIAS : ATRBot(${slowCfg.atrLen}, ${slowCfg.mult}, ${slowCfg.maLen}, ${slowCfg.maType}) — chỉ trade khi slow state = hướng lệnh`);
  console.log(`  ENTRY: ATRBot(${fastCfg.atrLen}, ${fastCfg.mult}, ${fastCfg.maLen}, ${fastCfg.maType}) đảo + VSR(10,10) xuôi-confirm ${W_CONFIRM} nến + EMA20 pullback ${W_PULL} nến`);
  if (brExit) {
    console.log(`  EXIT : ${bestRule.id} (thoát khi ${bestRule.id === "EXIT_SLOW" ? "bias slow đảo" : "fast đảo"})`);
  } else {
    console.log(`  TP/SL: TP ${brTp}% / SL ${brSl}%${brAtr ? " (theo ATR fast)" : ""} | Time-stop: fast flip`);
  }
  console.log(`  Kết quả: win ${bestRule.win.toFixed(1)}% | TB ${bestRule.avg.toFixed(2)}% | Tổng ${bestRule.total.toFixed(0)}% | PF ${bestRule.pf.toFixed(2)} | N=${bestRule.n}`);
} else {
  console.log("Không đủ mẫu cho stage B.");
}

console.log("\nCSV đã lưu trong research-vsr/output/system/");

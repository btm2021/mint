import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// ============================================================
// BACKTEST SẠCH — KHÔNG LOOK-AHEAD BIAS (thay thế backtest_final.js)
// ------------------------------------------------------------
// VẤN ĐỀ CŨ: nhánh "không pullback → vào tại cf" cần nhìn 16 nến tương lai → bias.
// CÁCH SỬA — chỉ 2 chế độ entry KHẢ THI live (dữ liệu ≤ entry):
//   V7: sau cf, chờ pullback thật (giá chạm EMA20 trong wPull nến) → vào tại close nến chạm
//   V2: vào market ngay tại close cf (mọi tín hiệu hợp lệ, không chờ pullback)
// BIAS  : ATRBot(20,3,30,VIDYA) — slow state khớp hướng tại điểm vào
// ENTRY : ATRBot(14,2,14,VIDYA) confirm + VSR(10,10) xuôi + close qua EMA20 trong 8n
// EXIT  : TP1/TP2/SL theo cấu hình grid | time-stop = fast cycle hết
// CHI PHÍ: phí taker 0.05%×2 + slippage 0.02%×2
// ============================================================
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04,
  riskPerTrade: 1.0, R: 2.0,
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
  mode: "V7", // V7 = chờ pullback | V2 = market ngay tại cf
  tp1: 1.0, frac1: 0.66, tp2: 2.0, sl1: 2.0, be: true, sl2: 0.0,
};
function parseArgs(argv) {
  const args = { ...CONFIG };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
      if (val) { args[key] = val; i++; }
    }
  }
  if (typeof args.symbols === "string") args.symbols = args.symbols.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  args.bars = parseInt(args.bars, 10) || 200000;
  return args;
}
const C = parseArgs(process.argv.slice(2));
const SLOW = C.slow, FAST = C.fast;

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
function atrOf(bars, len) {
  const n = bars.length;
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}
const d2s = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16);

console.log("=".repeat(110));
console.log(`BACKTEST SẠCH (no look-ahead) — mode ${C.mode} | exit TP1=${C.tp1}%(${C.frac1})+BE, TP2=${C.tp2}%, SL=${C.sl1}%`);
console.log("=".repeat(110));

const signals = [];
for (const symbol of C.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${C.interval}.json`;
  let bars;
  try { bars = await fetchBars({ symbol, interval: C.interval, total: C.bars, cacheFile, delayMs: 450 }); }
  catch (e) { continue; }
  if (bars.length < 5000) continue;
  const n = bars.length;
  const ema20 = calcEma(bars, 20);
  const atrF = atrOf(bars, FAST.atrLen);
  const { uppers, lowers } = calculateVSR(bars, C.vsrLen, C.vsrThr);
  const slow = calculateTrendFull(bars, SLOW.atrLen, SLOW.maLen, SLOW.mult, SLOW.maType);
  const fastSt = calculateTrendFull(bars, FAST.atrLen, FAST.maLen, FAST.mult, FAST.maType).states;
  const slowCycles = cyclesOf(slow.states);
  const fastCycles = cyclesOf(fastSt);
  const finite = (arr, i) => Number.isFinite(arr[i]);

  for (let c = 0; c < fastCycles.length - 1; c++) {
    const cy = fastCycles[c];
    const cs = cy.start, ce = cy.end, S = cy.s;
    if (ce - cs < 2) continue;
    let cf = -1;
    for (let i = cs; i <= Math.min(ce - 1, cs + C.wConfirm - 1); i++) {
      const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
      const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
      if (xuoi && emaOk) { cf = i; break; }
    }
    if (cf === -1 || cf >= ce) continue;
    // Filter tại cf (dữ liệu ≤ cf — KHÔNG bias)
    const entryC = bars[cf].close;
    if (slow.states[cf] !== S) continue;
    const cycleAgeC = cf - cs + 1;
    if (cycleAgeC > C.maxCycleAge) continue;
    const evzC = S === 1 ? (finite(uppers, cf) ? (entryC - uppers[cf]) / atrF[cf] : 99) : (finite(lowers, cf) ? (lowers[cf] - entryC) / atrF[cf] : 99);
    if (evzC > -0.5 && evzC <= 0) continue;
    const pdC = S === 1 ? (ema20[cf] - entryC) / atrF[cf] : (entryC - ema20[cf]) / atrF[cf];
    if (pdC > C.maxPullATR) continue;

    // Tìm pullback thật (V7) — chỉ để biết CÓ hay KHÔNG trong tương lai → KHÔNG dùng cho V2
    let emaT = -1;
    if (C.mode === "V7") {
      for (let t = cf + 1; t <= Math.min(ce, cf + C.wPull); t++) {
        if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
      }
      if (emaT === -1 || emaT >= ce) continue;
      if (slow.states[emaT] !== S) continue;
      const entry = bars[emaT].close;
      const evzE = S === 1 ? (finite(uppers, emaT) ? (entry - uppers[emaT]) / atrF[emaT] : 99) : (finite(lowers, emaT) ? (lowers[emaT] - entry) / atrF[emaT] : 99);
      if (evzE > -0.5 && evzE <= 0) continue;
      const pdE = S === 1 ? (ema20[emaT] - entry) / atrF[emaT] : (entry - ema20[emaT]) / atrF[emaT];
      if (pdE > C.maxPullATR) continue;
      const avgV = bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf);
      signals.push({ symbol, S, bars, ema20, entryIdx: emaT, entry, end: Math.min(ce, n - 1), symbol, tEntry: bars[emaT].time, atrPct: atrF[emaT] / entry * 100, volConfirm: bars[cf].volume / avgV, cycleAge: emaT - cs + 1, pullLag: emaT - cf });
    } else { // V2 — market ngay tại cf
      const avgV = bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf);
      signals.push({ symbol, S, bars, ema20, entryIdx: cf, entry: entryC, end: Math.min(ce, n - 1), symbol, tEntry: bars[cf].time, atrPct: atrF[cf] / entryC * 100, volConfirm: bars[cf].volume / avgV, cycleAge: cycleAgeC, pullLag: 0 });
    }
  }
}
console.log(`Tín hiệu hợp lệ: ${signals.length}\n`);

// ==================== EXIT (TP1 frac1 + BE → TP2, hoặc TP đơn) ====================
const g = { tp1: C.tp1, frac1: C.frac1, tp2: C.tp2, sl1: C.sl1, be: C.be, sl2: C.sl2 };
const FEECOST = C.feePct + C.slippagePct;
const trades = [];
for (const s of signals) {
  const { bars, S, entryIdx, entry, end } = s;
  const sl1 = g.sl1, tp1 = g.tp1, tp2 = g.tp2, sl2 = g.sl2;
  const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
  const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  let rem = 1, pnlPct = 0, beActive = false, exitIdx = end, exitType = "TIMEOUT";
  for (let t = entryIdx + 1; t <= end; t++) {
    const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
    if (S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur) {
      pnlPct += rem * (S * (slCur / entry - 1) * 100 - FEECOST); rem = 0; exitType = beActive ? "SL2" : "SL1"; exitIdx = t; break;
    }
    if (rem > 0 && g.frac1 < 1) {
      const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1) { pnlPct += g.frac1 * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem -= g.frac1; beActive = true; }
    }
    if (rem > 0 && tp2 != null) {
      const tp2Lv = S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
      if (S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv) { pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP2"; exitIdx = t; break; }
    }
    if (rem > 0 && g.frac1 >= 1 && tp2 == null) {
      const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1) { pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP1"; exitIdx = t; break; }
    }
  }
  if (rem > 0) pnlPct += rem * (S * (bars[end].close / entry - 1) * 100 - FEECOST);
  trades.push({ symbol: s.symbol, S, tEntry: s.tEntry, tExit: bars[exitIdx].time, pnlPct: +pnlPct.toFixed(3), pnlR: +(pnlPct / C.R).toFixed(3), exitType, hold: exitIdx - entryIdx + 1, cycleAge: s.cycleAge, pullLag: s.pullLag, atrPct: s.atrPct, volConfirm: +s.volConfirm.toFixed(2) });
}
trades.sort((a, b) => a.tEntry - b.tEntry);

const stat = (rows) => {
  if (!rows.length) return null;
  const n = rows.length;
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = rows.reduce((a, t) => a + t.pnlR, 0) / n;
  return { n, win: (100 * w) / n, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * n };
};
const sAll = stat(trades), sTr = stat(trades.filter((t) => t.tEntry < C.oosSplit)), sTe = stat(trades.filter((t) => t.tEntry >= C.oosSplit));
console.log(`Toàn mẫu: N=${sAll.n} | WIN ${sAll.win.toFixed(1)}% | Exp ${sAll.exp.toFixed(3)}R | PF ${sAll.pf.toFixed(2)} | Tổng ${sAll.tot.toFixed(0)}R`);
console.log(`TRAIN  : N=${sTr.n} | WIN ${sTr.win.toFixed(1)}% | Exp ${sTr.exp.toFixed(3)}R | PF ${sTr.pf.toFixed(2)}`);
console.log(`TEST   : N=${sTe.n} | WIN ${sTe.win.toFixed(1)}% | Exp ${sTe.exp.toFixed(3)}R | PF ${sTe.pf.toFixed(2)}`);
const ex = {};
for (const t of trades) ex[t.exitType] = (ex[t.exitType] || 0) + 1;
console.log("Exit:", Object.entries(ex).map(([k, v]) => `${k} ${v} (${(100 * v / trades.length).toFixed(1)}%)`).join(" | "));

writeCsv(`output/backtest_clean/trades_${C.mode}.csv`, trades.map((t) => ({ ...t, tEntry: d2s(t.tEntry), tExit: d2s(t.tExit) })));
console.log(`CSV: output/backtest_clean/trades_${C.mode}.csv`);

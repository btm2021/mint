import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// MONEY MANAGEMENT GRID — kết hợp 5 cấu hình TP/SL tốt nhất × 4 họ quản lý vốn
//   fixed       : risk cố định % equity/lệnh
//   kelly       : f* = W - (1-W)/b (b = avgWin/avgLoss), đầy đủ / nửa / 1/4
//   martingale  : sau mỗi lệnh LỖ nhân đôi risk (cap), thắng thì reset
//   anti-mart   : sau mỗi lệnh THẮNG nhân đôi risk (cap), lỗ thì reset
// Equity mô phỏng theo thứ tự thời gian entry (compound); LƯU Ý: bỏ qua overlap vị thế.
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
};
const TP_SL_CONFIGS = [
  { name: "A0 BASE TP2/SL2", tp1: 2, frac1: 1, tp2: null, sl1: 2, be: false, sl2: null },
  { name: "E4 TP1=0.75(67%)+BE,TP2=2", tp1: 0.75, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "E10 TP1=1.0(67%)+BE,TP2=2", tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "E5 TP1=0.5(50%)+BE,TP2=1.5", tp1: 0.5, frac1: 0.5, tp2: 1.5, sl1: 2, be: true, sl2: 0 },
  { name: "B6 TP1=1.0(50%)+BE,TP2=2", tp1: 1.0, frac1: 0.5, tp2: 2, sl1: 2, be: true, sl2: 0 },
];
const MM_METHODS = [
  { name: "Fixed 0.5%", type: "fixed", f: 0.5 },
  { name: "Fixed 1.0%", type: "fixed", f: 1.0 },
  { name: "Fixed 2.0%", type: "fixed", f: 2.0 },
  { name: "Kelly FULL", type: "kelly", mult: 1.0 },
  { name: "Kelly HALF", type: "kelly", mult: 0.5 },
  { name: "Kelly QUARTER", type: "kelly", mult: 0.25 },
  { name: "Martingale x2 (base 0.5, cap 8)", type: "mart", base: 0.5, cap: 8 },
  { name: "Martingale x2 (base 1.0, cap 16)", type: "mart", base: 1.0, cap: 16 },
  { name: "Anti-mart x2 (base 0.5, cap 8)", type: "antimart", base: 0.5, cap: 8 },
  { name: "Anti-mart x2 (base 1.0, cap 16)", type: "antimart", base: 1.0, cap: 16 },
];

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
const A = parseArgs(process.argv.slice(2));
const SLOW = A.slow, FAST = A.fast;

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

console.log("Tính entry VBT (1 lần)...");
const entries = [];
for (const symbol of A.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${A.interval}.json`;
  let bars;
  try { bars = await fetchBars({ symbol, interval: A.interval, total: A.bars, cacheFile, delayMs: 450 }); }
  catch (e) { continue; }
  if (bars.length < 5000) continue;
  const n = bars.length;
  const ema20 = calcEma(bars, 20);
  const atrF = atrOf(bars, FAST.atrLen);
  const { uppers, lowers } = calculateVSR(bars, A.vsrLen, A.vsrThr);
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
    for (let i = cs; i <= Math.min(ce - 1, cs + A.wConfirm - 1); i++) {
      const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
      const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
      if (xuoi && emaOk) { cf = i; break; }
    }
    if (cf === -1 || cf >= ce) continue;
    let emaT = -1;
    for (let t = cf + 1; t <= Math.min(ce, cf + A.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
    }
    const entryIdx = emaT !== -1 ? emaT : cf;
    const entry = bars[entryIdx].close;
    if (slow.states[entryIdx] !== S) continue;
    if (entryIdx - cs + 1 > A.maxCycleAge) continue;
    const entryVsZone = S === 1
      ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
      : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
    if (entryVsZone > -0.5 && entryVsZone <= 0) continue;
    const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];
    if (pullDepth > A.maxPullATR) continue;
    const end = Math.min(ce, n - 1);
    entries.push({ symbol, S, entryIdx, entry, end, atrPct: atrF[entryIdx] / entry * 100, bars, tEntry: bars[entryIdx].time });
  }
}
console.log(`Tổng entry: ${entries.length}`);

const FEECOST = A.feePct + A.slippagePct;

function simulateExit(g) {
  const rows = [];
  for (const e of entries) {
    const { bars, S, entryIdx, entry, end } = e;
    const sl1 = g.sl1, tp1 = g.tp1, tp2 = g.tp2, sl2 = g.sl2;
    const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
    const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
    let rem = 1, pnlPct = 0, beActive = false, exitIdx = end, exitType = "TIMEOUT";
    for (let t = entryIdx + 1; t <= end; t++) {
      const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
      if (S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur) {
        pnlPct += rem * (S * (slCur / entry - 1) * 100 - FEECOST); rem = 0;
        exitType = beActive ? "SL2" : "SL1"; exitIdx = t; break;
      }
      if (rem > 0 && g.frac1 < 1) {
        const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
        if (hitTp1) {
          pnlPct += g.frac1 * (S * (tp1Lv / entry - 1) * 100 - FEECOST);
          rem -= g.frac1; beActive = true;
        }
      }
      if (rem > 0 && tp2 != null) {
        const tp2Lv = S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
        if (S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv) {
          pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - FEECOST); rem = 0;
          exitType = "TP2"; exitIdx = t; break;
        }
      }
      if (rem > 0 && g.frac1 >= 1 && tp2 == null) {
        const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
        if (hitTp1) { pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP1"; exitIdx = t; break; }
      }
    }
    if (rem > 0) pnlPct += rem * (S * (bars[end].close / entry - 1) * 100 - FEECOST);
    rows.push({ symbol: e.symbol, S, tEntry: e.tEntry, pnlPct, pnlR: pnlPct / A.R, exitType, hold: exitIdx - entryIdx + 1 });
  }
  rows.sort((a, b) => a.tEntry - b.tEntry);
  return rows;
}

// ---------- MÔ PHỎNG EQUITY ----------
// eq *= (1 + f * pnlR / 100)  với f = risk % equity/lệnh (SL đầy đủ = 1R khi thua)
function runMM(rows, mm, kellyFrac) {
  let eq = 100, peak = 100, maxDD = 0, maxPosF = 0;
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  let nMartHigh = 0, blew = false;
  for (const t of rows) {
    let f;
    if (mm.type === "fixed") f = mm.f;
    else if (mm.type === "kelly") f = kellyFrac * mm.mult;
    else if (mm.type === "mart") {
      f = Math.min(mm.base * Math.pow(2, lossStreak), mm.cap);
      if (lossStreak >= 3) nMartHigh++;
    } else { // antimart
      f = Math.min(mm.base * Math.pow(2, winStreak), mm.cap);
    }
    maxPosF = Math.max(maxPosF, f);
    eq *= 1 + (f * t.pnlR) / 100;
    if (eq <= 0) { blew = true; break; }
    if (t.pnlR > 0) { winStreak++; lossStreak = 0; } else { winStreak = 0; lossStreak++; }
    maxWinStreak = Math.max(maxWinStreak, winStreak);
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, (1 - eq / peak) * 100);
  }
  const yrs = (rows.length ? (rows[rows.length - 1].tEntry - rows[0].tEntry) / (365.25 * 86400) : 0);
  const cagr = yrs > 0 && eq > 0 ? (Math.pow(eq / 100, 1 / yrs) - 1) * 100 : -100;
  return { eq, cagr, maxDD, maxWinStreak, maxLossStreak, maxPosF, blew };
}

// ---------- CHẠY ----------
const out = [];
for (const g of TP_SL_CONFIGS) {
  const rows = simulateExit(g);
  const w = rows.filter((t) => t.pnlR > 0).length;
  const W = w / rows.length;
  const wins = rows.filter((t) => t.pnlR > 0);
  const losses = rows.filter((t) => t.pnlR <= 0);
  const avgW = wins.reduce((a, t) => a + t.pnlR, 0) / wins.length;
  const avgL = Math.abs(losses.reduce((a, t) => a + t.pnlR, 0) / losses.length);
  const b = avgW / avgL;
  const kelly = W - (1 - W) / b;
  console.log(`\n${"#".repeat(110)}`);
  console.log(`TP/SL: ${g.name} | N=${rows.length} | WIN ${(100 * W).toFixed(1)}% | avgW ${avgW.toFixed(3)}R | avgL ${-avgL.toFixed(3)}R | b=${b.toFixed(2)} | KELLY f*=${(100 * kelly).toFixed(1)}% | 1/2K=${(50 * kelly).toFixed(1)}% | 1/4K=${(25 * kelly).toFixed(1)}%`);
  console.log(`${"MM".padEnd(30)} ${"Equity".padStart(10)} ${"CAGR%".padStart(8)} ${"MaxDD%".padStart(8)} ${"DD/CAGR".padStart(8)} ${"maxRisk%".padStart(8)} ${"StreakW".padStart(7)} ${"StreakL".padStart(7)} ${"Cháy".padStart(4)}`);
  for (const mm of MM_METHODS) {
    const r = runMM(rows, mm, kelly);
    const ratio = r.cagr > 0 ? r.maxDD / r.cagr : Infinity;
    out.push({ tp: g.name, mm: mm.name, eq: +r.eq.toFixed(0), cagr: +r.cagr.toFixed(1), maxDD: +r.maxDD.toFixed(1), ddcagr: +ratio.toFixed(2), maxRisk: +r.maxPosF.toFixed(1), sw: r.maxWinStreak, sl: r.maxLossStreak, blew: r.blew });
    console.log(`${mm.name.padEnd(30)} ${r.eq.toFixed(0).padStart(10)} ${r.cagr.toFixed(1).padStart(8)} ${r.maxDD.toFixed(1).padStart(8)} ${ratio.toFixed(2).padStart(8)} ${r.maxPosF.toFixed(1).padStart(8)} ${String(r.maxWinStreak).padStart(7)} ${String(r.maxLossStreak).padStart(7)} ${(r.blew ? "🔥CHÁY" : "").padStart(4)}`);
  }
}

console.log(`\n${"#".repeat(110)}`);
console.log("BẢNG XẾP HẠNG — top 10 theo CAGR (DD/CAGR = chỉ số rủi ro, càng thấp càng tốt):");
console.log(`${"TP/SL".padEnd(28)} ${"MM".padEnd(28)} ${"Equity".padStart(9)} ${"CAGR%".padStart(7)} ${"MaxDD%".padStart(7)} ${"DD/CAGR".padStart(7)}`);
const sorted = [...out].sort((a, b) => b.cagr - a.cagr);
for (const r of sorted.slice(0, 10)) {
  console.log(`${r.tp.padEnd(28)} ${r.mm.padEnd(28)} ${String(r.eq).padStart(9)} ${r.cagr.toFixed(1).padStart(7)} ${r.maxDD.toFixed(1).padStart(7)} ${r.ddcagr.toFixed(2).padStart(7)}`);
}
writeCsv("output/mm_grid/results.csv", out.map((r) => ({ ...r, blew: r.blew ? 1 : 0 })));
console.log("\nCSV: output/mm_grid/results.csv");

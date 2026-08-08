import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// THỐNG KÊ R:R CHO HỆ THỐNG S3+F1+VSR(10,10)+TP2/SL2 (R = SL = 2%)
// + OUT-OF-SAMPLE: train < 2025-01-01 | test >= 2025-01-01
const FEE = 0.1;
const W_CONFIRM = 8;
const W_PULL = 16;
const R = 2; // SL = 2% = 1R
const SLOW = { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" };
const FAST = { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" };
const OOS_SPLIT = Date.UTC(2025, 0, 1) / 1000;

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
    const tr = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}

console.log(`THỐNG KÊ R:R + OUT-OF-SAMPLE — S3+F1+VSR(10,10)+TP2/SL2 — ${args.symbols.length} symbol, R=${R}%`);
console.log(`Split OOS: train < 2025-01-01 | test >= 2025-01-01`);
console.log("=".repeat(100));

const trades = [];
for (const symbol of args.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${args.interval}.json`;
  let bars;
  try {
    bars = await fetchBars({ symbol, interval: args.interval, total: args.bars, cacheFile, delayMs: 450 });
  } catch (e) { continue; }
  if (bars.length < 5000) continue;
  const n = bars.length;
  const ema20 = calcEma(bars, 20);
  const atrF = atrOf(bars, FAST.atrLen);
  const { zones, uppers, lowers } = calculateVSR(bars, 10, 10);
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
    const entry = bars[entryIdx].close;
    if (slow.states[entryIdx] !== S) continue;

    const tpLv = S === 1 ? entry * 1.02 : entry * 0.98;
    const slLv = S === 1 ? entry * 0.98 : entry * 1.02;
    let pnl = null, exitType = "";
    const end = Math.min(ce, n - 1);
    for (let t = entryIdx + 1; t <= end; t++) {
      if (S === 1 ? bars[t].low <= slLv : bars[t].high >= slLv) { pnl = -2 - FEE; exitType = "SL"; break; }
      if (S === 1 ? bars[t].high >= tpLv : bars[t].low <= tpLv) { pnl = 2 - FEE; exitType = "TP"; break; }
    }
    if (pnl === null) { pnl = S * (bars[end].close / entry - 1) * 100 - FEE; exitType = "TIMEOUT"; }

    const slowCyc = slowCycles.find((sc) => sc.start <= entryIdx && sc.end >= entryIdx) || slowCycles[0];
    const entryVsZone = S === 1
      ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
      : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
    const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];

    trades.push({
      symbol, S, time: bars[entryIdx].time, pnl: +pnl.toFixed(3), exitType,
      fastCycleLen: entryIdx - cs + 1,
      entryVsZone: +entryVsZone.toFixed(2),
      pullDepth: +pullDepth.toFixed(2),
    });
  }
}

// Filters tối ưu (từ optimize.js)
const optimized = trades.filter((t) => t.fastCycleLen <= 4 && !(t.entryVsZone > -0.5 && t.entryVsZone <= 0) && !(t.pullDepth > 0.5 && t.pullDepth <= 1));

const stats = (rows) => {
  const n = rows.length;
  if (!n) return null;
  const pnls = rows.map((r) => r.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const avg = pnls.reduce((a, b) => a + b, 0) / n;
  const total = pnls.reduce((a, b) => a + b, 0);
  // equity curve (theo thứ tự thời gian)
  let eq = 0, peak = 0, maxDD = 0;
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  for (const r of sorted) {
    eq += r.pnl / R;
    if (eq > peak) peak = eq;
    maxDD = Math.max(maxDD, peak - eq);
  }
  const expR = avg / R;
  const avgWinR = avgWin / R;
  const avgLossR = avgLoss / R;
  return { n, win: (100 * wins.length) / n, avgWinR, avgLossR, expR, pf: grossLoss > 0 ? grossWin / grossLoss : Infinity, maxDDR: maxDD, totalPct: total, avgPct: avg };
};

const fmt = (s) => (s ? `N=${String(s.n).padStart(6)} | WIN ${s.win.toFixed(1).padStart(5)}% | AvgWin ${s.avgWinR.toFixed(2)}R | AvgLoss ${s.avgLossR.toFixed(2)}R | Exp ${s.expR.toFixed(2)}R | PF ${s.pf.toFixed(2)} | MaxDD ${s.maxDDR.toFixed(1)}R | TB ${s.avgPct.toFixed(2)}% | Tổng ${s.totalPct.toFixed(0)}%` : "(không mẫu)");

console.log(`\n${"#".repeat(100)}`);
console.log("[1] TOÀN MẪU — so sánh R:R:");
console.log(`  BASE (không filter)     : ${fmt(stats(trades))}`);
console.log(`  TỐI ƯU (4 filter)       : ${fmt(stats(optimized))}`);

const rDist = (rows, label) => {
  const buckets = { "<-1.5R": 0, "-1.5..-0.5R": 0, "-0.5..0R": 0, "0..0.5R": 0, "0.5..1R": 0, ">=1R": 0 };
  for (const r of rows) {
    const x = r.pnl / R;
    if (x < -1.5) buckets["<-1.5R"]++;
    else if (x < -0.5) buckets["-1.5..-0.5R"]++;
    else if (x < 0) buckets["-0.5..0R"]++;
    else if (x < 0.5) buckets["0..0.5R"]++;
    else if (x < 1) buckets["0.5..1R"]++;
    else buckets[">=1R"]++;
  }
  console.log(`\n  PHÂN BỐ R-MULTIPLE — ${label} (N=${rows.length}):`);
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`    ${k.padEnd(12)}: ${String(v).padStart(6)} (${((100 * v) / rows.length).toFixed(1)}%)`);
  }
};
rDist(optimized, "TỐI ƯU toàn mẫu");

console.log(`\n${"#".repeat(100)}`);
console.log("[2] OUT-OF-SAMPLE — train < 2025 | test >= 2025:");
const train = trades.filter((t) => t.time < OOS_SPLIT);
const test = trades.filter((t) => t.time >= OOS_SPLIT);
const trainOpt = optimized.filter((t) => t.time < OOS_SPLIT);
const testOpt = optimized.filter((t) => t.time >= OOS_SPLIT);
console.log(`  BASE  — train: ${fmt(stats(train))}`);
console.log(`  BASE  — test : ${fmt(stats(test))}`);
console.log(`  TỐI ƯU — train: ${fmt(stats(trainOpt))}`);
console.log(`  TỐI ƯU — test : ${fmt(stats(testOpt))}`);

console.log(`\n  Số lệnh: train ${train.length} (${((100 * train.length) / trades.length).toFixed(0)}%) | test ${test.length} (${((100 * test.length) / trades.length).toFixed(0)}%)`);
rDist(trainOpt, "TỐI ƯU train");
rDist(testOpt, "TỐI ƯU test");

console.log(`\n${"#".repeat(100)}`);
console.log("[3] THEO SYMBOL — TỐI ƯU toàn mẫu (R:R):");
console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(6)} ${"Win%".padStart(6)} ${"AvgWinR".padStart(8)} ${"AvgLossR".padStart(9)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"MaxDDR".padStart(7)}`);
const bySym = new Map();
for (const t of optimized) {
  if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
  bySym.get(t.symbol).push(t);
}
for (const [sym, rows] of [...bySym.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const s = stats(rows);
  console.log(`  ${sym.padEnd(12)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(6)} ${s.avgWinR.toFixed(2).padStart(8)} ${s.avgLossR.toFixed(2).padStart(9)} ${s.expR.toFixed(2).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.maxDDR.toFixed(1).padStart(7)}`);
}

console.log(`\n${"#".repeat(100)}`);
console.log("[4] THEO SYMBOL — TEST (2025+, out-of-sample):");
console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(6)} ${"Win%".padStart(6)} ${"ExpR".padStart(7)} ${"PF".padStart(6)}`);
const bySymT = new Map();
for (const t of testOpt) {
  if (!bySymT.has(t.symbol)) bySymT.set(t.symbol, []);
  bySymT.get(t.symbol).push(t);
}
let neg = 0;
for (const [sym, rows] of [...bySymT.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const s = stats(rows);
  if (s.expR < 0) neg++;
  console.log(`  ${sym.padEnd(12)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(6)} ${s.expR.toFixed(2).padStart(7)} ${s.pf.toFixed(2).padStart(6)}`);
}
console.log(`  Số symbol expR âm trong test: ${neg}/${bySymT.size}`);

writeCsv("output/optimize/rr_trades.csv", trades);
writeCsv("output/optimize/rr_optimized.csv", optimized);
console.log("\nCSV đã lưu trong research-vsr/output/optimize/");

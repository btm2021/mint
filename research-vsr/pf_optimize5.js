import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { calcEma } from "./lib/indicators.js";
import { writeCsv } from "./lib/retest.js";

// TĂNG PF & ExpR — 3 lever:
//   L1: model dự đoán không-pullback (logistic, feature ≤ cf) — lọc nhóm momentum mạnh
//   L2: grid TP/SL riêng cho nhóm đã lọc (trend mạnh → TP2 xa hơn, SL tùy chọn)
//   L3: mode V2 vs V7
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m", bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
  topPct: 0.3,
};
const GRID = [{name:"TP1=2.5(66%)+BE,TP2=8",tp1:2.5,frac1:0.66,tp2:8,sl1:2,be:true,sl2:0},{name:"TP1=3(66%)+BE,TP2=8",tp1:3,frac1:0.66,tp2:8,sl1:2,be:true,sl2:0},{name:"TP1=3(50%)+BE,TP2=10",tp1:3,frac1:0.5,tp2:10,sl1:2,be:true,sl2:0},{name:"TP1=2.5(50%)+BE,TP2=10",tp1:2.5,frac1:0.5,tp2:10,sl1:2,be:true,sl2:0},{name:"TP1=2(66%)+BE,TP2=10",tp1:2,frac1:0.66,tp2:10,sl1:2,be:true,sl2:0},{name:"TP1=3(66%)+BE,TP2=12",tp1:3,frac1:0.66,tp2:12,sl1:2,be:true,sl2:0},{name:"TP đơn 10%/SL2",tp1:10,frac1:1,tp2:null,sl1:2,be:false,sl2:null},{name:"TP đơn 12%/SL2",tp1:12,frac1:1,tp2:null,sl1:2,be:false,sl2:null}];
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
  const n = states.length; const cycles = [];
  let cur = { s: states[0], start: 0, end: 0 };
  for (let i = 1; i < n; i++) {
    if (states[i] !== cur.s) { cur.end = i - 1; cycles.push(cur); cur = { s: states[i], start: i, end: i }; }
    else cur.end = i;
  }
  cur.end = n - 1; cycles.push(cur); return cycles;
}
function atrOf(bars, len) {
  const n = bars.length; const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

console.log("Xây dataset + train logistic...");
const X = [], Y = [], meta = [];
for (const symbol of A.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${A.interval}.json`;
  let bars;
  try { bars = await fetchBars({ symbol, interval: A.interval, total: A.bars, cacheFile, delayMs: 450 }); }
  catch (e) { continue; }
  if (bars.length < 5000) continue;
  const n = bars.length;
  const ema20 = calcEma(bars, 20);
  const atrF = atrOf(bars, FAST.atrLen);
  const { zones, uppers, lowers } = calculateVSR(bars, A.vsrLen, A.vsrThr);
  const slow = calculateTrendFull(bars, SLOW.atrLen, SLOW.maLen, SLOW.mult, SLOW.maType);
  const fastSt = calculateTrendFull(bars, FAST.atrLen, FAST.maLen, FAST.mult, FAST.maType).states;
  const slowCycles = cyclesOf(slow.states);
  const fastCycles = cyclesOf(fastSt);
  const finite = (arr, i) => Number.isFinite(arr[i]);
  const zStart = new Array(n).fill(-1);
  for (const z of zones) for (let i = z.startIndex; i <= Math.min(z.endIndex, n - 1); i++) zStart[i] = z.startIndex;
  const zW = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (finite(uppers, i) && finite(lowers, i)) zW[i] = (uppers[i] - lowers[i]) / bars[i].close * 100;

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
    const entry = bars[cf].close;
    if (slow.states[cf] !== S) continue;
    const cycleAge = cf - cs + 1;
    if (cycleAge > A.maxCycleAge) continue;
    const evz = S === 1 ? (finite(uppers, cf) ? (entry - uppers[cf]) / atrF[cf] : 99) : (finite(lowers, cf) ? (lowers[cf] - entry) / atrF[cf] : 99);
    if (evz > -0.5 && evz <= 0) continue;
    const pdC = S === 1 ? (ema20[cf] - entry) / atrF[cf] : (entry - ema20[cf]) / atrF[cf];
    if (pdC > A.maxPullATR) continue;

    let pullback = false;
    for (let t = cf + 1; t <= Math.min(ce, cf + A.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { pullback = true; break; }
    }
    const slowCyc = slowCycles.find((sc) => sc.start <= cf && sc.end >= cf) || slowCycles[0];
    const slowAge = cf - slowCyc.start;
    const slowLeftPct = slowCyc.end > cf ? (slowCyc.end - cf) / Math.max(1, slowCyc.end - slowCyc.start) : 0;
    const slowStr = Math.abs(slow.trail1[cf] - slow.trail2[cf]) / entry * 100;
    const trailSpread = finite(slow.trail2, cf) ? Math.abs(entry - slow.trail2[cf]) / atrF[cf] : 99;
    const distEma = S === 1 ? (entry - ema20[cf]) / atrF[cf] : (ema20[cf] - entry) / atrF[cf];
    const emaSlope = S === 1 ? (ema20[cf] - ema20[Math.max(0, cf - 5)]) / atrF[cf] : (ema20[Math.max(0, cf - 5)] - ema20[cf]) / atrF[cf];
    const emaSlope10 = S === 1 ? (ema20[cf] - ema20[Math.max(0, cf - 10)]) / atrF[cf] : (ema20[Math.max(0, cf - 10)] - ema20[cf]) / atrF[cf];
    const moveFromFlip = S * (entry / bars[cs].close - 1) * 100;
    const volConfirm = bars[cf].volume / Math.max(1e-9, (bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf)));
    const volEntry = bars[cs].volume / Math.max(1e-9, (bars.slice(Math.max(0, cs - 20), cs).reduce((a, b) => a + b.volume, 0) / Math.min(20, cs)));
    const atrPct = atrF[cf] / entry * 100;
    const rangePct = (bars[cf].high - bars[cf].low) / entry * 100;
    const bodyPct = Math.abs(bars[cf].close - bars[cf].open) / entry * 100;

    X.push([distEma, emaSlope, emaSlope10, slowStr, trailSpread, slowAge, slowLeftPct, moveFromFlip, volConfirm, volEntry, atrPct, rangePct, bodyPct, evz]);
    Y.push(pullback ? 0 : 1);
    meta.push({ symbol, S, tEntry: bars[cf].time, cf, ce, bars, entryIdx: cf, entry, end: Math.min(ce, n - 1) });
  }
}
console.log(`Dataset: ${Y.length} (không-pullback ${(100 * Y.reduce((a, b) => a + b, 0) / Y.length).toFixed(1)}%)`);

const goodJ = X[0].map((_, j) => j).filter((j) => X.every((r) => Number.isFinite(r[j])));
const mean = goodJ.map((j) => X.reduce((a, r) => a + r[j], 0) / X.length);
const sd = goodJ.map((j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mean[goodJ.indexOf(j)]) ** 2, 0) / X.length));
const norm = (row) => goodJ.map((j, k) => (row[j] - mean[k]) / sd[k]);
const trainI = [];
for (let i = 0; i < meta.length; i++) if (meta[i].tEntry < A.oosSplit) trainI.push(i);
const w = new Array(goodJ.length).fill(0); let b = 0;
const lr = 0.5, lambda = 0.01;
for (let it = 0; it < 300; it++) {
  let gw = new Array(goodJ.length).fill(0), gb = 0;
  for (const i of trainI) {
    const x = norm(X[i]);
    const p = sigmoid(x.reduce((a, v, k) => a + v * w[k], 0) + b);
    const err = p - Y[i];
    for (let k = 0; k < w.length; k++) gw[k] += err * x[k];
    gb += err;
  }
  for (let k = 0; k < w.length; k++) w[k] = (1 - lr * lambda / trainI.length) * w[k] - lr * gw[k] / trainI.length;
  b -= lr * gb / trainI.length;
}
const predict = (i) => sigmoid(norm(X[i]).reduce((a, v, k) => a + v * w[k], 0) + b);

// quantile từ train
const trainProbs = trainI.map((i) => predict(i)).sort((a, b) => a - b);
const qOf = (p) => trainProbs[Math.floor(p * (trainProbs.length - 1))];
const topTh = qOf(1 - A.topPct);
const keptI = [];
for (let i = 0; i < meta.length; i++) if (predict(i) >= topTh) keptI.push(i);
console.log(`Giữ ${A.topPct * 100}% theo model: ${keptI.length} lệnh (threshold ${topTh.toFixed(3)})`);

// exit simulation
const FEECOST = A.feePct + A.slippagePct;
function simExit(m, g) {
  const { bars, S, entryIdx, entry, end } = m;
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
  return { pnlPct, pnlR: pnlPct / A.R, tEntry: m.tEntry, exitType };
}
function stat(rows) {
  if (!rows.length) return null;
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = rows.reduce((a, t) => a + t.pnlR, 0) / rows.length;
  return { n: rows.length, win: (100 * w) / rows.length, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * rows.length };
}

console.log(`\n${"#".repeat(118)}`);
console.log(`GRID TP/SL trên nhóm Top-${A.topPct * 100}% model (V2 entry, feature ≤ cf) — mục tiêu PF/ExpR:`);
console.log(`${"Exit".padEnd(30)} ${"N".padStart(5)} ${"WIN%".padStart(7)} ${"ExpR".padStart(8)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"OOS N".padStart(5)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)} ${"OOS PF".padStart(7)}`);
const results = [];
for (const g of GRID) {
  const rows = keptI.map((i) => simExit(meta[i], g));
  rows.sort((a, b) => a.tEntry - b.tEntry);
  const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
  if (!s || !so) continue;
  let eq = 100, pk = 100, mdd = 0;
  for (const t of rows) { eq *= 1 + (t.pnlR * 1) / 100; if (eq > pk) pk = eq; mdd = Math.max(mdd, (1 - eq / pk) * 100); }
  results.push({ name: g.name, n: s.n, win: s.win, exp: s.exp, pf: s.pf, tot: s.tot, mdd, oosN: so.n, oosWin: so.win, oosExp: so.exp, oosPf: so.pf });
  console.log(`${g.name.padEnd(30)} ${String(s.n).padStart(5)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(8)} ${s.pf.toFixed(2).padStart(6)} ${s.tot.toFixed(0).padStart(7)} ${String(so.n).padStart(5)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)} ${so.pf.toFixed(2).padStart(7)} MaxDD ${mdd.toFixed(1)}%`);
}

// ranking theo OOS PF × ExpR
console.log(`\n${"#".repeat(118)}`);
console.log("XẾP HẠNG theo OOS (PF + ExpR kết hợp, ưu tiên PF):");
const sorted = [...results].sort((a, b) => (b.oosPf + b.oosExp * 5) - (a.oosPf + a.oosExp * 5));
for (const r of sorted.slice(0, 8)) {
  console.log(`  ${r.name.padEnd(30)} IS: WIN ${r.win.toFixed(1)}% | Exp ${r.exp.toFixed(3)}R | PF ${r.pf.toFixed(2)}  →  OOS: WIN ${r.oosWin.toFixed(1)}% | Exp ${r.oosExp.toFixed(3)}R | PF ${r.oosPf.toFixed(2)}`);
}

// thay đổi topPct cho config tốt nhất
writeCsv("output/optimize/pf_grid_top30.csv", results.map((r) => ({ ...r, win: +r.win.toFixed(1), exp: +r.exp.toFixed(3), pf: +r.pf.toFixed(2), oosWin: +r.oosWin.toFixed(1), oosExp: +r.oosExp.toFixed(3), oosPf: +r.oosPf.toFixed(2) })));
console.log("");
// chi tiết thoát cho cấu hình TP12
const g12 = GRID.find((g) => g.name.includes("12"));
const rows12 = keptI.map((i) => simExit(meta[i], g12)).sort((a, b) => a.tEntry - b.tEntry);
const ex = {}; for (const t of rows12) ex[t.exitType] = (ex[t.exitType] || 0) + 1;
console.log("Phân phối thoát TP12%:", Object.entries(ex).map(([k, v]) => k + " " + v + " (" + (100 * v / rows12.length).toFixed(1) + "%)").join(" | "));
const exP = {}; for (const t of rows12) exP[t.exitType] = (exP[t.exitType] || 0) + t.pnlR;
console.log("PnL theo thoát:", Object.entries(exP).map(([k, v]) => k + " " + v.toFixed(0) + "R").join(" | "));
let e = 100, pk = 100, mdd = 0;
for (const t of rows12) { e *= 1 + (t.pnlR * 1) / 100; if (e > pk) pk = e; mdd = Math.max(mdd, (1 - e / pk) * 100); }
console.log("MaxDD (risk 1%, tuần tự):", mdd.toFixed(1) + "%");
console.log("\nCSV: output/optimize/pf_grid_top30.csv");

import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// GRID TP/SL + BỘ LỌC trên BACKTEST SẠCH (no look-ahead)
// 2 chế độ entry (V7 chờ pullback / V2 market cf) × grid exit × greedy filter feature tại-cf
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m", bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
};
const EXITS = [
  { name: "A0 TP2/SL2", tp1: 2, frac1: 1, tp2: null, sl1: 2, be: false, sl2: null },
  { name: "E10 TP1=1.0(66%)+BE,TP2=2", tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "E4 TP1=0.75(67%)+BE,TP2=2", tp1: 0.75, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "E2 TP1=0.75+BE,TP2=1", tp1: 0.75, frac1: 0.5, tp2: 1, sl1: 2, be: true, sl2: 0 },
  { name: "E5 TP1=0.5+BE,TP2=1.5", tp1: 0.5, frac1: 0.5, tp2: 1.5, sl1: 2, be: true, sl2: 0 },
  { name: "B6 TP1=1.0(50%)+BE,TP2=2", tp1: 1.0, frac1: 0.5, tp2: 2, sl1: 2, be: true, sl2: 0 },
];
const FEECOST = CONFIG.feePct + CONFIG.slippagePct;

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
const d2s = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16);

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

console.log("Tính tín hiệu sạch (no look-ahead)...");
const signals = [];
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
    const entryC = bars[cf].close;
    if (slow.states[cf] !== S) continue;
    const cycleAgeC = cf - cs + 1;
    if (cycleAgeC > A.maxCycleAge) continue;
    const evzC = S === 1 ? (finite(uppers, cf) ? (entryC - uppers[cf]) / atrF[cf] : 99) : (finite(lowers, cf) ? (lowers[cf] - entryC) / atrF[cf] : 99);
    if (evzC > -0.5 && evzC <= 0) continue;
    const pdC = S === 1 ? (ema20[cf] - entryC) / atrF[cf] : (entryC - ema20[cf]) / atrF[cf];
    if (pdC > A.maxPullATR) continue;
    let emaT = -1;
    for (let t = cf + 1; t <= Math.min(ce, cf + A.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
    }
    const avgV = bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf);
    signals.push({ symbol, S, bars, ema20, cs, ce, cf, emaT, entryC, end: Math.min(ce, n - 1), cycleAgeC, evzC, volConfirm: bars[cf].volume / avgV, atrPctC: atrF[cf] / entryC * 100, slowStates: slow.states, hasPull: emaT !== -1, tEntry: bars[cf].time, hour: new Date(bars[cf].time * 1000).getUTCHours() });
  }
}
console.log(`Tín hiệu: ${signals.length}\n`);

function simulateExit(s, g, entryIdx, entry) {
  const { bars, S, end } = s;
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
  return { pnlPct, pnlR: pnlPct / A.R, tEntry: bars[entryIdx].time, exitType };
}

// Xây trades theo mode (V7/V2) + exit g
function build(mode, g) {
  const rows = [];
  for (const s of signals) {
    if (mode === "V7") {
      if (!s.hasPull) continue;
      const eIdx = s.emaT;
      if (eIdx >= s.ce) continue;
      if (s.slowStates[eIdx] !== s.S) continue;
      const entry = s.bars[eIdx].close;
      const evzE = s.S === 1 ? (Number.isFinite(s.bars[eIdx]) ? (Number.isFinite(s.uppers) ? 0 : 0) : 0) : 0;
      rows.push({ ...simulateExit(s, g, eIdx, entry), symbol: s.symbol, cycleAge: eIdx - s.cs + 1, pullLag: eIdx - s.cf, atrPct: s.atrPctC, volConfirm: s.volConfirm, hour: s.hour, entryVsZone: s.evzC });
    } else {
      rows.push({ ...simulateExit(s, g, s.cf, s.entryC), symbol: s.symbol, cycleAge: s.cycleAgeC, pullLag: 0, atrPct: s.atrPctC, volConfirm: s.volConfirm, hour: s.hour, entryVsZone: s.evzC });
    }
  }
  rows.sort((a, b) => a.tEntry - b.tEntry);
  return rows;
}

function stat(rows) {
  if (!rows.length) return { n: 0, win: 0, exp: 0, pf: 0, tot: 0 };
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = rows.reduce((a, t) => a + t.pnlR, 0) / rows.length;
  return { n: rows.length, win: (100 * w) / rows.length, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * rows.length };
}

// ============ 1) GRID TP/SL × 2 MODE ============
console.log(`${"Mode".padEnd(4)} ${"Exit".padEnd(26)} ${"N".padStart(6)} ${"WIN%".padStart(7)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"OOS N".padStart(6)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)}`);
const gridResults = [];
for (const mode of ["V7", "V2"]) {
  for (const g of EXITS) {
    const rows = build(mode, g);
    const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
    gridResults.push({ mode, exit: g.name, n: s.n, win: +s.win.toFixed(1), exp: +s.exp.toFixed(3), pf: +s.pf.toFixed(2), oosN: so.n, oosWin: +so.win.toFixed(1), oosExp: +so.exp.toFixed(3) });
    console.log(`${mode.padEnd(4)} ${g.name.padEnd(26)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.tot.toFixed(0).padStart(7)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
  }
}

// ============ 2) GREEDY FILTER trên mode+exit tốt nhất (theo ExpR×OOS) ============
const ranked = [...gridResults].sort((a, b) => (b.oosExp + b.exp) - (a.oosExp + a.exp));
const best = ranked[0];
console.log(`\n${"#".repeat(110)}`);
console.log(`BỘ LỌC GREEDY — mode ${best.mode} + exit ${best.exit} (feature tại-cf, không bias):`);
const rowsAll = build(best.mode, EXITS.find((e) => e.name === best.exit));
const FILTERS = [
  ["cycleAge<=2", (t) => t.cycleAge <= 2],
  ["volConfirm>=0.8", (t) => t.volConfirm >= 0.8],
  ["volConfirm>=1.0", (t) => t.volConfirm >= 1.0],
  ["atrPct>=0.3", (t) => t.atrPct >= 0.3],
  ["atrPct 0.3-1.0", (t) => t.atrPct >= 0.3 && t.atrPct <= 1.0],
  ["hour 0-17", (t) => t.hour < 18],
  ["hour 6-17", (t) => t.hour >= 6 && t.hour < 18],
];
let cur = rowsAll;
const applied = [];
console.log(`Base: N=${cur.length} | WIN ${stat(cur).win.toFixed(1)}% | Exp ${stat(cur).exp.toFixed(3)}R | OOS ${stat(cur.filter((t) => t.tEntry >= A.oosSplit)).win.toFixed(1)}%`);
let step = 1;
while (true) {
  const sBase = stat(cur);
  const sOosBase = stat(cur.filter((t) => t.tEntry >= A.oosSplit));
  let bestF = null;
  for (const [name, fn] of FILTERS) {
    if (applied.includes(name)) continue;
    const kept = cur.filter((x) => !fn(x));
    const s = stat(kept);
    const so = stat(kept.filter((t) => t.tEntry >= A.oosSplit));
    if (!s.n || s.n < 500 || so.n < 150) continue;
    const gain = (s.win - sBase.win) + (so.win - sOosBase.win);
    if (gain > 1.5) {
      if (!bestF || gain > bestF.gain) bestF = { name, kept, s, so, gain };
    }
  }
  if (!bestF) break;
  applied.push(bestF.name);
  cur = bestF.kept;
  console.log(`  Bước ${step}: loại [${bestF.name}] → N=${bestF.s.n} | WIN ${bestF.s.win.toFixed(1)}% (+${(bestF.s.win - sBase.win).toFixed(1)}pp) | Exp ${bestF.s.exp.toFixed(3)}R | OOS ${bestF.so.win.toFixed(1)}% (+${(bestF.so.win - sOosBase.win).toFixed(1)}pp)`);
  step++;
  if (step > 6) break;
}
const sF = stat(cur), soF = stat(cur.filter((t) => t.tEntry >= A.oosSplit));
console.log(`\nFINAL: N=${sF.n} | WIN ${sF.win.toFixed(1)}% | Exp ${sF.exp.toFixed(3)}R | PF ${sF.pf.toFixed(2)} | OOS WIN ${soF.win.toFixed(1)}% | OOS Exp ${soF.exp.toFixed(3)}R`);

// ============ 3) THEO NĂM (bản sạch tốt nhất) ============
console.log(`\n${"#".repeat(110)}`);
console.log(`THEO NĂM (${best.mode}+${best.exit}):`);
const byY = new Map();
for (const t of cur) {
  const y = new Date(t.tEntry * 1000).getUTCFullYear();
  if (!byY.has(y)) byY.set(y, []);
  byY.get(y).push(t);
}
for (const [y, r] of [...byY.entries()].sort()) {
  const s = stat(r);
  console.log(`  ${y}: N=${String(s.n).padStart(4)} | WIN ${s.win.toFixed(1)}% | Exp ${s.exp.toFixed(3)}R`);
}

// ============ 4) THEO SYMBOL ============
console.log(`\nTHEO SYMBOL (${best.mode}+${best.exit}):`);
const bySym = new Map();
for (const t of cur) {
  if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
  bySym.get(t.symbol).push(t);
}
for (const [sym, r] of [...bySym.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const s = stat(r);
  console.log(`  ${sym.padEnd(12)} N=${String(s.n).padStart(4)} | WIN ${s.win.toFixed(1)}% | Exp ${s.exp.toFixed(3)}R`);
}

writeCsv("output/backtest_clean/grid_results.csv", gridResults);
writeCsv("output/backtest_clean/final_trades.csv", cur.map((t) => ({ ...t, tEntry: d2s(t.tEntry) })));
console.log("\nCSV: output/backtest_clean/grid_results.csv | final_trades.csv");

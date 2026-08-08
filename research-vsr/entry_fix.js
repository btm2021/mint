import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// GIẢI QUYẾT VẤN ĐỀ ② — VÀO TRỄ TRONG CHU KỲ FAST
//   cycleAge 3-4 → win 51.5-52.6% (vs ≤2: 77.1%)
//   pullLag 2-4 (chờ hồi EMA20) → 51.1% (vs vào ngay: 77.0%)
//   pullDepth >0 (hồi thật) → 50-51% (vs không hồi: 72.9%)
// Test biến thể ENTRY (giữ exit E10 + A0 để đối chiếu):
//   V1 = hiện tại (chờ hồi emaT nếu có, else vào cf)
//   V2 = vào ngay tại cf (bỏ hẳn chờ hồi EMA20)
//   V3 = V2 + cycleAge(cf)<=2
//   V4 = V3 + volConfirm>=0.8 + atrPct>=0.3
//   V5 = V1 nhưng chỉ giữ lệnh KHÔNG có pullback
//   V6 = V2 + cycleAge(cf)<=2 + entryVsZone(cf)>0
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
};
const E10 = { name: "E10", tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 };
const A0 = { name: "A0", tp1: 2, frac1: 1, tp2: null, sl1: 2, be: false, sl2: null };

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

console.log("Tính dữ liệu + nhận diện tín hiệu VBT...");
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
    let emaT = -1;
    for (let t = cf + 1; t <= Math.min(ce, cf + A.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
    }
    const entryIdx = emaT !== -1 ? emaT : cf;
    const entry = bars[entryIdx].close;
    if (slow.states[entryIdx] !== S) continue;
    const cycleAge = entryIdx - cs + 1;
    if (cycleAge > A.maxCycleAge) continue;
    const entryVsZone = S === 1
      ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
      : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
    if (entryVsZone > -0.5 && entryVsZone <= 0) continue;
    const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];
    if (pullDepth > A.maxPullATR) continue;
    const end = Math.min(ce, n - 1);
    const avgV = bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf);
    signals.push({
      symbol, S, bars, ema20, atrF, uppers, lowers, cs, ce, cf, emaT, entryIdx, entry, end,
      cycleAge, pullLag: entryIdx - cf, pullDepth, entryVsZone,
      hasPull: emaT !== -1,
      volConfirm: bars[cf].volume / avgV,
      atrPct: atrF[entryIdx] / entry * 100,
      tEntry: bars[entryIdx].time,
      slowStates: slow.states,
    });
  }
}
console.log(`Tổng tín hiệu: ${signals.length}`);

const FEECOST = A.feePct + A.slippagePct;

function simulateExit(sig, g, entryIdx, entry) {
  const { bars, S, end } = sig;
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

// Biến thể entry — trả về {entryIdx, entry} hoặc null nếu bị lọc
function entryOf(sig, variant) {
  const { cf, cs, bars, ema20, atrF, uppers, lowers, S, slowStates, volConfirm, atrPct, entryVsZone } = sig;
  if (variant === "V1") return { entryIdx: sig.entryIdx, entry: sig.entry };
  if (variant === "V5" && sig.hasPull) return null;
  if (variant.startsWith("V2") || variant.startsWith("V3") || variant.startsWith("V4") || variant.startsWith("V6")) {
    const entryIdx = cf;
    const entry = bars[cf].close;
    if (slowStates[cf] !== S) return null;
    const cycleAgeCF = cf - cs + 1;
    if ((variant === "V3" || variant === "V4" || variant === "V6") && cycleAgeCF > 2) return null;
    if (variant === "V4" && (volConfirm < 0.8 || atrPct < 0.3)) return null;
    if (variant === "V6") {
      const finite2 = (arr, i) => Number.isFinite(arr[i]);
      const evz = S === 1 ? (finite2(uppers, cf) ? (entry - uppers[cf]) / atrF[cf] : 99) : (finite2(lowers, cf) ? (lowers[cf] - entry) / atrF[cf] : 99);
      if (evz <= 0) return null;
    }
    return { entryIdx, entry };
  }
  return { entryIdx: sig.entryIdx, entry: sig.entry };
}

function stat(rows) {
  if (!rows.length) return { n: 0, win: 0, exp: 0, pf: 0, tot: 0 };
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = rows.reduce((a, t) => a + t.pnlR, 0) / rows.length;
  return { n: rows.length, win: (100 * w) / rows.length, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * rows.length };
}
const build = (variant, exitG) => {
  const rows = [];
  for (const s of signals) {
    const e = entryOf(s, variant);
    if (!e) continue;
    rows.push(simulateExit(s, exitG, e.entryIdx, e.entry));
  }
  return rows;
};

console.log(`\n${"#".repeat(118)}`);
console.log("KẾT QUẢ — EXIT E10 (TP1=1.0(66%)+BE, TP2=2):");
console.log(`${"Entry variant".padEnd(38)} ${"N".padStart(6)} ${"WIN%".padStart(7)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"OOS N".padStart(6)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)}`);
for (const v of ["V1", "V2", "V3", "V4", "V5", "V6"]) {
  const rows = build(v, E10);
  const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
  console.log(`${v.padEnd(38)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.tot.toFixed(0).padStart(7)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
}

console.log(`\n${"#".repeat(118)}`);
console.log("KẾT QUẢ — EXIT A0 (TP2/SL2, đối chiếu):");
console.log(`${"Entry variant".padEnd(38)} ${"N".padStart(6)} ${"WIN%".padStart(7)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"OOS N".padStart(6)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)}`);
for (const v of ["V1", "V2", "V3", "V4", "V5", "V6"]) {
  const rows = build(v, A0);
  const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
  console.log(`${v.padEnd(38)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.tot.toFixed(0).padStart(7)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
}

// Chi tiết V2 theo cycleAge (tính từ cf) + theo pullLag
console.log(`\n${"#".repeat(118)}`);
console.log("[CHI TIẾT V2] winrate theo cycleAge (tính từ cf) và theo pullback:");
const v2Rows = [];
for (const s of signals) {
  const e = entryOf(s, "V2");
  if (!e) continue;
  v2Rows.push({ ...simulateExit(s, E10, e.entryIdx, e.entry), cycleAgeCF: s.cf - s.cs + 1, hasPull: s.hasPull, pullLag: s.emaT !== -1 ? s.emaT - s.cf : 0, entryVsZone: s.entryVsZone, pullDepth: s.pullDepth });
}
const grp = (keyFn, label) => {
  const g = new Map();
  for (const t of v2Rows) {
    const k = keyFn(t);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(t);
  }
  console.log(`\n  ${label}:`);
  for (const [k, rows] of g) {
    const s = stat(rows);
    const mark = s.n >= 100 && s.win <= 60 ? " ⚠️" : "";
    console.log(`    ${String(k).padEnd(16)} N=${String(s.n).padStart(5)} | WIN ${s.win.toFixed(1).padStart(5)}% | Exp ${s.exp.toFixed(2).padStart(6)}R${mark}`);
  }
};
grp((t) => t.cycleAgeCF, "CycleAge (cf - cs + 1)");
grp((t) => (t.hasPull ? "có pullback (emaT tìm thấy)" : "không pullback"), "Pullback");
grp((t) => (t.entryVsZone > 0 ? "entry trên zone" : t.entryVsZone > -0.5 ? "chạm zone" : "trong zone"), "Entry vs zone");

// CSV
const rowsOut = [];
for (const v of ["V1", "V2", "V3", "V4", "V5", "V6"]) {
  for (const [en, g] of [["E10", E10], ["A0", A0]]) {
    const rows = build(v, en === "E10" ? E10 : A0);
    const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
    rowsOut.push({ variant: v, exit: en, n: s.n, win: +s.win.toFixed(1), exp: +s.exp.toFixed(3), pf: +s.pf.toFixed(2), oosN: so.n, oosWin: +so.win.toFixed(1), oosExp: +so.exp.toFixed(3) });
  }
}
writeCsv("output/entry_fix/results.csv", rowsOut);
console.log("\nCSV: output/entry_fix/results.csv");

import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// VẤN ĐỀ ② — PHÂN TÍCH LOOK-AHEAD + CÁC PHIÊN BẢN ENTRY KHẢ THI
// ⚠️ Phát hiện: V1 (backtest_final hiện tại) có look-ahead bias ở nhánh
//    "không pullback → vào tại cf": để biết không có pullback phải nhìn tương lai 16 nến.
// Các phiên bản KHẢ THI trong live:
//   V2 : vào market ngay tại cf cho MỌI tín hiệu (không chờ pullback)
//   V7 : chỉ vào khi pullback thật xảy ra (chờ giá chạm EMA20, vào tại emaT)
//   V8 : V7 + bộ lọc (chỉ lấy pullback trong vòng 4 nến, shallow)
//   V2+filter : V2 + cycleAge<=2 + volConfirm>=0.8 + atr>=0.3 (biến thể không bias)
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

console.log("Tính dữ liệu + tín hiệu VBT...");
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
    // chỉ tính tại cf (không bias): các feature cần cho V2/V7
    const entryC = bars[cf].close;
    const evzC = S === 1 ? (finite(uppers, cf) ? (entryC - uppers[cf]) / atrF[cf] : 99) : (finite(lowers, cf) ? (lowers[cf] - entryC) / atrF[cf] : 99);
    const cycleAgeC = cf - cs + 1;
    const avgV = bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf);
    const end = Math.min(ce, n - 1);
    // lọc chuẩn VBT tại cf (biến thể V2) — áp dụng ngay tại vòng lặp
    if (slow.states[cf] !== S) continue;
    if (cycleAgeC > A.maxCycleAge) continue;
    if (evzC > -0.5 && evzC <= 0) continue;
    const pdC = S === 1 ? (ema20[cf] - entryC) / atrF[cf] : (entryC - ema20[cf]) / atrF[cf];
    if (pdC > A.maxPullATR) continue;
    signals.push({
      symbol, S, bars, ema20, cs, ce, cf, emaT, end, atrF, uppers, lowers,
      entryC, evzC, cycleAgeC,
      volConfirm: bars[cf].volume / avgV,
      atrPctC: atrF[cf] / entryC * 100,
      slowStates: slow.states,
      hasPull: emaT !== -1,
      tEntry: bars[cf].time,
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
  return { pnlPct, pnlR: pnlPct / A.R, tEntry: bars[entryIdx].time, exitType, entryIdx };
}

function stat(rows) {
  if (!rows.length) return { n: 0, win: 0, exp: 0, pf: 0, tot: 0 };
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = rows.reduce((a, t) => a + t.pnlR, 0) / rows.length;
  return { n: rows.length, win: (100 * w) / rows.length, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * rows.length };
}

// Xây trades theo variant (TẤT CẢ đều dùng dữ liệu ≤ thời điểm entry — không bias):
//   V2  : vào market tại cf (mọi tín hiệu hợp lệ)
//   V2F : V2 + cycleAge<=2 + volC>=0.8 + atr>=0.3
//   V7  : chờ pullback thật → vào tại emaT (kèm điều kiện bias slow tại emaT)
//   V7F : V7 + pullLag<=4 + pullDepth<=0.25 (pullback nhanh + nông)
const build = (variant, exitG) => {
  const rows = [];
  for (const s of signals) {
    if (variant === "V1") { // TÁI LẬP V1 (có bias) — để kiểm chứng
      if (!s.hasPull) continue; // KHÔNG: V1 vào cf khi không có pullback — đây chính là bias
      const eIdx = s.emaT;
      if (s.slowStates[eIdx] !== s.S) continue;
      if (eIdx - s.cf + 1 > 4) continue;
      const entry = s.bars[eIdx].close;
      const evzE = s.S === 1 ? (Number.isFinite(s.uppers[eIdx]) ? (entry - s.uppers[eIdx]) / s.atrF[eIdx] : 99) : (Number.isFinite(s.lowers[eIdx]) ? (s.lowers[eIdx] - entry) / s.atrF[eIdx] : 99);
      if (evzE > -0.5 && evzE <= 0) continue;
      const pd = s.S === 1 ? (s.ema20[eIdx] - entry) / s.atrF[eIdx] : (entry - s.ema20[eIdx]) / s.atrF[eIdx];
      if (pd > 0.5) continue;
      rows.push(simulateExit(s, exitG, eIdx, entry));
    } else if (variant === "V2" || variant === "V2F") {
      if (variant === "V2F" && (s.cycleAgeC > 2 || s.volConfirm < 0.8 || s.atrPctC < 0.3)) continue;
      rows.push(simulateExit(s, exitG, s.cf, s.entryC));
    } else { // V7 / V7F
      if (!s.hasPull) continue;
      const eIdx = s.emaT;
      if (s.slowStates[eIdx] !== s.S) continue;
      if (eIdx - s.cf + 1 > 4 || eIdx >= s.ce) continue;
      const entry = s.bars[eIdx].close;
      const evzE = s.S === 1 ? (Number.isFinite(s.uppers[eIdx]) ? (entry - s.uppers[eIdx]) / s.atrF[eIdx] : 99) : (Number.isFinite(s.lowers[eIdx]) ? (s.lowers[eIdx] - entry) / s.atrF[eIdx] : 99);
      if (evzE > -0.5 && evzE <= 0) continue;
      const pd = s.S === 1 ? (s.ema20[eIdx] - entry) / s.atrF[eIdx] : (entry - s.ema20[eIdx]) / s.atrF[eIdx];
      if (pd > 0.5) continue;
      if (variant === "V7F" && (eIdx - s.cf + 1 > 2 || pd > 0.25)) continue;
      rows.push(simulateExit(s, exitG, eIdx, entry));
    }
  }
  return rows;
};

const fmt = (v, exitG) => {
  const rows = build(v, exitG);
  const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
  console.log(`${v.padEnd(34)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.tot.toFixed(0).padStart(7)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
  return { v, n: s.n, win: s.win, exp: s.exp, pf: s.pf, oosN: so.n, oosWin: so.win, oosExp: so.exp };
};

console.log(`\n${"#".repeat(118)}`);
console.log("⚠️ PHÂN TÍCH LOOK-AHEAD: V1 cũ (vào cf khi không pullback) = cần biết tương lai → bỏ.");
console.log("Các variant DƯỚI ĐÂY đều khả thi live (chỉ dùng dữ liệu ≤ entry):");
console.log(`${"Variant".padEnd(34)} ${"N".padStart(6)} ${"WIN%".padStart(7)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"OOS N".padStart(6)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)}`);
console.log("— EXIT E10 —");
for (const v of ["V1", "V2", "V2F", "V7", "V7F"]) fmt(v, E10);
console.log("— EXIT A0 —");
for (const v of ["V1", "V2", "V2F", "V7", "V7F"]) fmt(v, A0);

// Phân tích pullback: pullback nhanh (1-2 nến) vs chậm (3-4 nến), nông vs sâu
console.log(`\n${"#".repeat(118)}`);
console.log("[CHI TIẾT V7] chất lượng pullback (vào tại emaT, E10):");
const v7Detail = [];
for (const s of signals) {
  if (!s.hasPull) continue;
  const eIdx = s.emaT;
  if (s.slowStates[eIdx] !== s.S) continue;
  if (eIdx - s.cf + 1 > 4 || eIdx >= s.ce) continue;
  const entry = s.bars[eIdx].close;
  const pd = s.S === 1 ? (s.ema20[eIdx] - entry) : (entry - s.ema20[eIdx]);
  v7Detail.push({ ...simulateExit(s, E10, eIdx, entry), pullLag: eIdx - s.cf, pullDepthR: pd / (entry * 0.01) });
}
const grp = (fn, label) => {
  const m = new Map();
  for (const t of v7Detail) {
    const k = fn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  console.log(`\n  ${label}:`);
  for (const [k, rows] of m) {
    const s = stat(rows);
    console.log(`    ${String(k).padEnd(20)} N=${String(s.n).padStart(5)} | WIN ${s.win.toFixed(1).padStart(5)}% | Exp ${s.exp.toFixed(2).padStart(6)}R${s.win <= 60 && s.n >= 100 ? " ⚠️" : ""}`);
  }
};
grp((t) => `lag ${t.pullLag}n`, "Thời gian chờ pullback (nến từ cf)");
grp((t) => (t.pullDepthR <= 0 ? "<=0 (giá thủng EMA)" : t.pullDepthR <= 0.25 ? "0-0.25% (nông)" : t.pullDepthR <= 0.5 ? "0.25-0.5%" : ">0.5% (sâu)"), "Độ sâu pullback (% giá)");

const rowsOut = [];
for (const [en, g] of [["E10", E10], ["A0", A0]]) {
  for (const v of ["V1", "V2", "V2F", "V7", "V7F"]) {
    const r = fmt(v, g);
    rowsOut.push({ variant: r.v, exit: en, n: r.n, win: +r.win.toFixed(1), exp: +r.exp.toFixed(3), pf: +r.pf.toFixed(2), oosN: r.oosN, oosWin: +r.oosWin.toFixed(1), oosExp: +r.oosExp.toFixed(3) });
  }
}
writeCsv("output/entry_fix/results_no_bias.csv", rowsOut);
console.log("\nCSV: output/entry_fix/results_no_bias.csv");

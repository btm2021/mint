import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { calcEma } from "./lib/indicators.js";

// TÌM FEATURE DỰ ĐOÁN NHÓM "KHÔNG PULLBACK" (win 92.4% trong bản ảo)
// Ý TƯỞNG: nhóm không pullback = momentum đủ mạnh để giá không quay lại EMA20 trong 16 nến.
// Nếu học được từ INDICATOR tại cf (dữ liệu ≤ cf, không look-ahead) → lọc được nhóm winrate cao thật.
// Phương pháp:
//   1. Nhãn Y = 1 nếu 16 nến tới KHÔNG có nến chạm EMA20 (không pullback)
//   2. Feature liên tục tại cf từ các indicator (không chỉ if/else):
//      - EMA20: khoảng cách giá-EMA, slope, slope-accel
//      - ATRBot slow: strength (khoảng trail1-trail2), trail2 spread, trend age
//      - ATRBot fast: cycle age, move từ flip, cycle length dự kiến
//      - VSR: zone width, zone age, entry vs zone
//      - Volume: volConfirm, volEntry, vol-accel
//   3. AUC từng feature + Logistic Regression (tổ hợp tuyến tính)
//   4. Áp dụng lọc theo probability → đo winrate/ExpR thật (bản sạch) + OOS
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
function standardize(mat, mean, sd) {
  return mat.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
}

console.log("Xây dataset: nhãn không-pullback × feature indicator tại cf...");
const X = [], Y = [], meta = [], barsMap = new Map();
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
  for (const z of zones) {
    for (let i = z.startIndex; i <= Math.min(z.endIndex, n - 1); i++) zStart[i] = z.startIndex;
  }
  const zW = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (finite(uppers, i) && finite(lowers, i)) zW[i] = (uppers[i] - lowers[i]) / bars[i].close * 100;
  }

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

    // NHÃN: 16 nến tới có nến nào chạm EMA20 không? (Y=1 nếu KHÔNG pullback)
    let pullback = false;
    for (let t = cf + 1; t <= Math.min(ce, cf + A.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { pullback = true; break; }
    }
    const y = pullback ? 0 : 1;

    // FEATURE TẠI CF (dữ liệu ≤ cf) — đầy đủ, liên tục
    const slowCyc = slowCycles.find((sc) => sc.start <= cf && sc.end >= cf) || slowCycles[0];
    const slowAge = cf - slowCyc.start;
    const slowLeftPct = slowCyc.end > cf ? (slowCyc.end - cf) / Math.max(1, slowCyc.end - slowCyc.start) : 0; // % bias còn lại
    const slowStr = Math.abs(slow.trail1[cf] - slow.trail2[cf]) / entry * 100;
    const trailSpread = finite(slow.trail2, cf) ? Math.abs(entry - slow.trail2[cf]) / atrF[cf] : 99;
    const distEma = S === 1 ? (entry - ema20[cf]) / atrF[cf] : (ema20[cf] - entry) / atrF[cf]; // giá cách EMA bao xa (hướng lệnh)
    const emaSlope = S === 1 ? (ema20[cf] - ema20[Math.max(0, cf - 5)]) / atrF[cf] : (ema20[Math.max(0, cf - 5)] - ema20[cf]) / atrF[cf];
    const emaSlope10 = S === 1 ? (ema20[cf] - ema20[Math.max(0, cf - 10)]) / atrF[cf] : (ema20[Math.max(0, cf - 10)] - ema20[cf]) / atrF[cf];
    const emaAccel = emaSlope - (S === 1 ? (ema20[cf - 5] - ema20[Math.max(0, cf - 10)]) / atrF[cf] : (ema20[Math.max(0, cf - 10)] - ema20[cf - 5]) / atrF[cf]);
    const moveFromFlip = S * (entry / bars[cs].close - 1) * 100;
    const volConfirm = bars[cf].volume / Math.max(1e-9, (bars.slice(Math.max(0, cf - 20), cf).reduce((a, b) => a + b.volume, 0) / Math.min(20, cf)));
    const volEntry = bars[cs].volume / Math.max(1e-9, (bars.slice(Math.max(0, cs - 20), cs).reduce((a, b) => a + b.volume, 0) / Math.min(20, cs)));
    const atrPct = atrF[cf] / entry * 100;
    const zoneWidth = Number.isFinite(zW[cf]) ? zW[cf] : NaN;
    const zoneAge = cf - zStart[cf];
    const fastLenSoFar = cf - cs + 1;
    const prevCycleLen = c > 0 ? fastCycles[c - 1].end - fastCycles[c - 1].start + 1 : NaN;
    const rangePct = (bars[cf].high - bars[cf].low) / entry * 100;
    const bodyPct = Math.abs(bars[cf].close - bars[cf].open) / entry * 100;
    const upBars5 = (() => { let u = 0; for (let t = Math.max(cs, cf - 5); t <= cf; t++) if (bars[t].close > bars[t].open) u++; return u; })();
    const volAccel = bars[cf].volume / Math.max(1e-9, bars[Math.max(0, cf - 3)].volume);

    X.push([distEma, emaSlope, emaSlope10, emaAccel, slowStr, trailSpread, slowAge, slowLeftPct, moveFromFlip, volConfirm, volEntry, atrPct, zoneWidth, zoneAge, fastLenSoFar, prevCycleLen, rangePct, bodyPct, upBars5, volAccel, evz]);
    Y.push(y);
    meta.push({ symbol, S, tEntry: bars[cf].time, cycleAge: fastLenSoFar, cf, ce, bars, entryIdx: cf, entry, end: Math.min(ce, n - 1) });
  }
}
console.log(`Dataset: ${Y.length} mẫu (không-pullback ${(100 * Y.reduce((a, b) => a + b, 0) / Y.length).toFixed(1)}%)`);

const FNAMES = ["distEma", "emaSlope5", "emaSlope10", "emaAccel", "slowStr", "trailSpread", "slowAge", "slowLeftPct", "moveFromFlip", "volConfirm", "volEntry", "atrPct", "zoneWidth", "zoneAge", "fastLen", "prevCycleLen", "rangePct", "bodyPct", "upBars5", "volAccel", "evz"];

// ===== 1) AUC từng feature =====
function aucSingle(xs, ys) {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const ranks = new Array(xs.length);
  idx.forEach((orig, r) => { ranks[orig] = r; });
  const nPos = ys.reduce((a, b) => a + b, 0), nNeg = ys.length - nPos;
  let sumR = 0;
  for (let i = 0; i < ys.length; i++) if (ys[i] === 1) sumR += ranks[i];
  return (sumR - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}
console.log(`\n${"#".repeat(90)}`);
console.log("[1] AUC TỪNG FEATURE (dự đoán KHÔNG pullback, dữ liệu ≤ cf):");
console.log(`${"Feature".padEnd(16)} ${"AUC".padStart(6)} ${"Ý nghĩa".padStart(40)}`);
const aucs = FNAMES.map((f, j) => {
  const xs = X.map((r) => r[j]);
  const clean = xs.map((v, i) => ({ v, y: Y[i] })).filter((o) => Number.isFinite(o.v));
  if (!clean.length) return { f, auc: 0.5 };
  return { f, auc: aucSingle(clean.map((o) => o.v), clean.map((o) => o.y)) };
}).sort((a, b) => b.auc - a.auc);
const SIG = {
  distEma: "giá cách EMA20 càng xa → càng khó pullback", emaSlope5: "EMA dốc cùng hướng", emaSlope10: "EMA dốc 10 nến", emaAccel: "EMA tăng tốc", slowStr: "bias slow mạnh (trail rộng)", trailSpread: "giá xa trail2", slowAge: "bias già", slowLeftPct: "% bias còn lại", moveFromFlip: "di chuyển từ flip", volConfirm: "volume nến confirm", volEntry: "volume nến flip", atrPct: "ATR%", zoneWidth: "zone rộng", zoneAge: "zone trẻ/cũ", fastLen: "tuổi fast cycle", prevCycleLen: "độ dài cycle trước", rangePct: "range nến cf", bodyPct: "thân nến cf", upBars5: "số nến xanh 5 gần nhất", volAccel: "volume tăng tốc", evz: "entry vs zone",
};
for (const { f, auc } of aucs) console.log(`  ${f.padEnd(16)} ${auc.toFixed(3).padStart(6)}   ${(SIG[f] || "").padEnd(40)}${auc > 0.55 ? " ✅" : auc < 0.45 ? " ⚠️ ngược" : ""}`);

// ===== 2) LOGISTIC REGRESSION (train < 2025, test ≥ 2025) =====
console.log(`\n${"#".repeat(90)}`);
console.log("[2] LOGISTIC REGRESSION — tổ hợp tuyến tính, OOS:");
const trainI = [], testI = [];
for (let i = 0; i < meta.length; i++) (meta[i].tEntry < A.oosSplit ? trainI : testI).push(i);
console.log(`  Train: ${trainI.length} | Test: ${testI.length}`);

// chọn feature: loại NaN, chuẩn hóa
const goodJ = FNAMES.map((_, j) => j).filter((j) => X.every((r) => Number.isFinite(r[j])));
const mean = goodJ.map((j) => X.reduce((a, r) => a + r[j], 0) / X.length);
const sd = goodJ.map((j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mean[goodJ.indexOf(j)]) ** 2, 0) / X.length));
const norm = (row) => goodJ.map((j, k) => (row[j] - mean[k]) / sd[k]);

// L2 logistic regression bằng gradient descent
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
const topW = w.map((v, k) => ({ f: FNAMES[goodJ[k]], v })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 8);
console.log("  Trọng số lớn nhất:", topW.map((t) => `${t.f}(${t.v.toFixed(2)})`).join(", "));

const auc = (idx) => aucSingle(idx.map((i) => predict(i)), idx.map((i) => Y[i]));
console.log(`  AUC train: ${auc(trainI).toFixed(3)} | AUC OOS: ${auc(testI).toFixed(3)}`);

// ===== 3) ÁP DỤNG: lọc theo probability → winrate/ExpR THẬT (bản sạch V2) =====
console.log(`\n${"#".repeat(90)}`);
console.log("[3] LỌC THEO PROBABILITY — winrate/ExpR thật (mode V2, exit E10, phí đủ):");
const FEECOST = A.feePct + A.slippagePct;
// mô phỏng exit E10
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
  return { pnlPct, pnlR: pnlPct / A.R };
}
const E10 = { tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 };
const allTrades = meta.map((m, i) => ({ ...simExit(m, E10), prob: predict(i), tEntry: m.tEntry, i }));
const probs = allTrades.map(t => t.prob);
console.log("  [debug] prob: min", Math.min(...probs).toFixed(3), "| max", Math.max(...probs).toFixed(3), "| mean", (probs.reduce((a,b)=>a+b,0)/probs.length).toFixed(3), "| >0.45:", probs.filter(p=>p>=0.45).length);
allTrades.sort((a, b) => a.tEntry - b.tEntry);
const stat = (rows) => {
  if (!rows.length) return null;
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  return { n: rows.length, win: (100 * w) / rows.length, exp: rows.reduce((a, t) => a + t.pnlR, 0) / rows.length, pf: gl > 0 ? gw / gl : Infinity };
};
const base = stat(allTrades);
console.log(`  BASE (không lọc): N=${base.n} | WIN ${base.win.toFixed(1)}% | Exp ${base.exp.toFixed(3)}R | PF ${base.pf.toFixed(2)}`);
// quantile từ TRAIN (không nhìn OOS để chọn ngưỡng)
const trainProbs = allTrades.filter((t) => t.tEntry < A.oosSplit).map((t) => t.prob).sort((a, b) => a - b);
const qOf = (p) => trainProbs[Math.floor(p * (trainProbs.length - 1))];
console.log(`\n  Lọc theo prob (ngưỡng = quantile TRAIN, giữ lệnh dự đoán KHÔNG pullback):`);
console.log(`  ${"Top % giữ".padEnd(10)} ${"Ngưỡng".padEnd(8)} ${"N".padStart(6)} ${"WIN%".padStart(7)} ${"ExpR".padStart(8)} ${"PF".padStart(6)} ${"OOS N".padStart(6)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)}`);
for (const [topPct, label] of [[0.1, "Top 10%"], [0.2, "Top 20%"], [0.3, "Top 30%"], [0.4, "Top 40%"], [0.5, "Top 50%"]]) {
  const th = qOf(1 - topPct);
  const k = allTrades.filter((t) => t.prob >= th);
  const s = stat(k), so = stat(k.filter((t) => t.tEntry >= A.oosSplit));
  if (!s || !so) continue;
  console.log(`  ${label.padEnd(10)} ${th.toFixed(2).padEnd(8)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(8)} ${s.pf.toFixed(2).padStart(6)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
}
console.log(`\n  Kiểm tra ngược: giữ Bottom (dự đoán CÓ pullback = nhóm yếu):`);
for (const bottomPct of [0.3, 0.5]) {
  const th = qOf(bottomPct);
  const k = allTrades.filter((t) => t.prob <= th);
  const s = stat(k), so = stat(k.filter((t) => t.tEntry >= A.oosSplit));
  if (!s || !so) continue;
  console.log(`  Bottom ${(100 * bottomPct).toFixed(0)}%              ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(8)} ${s.pf.toFixed(2).padStart(6)} ${String(so.n).padStart(6)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)}`);
}

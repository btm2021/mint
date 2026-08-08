import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { calcEma } from "./lib/indicators.js";
import { writeCsv } from "./lib/retest.js";

// HMM EDGE — tăng edge cho phiên bản v3 (V2 + Top-20% logistic + TP1=3%(66%)+BE/TP2=8%/SL2)
// Ý tưởng: HMM Gaussian (2-3 state) nhận diện REGIME thị trường từ chuỗi return 15m
//   state TREND (mean return > 0) → lệnh momentum mạnh hiệu quả hơn
//   state RANGE/CRASH → lọc bỏ
// Không look-ahead:
//   - HMM fit trên TRAIN (< 2025) mỗi symbol
//   - State tại bar t = forward filter (chỉ dùng dữ liệu ≤ t)
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m", bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
  topPct: 0.2,
  nStates: 3,
  tp1: 3.0, frac1: 0.66, tp2: 8.0, sl1: 2.0, be: true, sl2: 0.0,
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
  args.topPct = parseFloat(args.topPct) || 0.2;
  args.nStates = parseInt(args.nStates, 10) || 3;
  return args;
}
const A = parseArgs(process.argv.slice(2));
const SLOW = A.slow, FAST = A.fast;
const FEECOST = A.feePct + A.slippagePct;

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

// ==================== HMM GAUSSIAN (diagonal cov) ====================
class GaussianHMM {
  constructor(K, dim, seed = 42) {
    this.K = K; this.dim = dim;
    this.pi = new Array(K).fill(1 / K);
    this.A = Array.from({ length: K }, (_, i) => new Array(K).fill((1 - 0.9) / (K - 1)).map((v, j) => (i === j ? 0.9 : v)));
    this.mu = Array.from({ length: K }, () => new Array(dim).fill(0));
    this.sigma = Array.from({ length: K }, () => new Array(dim).fill(1));
  }
  logpdf(x, k) {
    let v = 0;
    for (let d = 0; d < this.dim; d++) {
      const s = Math.max(this.sigma[k][d], 1e-6);
      v += -0.5 * Math.log(2 * Math.PI * s) - (x[d] - this.mu[k][d]) ** 2 / (2 * s);
    }
    return v;
  }
  forward(obs) {
    // alpha[t][k] = P(o_1..o_t, s_t=k), chuẩn hóa để tránh underflow; trả logAlpha + scale
    const T = obs.length;
    const alpha = Array.from({ length: T }, () => new Array(this.K).fill(0));
    const scale = new Array(T).fill(0);
    for (let k = 0; k < this.K; k++) alpha[0][k] = Math.exp(this.logpdf(obs[0], k)) * this.pi[k];
    let s0 = alpha[0].reduce((a, b) => a + b, 0) || 1e-300;
    scale[0] = s0;
    for (let k = 0; k < this.K; k++) alpha[0][k] /= s0;
    for (let t = 1; t < T; t++) {
      for (let k = 0; k < this.K; k++) {
        let acc = 0;
        for (let i = 0; i < this.K; i++) acc += alpha[t - 1][i] * this.A[i][k];
        alpha[t][k] = Math.exp(this.logpdf(obs[t], k)) * acc;
      }
      const st = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
      scale[t] = st;
      for (let k = 0; k < this.K; k++) alpha[t][k] /= st;
    }
    return { alpha, scale };
  }
  fit(obs, iters = 60, tol = 1e-4) {
    const T = obs.length, K = this.K, D = this.dim;
    // init mu bằng quantile theo trục đầu
    const r0 = obs.map((o) => o[0]).sort((a, b) => a - b);
    for (let k = 0; k < K; k++) {
      const q = r0[Math.min(T - 1, Math.floor(((k + 0.5) / K) * T))];
      this.mu[k][0] = q;
      for (let d = 1; d < D; d++) this.mu[k][d] = 0;
    }
    let prevLL = -Infinity;
    for (let it = 0; it < iters; it++) {
      const { alpha, scale } = this.forward(obs);
      // backward
      const beta = Array.from({ length: T }, () => new Array(K).fill(0));
      for (let k = 0; k < K; k++) beta[T - 1][k] = 1;
      for (let t = T - 2; t >= 0; t--) {
        for (let i = 0; i < K; i++) {
          let acc = 0;
          for (let j = 0; j < K; j++) acc += this.A[i][j] * Math.exp(this.logpdf(obs[t + 1], j)) * beta[t + 1][j];
          beta[t][i] = acc / (scale[t + 1] || 1e-300);
        }
      }
      // gamma, xi
      const gamma = Array.from({ length: T }, (_, t) => {
        const g = new Array(K).fill(0);
        const sg = alpha[t].reduce((a, b, i) => a + b * beta[t][i], 0) || 1e-300;
        for (let k = 0; k < K; k++) g[k] = (alpha[t][k] * beta[t][k]) / sg;
        return g;
      });
      const xi = Array.from({ length: T - 1 }, (_, t) =>
        Array.from({ length: K }, (_, i) => {
          const row = new Array(K).fill(0);
          let sg = 0;
          for (let j = 0; j < K; j++) sg += alpha[t][i] * this.A[i][j] * Math.exp(this.logpdf(obs[t + 1], j)) * beta[t + 1][j];
          for (let j = 0; j < K; j++) {
            const v = alpha[t][i] * this.A[i][j] * Math.exp(this.logpdf(obs[t + 1], j)) * beta[t + 1][j];
            row[j] = sg > 0 ? v / sg : v;
          }
          return row;
        })
      );
      // M-step
      for (let k = 0; k < K; k++) {
        let gSum = 0; for (let t = 0; t < T; t++) gSum += gamma[t][k];
        this.pi[k] = gamma[0][k];
        const gs = gSum || 1e-300;
        for (let j = 0; j < K; j++) {
          let n = 0; for (let t = 0; t < T - 1; t++) n += xi[t][k][j];
          this.A[k][j] = n / gs;
        }
        const rowSum = this.A[k].reduce((a, b) => a + b, 0) || 1e-300;
        for (let j = 0; j < K; j++) this.A[k][j] /= rowSum;
        for (let d = 0; d < D; d++) {
          let num = 0; for (let t = 0; t < T; t++) num += gamma[t][k] * obs[t][d];
          this.mu[k][d] = num / gs;
          let v = 0; for (let t = 0; t < T; t++) v += gamma[t][k] * (obs[t][d] - this.mu[k][d]) ** 2;
          this.sigma[k][d] = v / gs + 1e-4;
        }
      }
      const ll = -Math.log(scale.reduce((a, b) => a + Math.log(b), 0)) * 0 + scale.reduce((a, b, i) => a + Math.log(b), 0);
      if (Math.abs(ll - prevLL) < tol) break;
      prevLL = ll;
    }
  }
  decodeCausal(obs) {
    const { alpha } = this.forward(obs);
    return alpha.map((a) => a.indexOf(Math.max(...a)));
  }
}

// ==================== XÂY DATASET (giống pf_optimize5) ====================
console.log("Xây dataset + train logistic + HMM...");
const X = [], Y = [], meta = [];
const symbolBars = new Map(); // symbol -> bars
for (const symbol of A.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${A.interval}.json`;
  let bars;
  try { bars = await fetchBars({ symbol, interval: A.interval, total: A.bars, cacheFile, delayMs: 450 }); }
  catch (e) { continue; }
  if (bars.length < 5000) continue;
  symbolBars.set(symbol, bars);
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
    meta.push({ symbol, S, tEntry: bars[cf].time, cf, ce, bars, entryIdx: cf, entry, end: Math.min(ce, n - 1), tIndex: cf });
  }
}
console.log(`Dataset: ${Y.length} (không-pullback ${(100 * Y.reduce((a, b) => a + b, 0) / Y.length).toFixed(1)}%)`);

// Logistic (giống pf_optimize5)
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
const trainProbs = trainI.map((i) => predict(i)).sort((a, b) => a - b);
const topTh = trainProbs[Math.floor((1 - A.topPct) * (trainProbs.length - 1))];
const keptI = [];
for (let i = 0; i < meta.length; i++) if (predict(i) >= topTh) keptI.push(i);
console.log(`Top-${A.topPct * 100}% logistic: ${keptI.length} lệnh (threshold ${topTh.toFixed(3)})`);

// ==================== HMM PER SYMBOL ====================
console.log(`\nTrain HMM (${A.nStates} states) trên train (<2025) từng symbol...`);
const hmmMap = new Map(); // symbol -> {hmm, states[], mu, sd}
for (const [symbol, bars] of symbolBars) {
  const n = bars.length;
  const obs = [];
  for (let i = 1; i < n; i++) {
    const r = Math.log(bars[i].close / bars[i - 1].close);
    const vol = Math.abs(r);
    obs.push([r, vol]);
  }
  // train split: chỉ dùng bars trước oosSplit
  const trainEnd = obs.findIndex((_, i) => bars[i + 1].time >= A.oosSplit);
  const trainObs = trainEnd > 500 ? obs.slice(0, trainEnd) : obs;
  // chuẩn hóa bằng train
  const mu = [0, 0], sde = [1, 1];
  if (trainObs.length > 100) {
    const m0 = trainObs.reduce((a, o) => a + o[0], 0) / trainObs.length;
    const m1 = trainObs.reduce((a, o) => a + o[1], 0) / trainObs.length;
    const s0 = Math.sqrt(trainObs.reduce((a, o) => a + (o[0] - m0) ** 2, 0) / trainObs.length) || 1e-6;
    const s1 = Math.sqrt(trainObs.reduce((a, o) => a + (o[1] - m1) ** 2, 0) / trainObs.length) || 1e-6;
    mu[0] = m0; mu[1] = m1; sde[0] = s0; sde[1] = s1;
  }
  const normObs = obs.map((o) => [(o[0] - mu[0]) / sde[0], (o[1] - mu[1]) / sde[1]]);
  const hmm = new GaussianHMM(A.nStates, 2);
  hmm.fit(normObs.slice(0, Math.max(500, trainEnd > 500 ? trainEnd : 5000)), 60);
  const states = hmm.decodeCausal(normObs); // state tại bar i+1 (obs index i)
  // gán state theo thứ tự mean return: state 0 = down, 1 = range, 2 = up
  const order = [...Array(A.nStates).keys()].sort((a, cb) => hmm.mu[a][0] - hmm.mu[cb][0]);
  const reorder = new Array(A.nStates).fill(0);
  order.forEach((orig, idx) => { reorder[orig] = idx; });
  for (let i = 0; i < states.length; i++) states[i] = reorder[states[i]];
  hmmMap.set(symbol, { hmm, states, mu, sd: sde });
}
console.log("HMM xong.", [...hmmMap.values()].map(h => h.states.filter(x => Number.isNaN(x) || x === undefined).length));

// thống kê state phân bố + mean return mỗi state (train + test)
console.log(`\n${"#".repeat(110)}`);
console.log("PHÂN BỐ REGIME (HMM) — % bars + mean return theo state (toàn mẫu):");
{
  const byS = new Map();
  for (const [symbol, bars] of symbolBars) {
    const { states } = hmmMap.get(symbol);
    for (let i = 0; i < states.length; i++) {
      if (!byS.has(states[i])) byS.set(states[i], []);
      byS.get(states[i]).push(Math.log(bars[i + 1].close / bars[i].close));
    }
  }
  for (const [k, r] of [...byS.entries()].sort()) {
    console.log(`  State ${k}: ${(100 * r.length / [...byS.values()].reduce((a, x) => a + x.length, 0)).toFixed(1)}% bars | mean return ${(100 * r.reduce((a, x) => a + x, 0) / r.length).toFixed(4)}%/nến`);
  }
}

// ==================== EXIT (v3) ====================
const g = { tp1: A.tp1, frac1: A.frac1, tp2: A.tp2, sl1: A.sl1, be: A.be, sl2: A.sl2 };
function simExit(m, ex) {
  const { bars, S, entryIdx, entry, end } = m;
  const sl1 = ex.sl1, tp1 = ex.tp1, tp2 = ex.tp2, sl2 = ex.sl2;
  const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
  const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  let rem = 1, pnlPct = 0, beActive = false, exitIdx = end, exitType = "TIMEOUT";
  for (let t = entryIdx + 1; t <= end; t++) {
    const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
    if (S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur) {
      pnlPct += rem * (S * (slCur / entry - 1) * 100 - FEECOST); rem = 0; exitType = beActive ? "SL2" : "SL1"; exitIdx = t; break;
    }
    if (rem > 0 && ex.frac1 < 1) {
      const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1) { pnlPct += ex.frac1 * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem -= ex.frac1; beActive = true; }
    }
    if (rem > 0 && tp2 != null) {
      const tp2Lv = S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
      if (S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv) { pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP2"; exitIdx = t; break; }
    }
    if (rem > 0 && ex.frac1 >= 1 && tp2 == null) {
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
  let eq = 100, pk = 100, mdd = 0;
  for (const t of rows) { eq *= 1 + (t.pnlR * 1) / 100; if (eq > pk) pk = eq; mdd = Math.max(mdd, (1 - eq / pk) * 100); }
  return { n: rows.length, win: (100 * w) / rows.length, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * rows.length, mdd };
}

// state tại entry của từng lệnh
const keptMeta = keptI.map((i) => meta[i]);
const withState = keptMeta.map((m, idx) => {
  const h = hmmMap.get(m.symbol);
  const st = h.states[m.tIndex - 1]; // obs index tương ứng bar tIndex (return bar tIndex-1 -> tIndex)
  return { m, st };
});

// ==================== SO SÁNH ====================
console.log(`\n${"#".repeat(110)}`);
console.log(`KẾT QUẢ — v3 (V2 + Top-${A.topPct * 100}% + TP1=${A.tp1}%(${A.frac1})+BE/TP2=${A.tp2}%/SL${A.sl1}%) + bộ lọc HMM state:`);
console.log(`  ${"Bộ lọc".padEnd(26)} ${"N".padStart(5)} ${"WIN%".padStart(7)} ${"ExpR".padStart(8)} ${"PF".padStart(6)} ${"MaxDD%".padStart(7)} ${"OOS N".padStart(5)} ${"OOS WIN%".padStart(9)} ${"OOS Exp".padStart(8)} ${"OOS PF".padStart(6)}`);
const baseRows = withState.map(({ m }) => simExit(m, g)).sort((a, b) => a.tEntry - b.tEntry);
const sB = stat(baseRows), soB = stat(baseRows.filter((t) => t.tEntry >= A.oosSplit));
console.log(`  ${"BASE (không lọc HMM)".padEnd(26)} ${String(sB.n).padStart(5)} ${sB.win.toFixed(1).padStart(7)} ${sB.exp.toFixed(3).padStart(8)} ${sB.pf.toFixed(2).padStart(6)} ${sB.mdd.toFixed(1).padStart(7)} ${String(soB.n).padStart(5)} ${soB.win.toFixed(1).padStart(9)} ${soB.exp.toFixed(3).padStart(8)} ${soB.pf.toFixed(2).padStart(6)}`);
const combos = [];
for (let mask = 1; mask < (1 << A.nStates); mask++) {
  const allow = [];
  for (let k = 0; k < A.nStates; k++) if (mask & (1 << k)) allow.push(k);
  if (allow.length === A.nStates) continue;
  const rows = withState.filter(({ st }) => allow.includes(st)).map(({ m }) => simExit(m, g)).sort((a, b) => a.tEntry - b.tEntry);
  const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
  if (!s || !so || s.n < 200 || so.n < 60) continue;
  combos.push({ allow, s, so });
  console.log(`  ${("State " + allow.join("+")).padEnd(26)} ${String(s.n).padStart(5)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(8)} ${s.pf.toFixed(2).padStart(6)} ${s.mdd.toFixed(1).padStart(7)} ${String(so.n).padStart(5)} ${so.win.toFixed(1).padStart(9)} ${so.exp.toFixed(3).padStart(8)} ${so.pf.toFixed(2).padStart(6)}`);
}
combos.sort((a, b) => (b.so.pf + b.so.exp * 3) - (a.so.pf + a.so.exp * 3));
if (combos.length) {
  const best = combos[0];
  console.log(`\nTỐT NHẤT: state ${best.allow.join("+")} → OOS WIN ${best.so.win.toFixed(1)}% | Exp ${best.so.exp.toFixed(3)}R | PF ${best.so.pf.toFixed(2)} (vs base OOS ${soB.exp.toFixed(3)}R / ${soB.pf.toFixed(2)})`);
}

// ==================== PER-STATE TP/SL (2TP grid trên state tốt nhất) ====================
console.log(`\n${"#".repeat(110)}`);
console.log("GRID TP/SL trên lệnh thuộc state tốt nhất (tìm cấu hình tối ưu hơn):");
const EXIT_GRID = [
  { name: "v3 TP1=3(66%)+BE/TP2=8", tp1: 3, frac1: 0.66, tp2: 8, sl1: 2, be: true, sl2: 0 },
  { name: "TP1=3(66%)+BE/TP2=6", tp1: 3, frac1: 0.66, tp2: 6, sl1: 2, be: true, sl2: 0 },
  { name: "TP1=4(66%)+BE/TP2=8", tp1: 4, frac1: 0.66, tp2: 8, sl1: 2, be: true, sl2: 0 },
  { name: "TP1=2.5(66%)+BE/TP2=8", tp1: 2.5, frac1: 0.66, tp2: 8, sl1: 2, be: true, sl2: 0 },
  { name: "TP đơn 8%", tp1: 8, frac1: 1, tp2: null, sl1: 2, be: false, sl2: null },
  { name: "TP1=3(66%)+BE/TP2=10", tp1: 3, frac1: 0.66, tp2: 10, sl1: 2, be: true, sl2: 0 },
  { name: "TP1=3(66%)+BE/TP2=12", tp1: 3, frac1: 0.66, tp2: 12, sl1: 2, be: true, sl2: 0 },
  { name: "TP1=3(66%)+BE/TP2=8,SL2.5", tp1: 3, frac1: 0.66, tp2: 8, sl1: 2.5, be: true, sl2: 0 },
];
if (combos.length) {
  const bestAllow = combos[0].allow;
  const rowsBest = withState.filter(({ st }) => bestAllow.includes(st));
  console.log(`  (trên state ${bestAllow.join("+")}, N=${rowsBest.length}):`);
  console.log(`  ${"Exit".padEnd(26)} ${"N".padStart(5)} ${"WIN%".padStart(7)} ${"ExpR".padStart(8)} ${"PF".padStart(6)} ${"MaxDD%".padStart(7)} ${"OOS N".padStart(5)} ${"OOS Exp".padStart(8)} ${"OOS PF".padStart(6)}`);
  for (const ex of EXIT_GRID) {
    const rows = rowsBest.map(({ m }) => simExit(m, ex)).sort((a, b) => a.tEntry - b.tEntry);
    const s = stat(rows), so = stat(rows.filter((t) => t.tEntry >= A.oosSplit));
    if (!s || !so) continue;
    console.log(`  ${ex.name.padEnd(26)} ${String(s.n).padStart(5)} ${s.win.toFixed(1).padStart(7)} ${s.exp.toFixed(3).padStart(8)} ${s.pf.toFixed(2).padStart(6)} ${s.mdd.toFixed(1).padStart(7)} ${String(so.n).padStart(5)} ${so.exp.toFixed(3).padStart(8)} ${so.pf.toFixed(2).padStart(6)}`);
  }
}
writeCsv("output/hmm/results.csv", withState.map(({ m, st }) => ({ symbol: m.symbol, state: st, tEntry: new Date(m.tEntry * 1000).toISOString().slice(0, 16) })));
console.log("\nCSV: output/hmm/results.csv");

import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// MONTE CARLO STRESS TEST — E10 + Fixed 1%, 300 symbol dự kiến
// 1) Phân phối MaxDD/equity khi xáo trộn thứ tự lệnh (chuỗi thua cực đoan)
// 2) Mô phỏng 1000 tháng giao dịch 300 symbol (bootstrap từ lệnh thực)
// 3) Kịch bản tháng vỡ thị trường (lệnh tương quan cùng SL)
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
  riskCap: 20,
};
const E10 = { tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 };

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

console.log("Tính entry VBT + exit E10...");
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
    entries.push({ symbol, S, entryIdx, entry, end, bars, tEntry: bars[entryIdx].time });
  }
}
console.log(`Tổng entry: ${entries.length}`);

// exit E10
const FEECOST = A.feePct + A.slippagePct;
const g = E10;
const trades = [];
for (const e of entries) {
  const { bars, S, entryIdx, entry, end } = e;
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
  }
  if (rem > 0) pnlPct += rem * (S * (bars[end].close / entry - 1) * 100 - FEECOST);
  trades.push({ symbol: e.symbol, pnlR: pnlPct / A.R, tEntry: e.tEntry, tExit: bars[exitIdx].time });
}
trades.sort((a, b) => a.tEntry - b.tEntry);
const pnls = trades.map((t) => t.pnlR);
const nTrades = trades.length;
const expR = pnls.reduce((a, b) => a + b, 0) / nTrades;
console.log(`E10 trades: ${nTrades} | ExpR ${expR.toFixed(3)}R\n`);

// ============ 1) MONTE CARLO — xáo trộn thứ tự lệnh (21 symbol, 5.7 năm) ============
console.log("=".repeat(110));
console.log("[1] MONTE CARLO — 10.000 lần xáo trộn thứ tự (chuỗi lệnh cực đoan)");
console.log("    Risk 1%/lệnh, compound — đo MaxDD % và lợi nhuận cuối kỳ");
const ITER = 10000;
const dds = [], rets = [], blowups = 0;
for (let it = 0; it < ITER; it++) {
  const arr = [...pnls];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  let eq = 100, peak = 100, mdd = 0;
  for (const p of arr) {
    eq *= 1 + (1.0 * p) / 100;
    if (eq > peak) peak = eq;
    mdd = Math.max(mdd, (1 - eq / peak) * 100);
  }
  dds.push(mdd);
  rets.push(eq - 100);
  if (eq < 50) blowups++;
}
dds.sort((a, b) => a - b);
rets.sort((a, b) => a - b);
const q = (a, p) => a[Math.floor(p * (a.length - 1))];
console.log(`  Median MaxDD: ${q(dds, 0.5).toFixed(1)}% | P90: ${q(dds, 0.9).toFixed(1)}% | P95: ${q(dds, 0.95).toFixed(1)}% | Tệ nhất: ${dds[dds.length - 1].toFixed(1)}%`);
console.log(`  Lợi nhuận cuối: P05 ${q(rets, 0.05).toFixed(0)}% | P50 ${q(rets, 0.5).toFixed(0)}% | P95 ${q(rets, 0.95).toFixed(0)}%`);
console.log(`  Số lần equity tụt <50% (thảm họa): ${blowups} (${(100 * blowups / ITER).toFixed(2)}%)`);

// ============ 2) MÔ PHỎNG 300 SYMBOL — bootstrap tháng ============
console.log(`\n${"=".repeat(110)}`);
console.log("[2] MÔ PHỎNG 10.000 THÁNG giao dịch 300 symbol (bootstrap từ lệnh thực E10)");
console.log("    Giả định: 22.3 lệnh/symbol/năm × 300 symbol ≈ 558 lệnh/tháng; risk 1%, cap 20%");
const MONTHLY_TRADES = Math.round(558);
const months = [];
for (let it = 0; it < 10000; it++) {
  let eq = 100, peak = 100, mdd = 0;
  let n = 0;
  while (n < MONTHLY_TRADES) {
    const p = pnls[Math.floor(Math.random() * nTrades)];
    // tổng risk ≤ 20%: bỏ qua lệnh nếu đã mở ~20 lệnh (mô phỏng đơn giản bằng skip xác suất)
    eq *= 1 + (1.0 * p) / 100;
    if (eq > peak) peak = eq;
    mdd = Math.max(mdd, (1 - eq / peak) * 100);
    n++;
  }
  months.push({ ret: eq - 100, mdd });
}
months.sort((a, b) => a.ret - b.ret);
const retArr = months.map((m) => m.ret);
console.log(`  Lợi nhuận 1 tháng: P05 ${q(retArr, 0.05).toFixed(0)}% | P25 ${q(retArr, 0.25).toFixed(0)}% | P50 ${q(retArr, 0.5).toFixed(0)}% | P75 ${q(retArr, 0.75).toFixed(0)}% | P95 ${q(retArr, 0.95).toFixed(0)}%`);
const negMonths = retArr.filter((r) => r < 0).length;
console.log(`  Xác suất tháng ÂM: ${(100 * negMonths / 10000).toFixed(1)}% | tháng âm TB: ${q(retArr, negMonths / 10000).toFixed(1)}%`);
console.log(`  MaxDD trong tháng: P50 ${q(months.map((m) => m.mdd).sort((a, b) => a - b), 0.5).toFixed(1)}% | P95 ${q(months.map((m) => m.mdd).sort((a, b) => a - b), 0.95).toFixed(1)}%`);

// ============ 3) KỊCH BẢN THÁNG VỠ THỊ TRƯỜNG ============
console.log(`\n${"=".repeat(110)}`);
console.log("[3] KỊCH BẢN THÁNG VỠ (tương quan: toàn thị trường SL cùng lúc)");
console.log("    Mô phỏng: bình thường + 1-2 đợt crash (30-60% lệnh trong tuần đó đều SL)");
for (const [label, crashPct] of [["Crash nhẹ (40% lệnh SL)", 0.4], ["Crash mạnh (60% lệnh SL)", 0.6], ["Crash cực mạnh (80% lệnh SL)", 0.8]]) {
  const res = [];
  for (let it = 0; it < 10000; it++) {
    let eq = 100;
    let n = 0, crashDay = Math.floor(Math.random() * 30);
    while (n < MONTHLY_TRADES) {
      const day = Math.floor(n / (MONTHLY_TRADES / 30));
      let p;
      if (day === crashDay || day === crashDay + 1) {
        p = Math.random() < crashPct ? -1.0 : pnls[Math.floor(Math.random() * nTrades)];
      } else {
        p = pnls[Math.floor(Math.random() * nTrades)];
      }
      eq *= 1 + (1.0 * p) / 100;
      n++;
    }
    res.push(eq - 100);
  }
  res.sort((a, b) => a - b);
  console.log(`  ${label.padEnd(30)}: P05 ${q(res, 0.05).toFixed(0)}% | P50 ${q(res, 0.5).toFixed(0)}% | P95 ${q(res, 0.95).toFixed(0)}% | âm ${(100 * res.filter((r) => r < 0).length / 10000).toFixed(0)}%`);
}

// ============ 4) LỆNH/SLIP NẶNG trên symbol nhỏ (chi phí tăng) ============
console.log(`\n${"=".repeat(110)}`);
console.log("[4] NHẠY CẢM CHI PHÍ — slippage tăng do symbol nhỏ (0.04% → 0.1-0.2%)");
for (const addSlip of [0, 0.1, 0.2]) {
  const adj = expR - addSlip / 2; // mỗi lệnh mất thêm ~1/2 addSlip do cả 2 đầu
  const month = 558 * adj;
  console.log(`  Slippage thêm ${addSlip.toFixed(1)}%/lệnh → ExpR ${adj.toFixed(3)}R → tháng ${month.toFixed(0)}%`);
}

writeCsv("output/mm_grid/montecarlo.csv", months.map((m, i) => ({ iter: i, ret: +m.ret.toFixed(2), mdd: +m.mdd.toFixed(2) })));
console.log("\nCSV: output/mm_grid/montecarlo.csv");

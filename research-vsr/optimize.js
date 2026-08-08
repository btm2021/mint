import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// TỐI ƯU: lọc lệnh SAI của hệ thống S3+F1+VSR(10,10)+TP2/SL2
// Ghi mọi feature của từng lệnh → tìm bucket lỗ → loại bỏ tuần tự (greedy) → winrate mới.
const FEE = 0.1;
const W_CONFIRM = 8;
const W_PULL = 16;
const SLOW = { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" };
const FAST = { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" };

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
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

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

console.log(`TỐI ƯU LỆNH SAI — hệ thống S3+F1+VSR(10,10)+TP2/SL2 — ${args.symbols.length} symbol`);
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

  // per-bar zone info
  const zStart = new Array(n).fill(-1);
  const zMerge = new Array(n).fill(0);
  for (const z of zones) {
    for (let i = z.startIndex; i <= Math.min(z.endIndex, n - 1); i++) {
      zStart[i] = z.startIndex;
      zMerge[i] = z.merges;
    }
  }

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
    if (slow.states[entryIdx] !== S) continue; // bias

    // TP2/SL2 exit
    const tpLv = S === 1 ? entry * 1.02 : entry * 0.98;
    const slLv = S === 1 ? entry * 0.98 : entry * 1.02;
    let pnl = null, hold = 0, exitType = "";
    const end = Math.min(ce, n - 1);
    for (let t = entryIdx + 1; t <= end; t++) {
      if (S === 1 ? bars[t].low <= slLv : bars[t].high >= slLv) { pnl = -2 - FEE; exitType = "SL"; hold = t - entryIdx; break; }
      if (S === 1 ? bars[t].high >= tpLv : bars[t].low <= tpLv) { pnl = 2 - FEE; exitType = "TP"; hold = t - entryIdx; break; }
    }
    if (pnl === null) { pnl = S * (bars[end].close / entry - 1) * 100 - FEE; exitType = "TIMEOUT"; hold = end - entryIdx; }

    // ---- Features ----
    const slowCyc = slowCycles.find((sc) => sc.start <= entryIdx && sc.end >= entryIdx) || slowCycles[0];
    const zoneW = finite(uppers, entryIdx) ? (uppers[entryIdx] - lowers[entryIdx]) / entry * 100 : 0;
    const entryVsZone = S === 1
      ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
      : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
    const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];
    const moveFromFlip = S * (entry / bars[cs].close - 1) * 100;
    const slowStrength = Math.abs(slow.trail1[entryIdx] - slow.trail2[entryIdx]) / entry * 100;

    trades.push({
      symbol, S, pnl: +pnl.toFixed(3), win: pnl > 0 ? 1 : 0, exitType, hold,
      fastCycleLen: entryIdx - cs + 1,
      slowAge: entryIdx - slowCyc.start,
      confLag: cf - cs,
      pullLag: entryIdx - cf,
      pullDepth: +pullDepth.toFixed(2),
      entryVsZone: +entryVsZone.toFixed(2),
      volConfirm: +((bars[cf].volume / avgVolume(bars, cf)) || 0).toFixed(2),
      volEntry: +((bars[entryIdx].volume / avgVolume(bars, entryIdx)) || 0).toFixed(2),
      atrPct: +((atrF[entryIdx] / entry) * 100).toFixed(2),
      zoneWidth: +zoneW.toFixed(2),
      zoneAge: cf - zStart[cf],
      zoneMerged: zMerge[cf],
      slowStrength: +slowStrength.toFixed(2),
      moveFromFlip: +moveFromFlip.toFixed(2),
      emaSlope: ema20[entryIdx] > ema20[entryIdx - 3] ? 1 : -1,
      hour: new Date(bars[entryIdx].time * 1000).getUTCHours(),
      rangePct: +(((bars[entryIdx].high - bars[entryIdx].low) / entry) * 100).toFixed(2),
    });
  }
}

// ==================== PHÂN TÍCH ====================
const stat = (rows) => {
  const n = rows.length;
  if (!n) return null;
  const win = rows.filter((r) => r.win).length;
  const avg = rows.reduce((a, r) => a + r.pnl, 0) / n;
  const total = rows.reduce((a, r) => a + r.pnl, 0);
  return { n, win: (100 * win) / n, avg, total };
};
const base = stat(trades);
console.log(`\n[0] BASE (${trades.length} lệnh): WIN ${base.win.toFixed(1)}% | TB ${base.avg.toFixed(2)}% | Tổng ${base.total.toFixed(0)}%`);
console.log(`    Exit types: TP ${trades.filter((t) => t.exitType === "TP").length} | SL ${trades.filter((t) => t.exitType === "SL").length} | TIMEOUT ${trades.filter((t) => t.exitType === "TIMEOUT").length}`);

const FEATURES = [
  { key: "fastCycleLen", name: "Tuổi fast cycle tại entry", buckets: (v) => (v <= 4 ? "<=4 (whipsaw)" : v <= 12 ? "5-12" : v <= 24 ? "13-24" : ">24") },
  { key: "slowAge", name: "Tuổi bias slow (nến)", buckets: (v) => (v <= 8 ? "<=8 (bias mới)" : v <= 24 ? "9-24" : v <= 60 ? "25-60" : ">60 (bias già)") },
  { key: "confLag", name: "Lag flip→confirm", buckets: (v) => (v <= 1 ? "0-1" : v <= 3 ? "2-3" : "4-7") },
  { key: "pullLag", name: "Lag confirm→entry (pullback)", buckets: (v) => (v <= 1 ? "0-1 (vào ngay)" : v <= 4 ? "2-4" : v <= 8 ? "5-8" : "9-16 (hồi sâu)") },
  { key: "pullDepth", name: "Độ sâu pullback (ATR)", buckets: (v) => (v <= 0 ? "<=0 (không hồi)" : v <= 0.5 ? "0-0.5" : v <= 1 ? "0.5-1" : v <= 2 ? "1-2" : ">2 (hồi quá sâu)") },
  { key: "entryVsZone", name: "Vị trí entry vs zone (ATR)", buckets: (v) => (v <= -0.5 ? "TRONG zone sâu" : v <= 0 ? "chạm zone" : v <= 0.5 ? "0-0.5" : v <= 1.5 ? "0.5-1.5" : ">1.5 (xa zone)") },
  { key: "volConfirm", name: "Volume nến confirm", buckets: (v) => (v <= 0.8 ? "<=0.8x" : v <= 1.2 ? "0.8-1.2" : v <= 2 ? "1.2-2" : ">2x") },
  { key: "volEntry", name: "Volume nến entry", buckets: (v) => (v <= 0.8 ? "<=0.8x" : v <= 1.2 ? "0.8-1.2" : v <= 2 ? "1.2-2" : ">2x") },
  { key: "atrPct", name: "ATR/giá tại entry (%)", buckets: (v) => (v <= 0.3 ? "<=0.3" : v <= 0.6 ? "0.3-0.6" : v <= 1 ? "0.6-1" : ">1") },
  { key: "zoneWidth", name: "Độ rộng zone (%)", buckets: (v) => (v <= 0.3 ? "<=0.3" : v <= 0.7 ? "0.3-0.7" : ">0.7") },
  { key: "zoneAge", name: "Tuổi zone tại confirm", buckets: (v) => (v <= 4 ? "<=4 (mới)" : v <= 12 ? "5-12" : v <= 30 ? "13-30" : ">30 (cũ)") },
  { key: "zoneMerged", name: "Zone đã gộp", buckets: (v) => (v >= 1 ? "có gộp" : "không gộp") },
  { key: "slowStrength", name: "Sức mạnh bias (%)", buckets: (v) => (v <= 0.1 ? "<=0.1 (yếu)" : v <= 0.3 ? "0.1-0.3" : v <= 0.7 ? "0.3-0.7" : ">0.7 (mạnh)") },
  { key: "moveFromFlip", name: "Di chuyển flip→entry (%)", buckets: (v) => (v <= 1 ? "<=1" : v <= 2 ? "1-2" : v <= 4 ? "2-4" : ">4") },
  { key: "emaSlope", name: "EMA slope vs hướng lệnh", buckets: (v, r) => (v === r.S ? "cùng hướng" : "ngược hướng") },
  { key: "hour", name: "Giờ UTC entry", buckets: (v) => (v < 6 ? "0-5" : v < 12 ? "6-11" : v < 18 ? "12-17" : "18-23") },
  { key: "S", name: "Hướng cycle", buckets: (v) => (v === 1 ? "UP" : "DOWN") },
];

console.log(`\n[1] WINRATE THEO BUCKET (base ${base.win.toFixed(1)}% — bucket dưới ~52% là LỆNH SAI):`);
const candidates = [];
for (const f of FEATURES) {
  const groups = new Map();
  for (const t of trades) {
    const b = f.buckets(t[f.key], t);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(t);
  }
  console.log(`\n  ${f.name}:`);
  for (const [label, rows] of groups) {
    const s = stat(rows);
    const flag = s.win <= base.win - 4 && s.n >= 100 ? " ⚠️ LỆNH SAI" : "";
    console.log(`    ${label.padEnd(22)} N=${String(s.n).padStart(6)} | WIN ${s.win.toFixed(1).padStart(5)}% | TB ${s.avg.toFixed(2).padStart(6)}%${flag}`);
    if (flag && s.avg < base.avg - 0.05) {
      candidates.push({ feature: f.name, bucket: label, cond: (t) => f.buckets(t[f.key], t) === label, n: s.n, win: s.win, avg: s.avg });
    }
  }
}

// ==================== TỐI ƯU GREEDY ====================
console.log(`\n${"#".repeat(100)}`);
console.log("[2] TỐI ƯU TUẦN TỰ (loại bucket lỗ, yêu cầu N còn >= 2500):");
let current = trades;
const applied = [];
let step = 1;
while (true) {
  const sBase = stat(current);
  let best = null;
  for (const cand of candidates) {
    if (applied.some((a) => a.feature === cand.feature && a.bucket === cand.bucket)) continue;
    const kept = current.filter((t) => !cand.cond(t));
    const s = stat(kept);
    if (!s || s.n < 2500) continue;
    const gain = s.win - sBase.win;
    if (gain > 0.5 && s.avg >= 0.15) {
      if (!best || gain > best.gain) best = { cand, kept, s, gain };
    }
  }
  if (!best) break;
  applied.push(best.cand);
  current = best.kept;
  console.log(`  Bước ${step}: LOẠI [${best.cand.feature} = ${best.cand.bucket}] (nhóm lỗ N=${best.cand.n}, win ${best.cand.win.toFixed(1)}%)`);
  console.log(`    -> còn N=${best.s.n} | WIN ${best.s.win.toFixed(1)}% (tăng +${best.gain.toFixed(1)}pp) | TB ${best.s.avg.toFixed(2)}% | Tổng ${best.s.total.toFixed(0)}%`);
  step++;
}

console.log(`\n${"#".repeat(100)}`);
const sFinal = stat(current);
console.log("[3] HỆ THỐNG TỐI ƯU:");
console.log(`  Base : N=${trades.length} | WIN ${base.win.toFixed(1)}% | TB ${base.avg.toFixed(2)}% | Tổng ${base.total.toFixed(0)}%`);
console.log(`  Tối ưu: N=${sFinal.n} | WIN ${sFinal.win.toFixed(1)}% (+${(sFinal.win - base.win).toFixed(1)}pp) | TB ${sFinal.avg.toFixed(2)}% | Tổng ${sFinal.total.toFixed(0)}%`);
console.log(`  Filters áp dụng (${applied.length}):`);
for (const a of applied) console.log(`    - KHÔNG trade khi [${a.feature} = ${a.bucket}]`);

console.log(`\n  THEO SYMBOL (hệ thống tối ưu):`);
console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(6)} ${"Win%".padStart(7)} ${"TB%".padStart(8)} ${"Tổng%".padStart(8)}`);
const bySym = new Map();
for (const t of current) {
  if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
  bySym.get(t.symbol).push(t);
}
let neg = 0;
for (const [sym, rows] of [...bySym.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const s = stat(rows);
  if (s.avg < 0) neg++;
  console.log(`  ${sym.padEnd(12)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(7)} ${s.avg.toFixed(2).padStart(8)} ${s.total.toFixed(0).padStart(8)}`);
}
console.log(`  Số symbol âm: ${neg}/${bySym.size}`);

writeCsv("output/optimize/trades.csv", trades);
writeCsv("output/optimize/filtered_trades.csv", current);
writeCsv("output/optimize/filters.csv", applied.map((a) => ({ feature: a.feature, bucket: a.bucket, removedN: a.n, removedWin: +a.win.toFixed(1) })));
console.log("\nCSV đã lưu trong research-vsr/output/optimize/");

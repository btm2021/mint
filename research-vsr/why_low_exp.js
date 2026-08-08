import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { calcEma } from "./lib/indicators.js";

// TẠI SAO WINRATE CAO MÀ EXPR THẤP?
// Phân rã PnL theo LOẠI THOÁT cho E4/E5/E10 trên bản sạch:
//   SL1 = SL gốc (-2R) | SL2 = thoát tại BE sau TP1 | TP2 = chạm TP thứ 2 | TIMEOUT
// + Phân phối R-multiple + avgWin/avgLoss → chỉ ra đúng cơ chế "thắng ít, thua đủ"
const CONFIG = {
  symbols: "XLMUSDT,SAGAUSDT,BICOUSDT,PHAUSDT",
  interval: "5m", bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  feePct: 0.1, slippagePct: 0.04, R: 2,
};
const EXITS = [
  { name: "E4 TP1=0.75(67%)+BE,TP2=2", tp1: 0.75, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "E5 TP1=0.5(50%)+BE,TP2=1.5", tp1: 0.5, frac1: 0.5, tp2: 1.5, sl1: 2, be: true, sl2: 0 },
  { name: "E10 TP1=1.0(66%)+BE,TP2=2", tp1: 1.0, frac1: 0.66, tp2: 2, sl1: 2, be: true, sl2: 0 },
  { name: "A0 TP2/SL2", tp1: 2, frac1: 1, tp2: null, sl1: 2, be: false, sl2: null },
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

console.log(`Phân tích cấu trúc lệnh — ${A.symbols.length} symbol ${A.interval} (bản sạch, mode V2)`);
console.log("=".repeat(110));
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
    if (cf - cs + 1 > A.maxCycleAge) continue;
    const evzC = S === 1 ? (finite(uppers, cf) ? (entryC - uppers[cf]) / atrF[cf] : 99) : (finite(lowers, cf) ? (lowers[cf] - entryC) / atrF[cf] : 99);
    if (evzC > -0.5 && evzC <= 0) continue;
    const pdC = S === 1 ? (ema20[cf] - entryC) / atrF[cf] : (entryC - ema20[cf]) / atrF[cf];
    if (pdC > A.maxPullATR) continue;
    signals.push({ S, bars, entryIdx: cf, entry: entryC, end: Math.min(ce, n - 1) });
  }
}
console.log(`Tín hiệu: ${signals.length}`);

function simulate(s, g) {
  const { bars, S, entryIdx, entry, end } = s;
  const sl1 = g.sl1, tp1 = g.tp1, tp2 = g.tp2, sl2 = g.sl2;
  const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
  const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  let rem = 1, pnlPct = 0, beActive = false, exitIdx = end, exitType = "TIMEOUT";
  let hitTp1 = false;
  for (let t = entryIdx + 1; t <= end; t++) {
    const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
    if (S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur) {
      pnlPct += rem * (S * (slCur / entry - 1) * 100 - FEECOST); rem = 0; exitType = beActive ? "SL2" : "SL1"; exitIdx = t; break;
    }
    if (rem > 0 && g.frac1 < 1 && !hitTp1) {
      const hitTp1b = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1b) {
        pnlPct += g.frac1 * (S * (tp1Lv / entry - 1) * 100 - FEECOST);
        rem -= g.frac1; beActive = true; hitTp1 = true;
      }
    }
    if (rem > 0 && tp2 != null) {
      const tp2Lv = S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
      if (S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv) { pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP2"; exitIdx = t; break; }
    }
    if (rem > 0 && g.frac1 >= 1 && tp2 == null) {
      const hitTp1b = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1b) { pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP1"; exitIdx = t; break; }
    }
  }
  if (rem > 0) pnlPct += rem * (S * (bars[end].close / entry - 1) * 100 - FEECOST);
  return { pnlR: pnlPct / A.R, exitType, hitTp1 };
}

for (const g of EXITS) {
  const rows = signals.map((s) => ({ ...simulate(s, g), s }));
  const n = rows.length;
  const wins = rows.filter((r) => r.pnlR > 0);
  const losses = rows.filter((r) => r.pnlR <= 0);
  const avgW = wins.reduce((a, r) => a + r.pnlR, 0) / wins.length;
  const avgL = losses.reduce((a, r) => a + r.pnlR, 0) / losses.length;
  const tot = rows.reduce((a, r) => a + r.pnlR, 0);
  const exp = tot / n;
  // phân rã theo loại thoát
  const byExit = new Map();
  for (const r of rows) {
    if (!byExit.has(r.exitType)) byExit.set(r.exitType, []);
    byExit.get(r.exitType).push(r);
  }
  console.log(`\n${"#".repeat(110)}`);
  console.log(`${g.name} | N=${n} | WIN ${(100 * wins.length / n).toFixed(1)}% | ExpR ${exp.toFixed(3)}R | avgW +${avgW.toFixed(3)}R | avgL ${avgL.toFixed(3)}R`);
  console.log(`  ${"Loại thoát".padEnd(12)} ${"N".padStart(6)} ${"%".padStart(5)} ${"Tổng R".padStart(8)} ${"Đóng góp %".padStart(10)}`);
  for (const [k, r] of byExit) {
    const t = r.reduce((a, x) => a + x.pnlR, 0);
    console.log(`  ${k.padEnd(12)} ${String(r.length).padStart(6)} ${(100 * r.length / n).toFixed(1).padStart(5)} ${t.toFixed(0).padStart(8)} ${(100 * t / tot).toFixed(1).padStart(10)}`);
  }
  // R-multiple buckets
  const buckets = { "<-0.5R": 0, "-0.5..0R": 0, "0..0.25R": 0, "0.25-0.5R": 0, "0.5-0.75R": 0, "0.75-1R": 0, ">=1R": 0 };
  for (const r of rows) {
    const x = r.pnlR;
    if (x < -0.5) buckets["<-0.5R"]++;
    else if (x < 0) buckets["-0.5..0R"]++;
    else if (x < 0.25) buckets["0..0.25R"]++;
    else if (x < 0.5) buckets["0.25-0.5R"]++;
    else if (x < 0.75) buckets["0.5-0.75R"]++;
    else if (x < 1) buckets["0.75-1R"]++;
    else buckets[">=1R"]++;
  }
  console.log(`  R-buckets:`);
  for (const [k, v] of Object.entries(buckets)) console.log(`    ${k.padEnd(12)}: ${String(v).padStart(5)} (${(100 * v / n).toFixed(1)}%)`);
}

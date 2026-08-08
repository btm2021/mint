import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// ============================================================
// BACKTEST CHUYÊN NGHIỆP — HỆ THỐNG "VSR-BIAS TREND" (VBT)
// ------------------------------------------------------------
// BIAS  : ATRBot(20, 3, 30, VIDYA) — chỉ trade khi slow state = hướng lệnh
// ENTRY : ATRBot(14, 2, 14, VIDYA) vừa đảo state
//         + VSR(10,10) xuôi-confirm trong 8 nến (cắt zone cùng hướng + close qua EMA20)
//         + chạm EMA20 trong 16 nến sau confirm
//         + tuổi fast cycle ≤ 4 nến | không entry tại biên zone | hồi ≤ 0.5 ATR
// EXIT  : TP 2% / SL 2% (SL ưu tiên cùng nến) | time-stop = fast flip close
// CHI PHÍ: phí taker 0.05% × 2 + slippage 0.02% × 2
// VỐN   : risk cố định 1% equity/lệnh (vị thế = 1% / 2% SL = 50% equity)
// ============================================================
const CONFIG = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  tpPct: 2.0, slPct: 2.0,
  feePct: 0.1, slippagePct: 0.04,       // khứ hồi
  riskPerTrade: 1.0,                    // % equity rủi ro/lệnh
  oosSplit: Date.UTC(2025, 0, 1) / 1000,
};
function parseArgs(argv) {
  const args = { ...CONFIG };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
      if (val) args[key] = val;
    }
  }
  if (typeof args.symbols === "string") args.symbols = args.symbols.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  args.bars = parseInt(args.bars, 10) || 200000;
  return args;
}
const C = parseArgs(process.argv.slice(2));
const R = C.slPct;
const SLOW = C.slow, FAST = C.fast;

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
const d2s = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16);

console.log("=".repeat(110));
console.log("BACKTEST CHUYÊN NGHIỆP — HỆ THỐNG VBT (VSR-Bias Trend):");
console.log(`  BIAS : ATRBot(${SLOW.atrLen},${SLOW.mult},${SLOW.maLen},${SLOW.maType}) | ENTRY: ATRBot(${FAST.atrLen},${FAST.mult},${FAST.maLen},${FAST.maType}) + VSR(${C.vsrLen},${C.vsrThr})`);
console.log(`  RULES: confirm ${C.wConfirm}n | pull ${C.wPull}n | cycleAge<=${C.maxCycleAge} | pull<=${C.maxPullATR}ATR | không entry tại biên zone`);
console.log(`  EXIT : TP ${C.tpPct}% / SL ${C.slPct}% (1R) | time-stop fast flip | phí+slippage ${(C.feePct + C.slippagePct).toFixed(2)}%/lệnh khứ hồi`);
console.log(`  VỐN : risk ${C.riskPerTrade}%/lệnh (vị thế ${(C.riskPerTrade / R * 100).toFixed(0)}% equity) | ${C.symbols.length} symbol ${C.interval}`);
console.log("=".repeat(110));

const trades = [];
for (const symbol of C.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${C.interval}.json`;
  let bars;
  try { bars = await fetchBars({ symbol, interval: C.interval, total: C.bars, cacheFile, delayMs: 450 }); }
  catch (e) { console.log(`BỎ QUA ${symbol}`); continue; }
  if (bars.length < 5000) continue;
  const n = bars.length;
  const ema20 = calcEma(bars, 20);
  const atrF = atrOf(bars, FAST.atrLen);
  const { uppers, lowers } = calculateVSR(bars, C.vsrLen, C.vsrThr);
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
    for (let i = cs; i <= Math.min(ce - 1, cs + C.wConfirm - 1); i++) {
      const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
      const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
      if (xuoi && emaOk) { cf = i; break; }
    }
    if (cf === -1 || cf >= ce) continue;
    let emaT = -1;
    for (let t = cf + 1; t <= Math.min(ce, cf + C.wPull); t++) {
      if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
    }
    const entryIdx = emaT !== -1 ? emaT : cf;
    const entry = bars[entryIdx].close;
    if (slow.states[entryIdx] !== S) continue;
    const cycleAge = entryIdx - cs + 1;
    if (cycleAge > C.maxCycleAge) continue;
    const entryVsZone = S === 1
      ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
      : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
    if (entryVsZone > -0.5 && entryVsZone <= 0) continue;
    const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];
    if (pullDepth > C.maxPullATR) continue;

    const tpLv = S === 1 ? entry * (1 + C.tpPct / 100) : entry * (1 - C.tpPct / 100);
    const slLv = S === 1 ? entry * (1 - C.slPct / 100) : entry * (1 + C.slPct / 100);
    let exitType = "TIMEOUT", exitPx = null, exitIdx = ce;
    const end = Math.min(ce, n - 1);
    for (let t = entryIdx + 1; t <= end; t++) {
      if (S === 1 ? bars[t].low <= slLv : bars[t].high >= slLv) { exitType = "SL"; exitPx = slLv; exitIdx = t; break; }
      if (S === 1 ? bars[t].high >= tpLv : bars[t].low <= tpLv) { exitType = "TP"; exitPx = tpLv; exitIdx = t; break; }
    }
    if (exitType === "TIMEOUT") { exitPx = bars[end].close; exitIdx = end; }
    const pnlPct = S * (exitPx / entry - 1) * 100 - C.feePct - C.slippagePct;
    const pnlR = pnlPct / R;
    const slowCyc = slowCycles.find((sc) => sc.start <= entryIdx && sc.end >= entryIdx) || slowCycles[0];
    trades.push({
      symbol, S, tEntry: bars[entryIdx].time, tExit: bars[exitIdx].time,
      entry, exitPx: +exitPx.toFixed(6), exitType, hold: exitIdx - entryIdx + 1,
      pnlPct: +pnlPct.toFixed(3), pnlR: +pnlR.toFixed(3),
      cycleAge, slowAge: entryIdx - slowCyc.start, cfLag: cf - cs, pullLag: entryIdx - cf,
    });
  }
}
trades.sort((a, b) => a.tEntry - b.tEntry);

// ==================== EQUITY & METRICS ====================
const eq = [100];
for (const t of trades) eq.push(eq[eq.length - 1] * (1 + (t.pnlPct * (C.riskPerTrade / R)) / 100));
const equity = trades.map((t, i) => ({ time: t.tEntry, eq: +eq[i + 1].toFixed(4) }));

const yrs = (trades.length ? (trades[trades.length - 1].tExit - trades[0].tEntry) / (365.25 * 86400) : 0);
const finalEq = eq[eq.length - 1];
const totalRet = finalEq - 100;
const cagr = yrs > 0 ? (Math.pow(finalEq / 100, 1 / yrs) - 1) * 100 : NaN;
let peak = 0, maxDD = 0, ddStart = 0, ddLen = 0, maxDDLen = 0;
for (let i = 0; i < eq.length; i++) {
  if (eq[i] > peak) { peak = eq[i]; ddLen = 0; }
  else {
    const dd = (1 - eq[i] / peak) * 100;
    if (dd > maxDD) maxDD = dd;
    ddLen++;
    if (ddLen > maxDDLen) maxDDLen = ddLen;
  }
}
const wins = trades.filter((t) => t.pnlPct > 0);
const losses = trades.filter((t) => t.pnlPct <= 0);
const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnlR, 0) / wins.length : 0;
const avgLoss = losses.length ? losses.reduce((a, t) => a + t.pnlR, 0) / losses.length : 0;
const grossWin = wins.reduce((a, t) => a + t.pnlPct, 0);
const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;
const expR = trades.reduce((a, t) => a + t.pnlR, 0) / trades.length;

// monthly returns
const monthly = new Map();
for (let i = 0; i < trades.length; i++) {
  const m = new Date(trades[i].tExit * 1000).toISOString().slice(0, 7);
  monthly.set(m, eq[i + 1] / eq[i] - 1);
}
const monRets = [...monthly.values()];
const meanM = monRets.reduce((a, b) => a + b, 0) / monRets.length;
const sdM = Math.sqrt(monRets.reduce((a, b) => a + (b - meanM) ** 2, 0) / monRets.length);
const downM = Math.sqrt(monRets.reduce((a, b) => a + Math.min(0, b - meanM) ** 2, 0) / monRets.length);
const sharpe = sdM > 0 ? (meanM / sdM) * Math.sqrt(12) : NaN;
const sortino = downM > 0 ? (meanM / downM) * Math.sqrt(12) : NaN;
const calmar = maxDD > 0 ? cagr / maxDD : NaN;
const recovery = maxDD > 0 ? totalRet / maxDD : NaN;

// streaks
let cur = 0, maxWinStreak = 0, maxLossStreak = 0;
for (const t of trades) {
  cur = t.pnlPct > 0 ? cur + 1 : 0;
  if (cur > maxWinStreak) maxWinStreak = cur;
}
cur = 0;
for (const t of trades) {
  cur = t.pnlPct <= 0 ? cur + 1 : 0;
  if (cur > maxLossStreak) maxLossStreak = cur;
}
const holdBars = trades.reduce((a, t) => a + t.hold, 0) / trades.length;
const holdHours = holdBars * 15 / 60;
const totalBars = C.symbols.length * C.bars;
const exposure = (trades.reduce((a, t) => a + t.hold, 0) / totalBars) * 100;

// yearly
const byYear = new Map();
for (const t of trades) {
  const y = new Date(t.tExit * 1000).getUTCFullYear();
  if (!byYear.has(y)) byYear.set(y, { n: 0, pnl: 0, wins: 0, eqStart: null, eqEnd: null });
  const m = byYear.get(y);
  m.n++;
  m.pnl += t.pnlPct;
  if (t.pnlPct > 0) m.wins++;
}
// equity per year (cần map index trade->equity)
const tradeEqIdx = new Map();
trades.forEach((t, i) => tradeEqIdx.set(t, i + 1));
const yearRets = new Map();
for (let y = new Date(trades[0].tEntry * 1000).getUTCFullYear(); y <= new Date(trades[trades.length - 1].tExit * 1000).getUTCFullYear(); y++) {
  const inY = trades.filter((t) => new Date(t.tEntry * 1000).getUTCFullYear() === y);
  const outY = trades.filter((t) => new Date(t.tExit * 1000).getUTCFullYear() === y);
  if (!inY.length) continue;
  const eqIn = eq[trades.indexOf(inY[0])];
  const eqOut = eq[trades.indexOf(outY[outY.length - 1]) + 1];
  yearRets.set(y, { n: inY.length, ret: (eqOut / eqIn - 1) * 100 });
}

// OOS
const trainT = trades.filter((t) => t.tEntry < C.oosSplit);
const testT = trades.filter((t) => t.tEntry >= C.oosSplit);
const oosStat = (rows) => {
  if (!rows.length) return null;
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  return { n: rows.length, win: (100 * w) / rows.length, exp: rows.reduce((a, t) => a + t.pnlR, 0) / rows.length, pf: gl > 0 ? gw / gl : Infinity };
};

// Số vị thế mở đồng thời tối đa (sweep theo thời gian)
{
  const events = [];
  for (const t of trades) {
    events.push({ time: t.tEntry, d: 1 });
    events.push({ time: t.tExit, d: -1 });
  }
  events.sort((a, b) => a.time - b.time);
  let open = 0, maxOpen = 0, maxOpenTime = 0;
  for (const e of events) {
    open += e.d;
    if (open > maxOpen) { maxOpen = open; maxOpenTime = e.time; }
  }
  C._maxConcurrent = maxOpen;
  C._maxConcurrentTime = maxOpenTime;
}

// ==================== BÁO CÁO ====================
const P = (l, v, u = "") => console.log(`  ${l.padEnd(38)}: ${v}${u}`);
console.log(`\n${"─".repeat(110)}`);
console.log("1. TỔNG QUAN");
P("Số lệnh", trades.length.toLocaleString());
P("Tỷ lệ thắng", `${((100 * wins.length) / trades.length).toFixed(2)}%`);
P("Thời gian backtest", `${yrs.toFixed(1)} năm (${d2s(trades[0].tEntry)} → ${d2s(trades[trades.length - 1].tExit)})`);
P("Lệnh/năm", (trades.length / yrs).toFixed(0));
P("Thời gian nắm giữ TB", `${holdBars.toFixed(1)} nến (~${holdHours.toFixed(1)}h)`);
P("Exposure", `${exposure.toFixed(2)}%`);
P("Lệnh/symbol", (trades.length / C.symbols.length).toFixed(0));

console.log(`\n${"─".repeat(110)}`);
console.log("2. LỢI NHUẬN & RỦI RO (equity bắt đầu 100, risk 1%/lệnh)");
console.log("   ⚠️ LƯU Ý PHƯƠNG PHÁP: equity curve compound theo thứ tự lệnh tuần tự — tham khảo.");
console.log(`   ⚠️ Vị thế mở ĐỒNG THỜI tối đa: ${C._maxConcurrent} lệnh (vào ${d2s(C._maxConcurrentTime)}) → vốn thực cần ≥ ${(C._maxConcurrent * C.riskPerTrade / R * 100).toFixed(0)}% equity nếu risk ${C.riskPerTrade}%/lệnh.`);
console.log(`   Tổng PnL đơn giản (tổng R): ${trades.reduce((a, t) => a + t.pnlR, 0).toFixed(0)}R (= ${(trades.reduce((a, t) => a + t.pnlR, 0) * R).toFixed(0)}% giá trị vị thế)`);
P("Tổng lợi nhuận (compound, tuần tự)", `+${totalRet.toFixed(1)}%`, " — XEM LƯU Ý TRÊN");
P("CAGR (tuần tự)", `${cagr.toFixed(2)}%`, " — XEM LƯU Ý TRÊN");
P("Max Drawdown (equity tuần tự)", `${maxDD.toFixed(2)}%`, ` (kéo dài ${maxDDLen} lệnh)`);
P("Recovery factor", recovery.toFixed(2));
P("Calmar (CAGR/MaxDD)", calmar.toFixed(2));
P("Sharpe (hàng tháng, ann.)", sharpe.toFixed(2));
P("Sortino (hàng tháng, ann.)", sortino.toFixed(2));

console.log(`\n${"─".repeat(110)}`);
console.log("3. THỐNG KÊ GIAO DỊCH (R = SL 2%)");
P("Expectancy/lệnh", `${expR.toFixed(3)}R`, ` (= ${(expR * R).toFixed(3)}%)`);
P("Lệnh thắng TB", `+${avgWin.toFixed(3)}R`, ` (= +${(avgWin * R).toFixed(2)}%)`);
P("Lệnh thua TB", `${avgLoss.toFixed(3)}R`, ` (= ${(avgLoss * R).toFixed(2)}%)`);
P("Profit factor", pf.toFixed(2));
P("Gain/loss ratio (avgWin/|avgLoss|)", (avgWin / Math.abs(avgLoss)).toFixed(2));
P("Kelly f*", `${(wins.length / trades.length - (1 - wins.length / trades.length) / (avgWin / Math.abs(avgLoss))).toFixed(3)}`, ` (khuyến nghị 1/2 Kelly = ${(0.5 * (wins.length / trades.length - (1 - wins.length / trades.length) / (avgWin / Math.abs(avgLoss)))).toFixed(3)})`);
P("Chuỗi thắng dài nhất", `${maxWinStreak} lệnh`, ` | Chuỗi thua dài nhất: ${maxLossStreak} lệnh`);
const exits = {};
for (const t of trades) exits[t.exitType] = (exits[t.exitType] || 0) + 1;
P("Phân bố thoát lệnh", `TP ${exits.TP} (${((100 * exits.TP) / trades.length).toFixed(1)}%) | SL ${exits.SL} (${((100 * exits.SL) / trades.length).toFixed(1)}%) | Timeout ${exits.TIMEOUT} (${((100 * exits.TIMEOUT) / trades.length).toFixed(1)}%)`);
const exitPnl = {};
for (const t of trades) exitPnl[t.exitType] = (exitPnl[t.exitType] || 0) + t.pnlR;
P("PnL theo loại thoát (R)", `TP ${exitPnl.TP.toFixed(0)}R | SL ${exitPnl.SL.toFixed(0)}R | Timeout ${exitPnl.TIMEOUT.toFixed(0)}R`);

console.log(`\n${"─".repeat(110)}`);
console.log("4. PHÂN BỐ R-MULTIPLE");
const buckets = { "<-1.5R": 0, "-1.5..-0.5R": 0, "-0.5..0R": 0, "0..0.5R": 0, "0.5..1R": 0, ">=1R": 0 };
for (const t of trades) {
  const x = t.pnlR;
  if (x < -1.5) buckets["<-1.5R"]++;
  else if (x < -0.5) buckets["-1.5..-0.5R"]++;
  else if (x < 0) buckets["-0.5..0R"]++;
  else if (x < 0.5) buckets["0..0.5R"]++;
  else if (x < 1) buckets["0.5..1R"]++;
  else buckets[">=1R"]++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(12)}: ${String(v).padStart(5)} lệnh (${((100 * v) / trades.length).toFixed(1)}%)`);

console.log(`\n${"─".repeat(110)}`);
console.log("5. LỢI NHUẬN HÀNG NĂM");
console.log(`  ${"Năm".padStart(6)} ${"Lệnh".padStart(6)} ${"Win%".padStart(6)} ${"Lợi nhuận equity %".padStart(20)}`);
for (const [y, m] of [...yearRets.entries()].sort()) {
  const ym = byYear.get(y);
  console.log(`  ${String(y).padStart(6)} ${String(ym.n).padStart(6)} ${((100 * ym.wins) / ym.n).toFixed(1).padStart(6)} ${m.ret.toFixed(1).padStart(20)}`);
}

console.log(`\n${"─".repeat(110)}`);
console.log("6. OUT-OF-SAMPLE (train < 2025 | test >= 2025)");
const sTrain = oosStat(trainT), sTest = oosStat(testT);
console.log(`  TRAIN: N=${sTrain.n} | WIN ${sTrain.win.toFixed(1)}% | Exp ${sTrain.exp.toFixed(3)}R | PF ${sTrain.pf.toFixed(2)}`);
console.log(`  TEST : N=${sTest.n} | WIN ${sTest.win.toFixed(1)}% | Exp ${sTest.exp.toFixed(3)}R | PF ${sTest.pf.toFixed(2)}`);

console.log(`\n${"─".repeat(110)}`);
console.log("7. MONTE CARLO — phân phối MaxDD (1000 lần xáo thứ tự lệnh)");
{
  const pnls = trades.map((t) => t.pnlPct);
  const dds = [];
  for (let it = 0; it < 1000; it++) {
    for (let i = pnls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pnls[i], pnls[j]] = [pnls[j], pnls[i]];
    }
    let e = 100, pk = 100, mdd = 0;
    for (const p of pnls) {
      e *= 1 + (p * (C.riskPerTrade / R)) / 100;
      if (e > pk) pk = e;
      mdd = Math.max(mdd, (1 - e / pk) * 100);
    }
    dds.push(mdd);
  }
  dds.sort((a, b) => a - b);
  console.log(`  Median MaxDD: ${dds[500].toFixed(1)}% | P90: ${dds[900].toFixed(1)}% | P95: ${dds[950].toFixed(1)}% | Tệ nhất: ${dds[999].toFixed(1)}%`);
}

console.log(`\n${"─".repeat(110)}`);
console.log("8. THEO SYMBOL");
console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(5)} ${"Win%".padStart(6)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"MaxDD R".padStart(8)}`);
const bySym = new Map();
for (const t of trades) {
  if (!bySym.has(t.symbol)) bySym.set(t.symbol, []);
  bySym.get(t.symbol).push(t);
}
for (const [sym, rows] of [...bySym.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const tot = rows.reduce((a, t) => a + t.pnlR, 0);
  let e = 100, pk = 100, mdd = 0;
  for (const t of rows) {
    e *= 1 + (t.pnlPct * (C.riskPerTrade / R)) / 100;
    if (e > pk) pk = e;
    mdd = Math.max(mdd, (1 - e / pk) * 100);
  }
  console.log(`  ${sym.padEnd(12)} ${String(rows.length).padStart(5)} ${((100 * w) / rows.length).toFixed(1).padStart(6)} ${(tot / rows.length).toFixed(2).padStart(7)} ${(gl > 0 ? gw / gl : Infinity).toFixed(2).padStart(6)} ${tot.toFixed(0).padStart(7)} ${(mdd / R).toFixed(1).padStart(8)}`);
}

console.log(`\n${"─".repeat(110)}`);
console.log("9. 20 LỆNH GẦN NHẤT (mẫu)");
console.log(`  ${"Symbol".padEnd(11)} ${"Hướng".padEnd(4)} ${"Vào".padEnd(17)} ${"Giá vào".padEnd(10)} ${"Ra".padEnd(17)} ${"Giá ra".padEnd(10)} ${"Loại".padEnd(8)} ${"Nắm".padEnd(5)} ${"PnL%".padEnd(7)} ${"R".padEnd(6)}`);
for (const t of trades.slice(-20)) {
  console.log(`  ${t.symbol.padEnd(11)} ${(t.S === 1 ? "LONG" : "SHORT").padEnd(4)} ${d2s(t.tEntry).padEnd(17)} ${t.entry.toFixed(5).padEnd(10)} ${d2s(t.tExit).padEnd(17)} ${t.exitPx.toFixed(5).padEnd(10)} ${t.exitType.padEnd(8)} ${String(t.hold).padEnd(5)} ${t.pnlPct.toFixed(2).padEnd(7)} ${t.pnlR.toFixed(2).padEnd(6)}`);
}

writeCsv("output/backtest_final/trades.csv", trades.map((t) => ({ ...t, tEntry: d2s(t.tEntry), tExit: d2s(t.tExit) })));
writeCsv("output/backtest_final/equity.csv", equity.map((e) => ({ time: d2s(e.time), equity: e.eq })));
writeCsv("output/backtest_final/monthly.csv", [...monthly.entries()].map(([m, r]) => ({ month: m, retPct: +(r * 100).toFixed(2) })));
console.log("\nCSV đã lưu: output/backtest_final/trades.csv | equity.csv | monthly.csv");

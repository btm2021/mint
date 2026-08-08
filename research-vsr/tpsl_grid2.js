import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// GRID TP/SL — giải quyết vấn đề "give-back profit"
// Mục tiêu: nâng WINRATE (ưu tiên #1), giữ ExpR/PF dương.
// Cấu trúc thoát linh hoạt:
//   sl1Pct            : SL ban đầu (đầy đủ vị thế) — cố định % hoặc 'ATR' động
//   tp1Pct, frac1     : TP đầu (đóng frac1 vị thế)
//   beAfterTp1        : sau TP1, kéo SL2 về breakeven (0) hoặc giữ nguyên
//   tp2Pct            : TP còn lại (hoặc null → chờ time-stop)
//   sl2Pct            : SL cho phần còn lại sau TP1 (0 = breakeven)
//   tp1Pct/... cũng nhận chuỗi 'ATR*k' để SL động theo ATR14.
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

// Các cấu hình cần test — ưu tiên winrate, sau đó ExpR/PF
const GRID = [{name:"E1 TP1=0.75+BE, TP2=1.5",tp1:0.75,frac1:0.5,tp2:1.5,sl1:2,be:true,sl2:0},{name:"E2 TP1=0.75+BE, TP2=1.0",tp1:0.75,frac1:0.5,tp2:1,sl1:2,be:true,sl2:0},{name:"E3 TP1=1.0+BE, TP2=1.5",tp1:1,frac1:0.5,tp2:1.5,sl1:2,be:true,sl2:0},{name:"E4 TP1=0.75+BE, TP2=2 (frac 2/3)",tp1:0.75,frac1:0.66,tp2:2,sl1:2,be:true,sl2:0},{name:"E5 TP1=0.5+BE, TP2=1.5",tp1:0.5,frac1:0.5,tp2:1.5,sl1:2,be:true,sl2:0},{name:"E6 TP1=0.5+BE, TP2=1.0",tp1:0.5,frac1:0.5,tp2:1,sl1:2,be:true,sl2:0},{name:"E7 TP1=1.25+BE, TP2=2",tp1:1.25,frac1:0.5,tp2:2,sl1:2,be:true,sl2:0},{name:"E8 TP1=0.75 (frac .33)+BE, TP2=2",tp1:0.75,frac1:0.33,tp2:2,sl1:2,be:true,sl2:0},{name:"E9 TP1=1.0 (frac .33)+BE, TP2=2",tp1:1,frac1:0.33,tp2:2,sl1:2,be:true,sl2:0},{name:"E10 TP1=1.0+BE, TP2=2 (frac .66)",tp1:1,frac1:0.66,tp2:2,sl1:2,be:true,sl2:0},{name:"E11 TP1=1.5+BE, TP2=2 (frac .33)",tp1:1.5,frac1:0.33,tp2:2,sl1:2,be:true,sl2:0},{name:"E12 TP1=0.75, frac .5, BE->0.5R, TP2=2",tp1:0.75,frac1:0.5,tp2:2,sl1:2,be:true,sl2:1},{name:"E13 TP1=0.5, frac .5, BE->1.0, TP2=2",tp1:0.5,frac1:0.5,tp2:2,sl1:2,be:true,sl2:1}];

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
const resolvePct = (v, atrPct) => (typeof v === "string" && v.startsWith("ATR*") ? parseFloat(v.slice(4)) * atrPct : v);
const d2s = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16);

// ---------- TÍNH TRƯỚC CÁC TRADE (entry giống hệt backtest_final) ----------
console.log("Tính entry VBT (1 lần, tái dùng cho mọi cấu hình TP/SL)...");
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
    entries.push({ symbol, S, entryIdx, entry, end, atrPct: atrF[entryIdx] / entry * 100, bars, tEntry: bars[entryIdx].time });
  }
}
console.log(`Tổng entry: ${entries.length} lệnh\n`);

// ---------- MÔ PHỎNG EXIT CHO TỪNG CẤU HÌNH ----------
const FEECOST = A.feePct + A.slippagePct; // % mỗi leg khứ hồi

function simulate(g) {
  const rows = [];
  for (const e of entries) {
    const { bars, S, entryIdx, entry, end, atrPct } = e;
    const sl1 = resolvePct(g.sl1, atrPct);
    const tp1 = resolvePct(g.tp1, atrPct);
    const tp2 = g.tp2 != null ? resolvePct(g.tp2, atrPct) : null;
    const sl2 = g.sl2 != null ? resolvePct(g.sl2, atrPct) : null;
    const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
    const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
    let rem = 1, pnlPct = 0, closedAt = []; // mảng {pct} của từng phần
    let beActive = false, remPx = null, exitIdx = end, exitType = "TIMEOUT";

    for (let t = entryIdx + 1; t <= end; t++) {
      const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
      const hitSl = S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur;
      if (hitSl) {
        pnlPct += rem * (S * (slCur / entry - 1) * 100 - FEECOST);
        rem = 0; exitType = beActive ? "SL2" : "SL1"; exitIdx = t; remPx = slCur; break;
      }
      if (rem > 0 && g.frac1 < 1) {
        const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
        if (hitTp1) {
          const f = g.frac1;
          pnlPct += f * (S * (tp1Lv / entry - 1) * 100 - FEECOST);
          rem -= f; beActive = true; closedAt.push({ tp: 1, px: tp1Lv });
        }
      }
      if (rem > 0 && tp2 != null) {
        const tp2Lv = S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
        const hitTp2 = S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv;
        if (hitTp2) { pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP2"; exitIdx = t; remPx = tp2Lv; break; }
      }
      // nếu frac1 == 1: TP đơn
      if (rem > 0 && g.frac1 >= 1 && tp2 == null) {
        const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
        if (hitTp1) { pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - FEECOST); rem = 0; exitType = "TP1"; exitIdx = t; remPx = tp1Lv; break; }
      }
    }
    if (rem > 0) {
      const px = bars[end].close;
      pnlPct += rem * (S * (px / entry - 1) * 100 - FEECOST);
      remPx = px;
    }
    rows.push({ symbol: e.symbol, S, tEntry: e.tEntry, pnlPct, pnlR: pnlPct / A.R, exitType, hold: exitIdx - entryIdx + 1 });
  }
  rows.sort((a, b) => a.tEntry - b.tEntry);
  return rows;
}

function stat(rows) {
  if (!rows.length) return null;
  const w = rows.filter((t) => t.pnlPct > 0).length;
  const gw = rows.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(rows.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  let e = 100, pk = 100, mdd = 0;
  for (const t of rows) { e *= 1 + (t.pnlPct / A.R) / 100; if (e > pk) pk = e; mdd = Math.max(mdd, (1 - e / pk) * 100); }
  return {
    n: rows.length,
    win: (100 * w) / rows.length,
    exp: rows.reduce((a, t) => a + t.pnlR, 0) / rows.length,
    pf: gl > 0 ? gw / gl : Infinity,
    totR: rows.reduce((a, t) => a + t.pnlR, 0),
    mdd: mdd / A.R,
    hold: rows.reduce((a, t) => a + t.hold, 0) / rows.length,
  };
}

console.log(`${"Cấu hình".padEnd(42)} ${"N".padStart(6)} ${"WIN%".padStart(6)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"TổngR".padStart(7)} ${"MaxDDR".padStart(7)} ${"Hold".padStart(5)} ${"OOS WIN%".padStart(9)} ${"OOS ExpR".padStart(9)}`);
console.log("-".repeat(110));
const allRows = [];
for (const g of GRID) {
  const rows = simulate(g);
  const s = stat(rows);
  const oos = rows.filter((t) => t.tEntry >= A.oosSplit);
  const sOos = stat(oos);
  const train = rows.filter((t) => t.tEntry < A.oosSplit);
  const sTr = stat(train);
  allRows.push({ g, s, sTr, sOos });
  console.log(`${g.name.padEnd(42)} ${String(s.n).padStart(6)} ${s.win.toFixed(1).padStart(6)} ${s.exp.toFixed(3).padStart(7)} ${s.pf.toFixed(2).padStart(6)} ${s.totR.toFixed(0).padStart(7)} ${s.mdd.toFixed(1).padStart(7)} ${s.hold.toFixed(0).padStart(5)} ${sOos.win.toFixed(1).padStart(9)} ${sOos.exp.toFixed(3).padStart(9)}`);
}

// Chi tiết loại thoát cho 3 cấu hình tốt nhất theo winrate (IS + OOS đều cao)
console.log(`\n${"─".repeat(110)}`);
console.log("CHI TIẾT THOÁT — 5 cấu hình winrate cao nhất:");
const sorted = [...allRows].sort((a, b) => b.s.win - a.s.win);
for (const { g, s } of sorted.slice(0, 5)) {
  const rows = simulate(g);
  const ex = {};
  for (const t of rows) ex[t.exitType] = (ex[t.exitType] || 0) + 1;
  const exPnl = {};
  for (const t of rows) exPnl[t.exitType] = (exPnl[t.exitType] || 0) + t.pnlR;
  const w = Object.entries(ex).map(([k, v]) => `${k}: ${v} (${(100 * v / rows.length).toFixed(1)}%, ${exPnl[k].toFixed(0)}R)`).join(" | ");
  console.log(`  ${g.name}: ${w}`);
}

// CSV tổng hợp
writeCsv("output/tpsl_grid/results.csv", allRows.map(({ g, s, sTr, sOos }) => ({
  config: g.name, n: s.n, win: +s.win.toFixed(2), expR: +s.exp.toFixed(3), pf: +s.pf.toFixed(2),
  totR: +s.totR.toFixed(0), mddR: +s.mdd.toFixed(1), hold: +s.hold.toFixed(0),
  trainWin: +sTr.win.toFixed(2), trainExp: +sTr.exp.toFixed(3),
  oosWin: +sOos.win.toFixed(2), oosExp: +sOos.exp.toFixed(3),
})));
console.log("\nCSV: output/tpsl_grid/results.csv");

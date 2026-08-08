import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// PHÂN TÍCH LỆNH SAI — hệ thống VBT hiện tại (backtest_final.js)
// Với mỗi lệnh, đo: MFE/MAE (R), thời gian SL bị hit, feature entry, hành vi sau entry
// → bucket so sánh WINNER vs LOSER → tìm nguyên nhân lỗ + hướng tránh.
const C = {
  symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
  interval: "15m",
  bars: 200000,
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  tpPct: 2.0, slPct: 2.0,
  feePct: 0.1, slippagePct: 0.04,
  R: 2,
};

function parseArgs(argv) {
  const args = { ...C };
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
const R = A.slPct;
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

console.log(`PHÂN TÍCH LỆNH SAI — VBT hiện tại — ${A.symbols.length} symbol ${A.interval}`);
console.log("=".repeat(110));

const trades = [];
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

    const tpLv = S === 1 ? entry * (1 + A.tpPct / 100) : entry * (1 - A.tpPct / 100);
    const slLv = S === 1 ? entry * (1 - A.slPct / 100) : entry * (1 + A.slPct / 100);
    let exitType = "TIMEOUT", exitPx = null, exitIdx = ce;
    const end = Math.min(ce, n - 1);
    let mfe = 0, mae = 0; // tính bằng % từ entry (cực trị đúng hướng / ngược hướng)
    for (let t = entryIdx + 1; t <= end; t++) {
      const fav = S === 1 ? (bars[t].high - entry) / entry * 100 : (entry - bars[t].low) / entry * 100;
      const adv = S === 1 ? (entry - bars[t].low) / entry * 100 : (bars[t].high - entry) / entry * 100;
      if (fav > mfe) mfe = fav;
      if (adv > mae) mae = adv;
      if (S === 1 ? bars[t].low <= slLv : bars[t].high >= slLv) { exitType = "SL"; exitPx = slLv; exitIdx = t; break; }
      if (S === 1 ? bars[t].high >= tpLv : bars[t].low <= tpLv) { exitType = "TP"; exitPx = tpLv; exitIdx = t; break; }
    }
    if (exitType === "TIMEOUT") { exitPx = bars[end].close; exitIdx = end; }
    const pnlPct = S * (exitPx / entry - 1) * 100 - A.feePct - A.slippagePct;
    const slowCyc = slowCycles.find((sc) => sc.start <= entryIdx && sc.end >= entryIdx) || slowCycles[0];
    const slowEnd = slowCyc.end;
    const slowLeft = slowEnd - exitIdx; // nến bias còn sống sau khi thoát (âm = bias đảo trước khi thoát)

    // thời gian từ entry đến SL (nếu SL)
    trades.push({
      symbol, S, tEntry: bars[entryIdx].time, tExit: bars[exitIdx].time,
      entry, exitPx: +exitPx.toFixed(6), exitType, hold: exitIdx - entryIdx + 1,
      pnlPct: +pnlPct.toFixed(3), pnlR: +(pnlPct / R).toFixed(3),
      mfeR: +(mfe / R).toFixed(2), maeR: +(mae / R).toFixed(2),
      mfeMaxPct: +mfe.toFixed(2), maeMaxPct: +mae.toFixed(2),
      cycleAge: entryIdx - cs + 1, slowAge: entryIdx - slowCyc.start, slowLeft,
      cfLag: cf - cs, pullLag: entryIdx - cf,
      entryVsZone: +entryVsZone.toFixed(2), pullDepth: +pullDepth.toFixed(2),
      volConfirm: +((bars[cf].volume / avgVolume(bars, cf)) || 0).toFixed(2),
      volEntry: +((bars[entryIdx].volume / avgVolume(bars, entryIdx)) || 0).toFixed(2),
      atrPct: +((atrF[entryIdx] / entry) * 100).toFixed(2),
      zoneAge: cf - zStart[cf],
      emaSlope: ema20[entryIdx] > ema20[entryIdx - 3] ? 1 : -1,
      hour: new Date(bars[entryIdx].time * 1000).getUTCHours(),
    });
  }
}
trades.sort((a, b) => a.tEntry - b.tEntry);
const d2s = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16);

const losers = trades.filter((t) => t.pnlPct <= 0);
const winners = trades.filter((t) => t.pnlPct > 0);
const slLosers = losers.filter((t) => t.exitType === "SL");
const toLosers = losers.filter((t) => t.exitType === "TIMEOUT");
const stat = (rows) => {
  if (!rows.length) return null;
  const win = rows.filter((t) => t.pnlPct > 0).length;
  return {
    n: rows.length,
    win: (100 * win) / rows.length,
    exp: rows.reduce((a, t) => a + t.pnlR, 0) / rows.length,
    avgMFE: rows.reduce((a, t) => a + t.mfeR, 0) / rows.length,
    avgMAE: rows.reduce((a, t) => a + t.maeR, 0) / rows.length,
    total: rows.reduce((a, t) => a + t.pnlR, 0),
  };
};

console.log(`\n[0] TỔNG QUAN — ${trades.length} lệnh | WIN ${stat(trades).win.toFixed(1)}% | Exp ${stat(trades).exp.toFixed(3)}R`);
console.log(`    Thoát: TP ${trades.filter((t) => t.exitType === "TP").length} | SL ${slLosers.length} | TIMEOUT ${trades.filter((t) => t.exitType === "TIMEOUT").length}`);
console.log(`    LOSERS: ${losers.length} lệnh (SL ${slLosers.length} + TIMEOUT lỗ ${toLosers.length}) | đóng góp vào tổng PnL lỗ: ${losers.reduce((a, t) => a + t.pnlR, 0).toFixed(0)}R`);

console.log(`\n${"─".repeat(110)}`);
console.log("[1] LOSER ĐƯỢC HÌNH THÀNH NHƯ THẾ NÀO?");
console.log(`  ${"Nhóm loser".padEnd(28)} ${"N".padStart(5)} ${"%lỗ".padStart(5)} ${"ExpR".padStart(7)} ${"MFE TB".padStart(8)} ${"MAE TB".padStart(8)} ${"hold TB".padStart(7)}`);
for (const [label, rows] of [
  ["SL (giá đi ngược ngay)", slLosers],
  ["TIMEOUT lỗ (âm thầm xuống)", toLosers],
]) {
  if (!rows.length) continue;
  const s = stat(rows);
  const hold = rows.reduce((a, t) => a + t.hold, 0) / rows.length;
  console.log(`  ${label.padEnd(28)} ${String(s.n).padStart(5)} ${(100 * s.n / losers.length).toFixed(1).padStart(5)} ${s.exp.toFixed(2).padStart(7)} ${s.avgMFE.toFixed(2).padStart(8)} ${s.avgMAE.toFixed(2).padStart(8)} ${hold.toFixed(1).padStart(7)}`);
}
console.log(`\n  Phân phối SL theo tốc độ bị hit (nến từ entry đến SL):`);
const sp = { "1-3 nến (sập ngay)": [], "4-8 nến": [], "9-16 nến": [], ">16 nến (mòn dần)": [] };
for (const t of slLosers) {
  const k = t.hold <= 3 ? "1-3 nến (sập ngay)" : t.hold <= 8 ? "4-8 nến" : t.hold <= 16 ? "9-16 nến" : ">16 nến (mòn dần)";
  sp[k].push(t);
}
for (const [k, rows] of Object.entries(sp)) {
  if (!rows.length) continue;
  const s = stat(rows);
  console.log(`    ${k.padEnd(20)} N=${String(rows.length).padStart(4)} (${(100 * rows.length / slLosers.length).toFixed(1).padStart(5)}%) | MFE TB ${s.avgMFE.toFixed(2)}R | tổng ${s.total.toFixed(0)}R`);
}

console.log(`\n  Lệnh từng có lời trước khi lỗ? (MFE trước SL/TIMEOUT lỗ)`);
const mfeBuck = { "0-0.25R (chưa kịp có lời)": 0, "0.25-0.5R": 0, "0.5-0.75R": 0, "0.75-1R": 0, ">=1R (gần chạm TP)": 0 };
for (const t of losers) {
  const m = t.mfeR;
  if (m < 0.25) mfeBuck["0-0.25R (chưa kịp có lời)"]++;
  else if (m < 0.5) mfeBuck["0.25-0.5R"]++;
  else if (m < 0.75) mfeBuck["0.5-0.75R"]++;
  else if (m < 1) mfeBuck["0.75-1R"]++;
  else mfeBuck[">=1R (gần chạm TP)"]++;
}
for (const [k, v] of Object.entries(mfeBuck)) {
  console.log(`    ${k.padEnd(28)} ${String(v).padStart(4)} lệnh (${(100 * v / losers.length).toFixed(1)}%)`);
}

console.log(`\n  Bias SLOW còn sống khi lệnh thua? (slowLeft = nến bias còn lại sau thoát)`);
const slb = { "<=-8 (bias đảo sớm)": [], "-7..0": [], "1..10": [], ">10 (bias còn dài)": [] };
for (const t of losers) {
  const k = t.slowLeft <= -8 ? "<=-8 (bias đảo sớm)" : t.slowLeft <= 0 ? "-7..0" : t.slowLeft <= 10 ? "1..10" : ">10 (bias còn dài)";
  slb[k].push(t);
}
for (const [k, rows] of Object.entries(slb)) {
  if (!rows.length) continue;
  const s = stat(rows);
  console.log(`    ${k.padEnd(24)} N=${String(rows.length).padStart(4)} (${(100 * rows.length / losers.length).toFixed(1).padStart(5)}%) | trong đó SL ${rows.filter((t) => t.exitType === "SL").length}`);
}

console.log(`\n${"─".repeat(110)}`);
console.log("[2] WINNER VS LOSER — so sánh feature tại entry (tìm dấu hiệu phân biệt):");
const FEATURES = [
  { key: "cycleAge", name: "Tuổi fast cycle tại entry", buckets: (v) => (v <= 2 ? "<=2" : v === 3 ? "3" : "4") },
  { key: "slowAge", name: "Tuổi bias slow", buckets: (v) => (v <= 8 ? "<=8 (bias mới)" : v <= 24 ? "9-24" : v <= 60 ? "25-60" : ">60 (bias già)") },
  { key: "pullLag", name: "Lag confirm→entry", buckets: (v) => (v <= 1 ? "0-1 (vào ngay)" : v <= 4 ? "2-4" : "5-16") },
  { key: "pullDepth", name: "Độ sâu pullback (ATR)", buckets: (v) => (v <= 0 ? "<=0 (không hồi)" : v <= 0.25 ? "0-0.25" : v <= 0.5 ? "0.25-0.5" : ">0.5") },
  { key: "entryVsZone", name: "Entry vs zone (ATR)", buckets: (v) => (v <= -0.5 ? "TRONG zone" : v <= 0 ? "chạm biên" : v <= 0.5 ? "0-0.5" : v <= 1.5 ? "0.5-1.5" : ">1.5") },
  { key: "volEntry", name: "Volume nến entry", buckets: (v) => (v <= 0.8 ? "<=0.8x" : v <= 1.2 ? "0.8-1.2" : v <= 2 ? "1.2-2" : ">2x") },
  { key: "volConfirm", name: "Volume nến confirm", buckets: (v) => (v <= 0.8 ? "<=0.8x" : v <= 1.2 ? "0.8-1.2" : v <= 2 ? "1.2-2" : ">2x") },
  { key: "atrPct", name: "ATR% tại entry", buckets: (v) => (v <= 0.3 ? "<=0.3" : v <= 0.6 ? "0.3-0.6" : v <= 1 ? "0.6-1" : ">1") },
  { key: "zoneAge", name: "Tuổi zone tại confirm", buckets: (v) => (v <= 4 ? "<=4 (mới)" : v <= 12 ? "5-12" : v <= 30 ? "13-30" : ">30 (cũ)") },
  { key: "hour", name: "Giờ UTC entry", buckets: (v) => (v < 6 ? "0-5" : v < 12 ? "6-11" : v < 18 ? "12-17" : "18-23") },
  { key: "S", name: "Hướng", buckets: (v) => (v === 1 ? "LONG" : "SHORT") },
];
const base = stat(trades);
for (const f of FEATURES) {
  const groups = new Map();
  for (const t of trades) {
    const b = f.buckets(t[f.key]);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(t);
  }
  console.log(`\n  ${f.name}:`);
  for (const [label, rows] of groups) {
    const s = stat(rows);
    const wRows = rows.filter((t) => t.pnlPct > 0);
    const lRows = rows.filter((t) => t.pnlPct <= 0);
    const wMFE = wRows.length ? wRows.reduce((a, t) => a + t.mfeR, 0) / wRows.length : 0;
    const lMAE = lRows.length ? lRows.reduce((a, t) => a + t.maeR, 0) / lRows.length : 0;
    const diff = s.win - base.win;
    const mark = diff <= -4 && s.n >= 100 ? " ⚠️ NHÓM LỖ" : diff >= 4 && s.n >= 100 ? " ✅ TỐT" : "";
    console.log(`    ${label.padEnd(20)} N=${String(s.n).padStart(6)} | WIN ${s.win.toFixed(1).padStart(5)}%${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp | Exp ${s.exp.toFixed(2).padStart(6)}R | MFE-w ${wMFE.toFixed(2)}R | MAE-l ${lMAE.toFixed(2)}R${mark}`);
  }
}

console.log(`\n${"─".repeat(110)}`);
console.log("[3] LOSER ĐIỂN HÌNH — 15 lệnh thua nặng nhất:");
console.log(`  ${"Symbol".padEnd(11)} ${"Hướng".padEnd(4)} ${"Vào".padEnd(17)} ${"Ra".padEnd(17)} ${"Loại".padEnd(8)} ${"Hold".padEnd(5)} ${"PnL".padEnd(7)} ${"MFE".padEnd(6)} ${"cycleAge".padEnd(8)} ${"slowAge".padEnd(7)} ${"pull".padEnd(5)} ${"volEnt".padEnd(6)} ${"ATR%".padEnd(5)} ${"h".padEnd(3)}`);
for (const t of [...losers].sort((a, b) => a.pnlR - b.pnlR).slice(0, 15)) {
  console.log(`  ${t.symbol.padEnd(11)} ${(t.S === 1 ? "L" : "S").padEnd(4)} ${d2s(t.tEntry).padEnd(17)} ${d2s(t.tExit).padEnd(17)} ${t.exitType.padEnd(8)} ${String(t.hold).padEnd(5)} ${t.pnlR.toFixed(2).padEnd(7)} ${t.mfeR.toFixed(2).padEnd(6)} ${String(t.cycleAge).padEnd(8)} ${String(t.slowAge).padEnd(7)} ${t.pullDepth.toFixed(2).padEnd(5)} ${t.volEntry.toFixed(2).padEnd(6)} ${t.atrPct.toFixed(2).padEnd(5)} ${String(t.hour).padEnd(3)}`);
}

writeCsv("output/optimize/losers_vbt.csv", losers.map((t) => ({ ...t, tEntry: d2s(t.tEntry), tExit: d2s(t.tExit) })));
writeCsv("output/optimize/all_trades_vbt.csv", trades.map((t) => ({ ...t, tEntry: d2s(t.tEntry), tExit: d2s(t.tExit) })));
console.log("\nCSV: output/optimize/losers_vbt.csv | all_trades_vbt.csv");

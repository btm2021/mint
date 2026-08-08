import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { analyseZoneTests, writeCsv } from "./lib/retest.js";
import { calcEma, calcDayVwap } from "./lib/indicators.js";

function parseArgs(argv) {
  const args = {
    symbols: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
    interval: "15m",
    bars: 200000,
    configs: "5,10|10,10|15,10",
    k: 8,
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
  args.k = parseInt(args.k, 10) || 8;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const configs = args.configs.split("|").map((c) => c.split(",").map(Number));
const K = args.k;
const FEE = 0.1; // % phí khứ hồi (taker 0.05% x 2)
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

const pooled = {}; // `len,thr` -> trades
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`BACKTEST RULES — ${args.symbols.length} symbol ${args.interval}`);
console.log(`Exit: close[T+${K}] | phí ${FEE}% khứ hồi | Configs: ${args.configs}`);
console.log("=".repeat(100));

for (const symbol of args.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${args.interval}.json`;
  let bars;
  try {
    bars = await fetchBars({ symbol, interval: args.interval, total: args.bars, cacheFile, delayMs: 450 });
  } catch (e) {
    console.log(`BỎ QUA ${symbol}: ${e.message}`);
    continue;
  }
  if (bars.length < 5000) continue;
  const trend = calculateTrendStates(bars);
  const ema20 = calcEma(bars, 20);
  const vwap = calcDayVwap(bars);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones } = calculateVSR(bars, len, thr);
    const tests = analyseZoneTests(bars, zones, trend, [8, 24]);
    for (const r of tests) {
      if (r.outcome8 === "NO_TEST") continue;
      if (r.touchIdx + K >= bars.length) continue; // không đủ nến phía sau
      const T = r.touchIdx;
      const cT = bars[T].close;
      const ret8 = (bars[T + K].close / cT - 1) * 100;
      const longBounce = r.approach === "ABOVE"; // bật = long khi test hỗ trợ
      const pnlBounce = (longBounce ? ret8 : -ret8) - FEE;
      const pnlThrough = (longBounce ? -ret8 : ret8) - FEE;
      let pnlBounce24 = null, pnlThrough24 = null;
      if (T + 24 < bars.length) {
        const ret24 = (bars[T + 24].close / cT - 1) * 100;
        pnlBounce24 = (longBounce ? ret24 : -ret24) - FEE;
        pnlThrough24 = (longBounce ? -ret24 : ret24) - FEE;
      }
      pooled[key].push({
        symbol, ...r,
        closeVsEma: cT >= ema20[T] ? "ABOVE" : "BELOW",
        closeVsVwap: Number.isFinite(vwap[T]) ? (cT >= vwap[T] ? "ABOVE" : "BELOW") : "NA",
        pnlBounce: +pnlBounce.toFixed(3),
        pnlThrough: +pnlThrough.toFixed(3),
        pnlBounce24: pnlBounce24 === null ? "" : +pnlBounce24.toFixed(3),
        pnlThrough24: pnlThrough24 === null ? "" : +pnlThrough24.toFixed(3),
      });
    }
  }
}

const score = (r) => {
  const aligned = r.closeVsEma === (r.approach === "ABOVE" ? "ABOVE" : "BELOW");
  const vwapAligned = r.closeVsVwap === (r.approach === "ABOVE" ? "ABOVE" : "BELOW");
  let s = 0;
  if (aligned) s++;
  if (vwapAligned) s++;
  if (r.volRatio <= 1) s++;
  if (r.ageAtTest > 12) s++;
  if (r.widthPct > 0.7) s++;
  if (r.merges >= 1) s++;
  return s;
};

// Các rule: cond(r) + dir (BOUNCE/THROUGH) + lấy pnl tương ứng
const RULES = [
  { id: "BASE", label: "BASE — tất cả → BẬT LẠI", dir: "BOUNCE", cond: () => true },
  { id: "R1", label: "R1: XUÔI EMA → BẬT LẠI", dir: "BOUNCE", cond: (r) => r.closeVsEma === (r.approach === "ABOVE" ? "ABOVE" : "BELOW") },
  { id: "R2", label: "R2: XUÔI EMA + vol<=1x → BẬT", dir: "BOUNCE", cond: (r) => r.closeVsEma === (r.approach === "ABOVE" ? "ABOVE" : "BELOW") && r.volRatio <= 1 },
  { id: "R3", label: "R3: score >= 3 → BẬT", dir: "BOUNCE", cond: (r) => score(r) >= 3 },
  { id: "R3b", label: "R3b: score >= 4 → BẬT", dir: "BOUNCE", cond: (r) => score(r) >= 4 },
  { id: "R4", label: "R4: NGƯỢC EMA + vol>2x → XUYÊN", dir: "THROUGH", cond: (r) => r.closeVsEma !== (r.approach === "ABOVE" ? "ABOVE" : "BELOW") && r.volRatio > 2 },
  { id: "R5", label: "R5: score <= 1 → XUYÊN", dir: "THROUGH", cond: (r) => score(r) <= 1 },
];

function metrics(rows, rule) {
  const trades = rows.filter(rule.cond);
  const n = trades.length;
  if (!n) return { rule, n: 0 };
  let hit8 = 0, hit24 = 0, win = 0, win24 = 0, sum = 0, sum24 = 0, cnt24 = 0;
  for (const t of trades) {
    const pnl = rule.dir === "BOUNCE" ? t.pnlBounce : t.pnlThrough;
    const pnl24 = rule.dir === "BOUNCE" ? t.pnlBounce24 : t.pnlThrough24;
    if (t.outcome8 === rule.dir) hit8++;
    if (t.outcome24 === rule.dir) hit24++;
    if (pnl > 0) win++;
    sum += pnl;
    if (pnl24 !== "" && pnl24 !== null) {
      cnt24++;
      if (pnl24 > 0) win24++;
      sum24 += pnl24;
    }
  }
  return {
    rule, n,
    hit8: (100 * hit8) / n, hit24: (100 * hit24) / n,
    win: (100 * win) / n, avg: sum / n, sum,
    win24: cnt24 ? (100 * win24) / cnt24 : NaN, avg24: cnt24 ? sum24 / cnt24 : NaN,
  };
}

const pooledReport = {};
const perSymbol = [];
const tradeRows = {};

for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key];
  if (!rows.length) continue;
  const m = RULES.map((r) => metrics(rows, r));
  pooledReport[key] = m;
  tradeRows[key] = rows;

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — ${rows.length} test có đủ ${K} nến phía sau`);
  console.log(`  ${"Rule".padEnd(34)} ${"N".padStart(7)} ${"ĐúngH8%".padStart(8)} ${"ĐúngH24%".padStart(9)} ${"Thắng%".padStart(8)} ${"TB%".padStart(8)} ${"Tổng%".padStart(9)} ${"W24%".padStart(6)} ${"TB24%".padStart(8)}`);
  for (const x of m) {
    if (!x.n) continue;
    console.log(`  ${x.rule.label.padEnd(34)} ${String(x.n).padStart(7)} ${x.hit8.toFixed(1).padStart(8)} ${x.hit24.toFixed(1).padStart(9)} ${x.win.toFixed(1).padStart(8)} ${x.avg.toFixed(2).padStart(8)} ${x.sum.toFixed(0).padStart(9)} ${x.win24.toFixed(1).padStart(6)} ${x.avg24.toFixed(2).padStart(8)}`);
  }
  writeCsv(`output/backtest/trades_${len}_${thr}.csv`, rows);

  // Per-symbol cho 2 rule chính
  for (const symbol of args.symbols) {
    const sRows = rows.filter((r) => r.symbol === symbol);
    if (!sRows.length) continue;
    const m3 = metrics(sRows, RULES.find((r) => r.id === "R3b"));
    const m4 = metrics(sRows, RULES.find((r) => r.id === "R4"));
    const mB = metrics(sRows, RULES.find((r) => r.id === "BASE"));
    perSymbol.push({
      symbol, config: key, n: sRows.length,
      baseN: mB.n, baseWin: +mB.win.toFixed(1),
      r3N: m3.n, r3Hit: +m3.hit8.toFixed(1), r3Win: +m3.win.toFixed(1), r3Avg: +m3.avg.toFixed(2),
      r4N: m4.n, r4Hit: +m4.hit8.toFixed(1), r4Win: +m4.win.toFixed(1), r4Avg: +m4.avg.toFixed(2),
    });
  }
}

// ==== Per-symbol detail ====
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = perSymbol.filter((m) => m.config === key).sort((a, b) => b.n - a.n);
  console.log(`\n${"-".repeat(100)}`);
  console.log(`THEO TỪNG SYMBOL — VSR (${key}) — R3b (score>=4 → BẬT), R4 (ngược EMA+vol>2x → XUYÊN)`);
  console.log(`  ${"Symbol".padEnd(12)} ${"Test".padStart(6)} ${"BaseW%".padStart(8)} ${"R3bN".padStart(6)} ${"R3bHit%".padStart(9)} ${"R3bW%".padStart(7)} ${"R3bTB%".padStart(8)} ${"R4N".padStart(6)} ${"R4Hit%".padStart(8)} ${"R4W%".padStart(6)} ${"R4TB%".padStart(8)}`);
  for (const m of rows) {
    console.log(`  ${m.symbol.padEnd(12)} ${String(m.n).padStart(6)} ${String(m.baseWin).padStart(8)} ${String(m.r3N).padStart(6)} ${String(m.r3Hit).padStart(9)} ${String(m.r3Win).padStart(7)} ${String(m.r3Avg).padStart(8)} ${String(m.r4N).padStart(6)} ${String(m.r4Hit).padStart(8)} ${String(m.r4Win).padStart(6)} ${String(m.r4Avg).padStart(8)}`);
  }
}

// ==== Tổng hợp 3 config ====
console.log(`\n${"-".repeat(100)}`);
console.log("TỔNG HỢP CHÉO (độ chính xác hướng theo outcome 8 nến):");
console.log(`  ${"Config".padEnd(10)} ${"Rule".padEnd(34)} ${"N".padStart(7)} ${"ĐúngH8%".padStart(8)} ${"Thắng%".padStart(8)} ${"TB%".padStart(8)}`);
for (const [len, thr] of configs) {
  for (const x of pooledReport[`${len},${thr}`]) {
    if (!x.n) continue;
    console.log(`  ${`(${len},${thr})`.padEnd(10)} ${x.rule.label.padEnd(34)} ${String(x.n).padStart(7)} ${x.hit8.toFixed(1).padStart(8)} ${x.win.toFixed(1).padStart(8)} ${x.avg.toFixed(2).padStart(8)}`);
  }
}

writeCsv("output/backtest/summary.csv", perSymbol);
console.log("\nCSV đã lưu trong research-vsr/output/backtest/");

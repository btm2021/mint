import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import {
  analyseZones, lagSnapshots, barLevelStats, countOutcomes,
  bucketTable, ruleEval, writeCsv,
} from "./lib/analyse.js";

function parseArgs(argv) {
  const args = {
    symbols: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT",
    interval: "15m",
    bars: 200000,
    configs: "20,20|10,10",
    delay: 450,
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
  args.delay = parseInt(args.delay, 10) || 450;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const configs = args.configs.split("|").map((c) => c.split(",").map(Number));
const PER_SYMBOL = new Map(); // key `${sym}|${len},${thr}` -> metrics
const pooled = {};             // key `${len},${thr}` -> rows (decision points + snaps)

for (const [len, thr] of configs) pooled[`${len},${thr}`] = { decisions: [], snaps: [] };

console.log(`Tải ${args.bars.toLocaleString()} nến tối đa cho ${args.symbols.length} symbol: ${args.symbols.join(", ")}`);
console.log(`Timeframe: ${args.interval} | VSR configs: ${args.configs} | delay giữa request: ${args.delay}ms`);
console.log("=".repeat(100));

for (const symbol of args.symbols) {
  const cacheFile = `cache/${symbol.toLowerCase()}_${args.interval}.json`;
  let bars;
  try {
    console.log(`\n[${symbol}]`);
    bars = await fetchBars({ symbol, interval: args.interval, total: args.bars, cacheFile, delayMs: args.delay });
  } catch (e) {
    console.log(`  BỎ QUA ${symbol}: ${e.message}`);
    continue;
  }
  if (bars.length < 2000) {
    console.log(`  BỎ QUA ${symbol}: chỉ có ${bars.length} nến (quá ít)`);
    continue;
  }

  console.log(`  Nến: ${bars.length.toLocaleString()} (${new Date(bars[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(bars.at(-1).time * 1000).toISOString().slice(0, 10)})`);
  const trend = calculateTrendStates(bars);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones, uppers, lowers } = calculateVSR(bars, len, thr);
    const rows = analyseZones(bars, zones, trend);
    const snaps = lagSnapshots(bars, zones, trend, [1, 4, 12]);
    const bls = barLevelStats(bars, uppers, lowers);
    const c = countOutcomes(rows);
    const n = rows.length;
    const withDecision = rows.filter((r) => r.pos !== "");
    const upExit = rows.filter((r) => r.outcome === "UP");
    const dnExit = rows.filter((r) => r.outcome === "DOWN");
    const agg = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : NaN);
    const nextSide = (dir, side) => rows.filter((r) => r.outcome === dir && r.nextZoneSide === side).length;

    const m = {
      symbol, config: key, bars: bars.length,
      zones: n,
      up: c.UP, down: c.DOWN, none: c.NONE, bypass: c.BYPASS,
      insidePct: bls.pctInsideOfZoneBars,
      ageAvg: agg(rows.filter((r) => r.age !== ""), (r) => r.age + 1),
      upRev8: upExit.length ? (upExit.filter((r) => r.revertedShort).length / upExit.length) * 100 : NaN,
      dnRev8: dnExit.length ? (dnExit.filter((r) => r.revertedShort).length / dnExit.length) * 100 : NaN,
      extUp: agg(upExit, (r) => r.extLong),
      extDn: agg(dnExit, (r) => r.extLong),
      nextUpAbove: upExit.length ? (nextSide("UP", "ABOVE") / upExit.length) * 100 : NaN,
      nextDnBelow: dnExit.length ? (nextSide("DOWN", "BELOW") / dnExit.length) * 100 : NaN,
      r1: ruleEval(withDecision, "R1", { cond: (r) => r.trendAt === 1 && r.pos >= 0.5, dir: "UP" }),
      r2: ruleEval(withDecision, "R2", { cond: (r) => r.trendAt === -1 && r.pos <= 0.5, dir: "DOWN" }),
      r3: ruleEval(withDecision, "R3", { cond: (r) => r.wickPoked === true && r.pos >= 0.5, dir: "UP" }),
      r4: ruleEval(withDecision, "R4", { cond: (r) => r.wickPoked === true && r.pos <= 0.5, dir: "DOWN" }),
    };
    PER_SYMBOL.set(`${symbol}|${key}`, m);

    // Gộp dữ liệu để thống kê pooled
    for (const r of withDecision) pooled[key].decisions.push({ symbol, ...r });
    for (const s of snaps) pooled[key].snaps.push({ symbol, ...s });

    writeCsv(`output/multi/zones_${symbol.toLowerCase()}_${len}_${thr}.csv`, rows);
  }
}

console.log("\n" + "=".repeat(100));
console.log("TỔNG HỢP THEO TỪNG SYMBOL (VSR 10,10):");
printTable("10,10");
console.log("\n" + "=".repeat(100));
console.log("TỔNG HỢP THEO TỪNG SYMBOL (VSR 20,20):");
printTable("20,20");

function printTable(key) {
  const rows = [...PER_SYMBOL.entries()]
    .filter(([, m]) => m.config === key)
    .sort((a, b) => b[1].bars - a[1].bars);
  const fmt = (v, d = 1, suffix = "") => (Number.isFinite(v) ? `${v.toFixed(d)}${suffix}` : "-");
  console.log(`  ${"Symbol".padEnd(10)} ${"Nến".padStart(8)} ${"Zone".padStart(5)} ${"UP%".padStart(5)} ${"DN%".padStart(5)} ${"BYP%".padStart(5)} ${"TrgZone%".padStart(8)} ${"Tuổi".padStart(5)} ${"UPrev8%".padStart(8)} ${"DNrev8%".padStart(8)} ${"extUP%".padStart(7)} ${"extDN%".padStart(7)} ${"nxUP%".padStart(7)} ${"nxDN%".padStart(6)} ${"R1%".padStart(5)} ${"R2%".padStart(5)} ${"R3%".padStart(5)} ${"R4%".padStart(5)}`);
  for (const [, m] of rows) {
    const total = m.zones;
    const hit = (r) => (r ? r.hitRate : "-");
    console.log(`  ${m.symbol.padEnd(10)} ${String(m.bars).padStart(8)} ${String(m.zones).padStart(5)} ${fmt(m.up / total * 100).padStart(5)} ${fmt(m.down / total * 100).padStart(5)} ${fmt(m.bypass / total * 100).padStart(5)} ${String(m.insidePct).padStart(8)} ${fmt(m.ageAvg, 0).padStart(5)} ${fmt(m.upRev8).padStart(8)} ${fmt(m.dnRev8).padStart(8)} ${fmt(m.extUp, 2).padStart(7)} ${fmt(m.extDn, 2).padStart(7)} ${fmt(m.nextUpAbove, 0).padStart(7)} ${fmt(m.nextDnBelow, 0).padStart(6)} ${hit(m.r1).padStart(5)} ${hit(m.r2).padStart(5)} ${hit(m.r3).padStart(5)} ${hit(m.r4).padStart(5)}`);
  }
}

// ==== Thống kê gộp (pooled) ====
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const decisions = pooled[key].decisions;
  const snaps = pooled[key].snaps;
  if (!decisions.length) continue;

  const c = countOutcomes(decisions);
  const n = decisions.length;
  console.log(`\n${"#".repeat(100)}`);
  console.log(`POOLED TẤT CẢ ${args.symbols.length} SYMBOL — VSR (${key}): ${n} điểm quyết định (base rate: UP ${c.UP} (${(100 * c.UP / n).toFixed(1)}%), DOWN ${c.DOWN} (${(100 * c.DOWN / n).toFixed(1)}%), NONE ${c.NONE})`);

  const printBucket = (rows, fn, labels) => {
    console.log(`  ${"Nhóm".padEnd(24)} ${"N".padStart(6)} ${"P(UP)".padStart(8)} ${"P(DOWN)".padStart(8)} ${"P(NONE)".padStart(8)}`);
    for (const g of bucketTable(rows, fn, labels)) {
      console.log(`  ${g.label.padEnd(24)} ${String(g.total).padStart(6)} ${g.pUp.padStart(8)} ${g.pDown.padStart(8)} ${g.pNone.padStart(8)}`);
    }
  };

  console.log("\n[1] Vị trí close trong zone (0 = đáy, 1 = đỉnh):");
  printBucket(decisions, (r) => (r.pos < 0.34 ? 0 : r.pos > 0.66 ? 1 : 2),
    ["pos: đáy zone (<0.34)", "pos: giữa zone", "pos: đỉnh zone (>0.66)"]);
  console.log("\n[2] Trend ATRBot:");
  printBucket(decisions, (r) => (r.trendAt === 1 ? 0 : 1), ["UPTREND", "DOWNTREND"]);
  console.log("\n[3] Tuổi zone (nến từ khi tạo zone):");
  printBucket(decisions, (r) => (r.age <= 4 ? 0 : r.age <= 12 ? 1 : 2), ["<=4 nến", "5-12 nến", ">12 nến"]);
  console.log("\n[4] Wick đã chọc ra ngoài zone:");
  printBucket(decisions, (r) => (r.wickPoked === true ? 0 : 1), ["đã chọc ra", "chưa chọc ra"]);

  const rules = [
    ["R1: trend UP + giá nửa trên zone → UP", { cond: (r) => r.trendAt === 1 && r.pos >= 0.5, dir: "UP" }],
    ["R2: trend DOWN + giá nửa dưới zone → DOWN", { cond: (r) => r.trendAt === -1 && r.pos <= 0.5, dir: "DOWN" }],
    ["R3: wick chọc ngoài + giá nửa trên → UP", { cond: (r) => r.wickPoked === true && r.pos >= 0.5, dir: "UP" }],
    ["R4: wick chọc ngoài + giá nửa dưới → DOWN", { cond: (r) => r.wickPoked === true && r.pos <= 0.5, dir: "DOWN" }],
    ["R5: trend UP + nửa dưới → DOWN (ngược)", { cond: (r) => r.trendAt === 1 && r.pos < 0.5, dir: "DOWN" }],
    ["R6: trend DOWN + nửa trên → UP (ngược)", { cond: (r) => r.trendAt === -1 && r.pos > 0.5, dir: "UP" }],
    ["R7: pos đáy 1/3 + trend DOWN → DOWN", { cond: (r) => r.trendAt === -1 && r.pos < 0.34, dir: "DOWN" }],
    ["R8: pos đỉnh 1/3 + trend UP → UP", { cond: (r) => r.trendAt === 1 && r.pos > 0.66, dir: "UP" }],
  ];
  console.log("\n[5] Đánh giá luật giao dịch (hit rate):");
  console.log(`  ${"Luật".padEnd(40)} ${"N".padStart(6)} ${"HIT".padStart(8)} ${"Ngược".padStart(8)} ${"NONE".padStart(8)}`);
  for (const [label, pred] of rules) {
    const e = ruleEval(decisions, label, pred);
    if (!e) continue;
    console.log(`  ${e.label.padEnd(40)} ${String(e.total).padStart(6)} ${e.hitRate.padStart(8)} ${e.oppRate.padStart(8)} ${e.noneRate.padStart(8)}`);
  }

  console.log("\n[6] Dự đoán sớm (L nến sau khi zone hình thành, giá còn trong zone):");
  for (const lag of [1, 4, 12]) {
    const s = snaps.filter((x) => x.lag === lag);
    if (!s.length) continue;
    const cs = countOutcomes(s);
    console.log(`  L=${String(lag).padStart(2)}: ${s.length} mẫu → UP ${(100 * cs.UP / s.length).toFixed(1)}%, DOWN ${(100 * cs.DOWN / s.length).toFixed(1)}%, NONE ${(100 * cs.NONE / s.length).toFixed(1)}%`);
    const sUp = s.filter((x) => x.pos >= 0.5);
    const sDn = s.filter((x) => x.pos < 0.5);
    const fmt = (rows) => {
      const cc = countOutcomes(rows);
      return rows.length ? `UP ${(100 * cc.UP / rows.length).toFixed(1)}% / DOWN ${(100 * cc.DOWN / rows.length).toFixed(1)}%` : "-";
    };
    if (sUp.length) console.log(`         giá nửa trên: ${fmt(sUp)}`);
    if (sDn.length) console.log(`         giá nửa dưới: ${fmt(sDn)}`);
  }
}

// ==== Xuất CSV tổng hợp ====
const summaryRows = [...PER_SYMBOL.values()].map((m) => ({
  symbol: m.symbol, config: m.config, bars: m.bars, zones: m.zones,
  up: m.up, down: m.down, none: m.none, bypass: m.bypass,
  insidePct: m.insidePct, ageAvg: Number(m.ageAvg.toFixed(1)),
  upRev8Pct: Number(m.upRev8.toFixed(1)), dnRev8Pct: Number(m.dnRev8.toFixed(1)),
  extUpPct: Number(m.extUp.toFixed(2)), extDnPct: Number(m.extDn.toFixed(2)),
  nextUpAbovePct: Number(m.nextUpAbove.toFixed(1)), nextDnBelowPct: Number(m.nextDnBelow.toFixed(1)),
  r1Hit: m.r1 ? m.r1.hitRate : "", r2Hit: m.r2 ? m.r2.hitRate : "",
  r3Hit: m.r3 ? m.r3.hitRate : "", r4Hit: m.r4 ? m.r4.hitRate : "",
}));
writeCsv("output/multi/summary.csv", summaryRows);
for (const [len, thr] of configs) {
  writeCsv(`output/multi/pooled_decisions_${len}_${thr}.csv`, pooled[`${len},${thr}`].decisions);
  writeCsv(`output/multi/pooled_snapshots_${len}_${thr}.csv`, pooled[`${len},${thr}`].snaps);
}
console.log("\nCSV đã lưu trong research-vsr/output/multi/ (zones_*, summary.csv, pooled_*)");

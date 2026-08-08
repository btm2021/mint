import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { analyseZones, lagSnapshots, buildReport, writeCsv, barLevelStats } from "./lib/analyse.js";

function parseArgs(argv) {
  const args = { symbol: "IMXUSDT", interval: "15m", bars: 50000, configs: "20,20|10,10" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
      if (val) { args[key] = val; i++; }
    }
  }
  args.bars = parseInt(args.bars, 10) || 50000;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const configs = args.configs.split("|").map((c) => c.split(",").map(Number));

const cacheFile = `cache/${args.symbol.toLowerCase()}_${args.interval}.json`;
const bars = await fetchBars({ symbol: args.symbol, interval: args.interval, total: args.bars, cacheFile });
if (bars.length < 500) {
  console.error(`Quá ít dữ liệu (${bars.length} nến). Kiểm tra symbol ${args.symbol} ${args.interval}.`);
  process.exit(1);
}

console.log(`Tính trend ATRBot (EMA30 + ATR14x2)...`);
const trend = calculateTrendStates(bars);

const summaries = [];
for (const [len, thr] of configs) {
  const label = `${len},${thr}`;
  console.log(`\nTính VSR (${label}) trên ${bars.length.toLocaleString()} nến...`);
  const { zones, uppers, lowers } = calculateVSR(bars, len, thr);
  const rows = analyseZones(bars, zones, trend);
  const snaps = lagSnapshots(bars, zones, trend, [1, 4, 12]);

  const report = buildReport({
    len,
    thr,
    symbol: args.symbol,
    interval: args.interval,
    bars,
    zones,
    uppers,
    lowers,
    rows,
    snaps,
  });
  console.log(report);

  writeCsv(`output/zones_${len}_${thr}.csv`, rows);
  writeCsv(`output/snapshots_${len}_${thr}.csv`, snaps);

  const c = { UP: 0, DOWN: 0, NONE: 0, BYPASS: 0 };
  for (const r of rows) c[r.outcome]++;
  const bls = barLevelStats(bars, uppers, lowers);
  summaries.push({ label, total: rows.length, ...c, insidePct: bls.pctInsideOfZoneBars });
}

console.log("-".repeat(96));
console.log("SO SÁNH HAI CẤU HÌNH VSR:");
console.log(`  ${"Cấu hình".padEnd(14)} ${"Zone".padStart(6)} ${"UP".padStart(6)} ${"DOWN".padStart(6)} ${"NONE".padStart(6)} ${"BYPASS".padStart(7)} ${"Nến trong zone %".padStart(14)}`);
for (const s of summaries) {
  console.log(`  ${`(${s.label})`.padEnd(14)} ${String(s.total).padStart(6)} ${String(s.UP).padStart(6)} ${String(s.DOWN).padStart(6)} ${String(s.NONE).padStart(6)} ${String(s.BYPASS).padStart(7)} ${s.insidePct.padStart(14)}`);
}

console.log("\nOutput CSV đã lưu trong thư mục research-vsr/output/");

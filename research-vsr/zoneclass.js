import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { analyseZoneTests, bucketTable, ruleEval, writeCsv } from "./lib/retest.js";
import { calcEma, calcDayVwap, avgVolume } from "./lib/indicators.js";

function parseArgs(argv) {
  const args = {
    symbols: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
    interval: "15m",
    bars: 200000,
    configs: "5,10|10,10|15,10",
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
const configs = args.configs.split("|").map((c) => c.split(",").map(Number));
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

const pooled = {}; // key `len,thr` -> tests augmented
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`PHÂN LOẠI ZONE ĐÁY/ĐỈNH/XUYÊN — ${args.symbols.length} symbol ${args.interval}`);
console.log(`Configs: ${args.configs} | Nến tối đa: ${args.bars.toLocaleString()} | K=8 nến`);
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
  if (bars.length < 5000) {
    console.log(`BỎ QUA ${symbol}: chỉ có ${bars.length} nến`);
    continue;
  }
  console.log(`  ${symbol}: ${bars.length.toLocaleString()} nến (${new Date(bars[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(bars.at(-1).time * 1000).toISOString().slice(0, 10)})`);
  const trend = calculateTrendStates(bars);
  const ema20 = calcEma(bars, 20);
  const vwap = calcDayVwap(bars);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones } = calculateVSR(bars, len, thr);
    const tests = analyseZoneTests(bars, zones, trend, [8]);
    for (const r of tests) {
      if (r.outcome8 === "NO_TEST") {
        pooled[key].push({ symbol, ...r });
        continue;
      }
      const cT = bars[r.touchIdx].close;
      pooled[key].push({
        symbol, ...r,
        closeVsEma: cT >= ema20[r.touchIdx] ? "ABOVE" : "BELOW",
        emaSlope: ema20[r.touchIdx] > ema20[r.touchIdx - 3] ? "RISING" : "FALLING",
        closeVsVwap: Number.isFinite(vwap[r.touchIdx]) ? (cT >= vwap[r.touchIdx] ? "ABOVE" : "BELOW") : "NA",
      });
    }
  }
}

// ==================== BÁO CÁO ====================
const crossConfig = [];

for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const all = pooled[key];
  if (!all.length) continue;
  const tested = all.filter((r) => r.outcome8 !== "NO_TEST");
  const sup = tested.filter((r) => r.approach === "ABOVE");
  const res = tested.filter((r) => r.approach === "BELOW");

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — ${all.length} zone, ${tested.length} test (K=8)`);

  const printSide = (sideRows, label, wantBounce) => {
    const n = sideRows.length;
    const emit = (g) => {
      const cc = { BOUNCE: 0, THROUGH: 0, HELD: 0 };
      for (const r of g.rows) cc[r.outcome8]++;
      console.log(`  ${g.label.padEnd(30)} ${String(g.total).padStart(7)} ${pct(cc.BOUNCE, g.total).padStart(9)} ${pct(cc.THROUGH, g.total).padStart(9)} ${pct(cc.HELD, g.total).padStart(7)}`);
    };
    const cc = { BOUNCE: 0, THROUGH: 0, HELD: 0 };
    for (const r of sideRows) cc[r.outcome8]++;
    console.log(`\n[${label}] (${n} test) — base: BẬT ${pct(cc.BOUNCE, n)} | XUYÊN ${pct(cc.THROUGH, n)}`);
    console.log(`  ${"Nhóm".padEnd(30)} ${"N".padStart(7)} ${"Bật%".padStart(9)} ${"Xuyên%".padStart(9)} ${"Giữ%".padStart(7)}`);

    // EMA/VWAP alignment: cùng phía EMA với hướng test = xuôi trend
    const aligned = (r) => r.closeVsEma === (r.approach === "ABOVE" ? "ABOVE" : "BELOW");
    const vwapAligned = (r) => r.closeVsVwap === (r.approach === "ABOVE" ? "ABOVE" : "BELOW");
    console.log(`  — EMA20 alignment (giá test zone từ phía xuôi EMA):`);
    bucketTable(sideRows, (r) => (aligned(r) ? 0 : 1), ["XUÔI EMA (aligned)", "NGƯỢC EMA"]).forEach(emit);
    console.log(`  — VWAP phiên alignment:`);
    bucketTable(sideRows, (r) => (vwapAligned(r) ? 0 : 1), ["XUÔI VWAP", "NGƯỢC VWAP"]).forEach(emit);
    console.log(`  — Volume nến test vs TB20:`);
    bucketTable(sideRows, (r) => (r.volRatio <= 1 ? 0 : r.volRatio <= 2 ? 1 : 2), ["<=1x", "1-2x", ">2x"]).forEach(emit);
    console.log(`  — Tuổi zone khi test:`);
    bucketTable(sideRows, (r) => (r.ageAtTest <= 4 ? 0 : r.ageAtTest <= 12 ? 1 : 2), ["<=4 (mới)", "5-12", ">12 (cũ)"]).forEach(emit);
    console.log(`  — Độ rộng zone:`);
    bucketTable(sideRows, (r) => (r.widthPct <= 0.3 ? 0 : r.widthPct <= 0.7 ? 1 : 2), ["<=0.3%", "0.3-0.7%", ">0.7%"]).forEach(emit);
    console.log(`  — Zone đã gộp nhiều spike:`);
    bucketTable(sideRows, (r) => (r.merges >= 1 ? 0 : 1), ["có gộp", "không gộp"]).forEach(emit);

    // Composite score: đếm số điều kiện "thuận lợi cho zone giữ"
    const score = (r) => {
      let s = 0;
      if (aligned(r)) s++;
      if (vwapAligned(r)) s++;
      if (r.volRatio <= 1) s++;
      if (r.ageAtTest > 12) s++;
      if (r.widthPct > 0.7) s++;
      if (r.merges >= 1) s++;
      return s;
    };
    console.log(`  — ĐIỂM TỔNG HỢP (0-6): đếm số điều kiện thuận lợi cho việc zone GIỮ:`);
    console.log(`    (xuôi EMA + xuôi VWAP + volume thấp + zone cũ + zone rộng + zone gộp)`);
    bucketTable(sideRows, (r) => (score(r) <= 1 ? 0 : score(r) === 2 ? 1 : score(r) === 3 ? 2 : score(r) === 4 ? 3 : 4), ["0-1 điểm", "2 điểm", "3 điểm", "4 điểm", "5-6 điểm"]).forEach(emit);

    const rules = [
      ["XUÔI EMA → BẬT", { cond: (r) => aligned(r), dir: "BOUNCE" }],
      ["XUÔI EMA + volume<=1x → BẬT", { cond: (r) => aligned(r) && r.volRatio <= 1, dir: "BOUNCE" }],
      ["XUÔI EMA + volume<=1x + zone cũ → BẬT", { cond: (r) => aligned(r) && r.volRatio <= 1 && r.ageAtTest > 12, dir: "BOUNCE" }],
      ["NGƯỢC EMA + volume>2x → XUYÊN", { cond: (r) => !aligned(r) && r.volRatio > 2, dir: "THROUGH" }],
      ["score >= 4 → BẬT", { cond: (r) => score(r) >= 4, dir: "BOUNCE" }],
      ["score <= 1 → XUYÊN", { cond: (r) => score(r) <= 1, dir: "THROUGH" }],
    ];
    console.log(`  — Luật:`);
    console.log(`  ${"Luật".padEnd(38)} ${"N".padStart(7)} ${"HIT".padStart(8)} ${"Ngược".padStart(8)} ${"Giữ".padStart(7)}`);
    for (const [label, pred] of rules) {
      const e = ruleEval(sideRows, label, pred);
      if (!e) continue;
      console.log(`  ${e.label.padEnd(38)} ${String(e.total).padStart(7)} ${e.hitRate.padStart(8)} ${e.oppRate.padStart(8)} ${e.heldRate.padStart(7)}`);
    }
    return { cc, n };
  };

  const sStat = printSide(sup, `TEST HỖ TRỢ — giá từ trên xuống (zone = ĐÁY)`, true);
  const rStat = printSide(res, `TEST KHÁNG CỰ — giá từ dưới lên (zone = ĐỈNH)`, false);

  const allAligned = tested.filter((r) => r.closeVsEma === (r.approach === "ABOVE" ? "ABOVE" : "BELOW"));
  const ccA = { BOUNCE: 0, THROUGH: 0, HELD: 0 };
  for (const r of allAligned) ccA[r.outcome8]++;
  crossConfig.push({
    config: key,
    zones: all.length,
    tests: tested.length,
    supBnc: sStat.cc.BOUNCE / sStat.n,
    resBnc: rStat.cc.BOUNCE / rStat.n,
    alignedBnc: allAligned.length ? ccA.BOUNCE / allAligned.length : NaN,
    alignedN: allAligned.length,
  });
}

console.log(`\n${"-".repeat(100)}`);
console.log("SO SÁNH CHÉO 3 CẤU HÌNH (dự đoán BẬT LẠI = zone GIỮ):");
console.log(`  ${"Config".padEnd(10)} ${"Zone".padStart(8)} ${"Test".padStart(8)} ${"HTrợBật%".padStart(9)} ${"KCựBật%".padStart(9)} ${"XuôiEMA%".padStart(10)} ${"N".padStart(7)}`);
for (const c of crossConfig) {
  console.log(`  ${`(${c.config})`.padEnd(10)} ${String(c.zones).padStart(8)} ${String(c.tests).padStart(8)} ${pct(c.supBnc, 1).padStart(9)} ${pct(c.resBnc, 1).padStart(9)} ${(Number.isFinite(c.alignedBnc) ? pct(c.alignedBnc, 1) : "-").padStart(10)} ${String(c.alignedN).padStart(7)}`);
}

for (const [len, thr] of configs) {
  writeCsv(`output/zoneclass/pooled_${len}_${thr}.csv`, pooled[`${len},${thr}`]);
}
writeCsv("output/zoneclass/summary.csv", crossConfig.map((c) => ({ ...c, supBnc: +(c.supBnc * 100).toFixed(1), resBnc: +(c.resBnc * 100).toFixed(1), alignedBnc: +(c.alignedBnc * 100).toFixed(1) })));
console.log("\nCSV đã lưu trong research-vsr/output/zoneclass/");

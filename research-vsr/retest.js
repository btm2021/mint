import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { analyseZoneTests, countOutcomes8, bucketTable, ruleEval, writeCsv } from "./lib/retest.js";

const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

function parseArgs(argv) {
  const args = {
    symbols: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT",
    interval: "15m",
    bars: 200000,
    configs: "20,20|10,10",
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
const Ks = [8, 24];
const K_PRIMARY = 8;

const pooled = {}; // `${len},${thr}` -> tests[]
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];
const perSymbol = []; // summary rows

console.log(`RETEST ZONES — ${args.symbols.length} symbol ${args.interval}, cache tái sử dụng (không tải lại nếu đủ)`);
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
  if (bars.length < 2000) {
    console.log(`BỎ QUA ${symbol}: chỉ có ${bars.length} nến`);
    continue;
  }
  const trend = calculateTrendStates(bars);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones } = calculateVSR(bars, len, thr);
    const tests = analyseZoneTests(bars, zones, trend, Ks);
    pooled[key].push(...tests.map((t) => ({ symbol, ...t })));

    const c = countOutcomes8(tests);
    const total = tests.length;
    const tested = tests.filter((t) => t.outcome8 !== "NO_TEST");
    const sup = tested.filter((t) => t.approach === "ABOVE");
    const res = tested.filter((t) => t.approach === "BELOW");
    const cs = countOutcomes8(sup);
    const cr = countOutcomes8(res);
    const avg = (arr, f) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : NaN);

    perSymbol.push({
      symbol, config: key, zones: total,
      noTestPct: c.NO_TEST ? +((100 * c.NO_TEST) / total).toFixed(1) : 0,
      supN: sup.length,
      supThrPct: cs.THROUGH ? +((100 * cs.THROUGH) / sup.length).toFixed(1) : NaN,
      supBncPct: cs.BOUNCE ? +((100 * cs.BOUNCE) / sup.length).toFixed(1) : NaN,
      resN: res.length,
      resThrPct: cr.THROUGH ? +((100 * cr.THROUGH) / res.length).toFixed(1) : NaN,
      resBncPct: cr.BOUNCE ? +((100 * cr.BOUNCE) / res.length).toFixed(1) : NaN,
      extBnc: avg(sup.filter((t) => t.outcome8 === "BOUNCE"), (t) => t.ext8Pct),
      extThr: avg(sup.filter((t) => t.outcome8 === "THROUGH"), (t) => t.ext8Pct),
    });

    writeCsv(`output/retest/tests_${symbol.toLowerCase()}_${len}_${thr}.csv`, tests);
  }
}

// ==== Báo cáo gộp ====
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const all = pooled[key];
  if (!all.length) continue;
  const tested = all.filter((t) => t.outcome8 !== "NO_TEST");
  const sup = tested.filter((t) => t.approach === "ABOVE");
  const res = tested.filter((t) => t.approach === "BELOW");

  const printSide = (rows, label) => {
    const c = countOutcomes8(rows);
    const n = rows.length;
    console.log(`\n[${label}] (${n} lần test)`);
    console.log(`  ${"Nhóm".padEnd(26)} ${"N".padStart(6)} ${"Xuyên qua%".padStart(10)} ${"Bật lại%".padStart(9)} ${"Giữ im%".padStart(8)}`);
    const emit = (g) => console.log(`  ${g.label.padEnd(26)} ${String(g.total).padStart(6)} ${g.pThr.padStart(10)} ${g.pBnc.padStart(9)} ${g.pHeld.padStart(8)}`);
    console.log(`  BASE RATE`);
    emit({ label: "(tất cả)", total: n, pThr: pct(c.THROUGH, n), pBnc: pct(c.BOUNCE, n), pHeld: pct(c.HELD, n) });
    console.log(`  — Trend ATRBot:`);
    bucketTable(rows, (r) => (r.trendAt === 1 ? 0 : 1), ["UPTREND", "DOWNTREND"]).forEach(emit);
    console.log(`  — Context nơi zone tạo ra (20 nến trước):`);
    bucketTable(rows, (r) => (r.ctx === "BOTTOM" ? 0 : r.ctx === "TOP" ? 1 : 2), ["zone ở ĐÁY biên độ", "zone ở ĐỈNH biên độ", "zone ở GIỮA"]).forEach(emit);
    console.log(`  — Tuổi zone khi test (nến):`);
    bucketTable(rows, (r) => (r.ageAtTest <= 4 ? 0 : r.ageAtTest <= 12 ? 1 : 2), ["<=4 nến (zone mới)", "5-12 nến", ">12 nến (zone cũ)"]).forEach(emit);
    console.log(`  — Khoảng cách giá chạy xa trước khi quay lại test:`);
    bucketTable(rows, (r) => (r.distAwayPct <= 0.5 ? 0 : r.distAwayPct <= 1.5 ? 1 : 2), ["<=0.5%", "0.5-1.5%", ">1.5%"]).forEach(emit);
    console.log(`  — Volume tại nến test so với TB 20 nến:`);
    bucketTable(rows, (r) => (r.volRatio <= 1 ? 0 : r.volRatio <= 2 ? 1 : 2), ["<=1x", "1-2x", ">2x"]).forEach(emit);
    console.log(`  — Hướng di chuyển ban đầu ngay khi zone tạo:`);
    bucketTable(rows, (r) => (r.firstMove === "UP" ? 0 : r.firstMove === "DOWN" ? 1 : 2), ["đi lên khỏi zone", "đi xuống khỏi zone", "nằm trong zone"]).forEach(emit);
    console.log(`  — Độ rộng zone:`);
    bucketTable(rows, (r) => (r.widthPct <= 0.3 ? 0 : r.widthPct <= 0.7 ? 1 : 2), ["<=0.3%", "0.3-0.7%", ">0.7%"]).forEach(emit);
    console.log(`  — Zone được gộp (nhiều spike cùng chung 1 zone):`);
    bucketTable(rows, (r) => (r.merges >= 1 ? 0 : 1), ["có gộp >=1 lần", "không gộp"]).forEach(emit);

    console.log(`  — Luật giao dịch:`);
    const rules = [
      ["TREND DOWN → XUYÊN QUA", { cond: (r) => r.trendAt === -1, dir: "THROUGH" }],
      ["TREND UP → BẬT LẠI", { cond: (r) => r.trendAt === 1, dir: "BOUNCE" }],
      ["zone MỚI (<=4 nến) → BẬT LẠI", { cond: (r) => r.ageAtTest <= 4, dir: "BOUNCE" }],
      ["zone CŨ (>12 nến) → XUYÊN QUA", { cond: (r) => r.ageAtTest > 12, dir: "THROUGH" }],
      ["context ĐÁY → BẬT LẠI", { cond: (r) => r.ctx === "BOTTOM", dir: "BOUNCE" }],
      ["context ĐỈNH → XUYÊN QUA", { cond: (r) => r.ctx === "TOP", dir: "THROUGH" }],
      ["khoảng cách xa >1.5% → BẬT LẠI", { cond: (r) => r.distAwayPct > 1.5, dir: "BOUNCE" }],
      ["volume test >2x → XUYÊN QUA", { cond: (r) => r.volRatio > 2, dir: "THROUGH" }],
    ];
    console.log(`  ${"Luật".padEnd(34)} ${"N".padStart(6)} ${"HIT".padStart(8)} ${"Ngược".padStart(8)} ${"Giữ".padStart(8)}`);
    for (const [label, pred] of rules) {
      const e = ruleEval(rows, label, pred);
      if (!e) continue;
      console.log(`  ${e.label.padEnd(34)} ${String(e.total).padStart(6)} ${e.hitRate.padStart(8)} ${e.oppRate.padStart(8)} ${e.heldRate.padStart(8)}`);
    }
    const bnc = rows.filter((r) => r.outcome8 === "BOUNCE");
    const thr = rows.filter((r) => r.outcome8 === "THROUGH");
    const avg = (arr, f) => (arr.length ? (arr.reduce((a, r) => a + f(r), 0) / arr.length).toFixed(2) : "-");
    console.log(`  — Độ xa TB sau sự kiện: bật lại ${avg(bnc, (r) => r.ext8Pct)}% | xuyên qua ${avg(thr, (r) => r.ext8Pct)}%`);
  };

  const cAll = countOutcomes8(all);
  console.log(`\n${"#".repeat(100)}`);
  console.log(`RETEST VSR (${key}) — ${args.symbols.length} symbol, ${all.length} zone (K=${K_PRIMARY} nến ≈ 2h)`);
  console.log(`  NO_TEST (giá chưa từng chạm lại zone): ${cAll.NO_TEST} (${pct(cAll.NO_TEST, all.length)})`);
  console.log(`  Có test: ${tested.length} (${pct(tested.length, all.length)}) — trong đó test HỖ TRỢ (giá từ trên xuống): ${sup.length}, test KHÁNG CỰ (giá từ dưới lên): ${res.length}`);
  printSide(sup, `TEST HỖ TRỢ — giá từ TRÊN đi xuống chạm zone (zone = ĐÁY/đỡ dưới)`);
  printSide(res, `TEST KHÁNG CỰ — giá từ DƯỚI đi lên chạm zone (zone = ĐỈNH/đỡ trên)`);

  // K=24
  const c24 = { THROUGH: 0, BOUNCE: 0, HELD: 0, NO_TEST: 0 };
  for (const t of tested) c24[t.outcome24]++;
  console.log(`\n  So với K=${24} nến (≈6h): THROUGH ${pct(c24.THROUGH, tested.length)} | BOUNCE ${pct(c24.BOUNCE, tested.length)} | HELD ${pct(c24.HELD, tested.length)} (trong số ${tested.length} zone có test)`);
}

// ==== Bảng per-symbol ====
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = perSymbol.filter((m) => m.config === key).sort((a, b) => b.zones - a.zones);
  console.log(`\n${"-".repeat(100)}`);
  console.log(`THEO TỪNG SYMBOL — VSR (${key}) — cột % tính trên các lần test: THR = xuyên qua, BNC = bật lại`);
  console.log(`  ${"Symbol".padEnd(12)} ${"Zone".padStart(6)} ${"NoTest%".padStart(8)} ${"HTrợ".padStart(5)} ${"supTHR%".padStart(8)} ${"supBNC%".padStart(8)} ${"KCự".padStart(5)} ${"resTHR%".padStart(8)} ${"resBNC%".padStart(8)} ${"extBnc%".padStart(8)} ${"extThr%".padStart(8)}`);
  for (const m of rows) {
    console.log(`  ${m.symbol.padEnd(12)} ${String(m.zones).padStart(6)} ${String(m.noTestPct).padStart(8)} ${String(m.supN).padStart(5)} ${m.supThrPct.toFixed(1).padStart(8)} ${m.supBncPct.toFixed(1).padStart(8)} ${String(m.resN).padStart(5)} ${m.resThrPct.toFixed(1).padStart(8)} ${m.resBncPct.toFixed(1).padStart(8)} ${m.extBnc.toFixed(2).padStart(8)} ${m.extThr.toFixed(2).padStart(8)}`);
  }
}

writeCsv("output/retest/summary.csv", perSymbol);
for (const [len, thr] of configs) {
  writeCsv(`output/retest/pooled_tests_${len}_${thr}.csv`, pooled[`${len},${thr}`]);
}
console.log("\nCSV đã lưu trong research-vsr/output/retest/");

import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { analyseZoneTests, bucketTable, ruleEval, writeCsv } from "./lib/retest.js";
import { calcEma, calcDayVwap, avgVolume } from "./lib/indicators.js";

function parseArgs(argv) {
  const args = {
    symbols: "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT",
    interval: "15m",
    bars: 200000,
    kFwd: 24,
    sampleStep: 4,
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
  args.kFwd = parseInt(args.kFwd, 10) || 24;
  args.sampleStep = parseInt(args.sampleStep, 10) || 4;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const K = args.kFwd;
const STEP = args.sampleStep;
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

// VSR10: length=10, threshold=10 | VSR20: length=20, threshold=20
const P10 = { len: 10, thr: 10 };
const P20 = { len: 20, thr: 20 };

const partA = [];       // mẫu dự đoán việc tạo zone VSR20
const partB = [];       // zone VSR20 + retest + confluence + EMA/VWAP
const perSymbol = [];

console.log(`DỰ ĐOÁN VSR(20,20) BẰNG VSR(10,10) + EMA20 + VWAP phiên — ${args.symbols.length} symbol ${args.interval}`);
console.log(`Cửa sổ dự đoán tạo zone VSR20: ${K} nến (≈${K * 15} phút) | mẫu Part A: mỗi ${STEP} nến lấy 1`);
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
  const n = bars.length;
  const trend = calculateTrendStates(bars);
  const ema20 = calcEma(bars, 20);
  const vwap = calcDayVwap(bars);

  const v10 = calculateVSR(bars, P10.len, P10.thr);
  const v20 = calculateVSR(bars, P20.len, P20.thr);
  const tests10 = analyseZoneTests(bars, v10.zones, trend, [8]);
  const tests20 = analyseZoneTests(bars, v20.zones, trend, [8, 24]);

  // ---- Sự kiện VSR20 (signal > 20) và VSR10 test, sắp theo thời gian ----
  const events20 = [];
  for (let i = 0; i < n; i++) if (v20.signals[i] > 20) events20.push(i);
  const tests10Ev = tests10
    .filter((r) => r.outcome8 !== "NO_TEST")
    .map((r) => ({ t: r.touchIdx, outcome: r.outcome8 }))
    .sort((a, b) => a.t - b.t);

  // ================= PART A: dự đoán VSR20 zone mới trong K nến tới =================
  let ptrE = 0;   // con trỏ events20
  let ptrT = 0;   // con trỏ tests10Ev
  let ptrZ = 0;   // con trỏ zone VSR10 active
  const pA = [];
  for (let t = 200; t < n - K; t += STEP) {
    while (ptrE < events20.length && events20[ptrE] <= t) ptrE++;
    let has20 = false;
    for (let j = ptrE; j < events20.length && events20[j] <= t + K; j++) { has20 = true; break; }

    while (ptrZ < v10.zones.length && v10.zones[ptrZ].endIndex < t) ptrZ++;
    const z10 = ptrZ < v10.zones.length && v10.zones[ptrZ].startIndex <= t && v10.zones[ptrZ].endIndex >= t
      ? v10.zones[ptrZ]
      : null;

    while (ptrT < tests10Ev.length && tests10Ev[ptrT].t <= t) ptrT++;
    let last10 = "NONE";
    if (ptrT > 0 && tests10Ev[ptrT - 1].t >= t - K) last10 = tests10Ev[ptrT - 1].outcome;

    const close = bars[t].close;
    const vRatio = bars[t].volume / avgVolume(bars, t);
    pA.push({
      symbol, t,
      sig10: +v10.signals[t].toFixed(2),
      vsr10Active: z10 ? 1 : 0,
      vsr10Age: z10 ? t - z10.startIndex : -1,
      pos10: z10 ? +Math.min(1, Math.max(0, (close - z10.lower) / (z10.upper - z10.lower))).toFixed(3) : -1,
      last10,
      trend: trend[t],
      closeVsEma: close >= ema20[t] ? "ABOVE" : "BELOW",
      emaSlope: ema20[t] > ema20[t - 3] ? "RISING" : "FALLING",
      closeVsVwap: Number.isFinite(vwap[t]) ? (close >= vwap[t] ? "ABOVE" : "BELOW") : "NA",
      volRatio: +vRatio.toFixed(2),
      zone20: has20 ? 1 : 0,
    });
  }
  partA.push(...pA);
  writeCsv(`output/predict20/partA_${symbol.toLowerCase()}.csv`, pA);

  // ================= PART B: hành vi zone VSR20 theo VSR10 + EMA/VWAP =================
  for (const r of tests20) {
    if (r.outcome8 === "NO_TEST") continue;
    const zone = v20.zones[r.zoneId];
    const start = zone.startIndex;
    const T = r.touchIdx;
    // Vị trí zone VSR20 so với zone VSR10 đang hoạt động lúc tạo:
    // overlap / gần (cách <= 1 lần độ rộng zone VSR10) / xa
    let dist10 = "NONE";
    if (Number.isFinite(v10.lowers[start]) && Number.isFinite(v10.uppers[start])) {
      const l10 = v10.lowers[start], u10 = v10.uppers[start];
      const overlap = r.lower <= u10 && l10 <= r.upper;
      if (overlap) dist10 = "OVERLAP";
      else {
        const w10 = u10 - l10;
        const gap = l10 > r.upper ? l10 - r.upper : r.lower - u10;
        dist10 = gap <= w10 ? "NEAR" : "FAR";
      }
    }
    let last10 = "NONE";
    for (let j = tests10Ev.length - 1; j >= 0; j--) {
      if (tests10Ev[j].t < start) {
        if (start - tests10Ev[j].t <= K) last10 = tests10Ev[j].outcome;
        break;
      }
    }
    const cT = bars[T].close;
    partB.push({
      symbol, ...r,
      dist10,
      last10,
      closeVsEma: cT >= ema20[T] ? "ABOVE" : "BELOW",
      emaSlope: ema20[T] > ema20[T - 3] ? "RISING" : "FALLING",
      closeVsVwap: Number.isFinite(vwap[T]) ? (cT >= vwap[T] ? "ABOVE" : "BELOW") : "NA",
    });
  }

  // ---- summary per symbol ----
  const sup = tests20.filter((t) => t.outcome8 !== "NO_TEST" && t.approach === "ABOVE");
  const res = tests20.filter((t) => t.outcome8 !== "NO_TEST" && t.approach === "BELOW");
  const supBnc = sup.filter((t) => t.outcome8 === "BOUNCE").length;
  const resBnc = res.filter((t) => t.outcome8 === "BOUNCE").length;
  const tested = sup.length + res.length;
  perSymbol.push({
    symbol, zones: tests20.length, noTestPct: +((100 * tests20.filter((t) => t.outcome8 === "NO_TEST").length) / Math.max(1, tests20.length)).toFixed(1),
    supN: sup.length, supBncPct: +((100 * supBnc) / Math.max(1, sup.length)).toFixed(1),
    resN: res.length, resBncPct: +((100 * resBnc) / Math.max(1, res.length)).toFixed(1),
  });
}

// ==================================== BÁO CÁO ====================================
console.log(`\n${"#".repeat(100)}`);
console.log(`PART A — VSR(10,10) có dự đoán được VSR(20,20) TẠO ZONE MỚI trong ${K} nến tới không?`);
{
  const rows = partA;
  const n = rows.length;
  const pos = rows.filter((r) => r.zone20 === 1).length;
  console.log(`  Số mẫu: ${n.toLocaleString()} (mỗi ${STEP} nến) | Có zone VSR20 mới trong ${K} nến: ${pos.toLocaleString()} = BASE RATE ${pct(pos, n)}`);

  const print = (label, fn, labels) => {
    console.log(`\n  ${label}:`);
    console.log(`  ${"Nhóm".padEnd(30)} ${"N".padStart(9)} ${"P(zone20 mới)".padStart(14)} ${"Lift".padStart(8)}`);
    for (const g of bucketTable(rows, fn, labels)) {
      const c = g.total ? g.rows.filter((r) => r.zone20 === 1).length : 0;
      const rate = pct(c, g.total);
      const lift = g.total ? ((100 * c) / g.total / (pos / n)).toFixed(2) : "-";
      console.log(`  ${g.label.padEnd(30)} ${String(g.total).padStart(9)} ${rate.padStart(14)} ${("x" + lift).padStart(8)}`);
    }
  };
  print("signal VSR10 (độ lớn spike volume gần nhất):", (r) => (r.sig10 <= 1 ? 0 : r.sig10 <= 5 ? 1 : 2), ["<=1 (volume lặng)", "1-5", ">5 (spike mạnh)"]);
  print("có zone VSR10 đang hoạt động:", (r) => (r.vsr10Active === 1 ? 0 : 1), ["đang có zone VSR10", "chưa có zone"]);
  print("kết quả lần test VSR10 gần nhất (trong 24 nến):", (r) => (r.last10 === "BOUNCE" ? 0 : r.last10 === "THROUGH" ? 1 : 2), ["BẬT LẠI (zone giữ)", "XUYÊN QUA (zone vỡ)", "không có test"]);
  print("trend ATRBot:", (r) => (r.trend === 1 ? 0 : 1), ["UPTREND", "DOWNTREND"]);
  print("close vs EMA20:", (r) => (r.closeVsEma === "ABOVE" ? 0 : 1), ["trên EMA20", "dưới EMA20"]);
  print("EMA20 slope:", (r) => (r.emaSlope === "RISING" ? 0 : 1), ["EMA đi lên", "EMA đi xuống"]);
  print("close vs VWAP phiên:", (r) => (r.closeVsVwap === "ABOVE" ? 0 : r.closeVsVwap === "BELOW" ? 1 : 2), ["trên VWAP", "dưới VWAP", "không có VWAP"]);
  print("volume hiện tại vs TB20:", (r) => (r.volRatio <= 1 ? 0 : r.volRatio <= 2 ? 1 : 2), ["<=1x", "1-2x", ">2x"]);

  console.log(`\n  Luật (kết hợp):`);
  const rulesA = [
    ["sig10>5 + volume>2x → zone20 mới", { cond: (r) => r.sig10 > 5 && r.volRatio > 2, dir: "Z" }],
    ["test VSR10 THROUGH + EMA đi xuống → zone20 mới", { cond: (r) => r.last10 === "THROUGH" && r.emaSlope === "FALLING", dir: "Z" }],
    ["sig10>5 + close dưới EMA20 → zone20 mới", { cond: (r) => r.sig10 > 5 && r.closeVsEma === "BELOW", dir: "Z" }],
  ];
  console.log(`  ${"Luật".padEnd(44)} ${"N".padStart(9)} ${"P(zone20 mới)".padStart(14)} ${"Lift".padStart(8)}`);
  for (const [label, pred] of rulesA) {
    const m = rows.filter(pred.cond);
    if (!m.length) continue;
    const c = m.filter((r) => r.zone20 === 1).length;
    console.log(`  ${label.padEnd(44)} ${String(m.length).padStart(9)} ${pct(c, m.length).padStart(14)} ${("x" + ((100 * c) / m.length / (pos / n)).toFixed(2)).padStart(8)}`);
  }
}

console.log(`\n${"#".repeat(100)}`);
console.log(`PART B — Thông tin VSR(10,10) + EMA20/VWAP dự đoán ZONE VSR(20,20) GIỮ hay XUYÊN (K=8 nến)`);
{
  const rows = partB;
  const sup = rows.filter((r) => r.approach === "ABOVE");
  const res = rows.filter((r) => r.approach === "BELOW");

  const printSide = (sideRows, label) => {
    const n = sideRows.length;
    const c = { BOUNCE: 0, THROUGH: 0, HELD: 0 };
    for (const r of sideRows) c[r.outcome8]++;
    console.log(`\n[${label}] (${n} test)`);
    console.log(`  ${"Nhóm".padEnd(30)} ${"N".padStart(6)} ${"Bật%".padStart(8)} ${"Xuyên%".padStart(9)} ${"Giữ%".padStart(8)}`);
    const emit = (g) => {
      const cc = { BOUNCE: 0, THROUGH: 0, HELD: 0 };
      for (const r of g.rows) cc[r.outcome8]++;
      console.log(`  ${g.label.padEnd(30)} ${String(g.total).padStart(6)} ${pct(cc.BOUNCE, g.total).padStart(8)} ${pct(cc.THROUGH, g.total).padStart(9)} ${pct(cc.HELD, g.total).padStart(8)}`);
    };
    console.log(`  BASE RATE`);
    emit({ label: "(tất cả)", total: n, rows: sideRows });
    console.log(`  — Vị trí zone VSR20 so với zone VSR10 đang hoạt động lúc tạo:`);
    bucketTable(sideRows, (r) => (r.dist10 === "OVERLAP" ? 0 : r.dist10 === "NEAR" ? 1 : r.dist10 === "FAR" ? 2 : 3), ["TRÙNG vùng VSR10", "GẦN zone VSR10", "XA zone VSR10", "không có zone VSR10"]).forEach(emit);
    console.log(`  — Kết quả lần test VSR10 gần nhất trước khi zone VSR20 tạo:`);
    bucketTable(sideRows, (r) => (r.last10 === "BOUNCE" ? 0 : r.last10 === "THROUGH" ? 1 : 2), ["VSR10 BẬT (giữ)", "VSR10 XUYÊN (vỡ)", "không có test gần"]).forEach(emit);
    console.log(`  — Close vs EMA20 tại nến test:`);
    bucketTable(sideRows, (r) => (r.closeVsEma === "ABOVE" ? 0 : 1), ["trên EMA20", "dưới EMA20"]).forEach(emit);
    console.log(`  — EMA20 slope tại nến test:`);
    bucketTable(sideRows, (r) => (r.emaSlope === "RISING" ? 0 : 1), ["EMA đi lên", "EMA đi xuống"]).forEach(emit);
    console.log(`  — Close vs VWAP phiên tại nến test:`);
    bucketTable(sideRows, (r) => (r.closeVsVwap === "ABOVE" ? 0 : r.closeVsVwap === "BELOW" ? 1 : 2), ["trên VWAP", "dưới VWAP", "không có"]).forEach(emit);
    console.log(`  — Volume tại nến test (so sánh với nến):`);
    bucketTable(sideRows, (r) => (r.volRatio <= 1 ? 0 : r.volRatio <= 2 ? 1 : 2), ["<=1x", "1-2x", ">2x"]).forEach(emit);

    console.log(`  — Luật (hit rate dự đoán BẬT LẠI):`);
    const wantBounce = label.includes("HỖ TRỢ");
    const rules = [
      [`zone VSR20 TRÙNG vùng VSR10 → BẬT`, { cond: (r) => r.dist10 === "OVERLAP", dir: "BOUNCE" }],
      [`zone VSR20 XA vùng VSR10 → XUYÊN`, { cond: (r) => r.dist10 === "FAR", dir: "THROUGH" }],
      [`last10 BẬT → BẬT`, { cond: (r) => r.last10 === "BOUNCE", dir: "BOUNCE" }],
      [`last10 XUYÊN → XUYÊN`, { cond: (r) => r.last10 === "THROUGH", dir: "THROUGH" }],
      [`EMA ${wantBounce ? "đi lên → BẬT" : "đi xuống → BẬT"}`, { cond: (r) => r.emaSlope === (wantBounce ? "RISING" : "FALLING"), dir: "BOUNCE" }],
      [`close ${wantBounce ? "trên EMA → BẬT" : "dưới EMA → BẬT"}`, { cond: (r) => r.closeVsEma === (wantBounce ? "ABOVE" : "BELOW"), dir: "BOUNCE" }],
      [`close ${wantBounce ? "dưới EMA → XUYÊN" : "trên EMA → XUYÊN"}`, { cond: (r) => r.closeVsEma === (wantBounce ? "BELOW" : "ABOVE"), dir: "THROUGH" }],
      [`volume test >2x → XUYÊN`, { cond: (r) => r.volRatio > 2, dir: "THROUGH" }],
      [`confluence + EMA ${wantBounce ? "lên" : "xuống"} → BẬT`, { cond: (r) => r.dist10 === "OVERLAP" && r.emaSlope === (wantBounce ? "RISING" : "FALLING"), dir: "BOUNCE" }],
    ];
    console.log(`  ${"Luật".padEnd(34)} ${"N".padStart(6)} ${"HIT".padStart(8)} ${"Ngược".padStart(8)} ${"Giữ".padStart(8)}`);
    for (const [label2, pred] of rules) {
      const e = ruleEval(sideRows, label2, pred);
      if (!e) continue;
      console.log(`  ${e.label.padEnd(34)} ${String(e.total).padStart(6)} ${e.hitRate.padStart(8)} ${e.oppRate.padStart(8)} ${e.heldRate.padStart(8)}`);
    }
  };
  printSide(sup, "TEST HỖ TRỢ zone VSR20 — giá từ trên xuống");
  printSide(res, "TEST KHÁNG CỰ zone VSR20 — giá từ dưới lên");
}

// ---- per-symbol ----
console.log(`\n${"-".repeat(100)}`);
console.log("THEO TỪNG SYMBOL (VSR20 — test có outcome): BNC% = % bật lại");
console.log(`  ${"Symbol".padEnd(12)} ${"Zone".padStart(6)} ${"NoTest%".padStart(8)} ${"HTrợ".padStart(5)} ${"supBNC%".padStart(8)} ${"KCự".padStart(5)} ${"resBNC%".padStart(8)}`);
for (const m of perSymbol) {
  console.log(`  ${m.symbol.padEnd(12)} ${String(m.zones).padStart(6)} ${String(m.noTestPct).padStart(8)} ${String(m.supN).padStart(5)} ${String(m.supBncPct).padStart(8)} ${String(m.resN).padStart(5)} ${String(m.resBncPct).padStart(8)}`);
}

writeCsv("output/predict20/partA_pooled.csv", partA);
writeCsv("output/predict20/partB_pooled.csv", partB);
writeCsv("output/predict20/summary.csv", perSymbol);
console.log("\nCSV đã lưu trong research-vsr/output/predict20/");

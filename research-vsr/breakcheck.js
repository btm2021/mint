import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, calcDayVwap } from "./lib/indicators.js";

// ĐỊNH NGHĨA MỚI (theo đề xuất): "XUYÊN" chỉ tính khi ATRBot(14,2,14,VIDYA) xác nhận hướng
//   - support break (approach ABOVE, close < lower) phải có state = DOWNTREND tại nến xuyên
//   - resistance break (approach BELOW, close > upper) phải có state = UPTREND
//   - close xuyên nhưng trend KHÔNG xác nhận -> PHA_GIA (phá giả)
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
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

const pooled = {};
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`BREAKCHECK — XUYÊN có ATRBot(14,2,14 VIDYA) xác nhận — ${args.symbols.length} symbol, K=${K}`);
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
  const trend = calculateTrendStates(bars, 14, 14, 2, "vidya");
  const ema20 = calcEma(bars, 20);
  const vwap = calcDayVwap(bars);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones } = calculateVSR(bars, len, thr);
    const n = bars.length;

    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      const start = z.startIndex;
      const end = Math.min(z.endIndex, n - 1);
      const upper = z.upper, lower = z.lower;
      if (!(upper > lower)) continue;
      if (start >= n - 2) continue;

      const eps = [];
      let i = start + 1;
      while (i <= end) {
        const prevInside = bars[i - 1].close >= lower && bars[i - 1].close <= upper;
        if (!prevInside && bars[i].high >= lower && bars[i].low <= upper) {
          const epStart = i;
          const approach = bars[i - 1].close > upper ? "ABOVE" : "BELOW";
          let j = i;
          while (j <= end && !(bars[j - 1].close >= lower && bars[j - 1].close <= upper) && bars[j].high >= lower && bars[j].low <= upper) j++;
          // Phân loại episode với ATRBot xác nhận
          let outcome = "GIU";           // chặn (không close nào xuyên trong K)
          let breakIdx = -1;
          let trendAtBreak = null;
          let oldThrough = false;
          const scanEnd = Math.min(end, epStart + K);
          for (let t = epStart; t <= scanEnd; t++) {
            const c = bars[t].close;
            const thru = approach === "ABOVE" ? c < lower : c > upper;
            if (thru) {
              oldThrough = true;
              breakIdx = t;
              trendAtBreak = trend[t];
              break;
            }
          }
          if (oldThrough) {
            const confirmDown = approach === "ABOVE" && trendAtBreak === -1;
            const confirmUp = approach === "BELOW" && trendAtBreak === 1;
            outcome = confirmDown || confirmUp ? "XUYEN_THAT" : "PHA_GIA";
          }
          eps.push({ start: epStart, approach, outcome, breakIdx, trendAtBreak, trendAtTouch: trend[Math.max(0, epStart - 1)] });
          i = j;
        } else {
          i++;
        }
      }

      if (!eps.length) continue;
      const first = eps[0];
      const anyReal = eps.some((e) => e.outcome === "XUYEN_THAT");
      const cF = bars[first.start].close;
      const alignedEma = first.approach === "ABOVE" ? cF >= ema20[first.start] : cF < ema20[first.start];
      const alignedVwap = first.approach === "ABOVE" ? cF >= vwap[first.start] : cF < vwap[first.start];
      let vAvg = 0, cnt = 0;
      for (let t = Math.max(0, first.start - 20); t < first.start; t++) { vAvg += bars[t].volume; cnt++; }
      vAvg = cnt ? vAvg / cnt : NaN;
      const volRatio = vAvg > 0 ? bars[first.start].volume / vAvg : NaN;
      const age = first.start - start;
      const wPct = (upper - lower) / cF * 100;
      let score = 0;
      if (alignedEma) score++;
      if (alignedVwap) score++;
      if (volRatio <= 1) score++;
      if (age > 12) score++;
      if (wPct > 0.7) score++;
      if (z.merges >= 1) score++;

      pooled[key].push({
        symbol, zoneId: zi,
        eps: eps.length,
        sides: [...new Set(eps.map((e) => e.approach))].length,
        firstApproach: first.approach,
        firstOutcome: first.outcome,
        zoneOutcome: anyReal ? "XUYEN_THAT" : "CHAN",
        score,
        firstOldThrough: eps[0].outcome !== "GIU",
        firstOldThroughFake: first.outcome === "PHA_GIA",
        lag: first.breakIdx === -1 ? "" : first.breakIdx - first.start,
        trendFlip: first.breakIdx === -1 ? "" : first.trendAtTouch !== first.trendAtBreak,
      });
    }
  }
}

for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key];
  if (!rows.length) continue;
  const n = rows.length;

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — ${n} zone có ≥1 lần chạm | XUYÊN = close xuyên + ATRBot(14,2,14 VIDYA) xác nhận hướng`);

  const firsts = rows.map((r) => ({ ...r, epOutcome: r.firstOutcome }));
  const perTouch = (label, cond) => {
    const rs = rows.filter(cond);
    const g = rs.filter((r) => r.firstOutcome === "GIU").length;
    const t = rs.filter((r) => r.firstOutcome === "XUYEN_THAT").length;
    const f = rs.filter((r) => r.firstOutcome === "PHA_GIA").length;
    console.log(`  ${label.padEnd(30)}: GIỮ ${pct(g, rs.length)} | XUYÊN THẬT ${pct(t, rs.length)} | PHÁ GIẢ ${pct(f, rs.length)} (N=${rs.length})`);
  };

  console.log(`\n[1] LẦN CHẠM ĐẦU TIÊN — định nghĩa mới:`);
  perTouch("(tất cả)", () => true);
  const oldThru = rows.filter((r) => r.firstOldThrough);
  const fake = rows.filter((r) => r.firstOldThroughFake);
  console.log(`\n[2] HIỆU CHỈNH: trong ${oldThru.length} lần close xuyên (định nghĩa cũ):`);
  console.log(`    - XUYÊN THẬT (ATRBOT xác nhận): ${oldThru.length - fake.length} (${pct(oldThru.length - fake.length, oldThru.length)})`);
  console.log(`    - PHÁ GIẢ (không xác nhận): ${fake.length} (${pct(fake.length, oldThru.length)})`);
  console.log(`    -> Định nghĩa mới LOẠI ${pct(fake.length, oldThru.length)} số cú "xuyên" cũ`);

  console.log(`\n[3] CẢ ZONE (định nghĩa mới, mọi lần chạm):`);
  const chan = rows.filter((r) => r.zoneOutcome === "CHAN").length;
  const real = rows.filter((r) => r.zoneOutcome === "XUYEN_THAT").length;
  console.log(`  CHẶN cả đời (không có xuyên thật nào) : ${chan} (${pct(chan, n)})`);
  console.log(`  XUYÊN THẬT cả đời (≥1 lần xác nhận)    : ${real} (${pct(real, n)})`);
  console.log(`  (so với định nghĩa cũ: CHẶN 18-28% | XUYÊN 72-82%)`);

  console.log(`\n[4] Theo phía chạm đầu tiên (cấp lần chạm):`);
  perTouch("chạm đầu từ TRÊN (support)", (r) => r.firstApproach === "ABOVE");
  perTouch("chạm đầu từ DƯỚI (resistance)", (r) => r.firstApproach === "BELOW");

  console.log(`\n[5] Theo SCORE tại lần chạm đầu (cấp lần chạm):`);
  perTouch("score >= 4 (dự đoán BẬT)", (r) => r.score >= 4);
  perTouch("score = 3", (r) => r.score === 3);
  perTouch("score = 2", (r) => r.score === 2);
  perTouch("score <= 1 (cảnh báo XUYÊN)", (r) => r.score <= 1);

  console.log(`\n[6] Độ trễ xác nhận & flip trend (lần chạm đầu có xuyên thật):`);
  const realFirst = rows.filter((r) => r.firstOutcome === "XUYEN_THAT");
  const lags = realFirst.map((r) => r.lag);
  const lagAvg = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : NaN;
  const flips = realFirst.filter((r) => r.trendFlip === true).length;
  console.log(`  Nến TB từ chạm đến xác nhận: ${lagAvg.toFixed(1)} (median ~${[...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)]})`);
  console.log(`  Trend ĐẢO so với lúc chạm: ${flips} (${pct(flips, realFirst.length)})`);
  const fakeFirst = rows.filter((r) => r.firstOutcome === "PHA_GIA");
  console.log(`  Phá giả (N=${fakeFirst.length}): trend đang ngược hướng phá -> giá quay lại (không xác nhận)`);

  console.log(`\n[7] Cả zone theo score (định nghĩa mới):`);
  for (const [label, cond] of [
    ["score >= 4", (r) => r.score >= 4],
    ["score <= 1", (r) => r.score <= 1],
  ]) {
    const rs = rows.filter(cond);
    const c = rs.filter((r) => r.zoneOutcome === "CHAN").length;
    console.log(`  ${label.padEnd(12)}: CHẶN cả đời ${pct(c, rs.length)} | XUYÊN THẬT ${pct(rs.length - c, rs.length)} (N=${rs.length})`);
  }

  writeCsv(`output/breakcheck/zone_${len}_${thr}.csv`, rows);
}

console.log("\nCSV đã lưu trong research-vsr/output/breakcheck/");

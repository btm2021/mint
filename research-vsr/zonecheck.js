import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
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
const pct = (x, total) => (total ? `${((100 * x) / total).toFixed(1)}%` : "-");

const pooled = {};
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`ZONE-LEVEL CHECK — cả ZONE chặn hay xuyên (không cắt theo hướng) — ${args.symbols.length} symbol, K=${K}`);
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
    const n = bars.length;

    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      const start = z.startIndex;
      const end = Math.min(z.endIndex, n - 1);
      const upper = z.upper, lower = z.lower;
      if (!(upper > lower)) continue;
      if (start >= n - 2) continue;

      // Gộp các nến chạm liên tiếp thành 1 episode chạm
      const eps = [];
      let i = start + 1;
      while (i <= end) {
        const prevInside = bars[i - 1].close >= lower && bars[i - 1].close <= upper;
        const overlaps = bars[i].high >= lower && bars[i].low <= upper;
        if (!prevInside && overlaps) {
          const epStart = i;
          const approach = bars[i - 1].close > upper ? "ABOVE" : "BELOW";
          let j = i;
          while (j <= end && !(bars[j - 1].close >= lower && bars[j - 1].close <= upper) && bars[j].high >= lower && bars[j].low <= upper) j++;
          // Outcome: có nến nào đóng XUYÊN qua zone trong K nến (giới hạn trong đời zone) không
          let outcome = "BLOCKED";
          const scanEnd = Math.min(end, epStart + K);
          for (let t = epStart; t <= scanEnd; t++) {
            const c = bars[t].close;
            if (approach === "ABOVE" && c < lower) { outcome = "THROUGH"; break; }
            if (approach === "BELOW" && c > upper) { outcome = "THROUGH"; break; }
          }
          eps.push({ start: epStart, approach, outcome });
          i = j;
        } else {
          i++;
        }
      }

      if (!eps.length) continue;

      const sides = [...new Set(eps.map((e) => e.approach))];
      const anyThrough = eps.some((e) => e.outcome === "THROUGH");
      const first = eps[0];
      const cF = bars[first.start].close;

      // Score tại episode đầu tiên (như zoneclass)
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
        startTime: new Date(bars[start].time * 1000).toISOString().slice(0, 16).replace("T", " "),
        eps: eps.length,
        sidesTouched: sides.length === 2 ? "BOTH" : sides[0],
        firstApproach: first.approach,
        firstOutcome: first.outcome,
        zoneOutcome: anyThrough ? "XUYEN" : "CHAN",
        score: score,
        firstThrough: first.outcome === "THROUGH",
        secondBlockedAfterFirstBlocked: eps.length >= 2 ? (first.outcome === "BLOCKED" ? eps.slice(1).every((e) => e.outcome === "BLOCKED") : "") : "",
      });
    }
  }
}

for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key];
  if (!rows.length) continue;

  const n = rows.length;
  const chan = rows.filter((r) => r.zoneOutcome === "CHAN").length;
  const both = rows.filter((r) => r.sidesTouched === "BOTH");
  const onlyA = rows.filter((r) => r.sidesTouched === "ABOVE");
  const onlyB = rows.filter((r) => r.sidesTouched === "BELOW");
  const oneSide = onlyA.length + onlyB.length;

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — ${n} zone có ≥1 lần chạm (K=${K}, xét trong đời zone)`);
  console.log(`\n[1] Zone bị chạm từ MẤY phía? (có phải "cắt lên cắt xuống" không?)`);
  console.log(`  Chỉ từ TRÊN xuống : ${onlyA.length} (${pct(onlyA.length, n)})`);
  console.log(`  Chỉ từ DƯỚI lên   : ${onlyB.length} (${pct(onlyB.length, n)})`);
  console.log(`  CẢ HAI phía (BOTH): ${both.length} (${pct(both.length, n)})  <- zone chặn kiểu 2 chiều`);

  console.log(`\n[2] KẾT QUẢ CẢ ZONE (mọi lần chạm):`);
  console.log(`  CHẶN (không lần nào xuyên): ${chan} (${pct(chan, n)})`);
  console.log(`  XUYÊN (≥1 lần đóng xuyên)  : ${n - chan} (${pct(n - chan, n)})`);

  const sideOutcome = (rows2, label) => {
    const c = rows2.filter((r) => r.zoneOutcome === "CHAN").length;
    console.log(`  ${label.padEnd(28)}: CHẶN ${pct(c, rows2.length)} | XUYÊN ${pct(rows2.length - c, rows2.length)} (N=${rows2.length})`);
  };
  console.log(`\n[3] Kết quả theo phía chạm ĐẦU TIÊN (zone vẫn là 1 thể):`);
  sideOutcome(rows.filter((r) => r.firstApproach === "ABOVE"), "chạm đầu tiên từ TRÊN");
  sideOutcome(rows.filter((r) => r.firstApproach === "BELOW"), "chạm đầu tiên từ DƯỚI");

  console.log(`\n[4] Kết quả theo SCORE tại lần chạm đầu tiên:`);
  const sc = (cond, label) => sideOutcome(rows.filter(cond), label);
  sc((r) => r.score >= 4, "score >= 4 (dự đoán BẬT)");
  sc((r) => r.score === 3, "score = 3");
  sc((r) => r.score === 2, "score = 2");
  sc((r) => r.score <= 1, "score <= 1 (cảnh báo XUYÊN)");

  console.log(`\n[5] Zone chặn lần đầu — các lần sau có chặn tiếp không (nhất quán)?`);
  const firstBlocked = rows.filter((r) => r.firstOutcome === "BLOCKED" && r.eps >= 2);
  const keepBlocked = firstBlocked.filter((r) => r.secondBlockedAfterFirstBlocked === true).length;
  console.log(`  Trong ${firstBlocked.length} zone chặn lần đầu và bị chạm ≥2 lần:`);
  console.log(`    chặn tiếp mọi lần sau: ${keepBlocked} (${pct(keepBlocked, firstBlocked.length)})`);
  console.log(`    có ≥1 lần sau bị xuyên: ${firstBlocked.length - keepBlocked} (${pct(firstBlocked.length - keepBlocked, firstBlocked.length)})`);

  const firstBlockedBoth = firstBlocked.filter((r) => r.sidesTouched === "BOTH");
  const keepBoth = firstBlockedBoth.filter((r) => r.secondBlockedAfterFirstBlocked === true).length;
  console.log(`  (riêng zone bị chạm CẢ 2 phía và chặn lần đầu: chặn tiếp ${pct(keepBoth, firstBlockedBoth.length)}, N=${firstBlockedBoth.length})`);

  console.log(`\n[6] So với cách cũ (chỉ lần chạm đầu):`);
  const fB = rows.filter((r) => r.firstOutcome === "BLOCKED").length;
  console.log(`  Lần chạm đầu: chặn ${pct(fB, n)} | xuyên ${pct(n - fB, n)}`);
  console.log(`  Cả zone     : chặn ${pct(chan, n)} | xuyên ${pct(n - chan, n)}`);
  const agree = rows.filter((r) => (r.zoneOutcome === "CHAN") === (r.firstOutcome === "BLOCKED")).length;
  console.log(`  Độ trùng 2 cách đánh giá: ${pct(agree, n)}`);

  writeCsv(`output/zonecheck/zone_${len}_${thr}.csv`, rows);
}

console.log("\nCSV đã lưu trong research-vsr/output/zonecheck/");

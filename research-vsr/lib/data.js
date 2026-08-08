import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BATCH = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tôn trọng rate limit Binance Futures (2400 weight/phút):
// - klines limit=1500 tốn 10 weight → chờ delayMs giữa các request (~130 req/phút, an toàn)
// - Gặp 429/418 → ngừng theo Retry-After rồi quay lại
async function getKlines(url, delayMs) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status === 418) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = (Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000);
        console.log(`  Rate limit (HTTP ${res.status}), chờ ${(wait / 1000).toFixed(0)}s...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.code) throw new Error(`API ${data.code}: ${data.msg}`);
      return data;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(delayMs * (attempt + 1) + 200);
    }
  }
}

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

// Cache định dạng compact giống project: [time, open, high, low, close, volume]
export function loadCache(file) {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) return null;
  if (parsed.length && Array.isArray(parsed[0])) {
    return parsed.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  }
  if (parsed.length && typeof parsed[0] === "object" && "time" in parsed[0]) {
    return parsed;
  }
  return null;
}

function saveCache(file, bars) {
  ensureDir(file);
  writeFileSync(file, JSON.stringify(bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume])));
}

export async function fetchBars({ symbol, interval, total, cacheFile, delayMs = 450 }) {
  const base = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}`;
  const map = new Map();

  const cached = cacheFile ? loadCache(cacheFile) : null;
  if (cached) {
    for (const b of cached) map.set(b.time * 1000, b);
    console.log(`  Cache: ${map.size.toLocaleString()} nến`);
  }

  // 1. Cập nhật dữ liệu MỚI (forward) nếu đã có cache
  const times = [...map.keys()].sort((a, b) => a - b);
  const lastTime = times.length ? times.at(-1) : 0;
  if (lastTime > 0 && map.size < total) {
    let startTime = lastTime + 1;
    let added = true;
    while (added && map.size < total) {
      const data = await getKlines(`${base}&limit=${BATCH}&startTime=${startTime}`, delayMs);
      added = Array.isArray(data) && data.length > 0;
      for (const d of data) map.set(d[0], { time: d[0] / 1000, open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] });
      if (data.length < BATCH) break;
      startTime = data[data.length - 1][0] + 1;
      await sleep(delayMs);
    }
  }

  // 2. Tải LỊCH SỬ còn thiếu (backward) cho tới đủ `total` hoặc hết dữ liệu
  let firstTime = times.length ? times[0] : 0;
  let endTime = firstTime > 0 ? firstTime - 1 : undefined;
  let failCount = 0;
  while (map.size < total) {
    const url = endTime === undefined
      ? `${base}&limit=${BATCH}`
      : `${base}&limit=${BATCH}&endTime=${endTime}`;
    let data;
    try {
      data = await getKlines(url, delayMs);
    } catch (e) {
      failCount++;
      if (failCount >= 5) throw e;
      console.log(`  Lỗi tải: ${e.message} — thử lại (${failCount}/5)...`);
      await sleep(delayMs * 3);
      continue;
    }
    failCount = 0;
    if (!Array.isArray(data) || data.length === 0) break; // hết dữ liệu
    for (const d of data) map.set(d[0], { time: d[0] / 1000, open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] });
    endTime = data[0][0] - 1;
    if (data.length < BATCH) break;
    process.stdout.write(`\r  Đang tải lịch sử... ${map.size.toLocaleString()} nến`);
    await sleep(delayMs);
  }
  process.stdout.write("\n");

  let bars = [...map.values()].sort((a, b) => a.time - b.time).slice(-total);

  if (cacheFile) saveCache(cacheFile, bars);
  return bars;
}

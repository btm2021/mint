import fs from "node:fs";
import { calculateVSR } from "./lib/vsr.js";
import { analyseZoneTests } from "./lib/retest.js";

const raw = JSON.parse(fs.readFileSync("cache/imxusdt_15m.json", "utf8"));
const bars = raw.map((r) => Array.isArray(r) ? { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] } : r).slice(-30000);
const { zones } = calculateVSR(bars, 10, 10);
const trend = new Array(bars.length).fill(1);

const retestRows = analyseZoneTests(bars, zones, trend, [8]);
const byZone = new Map(retestRows.map((r) => [r.zoneId, r]));
console.log(`zones: ${zones.length}, retestRows: ${retestRows.length}, first keys: ${JSON.stringify(retestRows.slice(0, 3).map((r) => r.zoneId))}`);
let mismatch = 0, total = 0, noRow = 0;
for (let zi = 0; zi < zones.length; zi++) {
  const z = zones[zi];
  const start = z.startIndex;
  const end = Math.min(z.endIndex, bars.length - 1);
  const upper = z.upper, lower = z.lower;
  if (!(upper > lower)) continue;
  if (start >= bars.length - 2) continue;
  const r = byZone.get(zi);
  if (!r) { noRow++; continue; }
  if (r.outcome8 === "NO_TEST") continue;
  total++;

  // tái lập logic zonecheck: episode đầu tiên + outcome trong [epStart, min(end, epStart+8)]
  let i = start + 1;
  while (i <= end) {
    const prevInside = bars[i - 1].close >= lower && bars[i - 1].close <= upper;
    if (!prevInside && bars[i].high >= lower && bars[i].low <= upper) break;
    i++;
  }
  if (i > end) continue;
  const approach = bars[i - 1].close > upper ? "ABOVE" : "BELOW";
  let outcome = "BLOCKED";
  const scanEnd = Math.min(end, i + 8);
  for (let t = i; t <= scanEnd; t++) {
    const c = bars[t].close;
    if (approach === "ABOVE" && c < lower) { outcome = "THROUGH"; break; }
    if (approach === "BELOW" && c > upper) { outcome = "THROUGH"; break; }
  }
  const retestBlocked = r.outcome8 === "BOUNCE" || r.outcome8 === "HELD";
  const zcBlocked = outcome === "BLOCKED";
  if (retestBlocked !== zcBlocked) {
    mismatch++;
    if (mismatch <= 5) {
      console.log(`MISMATCH zone ${zi} idx ${i}: retest=${r.outcome8} (T=${r.touchIdx}) zonecheck=${outcome}`);
    }
  }
}
console.log(`Tổng ${total} | khác nhau: ${mismatch} (${((100 * mismatch) / total).toFixed(1)}%)`);

import fs from "node:fs";
const src = fs.readFileSync("../js/indicators.js", "utf8");
const match = src.match(/function calculateVSR[\s\S]*?\n}/);
if (!match) {
  console.error("Khong tim thay calculateVSR trong indicators.js");
  process.exit(1);
}
const original = new Function("return " + match[0] + "")();
const { calculateVSR } = await import("./lib/vsr.js");
const bars = JSON.parse(fs.readFileSync("cache/imxusdt_15m.json", "utf8")).slice(-3000);
for (const [len, thr] of [[10, 10], [20, 20], [20, 10], [10, 5]]) {
  const a = original(bars, len, thr);
  const b = calculateVSR(bars, len, thr).zones;
  const same = a.length === b.length && a.every((z, i) =>
    z.startIndex === b[i].startIndex && z.endIndex === b[i].endIndex &&
    z.upper === b[i].upper && z.lower === b[i].lower);
  console.log(`len=${len} thr=${thr}: original=${a.length} zones, replica=${b.length} zones, match=${same}`);
}

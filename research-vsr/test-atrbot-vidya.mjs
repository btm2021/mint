import fs from "node:fs";
const src = fs.readFileSync("../js/indicators.js", "utf8");
const match = src.match(/function calculateATRBot[\s\S]*?\n}/);
const original = new Function("return " + match[0] + "")();
const { calculateTrendStates } = await import("./lib/atrbot.js");

const raw = JSON.parse(fs.readFileSync("cache/imxusdt_15m.json", "utf8")).slice(-5000);
const bars = raw.map((r) => Array.isArray(r) ? { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] } : r);

for (const [atrLen, maLen, mult, maType] of [[14, 30, 2, "ema"], [14, 14, 2, "vidya"], [20, 20, 2, "vidya"]]) {
  const orig = original(bars, atrLen, maLen, mult, maType, "close");
  const mine = calculateTrendStates(bars, atrLen, maLen, mult, maType);
  let diffT1 = 0, diffT2 = 0, diffState = 0;
  for (let i = 100; i < bars.length; i++) {
    if (Math.abs(orig.t1Data[i].value - mine[i]) > 1e-9) diffT1++;
  }
  // states: so sánh trực tiếp trail2 để suy state
  const origState = (i) => orig.t1Data[i].value > orig.t2Data[i].value ? 1 : -1;
  for (let i = 100; i < bars.length; i++) {
    if (origState(i) !== mine[i]) diffState++;
  }
  console.log(`atrLen=${atrLen} maLen=${maLen} mult=${mult} ${maType}: diffT1=${diffT1}/${bars.length - 100}, diffState=${diffState}`);
}

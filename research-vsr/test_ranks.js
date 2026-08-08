import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendFull } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma } from "./lib/indicators.js";

// TEST VBT trên 6 symbol theo thứ hạng volume × 2 timeframe (5m, 15m)
// Thông số VBT giữ NGUYÊN (tối ưu cho 15m) — kết quả 5m là tham khảo, cần tái chuẩn hóa.
const C = {
  slow: { atrLen: 20, mult: 3, maLen: 30, maType: "vidya" },
  fast: { atrLen: 14, mult: 2, maLen: 14, maType: "vidya" },
  vsrLen: 10, vsrThr: 10,
  wConfirm: 8, wPull: 16, maxCycleAge: 4, maxPullATR: 0.5,
  tpPct: 2.0, slPct: 2.0,
  feePct: 0.1, slippagePct: 0.04,
  R: 2,
};
const SYMBOLS = {
  "TOP (hạng 9-10)": ["SKHYNIXUSDT", "KORUUSDT"],
  "TRUNG (hạng 99-100)": ["RKLBUSDT", "XAUTUSDT"],
  "BÉ (hạng 200-201)": ["BASEDUSDT", "SAGAUSDT"],
};
const INTERVALS = ["5m", "15m"];

function cyclesOf(states) {
  const n = states.length;
  const cycles = [];
  let cur = { s: states[0], start: 0, end: 0 };
  for (let i = 1; i < n; i++) {
    if (states[i] !== cur.s) { cur.end = i - 1; cycles.push(cur); cur = { s: states[i], start: i, end: i }; }
    else cur.end = i;
  }
  cur.end = n - 1;
  cycles.push(cur);
  return cycles;
}
function atrOf(bars, len) {
  const n = bars.length;
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}

console.log("TEST VBT THEO THỨ HẠNG VOLUME × TIMEFRAME — thông số VBT giữ nguyên (tối ưu 15m)");
console.log("=".repeat(110));

const results = [];
for (const interval of INTERVALS) {
  console.log(`\n${"#".repeat(110)}`);
  console.log(`TIMEFRAME ${interval}`);
  for (const [group, symbols] of Object.entries(SYMBOLS)) {
    for (const symbol of symbols) {
      const cacheFile = `cache/${symbol.toLowerCase()}_${interval}.json`;
      let bars;
      try { bars = await fetchBars({ symbol, interval, total: 200000, cacheFile, delayMs: 450 }); }
      catch (e) { console.log(`  [${group}] ${symbol}: LỖI ${e.message}`); continue; }
      if (bars.length < 3000) { console.log(`  [${group}] ${symbol}: chỉ ${bars.length} nến — bỏ qua`); continue; }
      const n = bars.length;
      const ema20 = calcEma(bars, 20);
      const atrF = atrOf(bars, C.fast.atrLen);
      const { uppers, lowers } = calculateVSR(bars, C.vsrLen, C.vsrThr);
      const slow = calculateTrendFull(bars, C.slow.atrLen, C.slow.maLen, C.slow.mult, C.slow.maType);
      const fastSt = calculateTrendFull(bars, C.fast.atrLen, C.fast.maLen, C.fast.mult, C.fast.maType).states;
      const slowCycles = cyclesOf(slow.states);
      const fastCycles = cyclesOf(fastSt);
      const finite = (arr, i) => Number.isFinite(arr[i]);

      const trades = [];
      for (let c = 0; c < fastCycles.length - 1; c++) {
        const cy = fastCycles[c];
        const cs = cy.start, ce = cy.end, S = cy.s;
        if (ce - cs < 2) continue;
        let cf = -1;
        for (let i = cs; i <= Math.min(ce - 1, cs + C.wConfirm - 1); i++) {
          const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
          const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
          if (xuoi && emaOk) { cf = i; break; }
        }
        if (cf === -1 || cf >= ce) continue;
        let emaT = -1;
        for (let t = cf + 1; t <= Math.min(ce, cf + C.wPull); t++) {
          if (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t]) { emaT = t; break; }
        }
        const entryIdx = emaT !== -1 ? emaT : cf;
        const entry = bars[entryIdx].close;
        if (slow.states[entryIdx] !== S) continue;
        if (entryIdx - cs + 1 > C.maxCycleAge) continue;
        const entryVsZone = S === 1
          ? (finite(uppers, entryIdx) ? (entry - uppers[entryIdx]) / atrF[entryIdx] : 99)
          : (finite(lowers, entryIdx) ? (lowers[entryIdx] - entry) / atrF[entryIdx] : 99);
        if (entryVsZone > -0.5 && entryVsZone <= 0) continue;
        const pullDepth = S === 1 ? (ema20[entryIdx] - entry) / atrF[entryIdx] : (entry - ema20[entryIdx]) / atrF[entryIdx];
        if (pullDepth > C.maxPullATR) continue;

        const tpLv = S === 1 ? entry * (1 + C.tpPct / 100) : entry * (1 - C.tpPct / 100);
        const slLv = S === 1 ? entry * (1 - C.slPct / 100) : entry * (1 + C.slPct / 100);
        let exitType = "TIMEOUT", exitPx = null;
        const end = Math.min(ce, n - 1);
        for (let t = entryIdx + 1; t <= end; t++) {
          if (S === 1 ? bars[t].low <= slLv : bars[t].high >= slLv) { exitType = "SL"; exitPx = slLv; break; }
          if (S === 1 ? bars[t].high >= tpLv : bars[t].low <= tpLv) { exitType = "TP"; exitPx = tpLv; break; }
        }
        if (exitType === "TIMEOUT") exitPx = bars[end].close;
        const pnlPct = S * (exitPx / entry - 1) * 100 - C.feePct - C.slippagePct;
        const slowCyc = slowCycles.find((sc) => sc.start <= entryIdx && sc.end >= entryIdx) || slowCycles[0];
        trades.push({ symbol, interval, S, tEntry: bars[entryIdx].time, pnlPct, pnlR: pnlPct / C.R, hold: end - entryIdx + 1, exitType, slowAge: entryIdx - slowCyc.start });
      }
      if (!trades.length) { console.log(`  [${group}] ${symbol}: 0 lệnh`); continue; }
      const win = trades.filter((t) => t.pnlPct > 0).length;
      const gw = trades.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
      const gl = Math.abs(trades.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
      const totR = trades.reduce((a, t) => a + t.pnlR, 0);
      const expR = totR / trades.length;
      const hold = trades.reduce((a, t) => a + t.hold, 0) / trades.length;
      const days = (trades[trades.length - 1].tEntry - trades[0].tEntry) / 86400;
      const perYear = days > 0 ? trades.length / (days / 365) : 0;
      let e = 100, pk = 100, mdd = 0;
      for (const t of trades) {
        e *= 1 + (t.pnlPct * (1 / C.R)) / 100;
        if (e > pk) pk = e;
        mdd = Math.max(mdd, (1 - e / pk) * 100);
      }
      results.push({ group, symbol, interval, bars: n, n: trades.length, win: (100 * win) / trades.length, expR, pf: gl > 0 ? gw / gl : Infinity, totR, mddR: mdd / C.R, holdBars: hold, perYear, from: new Date(trades[0].tEntry * 1000).toISOString().slice(0, 10) });
      console.log(`  [${group}] ${symbol} (${bars.length.toLocaleString()} nến, từ ${results[results.length - 1].from}): N=${trades.length} | WIN ${((100 * win) / trades.length).toFixed(1)}% | Exp ${expR.toFixed(2)}R | PF ${(gl > 0 ? gw / gl : Infinity).toFixed(2)} | Tổng ${totR.toFixed(0)}R | MaxDD ${(mdd / C.R).toFixed(1)}R | giữ TB ${hold.toFixed(1)}n | ${perYear.toFixed(0)} lệnh/năm`);
    }
  }
}

console.log(`\n${"-".repeat(110)}`);
console.log("TỔNG HỢP (theo nhóm × timeframe):");
console.log(`  ${"Nhóm".padEnd(14)} ${"TF".padEnd(4)} ${"Symbol".padEnd(10)} ${"N".padStart(6)} ${"Win%".padStart(6)} ${"ExpR".padStart(7)} ${"PF".padStart(6)} ${"MaxDDR".padStart(7)} ${"Lệnh/năm".padStart(9)}`);
for (const r of results.sort((a, b) => a.group.localeCompare(b.group) || a.interval.localeCompare(b.interval))) {
  console.log(`  ${r.group.padEnd(14)} ${r.interval.padEnd(4)} ${r.symbol.padEnd(10)} ${String(r.n).padStart(6)} ${r.win.toFixed(1).padStart(6)} ${r.expR.toFixed(2).padStart(7)} ${r.pf.toFixed(2).padStart(6)} ${r.mddR.toFixed(1).padStart(7)} ${r.perYear.toFixed(0).padStart(9)}`);
}
writeCsv("output/test_ranks/results.csv", results.map((r) => ({ ...r, win: +r.win.toFixed(1), expR: +r.expR.toFixed(3), pf: +r.pf.toFixed(2), totR: +r.totR.toFixed(0), mddR: +r.mddR.toFixed(1), holdBars: +r.holdBars.toFixed(1), perYear: +r.perYear.toFixed(0) })));
console.log("\nCSV: output/test_ranks/results.csv");

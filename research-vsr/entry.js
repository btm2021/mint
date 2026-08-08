import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// TÌM ENTRY TỐI ƯU cho ATRBot(14,2,14 VIDYA) + VSR
// Khung: trend = state ATRBot; điều kiện entry = xuôi-confirm (zone cắt cùng hướng + close qua EMA20
// trong W nến đầu). Quét: W ∈ {4,8,12,24} × entry ∈ {flip, conf, nextopen, emapull, zonepull} × vol ∈ {không, 1x, 1.5x, 2x}.
// Exit cố định: tại nến đảo (close[ce]). Phí 0.1%.
const FEE = 0.1;
const WINDOWS = [4, 8, 12, 24];
const VOLS = [0, 1, 1.5, 2];

function parseArgs(argv) {
  const args = {
    symbols: "IMXUSDT,BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,SUIUSDT,1000PEPEUSDT,AVAXUSDT,TONUSDT,TRXUSDT,NEARUSDT,APTUSDT,ARBUSDT,OPUSDT,DOTUSDT,FILUSDT,LTCUSDT",
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

const pooled = {}; // config key -> Map(comboKey -> [{symbol, pnl, hold}])
for (const [len, thr] of configs) pooled[`${len},${thr}`] = new Map();

const comboKey = (W, entry, V) => `W${W}_${entry}_V${V === 0 ? "x" : V}`;
for (const key of Object.keys(pooled)) {
  for (const W of WINDOWS) for (const e of ["flip", "conf", "nextopen", "emapull", "zonepull"]) for (const V of VOLS) {
    pooled[key].set(comboKey(W, e, V), []);
  }
}

console.log(`TÌM ENTRY TỐI ƯU — ATRBot(14,2,14 VIDYA) + VSR — ${args.symbols.length} symbol, phí ${FEE}%`);
console.log(`Quét: W∈{4,8,12,24} × entry∈{flip,conf,nextopen,emapull,zonepull} × vol∈{-,1x,1.5x,2x}`);
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
  const n = bars.length;
  const states = calculateTrendStates(bars, 14, 14, 2, "vidya");
  const ema20 = calcEma(bars, 20);

  const cycles = [];
  let cur = { s: states[0], start: 0, end: 0 };
  for (let i = 1; i < n; i++) {
    if (states[i] !== cur.s) { cur.end = i - 1; cycles.push(cur); cur = { s: states[i], start: i, end: i }; }
    else cur.end = i;
  }
  cur.end = n - 1;
  cycles.push(cur);

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const map = pooled[key];
    const { uppers, lowers } = calculateVSR(bars, len, thr);
    const finite = (arr, i) => Number.isFinite(arr[i]);

    for (let c = 0; c < cycles.length - 1; c++) {
      const cy = cycles[c];
      const cs = cy.start, ce = cy.end, S = cy.s;
      const exitPx = bars[ce].close;
      if (ce - cs < 2) continue;

      // confirm bar theo từng window
      const cf = {};
      for (const W of WINDOWS) {
        cf[W] = -1;
        for (let i = cs; i <= Math.min(ce - 1, cs + W - 1); i++) {
          const xuoi = S === 1 ? (finite(uppers, i) && bars[i].close > uppers[i]) : (finite(lowers, i) && bars[i].close < lowers[i]);
          const emaOk = S === 1 ? bars[i].close > ema20[i] : bars[i].close < ema20[i];
          if (xuoi && emaOk) { cf[W] = i; break; }
        }
      }

      for (const W of WINDOWS) {
        const cfb = cf[W];
        if (cfb === -1 || cfb >= ce) continue;
        const volRatioCf = bars[cfb].volume / avgVolume(bars, cfb);

        // entry price theo từng cách
        const ep = {};
        ep.flip = bars[cs].close;
        ep.conf = bars[cfb].close;
        ep.nextopen = cfb + 1 <= ce ? bars[cfb + 1].open : null;
        let emaT = -1, zoneT = -1;
        for (let t = cfb + 1; t <= Math.min(ce, cfb + 16); t++) {
          if (emaT === -1 && (S === 1 ? bars[t].low <= ema20[t] : bars[t].high >= ema20[t])) emaT = t;
          if (zoneT === -1 && (S === 1 ? (finite(uppers, t) && bars[t].low <= uppers[t]) : (finite(lowers, t) && bars[t].high >= lowers[t]))) zoneT = t;
        }
        ep.emapull = emaT !== -1 ? bars[emaT].close : bars[cfb].close;
        ep.zonepull = zoneT !== -1 ? bars[zoneT].close : bars[cfb].close;

        for (const e of ["flip", "conf", "nextopen", "emapull", "zonepull"]) {
          const entryPx = ep[e];
          if (!entryPx || !Number.isFinite(entryPx)) continue;
          for (const V of VOLS) {
            if (V > 0 && volRatioCf <= V) continue;
            const pnl = S * (exitPx / entryPx - 1) * 100 - FEE;
            const tEntry = e === "flip" ? cs : e === "conf" ? cfb : e === "nextopen" ? cfb + 1 : e === "emapull" ? (emaT !== -1 ? emaT : cfb) : (zoneT !== -1 ? zoneT : cfb);
            map.get(comboKey(W, e, V)).push({ symbol, pnl: +pnl.toFixed(3), hold: ce - tEntry + 1 });
          }
        }
      }
    }
  }
}

// ==================== BÁO CÁO ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const map = pooled[key];
  const combos = [];
  for (const [ck, rows] of map) {
    if (!rows.length) continue;
    const win = rows.filter((r) => r.pnl > 0).length;
    const avg = rows.reduce((a, r) => a + r.pnl, 0) / rows.length;
    const total = rows.reduce((a, r) => a + r.pnl, 0);
    const hold = rows.reduce((a, r) => a + r.hold, 0) / rows.length;
    combos.push({ combo: ck, n: rows.length, winrate: (100 * win) / rows.length, avg, total, hold });
  }
  combos.sort((a, b) => b.winrate - a.winrate);

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — TOP 15 TỔ HỢP ENTRY theo WINRATE (N >= 500):`);
  console.log(`  ${"Combo".padEnd(20)} ${"N".padStart(7)} ${"Win%".padStart(7)} ${"TB%".padStart(8)} ${"Tổng%".padStart(9)} ${"Giữn".padStart(7)}`);
  for (const c of combos.filter((c) => c.n >= 500).slice(0, 15)) {
    console.log(`  ${c.combo.padEnd(20)} ${String(c.n).padStart(7)} ${c.winrate.toFixed(1).padStart(7)} ${c.avg.toFixed(2).padStart(8)} ${c.total.toFixed(0).padStart(9)} ${c.hold.toFixed(1).padStart(7)}`);
  }

  console.log(`\n  ENTRY TIMING (W=8, không lọc volume):`);
  for (const e of ["flip", "conf", "nextopen", "emapull", "zonepull"]) {
    const c = combos.find((x) => x.combo === comboKey(8, e, 0));
    if (c) console.log(`  ${e.padEnd(10)}: N=${String(c.n).padStart(7)} | Win ${c.winrate.toFixed(1)}% | TB ${c.avg.toFixed(2)}%`);
  }
  console.log(`\n  CỬA SỔ W (entry=conf, không lọc volume):`);
  for (const W of WINDOWS) {
    const c = combos.find((x) => x.combo === comboKey(W, "conf", 0));
    if (c) console.log(`  W=${String(W).padEnd(3)}: N=${String(c.n).padStart(7)} | Win ${c.winrate.toFixed(1)}% | TB ${c.avg.toFixed(2)}%`);
  }
  console.log(`\n  LỌC VOLUME (W=8, entry=conf):`);
  for (const V of VOLS) {
    const c = combos.find((x) => x.combo === comboKey(8, "conf", V));
    if (c) console.log(`  vol>${V === 0 ? "-" : V + "x"}: N=${String(c.n).padStart(7)} | Win ${c.winrate.toFixed(1)}% | TB ${c.avg.toFixed(2)}%`);
  }
  console.log(`\n  LỌC VOLUME (W=8, entry=zonepull):`);
  for (const V of VOLS) {
    const c = combos.find((x) => x.combo === comboKey(8, "zonepull", V));
    if (c) console.log(`  vol>${V === 0 ? "-" : V + "x"}: N=${String(c.n).padStart(7)} | Win ${c.winrate.toFixed(1)}% | TB ${c.avg.toFixed(2)}%`);
  }

  const base = combos.find((x) => x.combo === comboKey(4, "flip", 0) && x.n > 0) || combos[0];
  writeCsv(`output/entry/combos_${len}_${thr}.csv`, combos.map((c) => ({ ...c, winrate: +c.winrate.toFixed(2), avg: +c.avg.toFixed(3), total: +c.total.toFixed(1), hold: +c.hold.toFixed(1) })));
}

// ==================== Per-symbol: BASE vs BEST ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const map = pooled[key];
  const combos = [];
  for (const [ck, rows] of map) {
    if (rows.length < 500) continue;
    const win = rows.filter((r) => r.pnl > 0).length;
    combos.push({ combo: ck, n: rows.length, winrate: (100 * win) / rows.length });
  }
  combos.sort((a, b) => b.winrate - a.winrate);
  const best = combos[0];
  if (!best) continue;
  console.log(`\n${"-".repeat(100)}`);
  console.log(`THEO SYMBOL — VSR (${key}) — BASE (flip entry, mọi cycle) vs BEST: ${best.combo} (win ${best.winrate.toFixed(1)}%)`);
  const baseMap = map.get(comboKey(4, "flip", 0));
  const bestMap = map.get(best.combo);
  const syms = new Set([...baseMap.map((r) => r.symbol), ...bestMap.map((r) => r.symbol)]);
  console.log(`  ${"Symbol".padEnd(12)} ${"BaseN".padStart(6)} ${"BaseW%".padStart(8)} ${"BestN".padStart(6)} ${"BestW%".padStart(8)} ${"ΔWin".padStart(7)} ${"BestTB%".padStart(9)}`);
  for (const sym of [...syms].sort()) {
    const b = baseMap.filter((r) => r.symbol === sym);
    const be = bestMap.filter((r) => r.symbol === sym);
    if (!b.length || !be.length) continue;
    const bW = (100 * b.filter((r) => r.pnl > 0).length) / b.length;
    const eW = (100 * be.filter((r) => r.pnl > 0).length) / be.length;
    const eT = be.reduce((a, r) => a + r.pnl, 0) / be.length;
    console.log(`  ${sym.padEnd(12)} ${String(b.length).padStart(6)} ${bW.toFixed(1).padStart(8)} ${String(be.length).padStart(6)} ${eW.toFixed(1).padStart(8)} ${(eW - bW).toFixed(1).padStart(7)} ${eT.toFixed(2).padStart(9)}`);
  }
}

console.log("\nCSV đã lưu trong research-vsr/output/entry/");

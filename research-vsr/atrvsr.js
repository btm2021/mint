import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, avgVolume } from "./lib/indicators.js";

// MỤC TIÊU: dùng VSR để TĂNG WINRATE cho ATRBot(14,2,14,VIDYA)
// Chiến lược gốc: long khi state=1, short khi state=-1, thoát khi state đảo (tại close nến đảo).
// Phân loại từng chu kỳ theo VSR: flip do cắt zone ngược/xuôi, có/không EMA-xác nhận,
// xuôi-confirm sớm trong 8 nến đầu. So sánh winrate.
// Biến thể thoát sớm: khi zone bị cắt NGƯỢC trend + xác nhận -> thoát ngay (tránh mất phần lời).
const FEE = 0.1; // % khứ hồi

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

const pooled = {};
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`ATRBOT + VSR — tăng winrate cho ATRBot(14,2,14 VIDYA) — ${args.symbols.length} symbol, phí ${FEE}%`);
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
    const { uppers, lowers } = calculateVSR(bars, len, thr);
    const finite = (arr, i) => Number.isFinite(arr[i]);

    for (let c = 0; c < cycles.length - 1; c++) {
      const cy = cycles[c];
      const cs = cy.start, ce = cy.end, S = cy.s;
      const entry = bars[cs].close;
      const exitBase = bars[ce].close;
      const movePct = S * (exitBase / entry - 1) * 100;
      const pnlBase = movePct - FEE;
      const winBase = pnlBase > 0;
      const hold = ce - cs + 1;

      // ---- Phân loại VSR tại điểm flip (bar cs) ----
      let crossStart = "NONE";
      if (finite(uppers, cs - 1) && finite(lowers, cs - 1)) {
        if (bars[cs].close > uppers[cs - 1]) crossStart = S === 1 ? "XUOI" : "NGUOC";
        else if (bars[cs].close < lowers[cs - 1]) crossStart = S === -1 ? "XUOI" : "NGUOC";
      }
      let confStart = false;
      if (crossStart === "NGUOC") {
        if (S === 1 && bars[cs].close < ema20[cs]) confStart = true;
        if (S === -1 && bars[cs].close > ema20[cs]) confStart = true;
      }

      // ---- Xuôi confirm trong 8 nến đầu (xác nhận trend mới) ----
      let xuoiEarly = false;
      let confBar = -1;
      for (let i = cs; i <= Math.min(ce, cs + 7); i++) {
        if (S === 1 && finite(uppers, i) && bars[i].close > uppers[i] && bars[i].close > ema20[i]) { xuoiEarly = true; confBar = i; break; }
        if (S === -1 && finite(lowers, i) && bars[i].close < lowers[i] && bars[i].close < ema20[i]) { xuoiEarly = true; confBar = i; break; }
      }
      const pnlEntryConf = xuoiEarly ? S * (exitBase / bars[confBar].close - 1) * 100 - FEE : null;

      // ---- Thoát sớm khi cắt NGƯỢC + xác nhận ----
      const findExit = (strict) => {
        for (let t = cs + 1; t <= ce; t++) {
          if (S === 1 && finite(lowers, t - 1) && bars[t].close < lowers[t - 1]) {
            const emaOk = bars[t].close < ema20[t];
            const volOk = bars[t].volume > 2 * avgVolume(bars, t);
            if (strict ? emaOk && volOk : emaOk || volOk) {
              return { t, pnl: S * (bars[t].close / entry - 1) * 100 - FEE };
            }
          }
          if (S === -1 && finite(uppers, t - 1) && bars[t].close > uppers[t - 1]) {
            const emaOk = bars[t].close > ema20[t];
            const volOk = bars[t].volume > 2 * avgVolume(bars, t);
            if (strict ? emaOk && volOk : emaOk || volOk) {
              return { t, pnl: S * (bars[t].close / entry - 1) * 100 - FEE };
            }
          }
        }
        return null;
      };
      const exConf = findExit(false);
      const exStrict = findExit(true);
      const pnlConf = exConf ? exConf.pnl : pnlBase;
      const pnlStrict = exStrict ? exStrict.pnl : pnlBase;
      const holdConf = exConf ? exConf.t - cs + 1 : hold;

      pooled[key].push({
        symbol, config: key, state: S, cycleLen: hold,
        crossStart, confStart, xuoiEarly,
        winBase: winBase ? 1 : 0, pnlBase: +pnlBase.toFixed(3),
        pnlConf: +pnlConf.toFixed(3), pnlStrict: +pnlStrict.toFixed(3),
        pnlEntryConf: pnlEntryConf === null ? "" : +pnlEntryConf.toFixed(3),
        holdConf,
      });
    }
  }
}

for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key];
  if (!rows.length) continue;

  const stat = (label, rs) => {
    if (!rs.length) { console.log(`  ${label.padEnd(38)}: (không có mẫu)`); return; }
    const win = rs.filter((r) => r.winBase).length;
    const avg = rs.reduce((a, r) => a + r.pnlBase, 0) / rs.length;
    const total = rs.reduce((a, r) => a + r.pnlBase, 0);
    console.log(`  ${label.padEnd(38)}: N=${String(rs.length).padStart(6)} | WINRATE ${pct(win, rs.length).padStart(6)} | TB ${avg.toFixed(2)}% | Tổng ${total.toFixed(0)}%`);
  };

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — ${rows.length} chu kỳ ATRBot`);
  console.log(`\n[1] BASE — ATRBot thuần (long/short theo state, thoát khi đảo):`);
  stat("(tất cả)", rows);
  stat("UP cycle", rows.filter((r) => r.state === 1));
  stat("DOWN cycle", rows.filter((r) => r.state === -1));

  console.log(`\n[2] WINRATE THEO TRẠNG THÁI VSR TẠI ĐIỂM ĐẢO (flip):`);
  stat("flip do cắt zone NGƯỢC + EMA xác nhận", rows.filter((r) => r.crossStart === "NGUOC" && r.confStart));
  stat("flip do cắt zone NGƯỢC (không xác nhận)", rows.filter((r) => r.crossStart === "NGUOC" && !r.confStart));
  stat("flip do cắt zone XUÔI", rows.filter((r) => r.crossStart === "XUOI"));
  stat("flip không cắt zone", rows.filter((r) => r.crossStart === "NONE"));

  console.log(`\n[3] WINRATE THEO XÁC NHẬN SỚM (xuôi confirm trong 8 nến đầu cycle):`);
  stat("có xuôi confirm sớm", rows.filter((r) => r.xuoiEarly));
  stat("không có xuôi confirm sớm", rows.filter((r) => !r.xuoiEarly));

  console.log(`\n[4] THOÁT SỚM BẰNG VSR (cắt ngược + xác nhận):`);
  const exec = (label, field) => {
    const win = rows.filter((r) => r[field] > 0).length;
    const avg = rows.reduce((a, r) => a + r[field], 0) / rows.length;
    const total = rows.reduce((a, r) => a + r[field], 0);
    const holdAvg = rows.reduce((a, r) => a + r.holdConf, 0) / rows.length;
    console.log(`  ${label.padEnd(38)}: WINRATE ${pct(win, rows.length).padStart(6)} | TB ${avg.toFixed(2)}% | Tổng ${total.toFixed(0)}% | giữ TB ${holdAvg.toFixed(1)}n`);
  };
  exec("BASE (giữ đến khi đảo)", "pnlBase");
  exec("THOÁT SỚM: cắt ngược + (EMA hoặc vol>2x)", "pnlConf");
  exec("THOÁT SỚM chặt: cắt ngược + EMA và vol>2x", "pnlStrict");

  console.log(`\n[5] KẾT HỢP — lọc entry bằng xuôi confirm sớm (vào tại nến confirm):`);
  const early = rows.filter((r) => r.xuoiEarly);
  const late = rows.filter((r) => !r.xuoiEarly);
  const w1 = early.filter((r) => r.winBase).length;
  const w2 = late.filter((r) => r.winBase).length;
  const ec = early.filter((r) => r.pnlEntryConf !== "" && r.pnlEntryConf > 0).length;
  const ecTb = early.length ? early.reduce((a, r) => a + (r.pnlEntryConf === "" ? 0 : r.pnlEntryConf), 0) / early.length : NaN;
  const ecTot = early.reduce((a, r) => a + (r.pnlEntryConf === "" ? 0 : r.pnlEntryConf), 0);
  console.log(`  Có confirm sớm (entry tại flip) : N=${early.length} | winrate ${pct(w1, early.length)} | TB ${early.length ? (early.reduce((a, r) => a + r.pnlBase, 0) / early.length).toFixed(2) : "-"}% | Tổng ${early.reduce((a, r) => a + r.pnlBase, 0).toFixed(0)}%`);
  console.log(`  -> VÀO LỆNH tại nến confirm thật : N=${early.length} | winrate ${pct(ec, early.length)} | TB ${ecTb.toFixed(2)}% | Tổng ${ecTot.toFixed(0)}%`);
  console.log(`  Không confirm (BỎ QUA lệnh này)  : N=${late.length} | winrate ${pct(w2, late.length)} | TB ${late.length ? (late.reduce((a, r) => a + r.pnlBase, 0) / late.length).toFixed(2) : "-"}% | Tổng ${late.reduce((a, r) => a + r.pnlBase, 0).toFixed(0)}%`);

  writeCsv(`output/atrvsr/cycles_${len}_${thr}.csv`, rows);
}

// ==================== Per-symbol ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key];
  if (!rows.length) continue;
  console.log(`\n${"-".repeat(100)}`);
  console.log(`THEO SYMBOL — VSR (${key}) — BASE vs THOÁT SỚM (cắt ngược + EMA/vol):`);
  console.log(`  ${"Symbol".padEnd(12)} ${"N".padStart(5)} ${"BaseW%".padStart(8)} ${"ExitW%".padStart(8)} ${"ΔWin".padStart(7)} ${"BaseTB%".padStart(9)} ${"ExitTB%".padStart(9)} ${"ΔTB".padStart(8)}`);
  const bySym = new Map();
  for (const r of rows) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, { n: 0, bW: 0, eW: 0, bS: 0, eS: 0 });
    const m = bySym.get(r.symbol);
    m.n++;
    if (r.pnlBase > 0) m.bW++;
    if (r.pnlConf > 0) m.eW++;
    m.bS += r.pnlBase;
    m.eS += r.pnlConf;
  }
  for (const [sym, m] of [...bySym.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const bW = (100 * m.bW) / m.n, eW = (100 * m.eW) / m.n;
    const bT = m.bS / m.n, eT = m.eS / m.n;
    console.log(`  ${sym.padEnd(12)} ${String(m.n).padStart(5)} ${bW.toFixed(1).padStart(8)} ${eW.toFixed(1).padStart(8)} ${(eW - bW).toFixed(1).padStart(7)} ${bT.toFixed(2).padStart(9)} ${eT.toFixed(2).padStart(9)} ${(eT - bT).toFixed(2).padStart(8)}`);
  }
}

// ==================== Cross-config ====================
console.log(`\n${"-".repeat(100)}`);
console.log("SO SÁNH 3 CONFIG:");
console.log(`  ${"Config".padEnd(10)} ${"N".padStart(6)} ${"BaseW%".padStart(8)} ${"ExitW%".padStart(8)} ${"BaseTB%".padStart(9)} ${"ExitTB%".padStart(9)}`);
for (const [len, thr] of configs) {
  const rows = pooled[`${len},${thr}`];
  if (!rows.length) continue;
  const n = rows.length;
  const bW = rows.filter((r) => r.pnlBase > 0).length;
  const eW = rows.filter((r) => r.pnlConf > 0).length;
  const bT = rows.reduce((a, r) => a + r.pnlBase, 0) / n;
  const eT = rows.reduce((a, r) => a + r.pnlConf, 0) / n;
  console.log(`  ${`(${len},${thr})`.padEnd(10)} ${String(n).padStart(6)} ${pct(bW, n).padStart(8)} ${pct(eW, n).padStart(8)} ${bT.toFixed(2).padStart(9)} ${eT.toFixed(2).padStart(9)}`);
}

console.log("\nCSV đã lưu trong research-vsr/output/atrvsr/");

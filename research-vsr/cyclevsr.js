import { fetchBars } from "./lib/data.js";
import { calculateVSR } from "./lib/vsr.js";
import { calculateTrendStates } from "./lib/atrbot.js";
import { writeCsv } from "./lib/retest.js";
import { calcEma, calcDayVwap, avgVolume } from "./lib/indicators.js";

// NGHIÊN CỨU: VSR bổ sung thông tin cho ATRBot(14,2,14,VIDYA)
// Trong mỗi chu kỳ ATRBot (state 1/-1 liên tục), zone VSR đang hoạt động.
// Sự kiện: giá đóng CẮT qua zone (close > upper hoặc close < lower) TRƯỚC khi cycle đảo.
//   - Cắt NGƯỢC trend (UP cycle bị cắt xuống / DOWN cycle bị cắt lên) -> nghi vấn đảo chiều
//   - Cắt XUÔI trend -> xác nhận trend tiếp tục
// Đo: P(cycle đảo trong 8/24/48 nến) so với base rate; độ trễ lead; coverage các lần đảo.
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
const med = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const pooled = {};
for (const [len, thr] of configs) pooled[`${len},${thr}`] = [];

console.log(`CYCLE vs VSR — VSR bổ trợ ATRBot(14,2,14 VIDYA) — ${args.symbols.length} symbol ${args.interval}`);
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
  const vwap = calcDayVwap(bars);

  // Chu kỳ ATRBot
  const cycles = [];
  let cur = { s: states[0], start: 0, end: 0 };
  for (let i = 1; i < n; i++) {
    if (states[i] !== cur.s) {
      cur.end = i - 1;
      cycles.push(cur);
      cur = { s: states[i], start: i, end: i };
    } else {
      cur.end = i;
    }
  }
  cur.end = n - 1;
  cycles.push(cur);

  // Base rate: với nến bất kỳ trong cycle (không kể cycle cuối), cycle còn lại bao nhiêu nến
  const remainAll = [];
  for (let c = 0; c < cycles.length - 1; c++) {
    for (let t = cycles[c].start; t <= cycles[c].end; t++) remainAll.push(cycles[c].end - t);
  }
  const baseFlip = (X) => remainAll.length ? remainAll.filter((r) => r <= X).length / remainAll.length : NaN;

  for (const [len, thr] of configs) {
    const key = `${len},${thr}`;
    const { zones } = calculateVSR(bars, len, thr);

    for (let c = 0; c < cycles.length - 1; c++) {
      const cy = cycles[c];
      const cs = cy.start, ce = cy.end;

      for (const z of zones) {
        if (!(z.startIndex <= ce && z.endIndex >= cs)) continue;
        const scanStart = Math.max(z.startIndex, cs);
        if (scanStart > ce) continue;
        const age0 = scanStart - z.startIndex;

        let t = -1, dir = "";
        for (let i = scanStart; i <= ce; i++) {
          if (bars[i].close > z.upper) { t = i; dir = "UP"; break; }
          if (bars[i].close < z.lower) { t = i; dir = "DN"; break; }
        }

        if (t === -1) {
          pooled[key].push({
            symbol, config: key, state: cy.s, cycleLen: ce - cs + 1,
            zoneStart: z.startIndex, zStartInCycle: z.startIndex >= cs ? 1 : 0,
            event: "HELD", crossDir: "", nguoc: "",
            lead: ce + 1 - scanStart,
            remAfter: ce + 1 - scanStart,
            ageAtEvent: age0 + (ce - scanStart),
            volRatio: +((bars[ce].volume / avgVolume(bars, ce)) || 0).toFixed(2),
            closeVsEma: bars[ce].close >= ema20[ce] ? "ABOVE" : "BELOW",
            widthPct: +(((z.upper - z.lower) / bars[scanStart].close) * 100).toFixed(3),
            merges: z.merges,
          });
          continue;
        }

        const crossDir = dir === "UP" ? "UP" : "DN";
        const nguoc = (cy.s === 1 && crossDir === "DN") || (cy.s === -1 && crossDir === "UP");
        const lead = ce + 1 - t;
        pooled[key].push({
          symbol, config: key, state: cy.s, cycleLen: ce - cs + 1,
          zoneStart: z.startIndex, zStartInCycle: z.startIndex >= cs ? 1 : 0,
          event: "CROSS", crossDir, nguoc: nguoc ? "NGUOC" : "XUOI",
          lead, flip8: lead <= 8 ? 1 : 0, flip24: lead <= 24 ? 1 : 0, flip48: lead <= 48 ? 1 : 0,
          remAfter: ce + 1 - t,
          ageAtEvent: age0 + (t - scanStart),
          volRatio: +((bars[t].volume / avgVolume(bars, t)) || 0).toFixed(2),
          closeVsEma: bars[t].close >= ema20[t] ? "ABOVE" : "BELOW",
          widthPct: +(((z.upper - z.lower) / bars[t].close) * 100).toFixed(3),
          merges: z.merges,
        });
      }
    }
  }

  const baseRow = { symbol, base8: baseFlip(8), base24: baseFlip(24), base48: baseFlip(48) };
  for (const [len, thr] of configs) pooled[`${len},${thr}`].push({ _base: true, ...baseRow });
}

// ==================== BÁO CÁO ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const all = pooled[key];
  const rows = all.filter((r) => !r._base);
  const base = all.find((r) => r._base);
  if (!rows.length) continue;

  const cyclesCount = new Set(rows.map((r) => `${r.symbol}|${r.cycleLen}|${r.zoneStart}`)).size; // xấp xỉ

  console.log(`\n${"#".repeat(100)}`);
  console.log(`VSR (${key}) — SỰ KIỆN ZONE TRONG CHU KỲ ATRBot(14,2,14 VIDYA) — ${rows.length} sự kiện (base rate: đảo trong 8n ${pct(base.base8, 1)}, 24n ${pct(base.base24, 1)}, 48n ${pct(base.base48, 1)})`);

  const stat = (label, rs) => {
    if (!rs.length) { console.log(`  ${label.padEnd(34)}: (không có mẫu)`); return; }
    const f8 = rs.filter((r) => r.flip8).length;
    const f24 = rs.filter((r) => r.flip24).length;
    const f48 = rs.filter((r) => r.flip48).length;
    const leads = rs.map((r) => r.lead);
    const medLead = med(leads);
    const avgLead = leads.reduce((a, b) => a + b, 0) / leads.length;
    const lift8 = (f8 / rs.length) / (base.base8 || 1e-9);
    const rem = rs.reduce((a, r) => a + r.remAfter, 0) / rs.length;
    console.log(`  ${label.padEnd(34)}: N=${String(rs.length).padStart(6)} | đảo 8n ${pct(f8, rs.length).padStart(6)} (x${lift8.toFixed(2)}) | 24n ${pct(f24, rs.length).padStart(6)} | 48n ${pct(f48, rs.length).padStart(6)} | lead TB ${avgLead.toFixed(1)}n (med ${medLead}n) | cycle còn lại TB ${rem.toFixed(1)}n`);
  };

  console.log(`\n[1] CẮT NGƯỢC trend (nghi vấn đảo chiều) vs CẮT XUÔI vs GIỮ:`);
  stat("CẮT NGƯỢC trend (→ đảo?)", rows.filter((r) => r.event === "CROSS" && r.nguoc === "NGUOC"));
  stat("CẮT XUÔI trend (→ tiếp tục)", rows.filter((r) => r.event === "CROSS" && r.nguoc === "XUOI"));
  stat("ZONE GIỮ suốt cycle (không cắt)", rows.filter((r) => r.event === "HELD"));

  console.log(`\n[2] Cắt ngược theo hướng cycle (UP cycle bị cắt xuống / DOWN cycle bị cắt lên):`);
  stat("UP cycle + cắt XUỐNG (support break)", rows.filter((r) => r.state === 1 && r.crossDir === "DN"));
  stat("DOWN cycle + cắt LÊN (resistance break)", rows.filter((r) => r.state === -1 && r.crossDir === "UP"));

  console.log(`\n[3] Cắt ngược + bộ lọc (đảo 8 nến):`);
  const ng = rows.filter((r) => r.event === "CROSS" && r.nguoc === "NGUOC");
  stat("ngược + close cùng phía EMA mới", ng.filter((r) => r.crossDir === "DN" ? r.closeVsEma === "BELOW" : r.closeVsEma === "ABOVE"));
  stat("ngược + volume > 2x", ng.filter((r) => r.volRatio > 2));
  stat("ngược + zone tạo TRONG cycle này", ng.filter((r) => r.zStartInCycle === 1));
  stat("ngược + zone rộng > 0.7%", ng.filter((r) => r.widthPct > 0.7));

  console.log(`\n[4] COVERAGE — bao nhiêu % lần ĐẢO cycle có VSR báo trước?`);
  const flips = new Map(); // symbol|cycleEnd -> {hadWarn8, hadWarn24, crossDirCount}
  for (const r of rows.filter((x) => x.event === "CROSS")) {
    const flipKey = `${r.symbol}|${r.cycleLen}`;
    const key2 = `${r.symbol}|${r.zoneStart}|${r.cycleLen}|${r.lead}`;
    // map theo (symbol, cycleLen) không đủ định danh -> dùng event lead đơn giản hóa:
  }
  // Cách đúng: với mỗi sự kiện cắt ngược, lead là khoảng cách đến lần đảo của CHÍNH cycle đó.
  // Coverage = trong các sự kiện cắt ngược, bao nhiêu % có lead <= 8/24 (tức đảo ngay sau).
  const ngWarn8 = ng.filter((r) => r.lead <= 8).length;
  const ngWarn24 = ng.filter((r) => r.lead <= 24).length;
  console.log(`  Cắt ngược xảy ra ≤8 nến trước khi cycle đảo: ${ngWarn8} (${pct(ngWarn8, ng.length)} của các lần cắt ngược)`);
  console.log(`  Cắt ngược xảy ra ≤24 nến trước khi cycle đảo: ${ngWarn24} (${pct(ngWarn24, ng.length)} của các lần cắt ngược)`);
  console.log(`  (trong ${rows.length} sự kiện zone; base rate đảo 24n = ${pct(base.base24, 1)})`);

  const xuoi = rows.filter((r) => r.event === "CROSS" && r.nguoc === "XUOI");
  console.log(`\n[5] ATRBot "ĐÚNG/SAI" — cycle còn lại TB sau sự kiện:`);
  console.log(`  Sau cắt NGƯỢC: cycle còn ${ng.length ? (ng.reduce((a, r) => a + r.remAfter, 0) / ng.length).toFixed(1) : "-"} nến (trend gần chết)`);
  console.log(`  Sau cắt XUÔI : cycle còn ${xuoi.length ? (xuoi.reduce((a, r) => a + r.remAfter, 0) / xuoi.length).toFixed(1) : "-"} nến (trend còn sống)`);
  const held = rows.filter((r) => r.event === "HELD");
  console.log(`  Zone giữ hết cycle: cycle còn TB ${held.length ? (held.reduce((a, r) => a + r.remAfter, 0) / held.length).toFixed(1) : "-"} nến từ khi zone xuất hiện`);

  writeCsv(`output/cyclevsr/events_${len}_${thr}.csv`, rows.filter((r) => !r._base));
}

// ==================== IMXUSDT riêng ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key].filter((r) => !r._base && r.symbol === "IMXUSDT");
  const base = pooled[key].find((r) => r._base && r.symbol === "IMXUSDT");
  if (!rows.length || !base) continue;
  console.log(`\n${"-".repeat(100)}`);
  console.log(`IMXUSDT RIÊNG — VSR (${key}) (base: đảo 8n ${pct(base.base8, 1)} / 24n ${pct(base.base24, 1)})`);
  const ng = rows.filter((r) => r.event === "CROSS" && r.nguoc === "NGUOC");
  const xuoi = rows.filter((r) => r.event === "CROSS" && r.nguoc === "XUOI");
  const held = rows.filter((r) => r.event === "HELD");
  const f = (rs) => {
    if (!rs.length) return "-";
    const f8 = rs.filter((r) => r.flip8).length;
    const f24 = rs.filter((r) => r.flip24).length;
    return `N=${rs.length} | đảo 8n ${pct(f8, rs.length)} | 24n ${pct(f24, rs.length)} | lead TB ${(rs.reduce((a, r) => a + r.lead, 0) / rs.length).toFixed(1)}n`;
  };
  console.log(`  Cắt NGƯỢC: ${f(ng)}`);
  console.log(`  Cắt XUÔI : ${f(xuoi)}`);
  console.log(`  GIỮ      : N=${held.length} (không cắt trước khi đảo)`);
}

// ==================== Per-symbol ====================
for (const [len, thr] of configs) {
  const key = `${len},${thr}`;
  const rows = pooled[key].filter((r) => !r._base);
  const bases = pooled[key].filter((r) => r._base);
  const baseMap = new Map(bases.map((b) => [b.symbol, b]));
  console.log(`\n${"-".repeat(100)}`);
  console.log(`THEO SYMBOL — VSR (${key}) — CẮT NGƯỢC trend:`);
  console.log(`  ${"Symbol".padEnd(12)} ${"Ngược".padStart(6)} ${"Đảo8%".padStart(7)} ${"Base8%".padStart(8)} ${"Lift".padStart(6)} ${"LeadTB".padStart(7)} ${"Xuôi".padStart(6)} ${"Giữ".padStart(6)}`);
  const bySym = new Map();
  for (const r of rows) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, { ng: 0, ngF8: 0, xuoi: 0, held: 0, leads: [] });
    const m = bySym.get(r.symbol);
    if (r.event === "CROSS" && r.nguoc === "NGUOC") { m.ng++; if (r.flip8) m.ngF8++; m.leads.push(r.lead); }
    else if (r.event === "CROSS") m.xuoi++;
    else m.held++;
  }
  for (const [sym, m] of [...bySym.entries()].sort((a, b) => b[1].ng - a[1].ng)) {
    const b = baseMap.get(sym);
    const b8 = b ? b.base8 * 100 : NaN;
    const rate = m.ng ? (100 * m.ngF8) / m.ng : NaN;
    const lift = m.ng && b ? rate / (b.base8 * 100) : NaN;
    const leadTb = m.leads.length ? (m.leads.reduce((a, x) => a + x, 0) / m.leads.length).toFixed(1) : "-";
    console.log(`  ${sym.padEnd(12)} ${String(m.ng).padStart(6)} ${(Number.isFinite(rate) ? rate.toFixed(1) : "-").padStart(7)} ${(Number.isFinite(b8) ? b8.toFixed(1) : "-").padStart(8)} ${(Number.isFinite(lift) ? "x" + lift.toFixed(2) : "-").padStart(6)} ${String(leadTb).padStart(7)} ${String(m.xuoi).padStart(6)} ${String(m.held).padStart(6)}`);
  }
}

console.log("\nCSV đã lưu trong research-vsr/output/cyclevsr/");

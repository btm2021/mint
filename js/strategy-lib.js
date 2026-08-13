// ============================================================
// strategy-lib.js — THƯ VIỆN DÙNG CHUNG cho mọi strategy
// Cung cấp: registry strategy, indicator engine, exit engine,
// vẽ lệnh + indicator lên chart, stats bar, panel indicator,
// modal chi tiết lệnh, hit-test click.
// Mỗi strategy chỉ cần register({...}) trong file riêng.
// ============================================================

// ==================== STRATEGY REGISTRY ====================
const STRATEGY = {
  current: null,       // strategy đang được dùng trên trang này
  register(def) { this.current = def; },
};

function mergeCfg(base, saved) {
  if (!saved) return JSON.parse(JSON.stringify(base));
  const out = JSON.parse(JSON.stringify(base));
  Object.assign(out, saved);
  out.slow = { ...base.slow, ...(saved.slow || {}) };
  out.fast = { ...base.fast, ...(saved.fast || {}) };
  out.colors = { ...base.colors, ...(saved.colors || {}) };
  return out;
}

// Load config của strategy từ localStorage (theo key của strategy)
function loadStrategyCfg() {
  const def = STRATEGY.current;
  if (!def) return null;
  try {
    const saved = JSON.parse(localStorage.getItem("stat1_stratCfg_" + def.key));
    return mergeCfg(def.defaults, saved);
  } catch (e) {
    return JSON.parse(JSON.stringify(def.defaults));
  }
}

function saveStrategyCfg() {
  const def = STRATEGY.current;
  if (!def) return;
  try { localStorage.setItem("stat1_stratCfg_" + def.key, JSON.stringify(STRAT_CFG)); } catch (e) { }
}

// ==================== INDICATOR ENGINE (dùng chung) ====================

function strategyEma(bars, len) {
  const alpha = 2 / (len + 1);
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    out[i] = i === 0 ? bars[i].close : alpha * bars[i].close + (1 - alpha) * out[i - 1];
  }
  return out;
}

function strategyAtr(bars, len) {
  const atr = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const tr = i === 0 ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
    atr[i] = i === 0 ? tr : (atr[i - 1] * (len - 1) + tr) / len;
  }
  return atr;
}

function strategyStates(bot, n) {
  const st = new Array(n).fill(0);
  for (const c of bot.cycles) {
    const e = Math.min(c.endIndex, n - 1);
    for (let i = c.startIndex; i <= e; i++) st[i] = c.state;
  }
  return st;
}

function strategyZoneArrays(zones, n) {
  const uppers = new Array(n).fill(NaN);
  const lowers = new Array(n).fill(NaN);
  for (const z of zones) {
    const e = Math.min(z.endIndex, n - 1);
    for (let i = z.startIndex; i <= e; i++) { uppers[i] = z.upper; lowers[i] = z.lower; }
  }
  return { uppers, lowers };
}

// Tính 1 lần toàn bộ indicator strategy → dùng chung cho backtest, modal, panel
// Trả về 2 VSR (vsrLen/vsrThr + vsr2Len/vsr2Thr), 2 ATRBot + EMA
function computeStrategyIndicators(bars, cfg) {
  const n = bars.length;
  const ema20 = strategyEma(bars, cfg.emaLen || 20);
  const atrF = strategyAtr(bars, cfg.fast.atrLen);
  const zones = calculateVSR(bars, cfg.vsrLen, cfg.vsrThr);
  const { uppers, lowers } = strategyZoneArrays(zones, n);
  let zones2 = [], uppers2 = [], lowers2 = [];
  if (cfg.vsr2Len) {
    zones2 = calculateVSR(bars, cfg.vsr2Len, cfg.vsr2Thr);
    const a = strategyZoneArrays(zones2, n);
    uppers2 = a.uppers; lowers2 = a.lowers;
  }
  const slow = calculateATRBot(bars, cfg.slow.atrLen, cfg.slow.maLen, cfg.slow.mult, cfg.slow.maType);
  const fast = calculateATRBot(bars, cfg.fast.atrLen, cfg.fast.maLen, cfg.fast.mult, cfg.fast.maType);
  const arrOf = (data, key) => {
    const a = new Array(n).fill(NaN);
    for (let i = 0; i < n && i < data.length; i++) a[i] = data[i] ? data[i][key] : NaN;
    return a;
  };
  return {
    ema20, atrF, uppers, lowers, zones, uppers2, lowers2, zones2,
    slowStates: strategyStates(slow, n),
    fastStates: strategyStates(fast, n),
    slowCycles: slow.cycles,
    fastCycles: fast.cycles,
    slowT1: arrOf(slow.t1Data, "value"),
    slowT2: arrOf(slow.t2Data, "value"),
    fastT1: arrOf(fast.t1Data, "value"),
    fastT2: arrOf(fast.t2Data, "value"),
  };
}

// ==================== EXIT ENGINE (dùng chung mọi strategy) ====================
function strategyExitSim(bars, s, cfg) {
  const entryIdx = s.entryIdx;
  const entry = bars[entryIdx].close;
  const S = s.S;
  const sl1 = cfg.sl1, tp1 = cfg.tp1, tp2 = cfg.tp2, frac1 = cfg.frac1, sl2 = cfg.sl2;
  const sl1Lv = S === 1 ? entry * (1 - sl1 / 100) : entry * (1 + sl1 / 100);
  const tp1Lv = S === 1 ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  const tp2Lv = tp2 != null ? (S === 1 ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100)) : null;
  let rem = 1, pnlPct = 0, beActive = false, tp1Done = false, exitIdx = s.end, exitType = "TIMEOUT";
  for (let t = entryIdx + 1; t <= s.end; t++) {
    const slCur = S === 1 ? (beActive ? entry * (1 - (sl2 ?? sl1) / 100) : sl1Lv) : (beActive ? entry * (1 + (sl2 ?? sl1) / 100) : sl1Lv);
    if (S === 1 ? bars[t].low <= slCur : bars[t].high >= slCur) {
      pnlPct += rem * (S * (slCur / entry - 1) * 100 - cfg.feePct); rem = 0; exitType = beActive ? "SL2" : "SL1"; exitIdx = t; break;
    }
    if (rem > 0 && frac1 < 1 && !tp1Done) {
      const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1) { pnlPct += frac1 * (S * (tp1Lv / entry - 1) * 100 - cfg.feePct); rem -= frac1; beActive = true; tp1Done = true; }
    }
    if (rem > 0 && tp2 != null) {
      if (S === 1 ? bars[t].high >= tp2Lv : bars[t].low <= tp2Lv) { pnlPct += rem * (S * (tp2Lv / entry - 1) * 100 - cfg.feePct); rem = 0; exitType = "TP2"; exitIdx = t; break; }
    }
    if (rem > 0 && frac1 >= 1 && tp2 == null) {
      const hitTp1 = S === 1 ? bars[t].high >= tp1Lv : bars[t].low <= tp1Lv;
      if (hitTp1) { pnlPct += rem * (S * (tp1Lv / entry - 1) * 100 - cfg.feePct); rem = 0; exitType = "TP1"; exitIdx = t; break; }
    }
  }
  if (rem > 0) pnlPct += rem * (S * (bars[s.end].close / entry - 1) * 100 - cfg.feePct);
  return { entryIdx, exitIdx, entry, exit: bars[exitIdx].close, sl1Lv, tp1Lv, tp2Lv, exitType, pnlPct: +pnlPct.toFixed(3), pnlR: +(pnlPct / sl1).toFixed(3), hold: exitIdx - entryIdx + 1 };
}

// ==================== BACKTEST (dispatch) ====================
function calculateStrategyTrades(bars, cfg) {
  const def = STRATEGY.current;
  if (!def) return [];
  return def.calculate(bars, cfg);
}

function strategyStats(trades) {
  if (!trades.length) return null;
  const n = trades.length;
  const w = trades.filter((t) => t.pnlPct > 0).length;
  const gw = trades.reduce((a, t) => a + Math.max(0, t.pnlPct), 0);
  const gl = Math.abs(trades.reduce((a, t) => a + Math.min(0, t.pnlPct), 0));
  const exp = trades.reduce((a, t) => a + t.pnlR, 0) / n;
  return { n, win: 100 * w / n, exp, pf: gl > 0 ? gw / gl : Infinity, tot: exp * n };
}

// ==================== MARKERS + STATS BAR + PANEL ====================
function applyStrategyMarkers() {
  if (!chart || !candleSeries) return;
  try {
    if (!strategyMarkersPlugin) strategyMarkersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, []);
    const markers = [];
    // Tôn trọng toggle "Điểm vào lệnh" — tắt thì không vẽ mũi tên L/S
    const entriesOn = !STRAT_CFG || STRAT_CFG.showEntries === undefined || STRAT_CFG.showEntries !== 0;
    if (showStrategy && entriesOn) {
      for (const t of globalStrategyTrades) {
        const bar = globalBars[t.entryIdx];
        if (!bar) continue;
        markers.push({
          time: bar.time,
          position: t.S === 1 ? "belowBar" : "aboveBar",
          color: t.S === 1 ? "#00E676" : "#FF5252",
          shape: t.S === 1 ? "arrowUp" : "arrowDown",
          text: t.S === 1 ? "L" : "S",
          size: 1.4,
        });
      }
    }
    strategyMarkersPlugin.setMarkers(markers);
  } catch (e) {
    console.warn("Strategy markers unavailable", e);
  }
}

function updateStrategyStats() {
  const el = document.getElementById("strategy-stats");
  if (!el) return;
  if (!showStrategy || !STRAT_CFG) { el.style.display = "none"; return; }
  const s = strategyStats(globalStrategyTrades);
  if (!s) { el.style.display = "none"; return; }
  el.style.display = "flex";
  const exits = {};
  for (const t of globalStrategyTrades) exits[t.exitType] = (exits[t.exitType] || 0) + 1;
  const exitStr = Object.entries(exits).map(([k, v]) => `${k} ${v}`).join(" | ");
  el.innerHTML = `<span class="ss-title">${STRAT_CFG.name || STRATEGY.current.name}${STRAT_CFG.mode ? " " + STRAT_CFG.mode : ""}</span>` +
    `<span>N <b>${s.n}</b></span>` +
    `<span>WIN <b>${s.win.toFixed(1)}%</b></span>` +
    `<span>Exp <b class="${s.exp >= 0 ? "up" : "down"}">${s.exp >= 0 ? "+" : ""}${s.exp.toFixed(3)}R</b></span>` +
    `<span>PF <b>${Number.isFinite(s.pf) ? s.pf.toFixed(2) : "∞"}</b></span>` +
    `<span title="${exitStr}">Exit <b>${exitStr}</b></span>`;
}

function updateStrategyIndicatorPanel(logical) {
  const el = document.getElementById("strat-indicators");
  if (!el) return;
  if (!showStrategy || !globalStratIndicators || !globalBars.length || !STRAT_CFG) { el.style.display = "none"; return; }
  el.style.display = "block";
  const I = globalStratIndicators;
  const i = Math.max(0, Math.min(globalBars.length - 1, Math.round(logical ?? globalBars.length - 1)));
  const b = globalBars[i];
  const price = b.close;
  const fmt = (v, p = 4) => (v == null || !Number.isFinite(v)) ? "—" : v.toFixed(p);
  const atrRatio = I.atrF[i] ? Math.abs(price - I.ema20[i]) / I.atrF[i] : 0;
  const fin = (arr, j) => arr && Number.isFinite(arr[j]);
  const inZone = fin(I.uppers, i) && price >= I.lowers[i] && price <= I.uppers[i];
  const zonePos = !fin(I.uppers, i) ? "no zone" : inZone ? "trong zone" : (price > I.uppers[i] ? "trên zone" : "dưới zone");
  const slowState = I.slowStates[i], fastState = I.fastStates[i];
  const st = (s) => s === 1 ? "▲ LONG" : s === -1 ? "▼ SHORT" : "—";
  const biasOk = slowState === fastState;
  const C = STRAT_CFG.colors || {};
  el.innerHTML =
    `<div class="si-title">${STRAT_CFG.name || STRATEGY.current.name} · ${SYMBOL} ${INTERVAL}</div>` +
    `<div class="si-row"><span>ATR chậm BIAS (${STRAT_CFG.slow.atrLen},${STRAT_CFG.slow.mult},${STRAT_CFG.slow.maLen},${String(STRAT_CFG.slow.maType).toUpperCase()})</span><b class="${slowState === 1 ? "up" : slowState === -1 ? "down" : ""}">${st(slowState)}</b></div>` +
    `<div class="si-row"><span>ATR nhanh ENTRY (${STRAT_CFG.fast.atrLen},${STRAT_CFG.fast.mult},${STRAT_CFG.fast.maLen},${String(STRAT_CFG.fast.maType).toUpperCase()})</span><b class="${fastState === 1 ? "up" : fastState === -1 ? "down" : ""}">${st(fastState)} ${biasOk ? "đồng thuận" : "ngược"}</b></div>` +
    `<div class="si-row"><span>VSR 1 (${STRAT_CFG.vsrLen},${STRAT_CFG.vsrThr})</span><b class="warn">${fmt(I.uppers[i])} – ${fmt(I.lowers[i])} (${zonePos})</b></div>` +
    (STRAT_CFG.vsr2Len && I.uppers2 ? `<div class="si-row"><span>VSR 2 (${STRAT_CFG.vsr2Len},${STRAT_CFG.vsr2Thr})</span><b class="info">${fmt(I.uppers2[i])} – ${fmt(I.lowers2[i])}</b></div>` : "") +
    (STRAT_CFG.showEma ? `<div class="si-row"><span>EMA${STRAT_CFG.emaLen}</span><b>${fmt(I.ema20[i])}</b></div>
    <div class="si-row"><span>Giá · cách EMA</span><b class="${atrRatio >= 1 ? "warn" : ""}">${fmt(price)} (${atrRatio.toFixed(2)}×ATR)</b></div>` : "") +
    `<div class="si-row"><span>ATR nhanh</span><b>${fmt(I.atrF[i])} (${(I.atrF[i] / price * 100).toFixed(2)}%)</b></div>`;
}

// ==================== RECOMPUTE ====================
function recomputeStrategy() {
  globalStratIndicators = null;
  globalStrategyTrades = showStrategy && STRAT_CFG && globalBars && globalBars.length >= 300 ? calculateStrategyTrades(globalBars, STRAT_CFG) : [];
  applyStrategyMarkers();
  updateStrategyStats();
  updateStrategyIndicatorPanel(lastCrosshairLogical);
  requestAnimationFrame(drawOverlay);
  const def = STRATEGY.current;
  if (def && def.fitContent) {
    // strategy hiển thị vùng/indicator (không có lệnh) → fit toàn bộ dữ liệu
    requestAnimationFrame(() => {
      try { chart.timeScale().fitContent(); } catch (e) { }
    });
  } else if (showStrategy && globalStrategyTrades.length) {
    // Khi bật strategy: cuộn tới lệnh gần nhất để người dùng thấy ngay
    requestAnimationFrame(() => {
      const last = globalStrategyTrades[globalStrategyTrades.length - 1];
      const from = Math.max(0, last.entryIdx - 300);
      const to = Math.min(globalBars.length - 1, last.exitIdx + 100);
      try { chart.timeScale().setVisibleLogicalRange({ from, to }); } catch (e) { }
    });
  }
}

// ==================== CLICK HIT-TEST ====================
function hitTestStrategyTrade(logical, price) {
  if (!showStrategy || !globalStrategyTrades.length || logical == null || price == null) return null;
  let best = null, bestDist = Infinity;
  for (const t of globalStrategyTrades) {
    if (logical < t.entryIdx - 3 || logical > t.exitIdx + 3) continue;
    const lo = Math.min(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? t.entry);
    const hi = Math.max(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? t.entry);
    if (price < lo || price > hi) continue;
    const dLogical = Math.abs(logical - (t.entryIdx + t.exitIdx) / 2);
    const dPrice = Math.abs(price - t.entry);
    const d = dLogical * 4 + dPrice / (t.entry || 1);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

// ==================== TRADE DETAIL MODAL ====================
let stratModalOpen = false;

function openStrategyTradeModal(trade) {
  if (!trade) return;
  stratModalOpen = true;
  const overlay = document.getElementById("strat-modal-overlay");
  if (!overlay) return;
  document.body.classList.add("modal-open");
  const pr = getPriceFormat(trade.entry).precision;
  const pf = (v) => v == null ? "—" : v.toFixed(pr);
  const fmtDate = (ts) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toTimeString().slice(0, 5);
  };
  const side = trade.S === 1 ? "LONG" : "SHORT";
  const sideCls = trade.S === 1 ? "up" : "down";
  const exitColor = trade.pnlPct >= 0 ? "up" : "down";
  const dur = (() => {
    const h = (trade.exitTime - trade.entryTime) / 3600;
    return h >= 24 ? (h / 24).toFixed(1) + "d" : h.toFixed(1) + "h";
  })();
  const check = (ok) => ok ? '<span class="stm-check ok">✓</span>' : '<span class="stm-check no">✗</span>';
  const stTxt = (s) => s === 1 ? "▲ LONG" : s === -1 ? "▼ SHORT" : "—";
  const row = (label, value, cls = "") => `<div class="stm-row"><span class="stm-lbl">${label}</span><span class="stm-val ${cls}">${cls === "ok" || cls === "no" ? check(cls === "ok") : ""}${value}</span></div>`;
  const h = { row, check, stTxt, pf, fmtDate };

  // Phần "Lý do vào lệnh" — do từng strategy tự định nghĩa (hook)
  const reasonSection = (STRATEGY.current && STRATEGY.current.modalSections)
    ? STRATEGY.current.modalSections(trade, h)
    : "";

  overlay.innerHTML = `
    <div class="stm-box" onclick="event.stopPropagation()">
      <div class="stm-header">
        <div class="stm-title">
          <span class="stm-badge ${sideCls}">${side === "LONG" ? "▲" : "▼"} ${side}</span>
          <span class="stm-sym">${SYMBOL} · ${INTERVAL} · ${(STRAT_CFG && STRAT_CFG.name) || (STRATEGY.current && STRATEGY.current.name)}</span>
        </div>
        <button class="stm-close" onclick="closeStrategyTradeModal()">✕</button>
      </div>

      <div class="stm-stats">
        <div class="stm-stat"><span class="stm-stat-lbl">Entry</span><span class="stm-stat-val ${sideCls}">${pf(trade.entry)}</span></div>
        <div class="stm-stat"><span class="stm-stat-lbl">Exit</span><span class="stm-stat-val">${pf(trade.exit)}</span></div>
        <div class="stm-stat"><span class="stm-stat-lbl">PnL</span><span class="stm-stat-val ${exitColor}">${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%</span></div>
        <div class="stm-stat"><span class="stm-stat-lbl">PnL (R)</span><span class="stm-stat-val ${exitColor}">${trade.pnlR >= 0 ? "+" : ""}${trade.pnlR.toFixed(2)}R</span></div>
        <div class="stm-stat"><span class="stm-stat-lbl">Exit type</span><span class="stm-stat-val ${exitColor}">${trade.exitType}</span></div>
        <div class="stm-stat"><span class="stm-stat-lbl">Giữ</span><span class="stm-stat-val">${trade.hold} nến (${dur})</span></div>
      </div>

      <div class="stm-body">
        ${reasonSection}
        <div class="stm-section">
          <div class="stm-section-title">Chi tiết lệnh</div>
          ${row("Entry", pf(trade.entry), sideCls)}
          ${row("SL1 (" + STRAT_CFG.sl1 + "%)", pf(trade.sl1Lv), "no")}
          ${trade.tp1Lv != null ? row("TP1 (" + STRAT_CFG.tp1 + "%, đóng " + (STRAT_CFG.frac1 * 100) + "%)", pf(trade.tp1Lv), "ok") : ""}
          ${trade.tp2Lv != null ? row("TP2 (" + STRAT_CFG.tp2 + "%)", pf(trade.tp2Lv), "ok") : ""}
          ${row("Chí phí khứ hồi", STRAT_CFG.feePct.toFixed(2) + "%", "")}
          ${row("Vị thế gợi ý (risk 1%)", "qty = equity × 1% ÷ SL" + (STRAT_CFG.sl1) + "%", "")}
        </div>
      </div>
    </div>`;
  overlay.style.display = "flex";
}

function closeStrategyTradeModal() {
  stratModalOpen = false;
  const overlay = document.getElementById("strat-modal-overlay");
  if (!overlay) return;
  overlay.style.display = "none";
  document.body.classList.remove("modal-open");
}

function setupStrategyModalBackdrop() {
  document.addEventListener("click", (e) => {
    if (stratModalOpen && e.target && e.target.id === "strat-modal-overlay") closeStrategyTradeModal();
  });
}

// ==================== DRAW STRATEGY OVERLAY (indicators + trades) ====================
function drawStrategyOverlay() {
  if (!showStrategy || !chart || !candleSeries || !ctx || !STRAT_CFG) return;
  const timeScale = chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  if (!range) return;
  const lastClose = globalBars && globalBars.length ? globalBars[globalBars.length - 1].close : 1;
  const pr = getPriceFormat(lastClose);
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr.precision);
  const hideBase = !!(STRATEGY.current && STRATEGY.current.hideBaseIndicators);

  // ============ INDICATORS (the exact ones the strategy uses) ============
  const I = globalStratIndicators;
  const C = STRAT_CFG.colors || {};
  const hexA = (hex, a) => {
    const h = String(hex || "#FFFFFF").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgba(255,255,255,${a})`;
  };
  const drawLineSeg = (arr, color, width = 1.2, dash = []) => {
    if (!arr) return;
    const first = Math.max(0, Math.floor(range.from) - 1);
    const last = Math.min(arr.length - 1, Math.ceil(range.to) + 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    let drawing = false;
    for (let i = first; i <= last; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) { drawing = false; continue; }
      const x = timeScale.logicalToCoordinate(i);
      const y = candleSeries.priceToCoordinate(v);
      if (x === null || y === null) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  if (hideBase) {
    // strategy tự vẽ mọi thứ (vd SMC) — bỏ qua indicator base
  } else {
  // VSR zones — zone 1
  if (I && I.zones && I.zones.length && STRAT_CFG.showVsr !== 0) {
    for (const z of I.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = canvas.width + 1000;
      const y1 = candleSeries.priceToCoordinate(z.upper);
      const y2 = candleSeries.priceToCoordinate(z.lower);
      if (y1 !== null && y2 !== null) {
        ctx.fillStyle = hexA(C.vsr1, 0.12);
        ctx.fillRect(xS, Math.min(y1, y2), xE - xS, Math.abs(y2 - y1));
        ctx.strokeStyle = hexA(C.vsr1, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xS, y1); ctx.lineTo(xE, y1);
        ctx.moveTo(xS, y2); ctx.lineTo(xE, y2);
        ctx.stroke();
      }
    }
  }
  // VSR zones — zone 2 (nếu bật)
  if (I && I.zones2 && I.zones2.length && STRAT_CFG.showVsr2) {
    for (const z of I.zones2) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = canvas.width + 1000;
      const y1 = candleSeries.priceToCoordinate(z.upper);
      const y2 = candleSeries.priceToCoordinate(z.lower);
      if (y1 !== null && y2 !== null) {
        ctx.fillStyle = hexA(C.vsr2, 0.09);
        ctx.fillRect(xS, Math.min(y1, y2), xE - xS, Math.abs(y2 - y1));
        ctx.strokeStyle = hexA(C.vsr2, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xS, y1); ctx.lineTo(xE, y1);
        ctx.moveTo(xS, y2); ctx.lineTo(xE, y2);
        ctx.stroke();
      }
    }
  }
  // EMA
  if (I && STRAT_CFG.showEma) drawLineSeg(I.ema20, hexA(C.ema, 0.85), 1.4);
  // ATRBot slow cloud (BIAS)
  if (I && I.slowCycles.length && STRAT_CFG.showBiasCloud !== 0) {
    for (const cyc of I.slowCycles) {
      if (cyc.endIndex < range.from || cyc.startIndex > range.to) continue;
      ctx.beginPath();
      let moved = false;
      for (let i = cyc.startIndex; i <= Math.min(cyc.endIndex, I.slowT1.length - 1); i++) {
        if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
        const x = timeScale.logicalToCoordinate(i), y = candleSeries.priceToCoordinate(I.slowT1[i]);
        if (x !== null && y !== null) { if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y); }
      }
      if (moved) {
        for (let i = Math.min(cyc.endIndex, I.slowT2.length - 1); i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i), y = candleSeries.priceToCoordinate(I.slowT2[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = cyc.state === 1 ? hexA(C.slowUp, 0.10) : hexA(C.slowDown, 0.10);
        ctx.fill();
      }
    }
  }
  // ATRBot fast cloud (ENTRY)
  if (I && I.fastCycles.length && STRAT_CFG.showEntryCloud !== 0) {
    for (const cyc of I.fastCycles) {
      if (cyc.endIndex < range.from || cyc.startIndex > range.to) continue;
      ctx.beginPath();
      let moved = false;
      for (let i = cyc.startIndex; i <= Math.min(cyc.endIndex, I.fastT1.length - 1); i++) {
        if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
        const x = timeScale.logicalToCoordinate(i), y = candleSeries.priceToCoordinate(I.fastT1[i]);
        if (x !== null && y !== null) { if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y); }
      }
      if (moved) {
        for (let i = Math.min(cyc.endIndex, I.fastT2.length - 1); i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i), y = candleSeries.priceToCoordinate(I.fastT2[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = cyc.state === 1 ? hexA(C.fastUp, 0.08) : hexA(C.fastDown, 0.08);
        ctx.fill();
      }
    }
  }
  } // end else (!hideBase) — indicator base

  // ============ TRADES with full info ============
  if (!hideBase && !globalStrategyTrades.length) return;
  if (hideBase) {
    // strategy tự vẽ lệnh nếu muốn — bỏ qua phần lệnh base
  } else {
  const label = (txt, x, y, color) => {
    ctx.font = "9.5px Outfit, sans-serif";
    const tw = ctx.measureText(txt).width + 8;
    let bx = x, by = y;
    if (bx + tw > canvas.width) bx = canvas.width - tw - 2;
    if (bx < 0) bx = 2;
    ctx.fillStyle = "rgba(13, 13, 22, 0.92)";
    ctx.fillRect(bx, by, tw, 14);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, tw, 14);
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(txt, bx + 4, by + 3);
  };
  for (const t of globalStrategyTrades) {
    if (t.exitIdx < range.from || t.entryIdx > range.to) continue;
    let x1 = timeScale.logicalToCoordinate(t.entryIdx);
    let x2 = timeScale.logicalToCoordinate(t.exitIdx);
    if (x1 === null) x1 = -1000;
    if (x2 === null) x2 = canvas.width + 1000;
    if (x2 <= x1) x2 = x1 + 6;
    const base = (a) => hexA(t.S === 1 ? (C.slowUp || "#00E676") : (C.slowDown || "#FF5252"), a);
    const hi = Math.max(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? -Infinity);
    const lo = Math.min(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? Infinity);
    const yHi = candleSeries.priceToCoordinate(hi);
    const yLo = candleSeries.priceToCoordinate(lo);
    if (yHi !== null && yLo !== null) {
      ctx.fillStyle = base(0.08);
      ctx.fillRect(x1, yHi, x2 - x1, yLo - yHi);
    }
    const level = (price, color, dash, width = 1) => {
      const y = candleSeries.priceToCoordinate(price);
      if (y === null) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
      return y;
    };
    const ySL = level(t.sl1Lv, hexA(C.sl, 1), [4, 3], 1.2);
    const yTP2 = t.tp2Lv != null ? level(t.tp2Lv, hexA(C.tp2, 1), [4, 3], 1.2) : null;
    const yTP1 = level(t.tp1Lv, hexA(C.tp1, 1), [4, 3], 1.2);
    const yEn = level(t.entry, hexA(C.entry, 0.9), [2, 3], 1);

    // Entry triangle (arrowUp/arrowDown) vẽ trực tiếp trên canvas
    const yE = candleSeries.priceToCoordinate(t.entry);
    if (yE !== null) {
      const xE = Math.max(0, x1);
      ctx.beginPath();
      if (t.S === 1) {
        ctx.moveTo(xE - 6, yE + 5);
        ctx.lineTo(xE + 6, yE + 5);
        ctx.lineTo(xE, yE - 6);
      } else {
        ctx.moveTo(xE - 6, yE - 5);
        ctx.lineTo(xE + 6, yE - 5);
        ctx.lineTo(xE, yE + 6);
      }
      ctx.closePath();
      ctx.fillStyle = t.S === 1 ? hexA(C.slowUp, 1) : hexA(C.slowDown, 1);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Price labels at line right-ends
    if (ySL !== null) label("SL " + pf(t.sl1Lv), x2 - 78, ySL - 7, C.sl || "#FF5252");
    if (yTP2 !== null) label("TP2 " + pf(t.tp2Lv), x2 - 88, yTP2 - 7, C.tp2 || "#00E676");
    if (yTP1 !== null) label("TP1 " + pf(t.tp1Lv), x2 - 88, yTP1 - 7, C.tp1 || "#FFC107");
    if (yEn !== null) label("ENTRY " + pf(t.entry), x1 + 4, yEn - 7, C.entry || "#9AA0A6");

    // Exit label: exit type + R + % + ROE (risk 1% equity → ROE% = pnlR)
    const yEx = candleSeries.priceToCoordinate(t.exit);
    if (yEx !== null) {
      const roe = t.pnlR * 1;
      const txt = `${t.exitType} ${t.pnlR >= 0 ? "+" : ""}${t.pnlR.toFixed(2)}R (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%) · ROE ${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`;
      ctx.font = "9.5px Outfit, sans-serif";
      const tw = ctx.measureText(txt).width + 8;
      let bx = x2 - tw - 2;
      if (bx < 0) bx = x2 + 4;
      if (bx + tw > canvas.width) bx = canvas.width - tw - 2;
      const by = yEx - 8;
      ctx.fillStyle = "rgba(13, 13, 22, 0.92)";
      ctx.fillRect(bx, by, tw, 14);
      ctx.strokeStyle = t.pnlR >= 0 ? hexA(C.tp2, 0.6) : hexA(C.sl, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, tw, 14);
      ctx.fillStyle = t.pnlR >= 0 ? C.tp2 : C.sl;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(txt, bx + 4, by + 3);
    }
  }
  } // end else (!hideBase) — trades

  // Hook: strategy vẽ thêm vùng (FVG / battle / SMC ...) sau khi vẽ lệnh
  if (STRATEGY.current && STRATEGY.current.drawZones) {
    try {
      STRATEGY.current.drawZones({ timeScale, range, C, hexA, ctx, canvas, candleSeries, pf, S: STRAT_CFG });
    } catch (e) {
      console.warn("drawZones error", e);
    }
  }
}

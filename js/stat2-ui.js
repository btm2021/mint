// ============================================================
// stat2-ui.js — GIAO DIỆN CÀI ĐẶT TOÀN DIỆN & TƯƠNG TÁC STAT2
// ============================================================

const MA_TYPE_OPTIONS = [
  ["ema", "EMA"], ["vwma", "VWMA"], ["lwma", "LWMA"], ["wma", "WMA"],
  ["hma", "HMA"], ["vwap", "VWAP (rolling)"], ["alma", "ALMA"], ["tema", "TEMA"],
  ["wwsma", "WWSMA"], ["zlema", "ZLEMA"], ["lsma", "LSMA"], ["kama", "KAMA"],
  ["vidya", "VIDYA"], ["smma", "SMMA"], ["mcginley", "McGinley"], ["swma", "SWMA"],
];

const SOURCE_OPTIONS = [
  ["close", "Close"], ["open", "Open"], ["high", "High"], ["low", "Low"],
  ["hl2", "HL2 (H+L)/2"], ["hlc3", "HLC3 (H+L+C)/3"], ["ohlc4", "OHLC4 (O+H+L+C)/4"],
];

const LINE_STYLE_OPTIONS = [
  ["solid", "Solid (Nét liền)"],
  ["dashed", "Dashed (Nét đứt)"],
  ["dotted", "Dotted (Chấm)"],
];

const ADAPTIVE_MODE_OPTIONS = [
  ["er", "ER — Efficiency Ratio (Sức mạnh xu hướng)"],
  ["vol", "Vol Ratio — ATR nhanh/chậm (Biến động)"],
];

function updateStat2StatsBar() {
  const el = document.getElementById("stat2-strategy-stats");
  if (!el) return;
  if (!STAT2_CFG.strategy.enabled || !globalStat2Trades.length) {
    el.style.display = "none";
    return;
  }
  const summary = computeStat2Summary(globalStat2Trades);
  if (!summary) {
    el.style.display = "none";
    return;
  }

  el.style.display = "flex";
  const exitsStr = Object.entries(summary.exits).map(([k, v]) => `${k} <b>${v}</b>`).join(" | ");
  el.innerHTML = `
    <span class="ss-title"><span class="badge-dot"></span>${STAT2_CFG.strategy.name} (${STAT2_CFG.strategy.mode})</span>
    <span>Lệnh <b>${summary.n}</b></span>
    <span>Win <b>${summary.winRate.toFixed(1)}%</b></span>
    <span>Exp <b class="${summary.expR >= 0 ? "up" : "down"}">${summary.expR >= 0 ? "+" : ""}${summary.expR.toFixed(3)}R</b></span>
    <span>PF <b>${Number.isFinite(summary.pf) ? summary.pf.toFixed(2) : "∞"}</b></span>
    <span class="ss-exits">${exitsStr}</span>
  `;
}

function updateStat2IndicatorHUD(logical) {
  const el = document.getElementById("stat2-indicator-hud");
  if (!el || !globalStat2Bars.length) return;

  const n = globalStat2Bars.length;
  const idx = Math.max(0, Math.min(n - 1, Math.round(logical ?? n - 1)));
  const bar = globalStat2Bars[idx];
  const price = bar.close;
  const pr = getStat2PriceFormat(price).precision;
  const fmt = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr);

  const b1State = globalStat2Bot1 && globalStat2Bot1.states ? globalStat2Bot1.states[idx] : 0;
  const b2State = globalStat2Bot2 && globalStat2Bot2.states ? globalStat2Bot2.states[idx] : 0;
  const vsr1U = globalStat2Vsr1 && globalStat2Vsr1.upperArr ? globalStat2Vsr1.upperArr[idx] : NaN;
  const vsr1L = globalStat2Vsr1 && globalStat2Vsr1.lowerArr ? globalStat2Vsr1.lowerArr[idx] : NaN;
  const vsr2U = globalStat2Vsr2 && globalStat2Vsr2.upperArr ? globalStat2Vsr2.upperArr[idx] : NaN;
  const vsr2L = globalStat2Vsr2 && globalStat2Vsr2.lowerArr ? globalStat2Vsr2.lowerArr[idx] : NaN;
  const ovU = globalStat2VsrOverlap && globalStat2VsrOverlap.upperArr ? globalStat2VsrOverlap.upperArr[idx] : NaN;
  const ovL = globalStat2VsrOverlap && globalStat2VsrOverlap.lowerArr ? globalStat2VsrOverlap.lowerArr[idx] : NaN;

  const stBadge = (st) => st === 1 ? `<span class="tag-up">▲ BULL</span>` : st === -1 ? `<span class="tag-down">▼ BEAR</span>` : `<span>—</span>`;
  const isOverlap = Number.isFinite(ovU) && Number.isFinite(ovL);

  el.innerHTML = `
    <div class="hud-item"><span class="hud-lbl">ATR1 (BIAS)</span> ${stBadge(b1State)}</div>
    <div class="hud-item"><span class="hud-lbl">ATR2 (ENTRY)</span> ${stBadge(b2State)}</div>
    <div class="hud-item"><span class="hud-lbl">VSR1</span> <b>${fmt(vsr1L)} – ${fmt(vsr1U)}</b></div>
    <div class="hud-item"><span class="hud-lbl">VSR2</span> <b>${fmt(vsr2L)} – ${fmt(vsr2U)}</b></div>
    <div class="hud-item"><span class="hud-lbl">VSR Overlap</span> <b class="${isOverlap ? "highlight" : "dim"}">${isOverlap ? `${fmt(ovL)} – ${fmt(ovU)}` : "None"}</b></div>
  `;
}

// ==================== TRADE DETAIL MODAL ====================

function openStat2TradeModal(trade) {
  if (!trade) return;
  const overlay = document.getElementById("stat2-trade-modal-overlay");
  if (!overlay) return;

  const pr = getStat2PriceFormat(trade.entry).precision;
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr);
  const fmtDate = (ts) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) + " " + d.toTimeString().slice(0, 5);
  };

  const side = trade.S === 1 ? "LONG" : "SHORT";
  const sideCls = trade.S === 1 ? "up" : "down";
  const pnlCls = trade.pnlPct >= 0 ? "up" : "down";

  overlay.innerHTML = `
    <div class="stat2-modal-card" onclick="event.stopPropagation()">
      <div class="modal-card-header">
        <div class="modal-card-title">
          <span class="trade-side-badge ${sideCls}">${side === "LONG" ? "▲" : "▼"} ${side}</span>
          <span class="trade-symbol-info">${STAT2_CFG.symbol} · ${STAT2_CFG.interval} · ${STAT2_CFG.strategy.name}</span>
        </div>
        <button class="modal-card-close" onclick="closeStat2TradeModal()">✕</button>
      </div>

      <div class="trade-stat-grid">
        <div class="trade-stat-box"><span class="lbl">Entry</span><span class="val ${sideCls}">${pf(trade.entry)}</span></div>
        <div class="trade-stat-box"><span class="lbl">Exit</span><span class="val">${pf(trade.exit)}</span></div>
        <div class="trade-stat-box"><span class="lbl">PnL %</span><span class="val ${pnlCls}">${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%</span></div>
        <div class="trade-stat-box"><span class="lbl">PnL R</span><span class="val ${pnlCls}">${trade.pnlR >= 0 ? "+" : ""}${trade.pnlR.toFixed(2)}R</span></div>
        <div class="trade-stat-box"><span class="lbl">Exit Type</span><span class="val ${pnlCls}">${trade.exitType}</span></div>
        <div class="trade-stat-box"><span class="lbl">Thời gian giữ</span><span class="val">${trade.hold} nến</span></div>
      </div>

      <div class="trade-detail-sections">
        <div class="sec-box">
          <div class="sec-title">① Thông tin tín hiệu & Bộ lọc</div>
          <div class="sec-row"><span>Thời điểm</span><b>${fmtDate(trade.entryTime)} → ${fmtDate(trade.exitTime)}</b></div>
          <div class="sec-row"><span>ATRBot 1 (BIAS)</span><b class="${trade.slowState === trade.S ? "up" : "down"}">${trade.slowState === 1 ? "▲ BULL" : "▼ BEAR"} (Đồng thuận)</b></div>
          <div class="sec-row"><span>ATRBot 2 (ENTRY)</span><b class="up">${trade.fastState === 1 ? "▲ BULL" : "▼ BEAR"} (Nến Flip)</b></div>
          <div class="sec-row"><span>VSR 1</span><b>${pf(trade.vsr1Lower)} – ${pf(trade.vsr1Upper)}</b></div>
          <div class="sec-row"><span>VSR 2</span><b>${pf(trade.vsr2Lower)} – ${pf(trade.vsr2Upper)}</b></div>
          <div class="sec-row"><span>VSR Overlap</span><b class="${trade.overlapUpper ? "highlight" : "dim"}">${trade.overlapUpper ? `${pf(trade.overlapLower)} – ${pf(trade.overlapUpper)}` : "Không có"}</b></div>
        </div>

        <div class="sec-box">
          <div class="sec-title">② Các mốc giá Quản lý Vị thế</div>
          <div class="sec-row"><span>Entry</span><b class="${sideCls}">${pf(trade.entry)}</b></div>
          <div class="sec-row"><span>Stop Loss (SL ${STAT2_CFG.strategy.sl1}%)</span><b class="down">${pf(trade.sl1Lv)}</b></div>
          <div class="sec-row"><span>Take Profit 1 (TP1 ${STAT2_CFG.strategy.tp1}%)</span><b class="up">${pf(trade.tp1Lv)}</b></div>
          ${trade.tp2Lv != null ? `<div class="sec-row"><span>Take Profit 2 (TP2 ${STAT2_CFG.strategy.tp2}%)</span><b class="up">${pf(trade.tp2Lv)}</b></div>` : ""}
          <div class="sec-row"><span>Chi phí Round-trip</span><b>${STAT2_CFG.strategy.feePct}%</b></div>
        </div>
      </div>
    </div>
  `;
  overlay.style.display = "flex";
}

function closeStat2TradeModal() {
  const overlay = document.getElementById("stat2-trade-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// ==================== SETTINGS MODAL ĐA TAB ====================

let activeSettingsTab = "atr1";

function openStat2SettingsModal(tab = "atr1") {
  activeSettingsTab = tab;
  renderStat2SettingsModal();
  const modal = document.getElementById("stat2-settings-modal");
  if (modal) modal.style.display = "flex";
}

function closeStat2SettingsModal() {
  const modal = document.getElementById("stat2-settings-modal");
  if (modal) modal.style.display = "none";
}

function renderStat2SettingsModal() {
  const container = document.getElementById("stat2-settings-content");
  const tabNav = document.getElementById("stat2-settings-tabs");
  if (!container || !tabNav) return;

  const tabs = [
    { id: "atr1", label: "ATRBot 1 (BIAS)" },
    { id: "atr2", label: "ATRBot 2 (ENTRY)" },
    { id: "vsr1", label: "VSR 1" },
    { id: "vsr2", label: "VSR 2" },
    { id: "vsrOverlap", label: "VSR Overlap" },
    { id: "sd", label: "Supply & Demand" },
    { id: "strategy", label: "Entry / TP / SL" },
    { id: "general", label: "Chart / Dữ liệu" },
  ];

  tabNav.innerHTML = tabs.map((t) => `
    <button class="settings-tab-btn ${t.id === activeSettingsTab ? "active" : ""}" onclick="switchStat2SettingsTab('${t.id}')">
      ${t.label}
    </button>
  `).join("");

  let html = "";
  const C = STAT2_CFG;

  const select = (label, path, options, val) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <select class="ctrl-select" data-path="${path}">
        ${options.map(([optVal, optTxt]) => `<option value="${optVal}" ${String(val) === String(optVal) ? "selected" : ""}>${optTxt}</option>`).join("")}
      </select>
    </div>
  `;

  const num = (label, path, val, min = 0, max = 500, step = 1) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <input type="number" class="ctrl-num" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>
  `;

  const toggle = (label, path, checked) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <label class="switch">
        <input type="checkbox" data-path="${path}" ${checked ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>
  `;

  const color = (label, path, val) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <div class="color-picker-wrap">
        <input type="color" class="ctrl-color" data-path="${path}" value="${val}" />
        <span class="color-code">${val}</span>
      </div>
    </div>
  `;

  const slider = (label, path, val, min = 0, max = 1, step = 0.01) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label} <span class="val-badge">${Math.round(val * 100)}%</span></label>
      <input type="range" class="ctrl-range" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>
  `;

  // Section cải tiến Trail 2 dùng chung cho ATRBot 1 & 2
  const trail2EnhanceSection = (key) => {
    const s = C[key];
    return `
      <div class="panel-sec">
        <div class="panel-sec-header">Cải tiến Trail 2 — Multiplier Thích Ứng</div>
        ${toggle("Bật Multiplier thích ứng", `${key}.adaptive.enabled`, s.adaptive.enabled)}
        ${select("Chế độ thích ứng", `${key}.adaptive.mode`, ADAPTIVE_MODE_OPTIONS, s.adaptive.mode)}
        ${num("Chu kỳ đo xu hướng (ER Length)", `${key}.adaptive.erLen`, s.adaptive.erLen, 2, 500, 1)}
        ${num("Multiplier tối thiểu (xu hướng mạnh)", `${key}.adaptive.minMult`, s.adaptive.minMult, 0.1, 20, 0.1)}
        ${num("Multiplier tối đa (đi ngang/nhiễu)", `${key}.adaptive.maxMult`, s.adaptive.maxMult, 0.1, 20, 0.1)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Cải tiến Trail 2 — Làm Mượt Nét</div>
        ${toggle("Bật làm mượt Trail 2 (EMA)", `${key}.smoothT2.enabled`, s.smoothT2.enabled)}
        ${num("Chu kỳ EMA làm mượt", `${key}.smoothT2.len`, s.smoothT2.len, 1, 100, 1)}
      </div>
    `;
  };

  if (activeSettingsTab === "atr1") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Tham số Tính toán ATRBot 1</div>
        ${toggle("Kích hoạt ATRBot 1", "atr1.enabled", C.atr1.enabled)}
        ${select("Nguồn giá (Source)", "atr1.source", SOURCE_OPTIONS, C.atr1.source)}
        ${select("Phương pháp MA (MA Type)", "atr1.maType", MA_TYPE_OPTIONS, C.atr1.maType)}
        ${num("Chu kỳ MA (MA Length)", "atr1.maLen", C.atr1.maLen, 1, 500, 1)}
        ${num("Chu kỳ ATR (ATR Length)", "atr1.atrLen", C.atr1.atrLen, 1, 500, 1)}
        ${num("Hệ số nhân (ATR Multiplier)", "atr1.mult", C.atr1.mult, 0.1, 20, 0.1)}
      </div>

      ${trail2EnhanceSection("atr1")}

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Trail 1 (MA Line)</div>
        ${toggle("Hiện Trail 1", "atr1.showT1", C.atr1.showT1)}
        ${color("Màu Trail 1", "atr1.t1Color", C.atr1.t1Color)}
        ${num("Độ dày nét (px)", "atr1.t1Width", C.atr1.t1Width, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "atr1.t1Style", LINE_STYLE_OPTIONS, C.atr1.t1Style)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Trail 2 (ATR Line)</div>
        ${toggle("Hiện Trail 2", "atr1.showT2", C.atr1.showT2)}
        ${color("Màu Trail 2", "atr1.t2Color", C.atr1.t2Color)}
        ${num("Độ dày nét (px)", "atr1.t2Width", C.atr1.t2Width, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "atr1.t2Style", LINE_STYLE_OPTIONS, C.atr1.t2Style)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Mây Vùng Đệm (Cloud Fill)</div>
        ${toggle("Hiện Mây Cloud", "atr1.showCloud", C.atr1.showCloud)}
        ${color("Màu Bullish Up", "atr1.cloudUpColor", C.atr1.cloudUpColor)}
        ${slider("Độ mờ Bullish", "atr1.cloudUpOpacity", C.atr1.cloudUpOpacity)}
        ${color("Màu Bearish Down", "atr1.cloudDownColor", C.atr1.cloudDownColor)}
        ${slider("Độ mờ Bearish", "atr1.cloudDownOpacity", C.atr1.cloudDownOpacity)}
      </div>
    `;
  } else if (activeSettingsTab === "atr2") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Tham số Tính toán ATRBot 2</div>
        ${toggle("Kích hoạt ATRBot 2", "atr2.enabled", C.atr2.enabled)}
        ${select("Nguồn giá (Source)", "atr2.source", SOURCE_OPTIONS, C.atr2.source)}
        ${select("Phương pháp MA (MA Type)", "atr2.maType", MA_TYPE_OPTIONS, C.atr2.maType)}
        ${num("Chu kỳ MA (MA Length)", "atr2.maLen", C.atr2.maLen, 1, 500, 1)}
        ${num("Chu kỳ ATR (ATR Length)", "atr2.atrLen", C.atr2.atrLen, 1, 500, 1)}
        ${num("Hệ số nhân (ATR Multiplier)", "atr2.mult", C.atr2.mult, 0.1, 20, 0.1)}
      </div>

      ${trail2EnhanceSection("atr2")}

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Trail 1 (MA Line)</div>
        ${toggle("Hiện Trail 1", "atr2.showT1", C.atr2.showT1)}
        ${color("Màu Trail 1", "atr2.t1Color", C.atr2.t1Color)}
        ${num("Độ dày nét (px)", "atr2.t1Width", C.atr2.t1Width, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "atr2.t1Style", LINE_STYLE_OPTIONS, C.atr2.t1Style)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Trail 2 (ATR Line)</div>
        ${toggle("Hiện Trail 2", "atr2.showT2", C.atr2.showT2)}
        ${color("Màu Trail 2", "atr2.t2Color", C.atr2.t2Color)}
        ${num("Độ dày nét (px)", "atr2.t2Width", C.atr2.t2Width, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "atr2.t2Style", LINE_STYLE_OPTIONS, C.atr2.t2Style)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Mây Vùng Đệm (Cloud Fill)</div>
        ${toggle("Hiện Mây Cloud", "atr2.showCloud", C.atr2.showCloud)}
        ${color("Màu Bullish Up", "atr2.cloudUpColor", C.atr2.cloudUpColor)}
        ${slider("Độ mờ Bullish", "atr2.cloudUpOpacity", C.atr2.cloudUpOpacity)}
        ${color("Màu Bearish Down", "atr2.cloudDownColor", C.atr2.cloudDownColor)}
        ${slider("Độ mờ Bearish", "atr2.cloudDownOpacity", C.atr2.cloudDownOpacity)}
      </div>
    `;
  } else if (activeSettingsTab === "vsr1") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Tham số Tính toán VSR 1</div>
        ${toggle("Kích hoạt VSR 1", "vsr1.enabled", C.vsr1.enabled)}
        ${num("Lookback Length", "vsr1.len", C.vsr1.len, 1, 500, 1)}
        ${num("Ngưỡng StDev Volume (Threshold)", "vsr1.thr", C.vsr1.thr, 0.1, 50, 0.5)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Trên (Upper Line)</div>
        ${toggle("Hiện Upper Line", "vsr1.showUpper", C.vsr1.showUpper)}
        ${color("Màu Upper Line", "vsr1.upperColor", C.vsr1.upperColor)}
        ${num("Độ dày nét", "vsr1.upperWidth", C.vsr1.upperWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsr1.upperStyle", LINE_STYLE_OPTIONS, C.vsr1.upperStyle)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Dưới (Lower Line)</div>
        ${toggle("Hiện Lower Line", "vsr1.showLower", C.vsr1.showLower)}
        ${color("Màu Lower Line", "vsr1.lowerColor", C.vsr1.lowerColor)}
        ${num("Độ dày nét", "vsr1.lowerWidth", C.vsr1.lowerWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsr1.lowerStyle", LINE_STYLE_OPTIONS, C.vsr1.lowerStyle)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Màu Nền Vùng (Background Fill)</div>
        ${toggle("Hiện Nền VSR 1", "vsr1.showFill", C.vsr1.showFill)}
        ${color("Màu Nền", "vsr1.fillColor", C.vsr1.fillColor)}
        ${slider("Độ mờ Nền (Opacity)", "vsr1.fillOpacity", C.vsr1.fillOpacity)}
      </div>
    `;
  } else if (activeSettingsTab === "vsr2") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Tham số Tính toán VSR 2</div>
        ${toggle("Kích hoạt VSR 2", "vsr2.enabled", C.vsr2.enabled)}
        ${num("Lookback Length", "vsr2.len", C.vsr2.len, 1, 500, 1)}
        ${num("Ngưỡng StDev Volume (Threshold)", "vsr2.thr", C.vsr2.thr, 0.1, 50, 0.5)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Trên (Upper Line)</div>
        ${toggle("Hiện Upper Line", "vsr2.showUpper", C.vsr2.showUpper)}
        ${color("Màu Upper Line", "vsr2.upperColor", C.vsr2.upperColor)}
        ${num("Độ dày nét", "vsr2.upperWidth", C.vsr2.upperWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsr2.upperStyle", LINE_STYLE_OPTIONS, C.vsr2.upperStyle)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Dưới (Lower Line)</div>
        ${toggle("Hiện Lower Line", "vsr2.showLower", C.vsr2.showLower)}
        ${color("Màu Lower Line", "vsr2.lowerColor", C.vsr2.lowerColor)}
        ${num("Độ dày nét", "vsr2.lowerWidth", C.vsr2.lowerWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsr2.lowerStyle", LINE_STYLE_OPTIONS, C.vsr2.lowerStyle)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Màu Nền Vùng (Background Fill)</div>
        ${toggle("Hiện Nền VSR 2", "vsr2.showFill", C.vsr2.showFill)}
        ${color("Màu Nền", "vsr2.fillColor", C.vsr2.fillColor)}
        ${slider("Độ mờ Nền (Opacity)", "vsr2.fillOpacity", C.vsr2.fillOpacity)}
      </div>
    `;
  } else if (activeSettingsTab === "vsrOverlap") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Vùng Chồng Lấn 2 VSR (Overlap Zone)</div>
        ${toggle("Bật Vùng Chồng Lấn", "vsrOverlap.enabled", C.vsrOverlap.enabled)}
        ${toggle("Hiện Nền Chồng Lấn", "vsrOverlap.showFill", C.vsrOverlap.showFill)}
        ${color("Màu Nền Chồng Lấn", "vsrOverlap.fillColor", C.vsrOverlap.fillColor)}
        ${slider("Độ mờ Nền (Opacity)", "vsrOverlap.fillOpacity", C.vsrOverlap.fillOpacity)}
        ${toggle("Hiệu ứng Gạch chéo (Diagonal Hatch)", "vsrOverlap.showHatch", C.vsrOverlap.showHatch)}
        ${toggle("Hiện Nhãn Huy Hiệu (⚡ OVERLAP)", "vsrOverlap.showLabel", C.vsrOverlap.showLabel)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Vùng Chồng Lấn</div>
        ${toggle("Hiện Viền Trên (Overlap Upper)", "vsrOverlap.showUpper", C.vsrOverlap.showUpper)}
        ${color("Màu Viền Trên", "vsrOverlap.upperColor", C.vsrOverlap.upperColor)}
        ${num("Độ dày nét", "vsrOverlap.upperWidth", C.vsrOverlap.upperWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsrOverlap.upperStyle", LINE_STYLE_OPTIONS, C.vsrOverlap.upperStyle)}

        ${toggle("Hiện Viền Dưới (Overlap Lower)", "vsrOverlap.showLower", C.vsrOverlap.showLower)}
        ${color("Màu Viền Dưới", "vsrOverlap.lowerColor", C.vsrOverlap.lowerColor)}
        ${num("Độ dày nét", "vsrOverlap.lowerWidth", C.vsrOverlap.lowerWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsrOverlap.lowerStyle", LINE_STYLE_OPTIONS, C.vsrOverlap.lowerStyle)}
      </div>
    `;
  } else if (activeSettingsTab === "sd") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Thuật toán Supply &amp; Demand (Nâng cao)</div>
        ${toggle("Kích hoạt S&D Zones", "sd.enabled", C.sd.enabled)}
        ${num("Swing Trái (Pivot Left)", "sd.pivotLeft", C.sd.pivotLeft, 1, 20, 1)}
        ${num("Swing Phải (Pivot Right)", "sd.pivotRight", C.sd.pivotRight, 1, 20, 1)}
        ${num("Nhìn lại Leg-In (nến)", "sd.legInLookback", C.sd.legInLookback, 2, 100, 1)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Xác nhận Displacement (Leg-Out)</div>
        ${num("Số nến đo Leg-Out", "sd.dispLookforward", C.sd.dispLookforward, 2, 50, 1)}
        ${num("Cú đẩy tối thiểu (× ATR)", "sd.dispAtrMult", C.sd.dispAtrMult, 0.5, 10, 0.1)}
        ${num("Thân nến cùng hướng (0.05–0.95)", "sd.bodyDominance", C.sd.bodyDominance, 0.05, 0.95, 0.05)}
        ${toggle("Bắt buộc có FVG (Imbalance)", "sd.requireFvg", C.sd.requireFvg)}
        ${toggle("Dùng Volume xác nhận", "sd.useVolume", C.sd.useVolume)}
        ${num("Volume tối thiểu (× trung bình)", "sd.volMult", C.sd.volMult, 1.0, 5, 0.1)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Lọc &amp; Giới hạn Zone</div>
        ${num("Vùng rộng tối đa (× ATR)", "sd.maxBaseWidthAtr", C.sd.maxBaseWidthAtr, 0.3, 5, 0.1)}
        ${num("Điểm số tối thiểu (0–100)", "sd.minScore", C.sd.minScore, 0, 100, 5)}
        ${num("Gộp zone chồng lấn > (0–0.9)", "sd.mergeOverlapPct", C.sd.mergeOverlapPct, 0, 0.9, 0.05)}
        ${num("Số zone tối đa / loại", "sd.maxZones", C.sd.maxZones, 1, 30, 1)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Hiển thị Zone</div>
        ${toggle("Hiện Demand Zone", "sd.showDemand", C.sd.showDemand)}
        ${color("Màu Demand", "sd.demandColor", C.sd.demandColor)}
        ${slider("Độ mờ Demand", "sd.demandOpacity", C.sd.demandOpacity)}
        ${toggle("Hiện Supply Zone", "sd.showSupply", C.sd.showSupply)}
        ${color("Màu Supply", "sd.supplyColor", C.sd.supplyColor)}
        ${slider("Độ mờ Supply", "sd.supplyOpacity", C.sd.supplyOpacity)}
        ${toggle("Hiện zone đã bị phá (mờ)", "sd.showBroken", C.sd.showBroken)}
        ${toggle("Hiện nhãn zone (Formation + Score)", "sd.showLabel", C.sd.showLabel)}
      </div>
    `;
  } else if (activeSettingsTab === "strategy") {
    const stratModes = [
      ["statOriginal", "Stat Original (Flip ATR2 + BIAS ATR1 Đồng Thuận)"],
      ["allFlips", "Mọi Nến Flip của ATR2 (Không lọc BIAS)"],
      ["vsrFilter", "Chỉ vào lệnh khi trong VSR Overlap"],
    ];

    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Luật Vào & Quản Lý Lệnh</div>
        ${toggle("Kích hoạt Chiến Lược", "strategy.enabled", C.strategy.enabled)}
        ${select("Chế độ lọc tín hiệu (Mode)", "strategy.mode", stratModes, C.strategy.mode)}
        ${num("Take Profit 1 (%)", "strategy.tp1", C.strategy.tp1, 0.1, 50, 0.5)}
        ${slider("Tỷ trọng chốt TP1 (Fraction)", "strategy.frac1", C.strategy.frac1, 0.1, 1.0, 0.05)}
        ${toggle("Sử dụng Take Profit 2", "strategy.hasTp2", C.strategy.hasTp2)}
        ${num("Take Profit 2 (%)", "strategy.tp2", C.strategy.tp2, 0.1, 50, 0.5)}
        ${num("Stop Loss 1 (%)", "strategy.sl1", C.strategy.sl1, 0.1, 20, 0.5)}
        ${num("Dời SL về Breakeven (SL2 %)", "strategy.sl2", C.strategy.sl2, 0, 10, 0.1)}
        ${num("Phí giao dịch Round-trip (%)", "strategy.feePct", C.strategy.feePct, 0, 1, 0.01)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Hiển Thị Mũi Tên & Đường Giá</div>
        ${toggle("Hiện Mũi tên Entry (L/S)", "strategy.showMarkers", C.strategy.showMarkers)}
        ${color("Màu Mũi tên Long", "strategy.markerUpColor", C.strategy.markerUpColor)}
        ${color("Màu Mũi tên Short", "strategy.markerDownColor", C.strategy.markerDownColor)}

        ${toggle("Hiện Đường Entry", "strategy.showEntryLine", C.strategy.showEntryLine)}
        ${color("Màu Đường Entry", "strategy.entryLineColor", C.strategy.entryLineColor)}
        ${num("Độ dày nét", "strategy.entryLineWidth", C.strategy.entryLineWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "strategy.entryLineStyle", LINE_STYLE_OPTIONS, C.strategy.entryLineStyle)}

        ${toggle("Hiện Đường TP1", "strategy.showTp1Line", C.strategy.showTp1Line)}
        ${color("Màu Đường TP1", "strategy.tp1LineColor", C.strategy.tp1LineColor)}
        ${select("Kiểu nét TP1", "strategy.tp1LineStyle", LINE_STYLE_OPTIONS, C.strategy.tp1LineStyle)}

        ${toggle("Hiện Đường TP2", "strategy.showTp2Line", C.strategy.showTp2Line)}
        ${color("Màu Đường TP2", "strategy.tp2LineColor", C.strategy.tp2LineColor)}

        ${toggle("Hiện Đường SL", "strategy.showSlLine", C.strategy.showSlLine)}
        ${color("Màu Đường SL", "strategy.slLineColor", C.strategy.slLineColor)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Khung Lệnh & Nhãn Giá</div>
        ${toggle("Hiện Vùng Khung Lệnh (Trade Box)", "strategy.showTradeBox", C.strategy.showTradeBox)}
        ${color("Màu Khung Thắng (Win)", "strategy.winBoxColor", C.strategy.winBoxColor)}
        ${color("Màu Khung Thua (Loss)", "strategy.lossBoxColor", C.strategy.lossBoxColor)}
        ${slider("Độ mờ Khung Lệnh", "strategy.boxOpacity", C.strategy.boxOpacity)}
        ${toggle("Hiện Nhãn Giá & Kết quả (Labels)", "strategy.showLabels", C.strategy.showLabels)}
      </div>
    `;
  } else if (activeSettingsTab === "general") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Cài Đặt Dữ Liệu & Biểu Đồ</div>
        ${num("Số nến lưu trữ (Bar Limit)", "barLimit", C.barLimit, 1000, 200000, 5000)}
        ${toggle("Hiện Lưới Biểu Đồ (Grid)", "chart.showGrid", C.chart.showGrid)}
        ${color("Màu Nến Tăng (Bull)", "chart.upColor", C.chart.upColor)}
        ${color("Màu Nến Giảm (Bear)", "chart.downColor", C.chart.downColor)}
        ${color("Màu Nền Biểu Đồ", "chart.bgColor", C.chart.bgColor)}
        ${color("Màu Lưới Biểu Đồ", "chart.gridColor", C.chart.gridColor)}
      </div>

      <div class="panel-sec">
        <div class="panel-sec-header">Khôi Phục Mặc Định</div>
        <div style="display:flex;gap:10px;margin-top:8px;">
          <button class="btn-secondary" onclick="handleStat2ResetTab('${activeSettingsTab}')">Reset Tab Hiện Tại</button>
          <button class="btn-danger" onclick="handleStat2ResetAll()">Reset Toàn Bộ Cài Đặt</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  bindStat2SettingInputs(container);
}

function switchStat2SettingsTab(tabId) {
  activeSettingsTab = tabId;
  renderStat2SettingsModal();
}

function setNestedProperty(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function bindStat2SettingInputs(container) {
  // Inputs change binding
  container.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", (e) => {
      const path = e.target.dataset.path;
      if (!path) return;

      let val;
      if (e.target.type === "checkbox") {
        val = e.target.checked;
      } else if (e.target.type === "number" || e.target.type === "range") {
        val = parseFloat(e.target.value);
      } else {
        val = e.target.value;
      }

      setNestedProperty(STAT2_CFG, path, val);

      // Cập nhật nhãn code màu hoặc slider badge nếu có
      if (e.target.type === "color") {
        const codeEl = e.target.nextElementSibling;
        if (codeEl) codeEl.textContent = val;
      }
      if (e.target.type === "range") {
        const badgeEl = e.target.parentElement.querySelector(".val-badge");
        if (badgeEl) badgeEl.textContent = `${Math.round(val * 100)}%`;
      }

      saveStat2Config();
      recalculateAndRedrawStat2();
    });
  });
}

function handleStat2ResetTab(tab) {
  if (confirm(`Bạn có chắc muốn khôi phục mặc định cho tab ${tab}?`)) {
    resetStat2Config(tab);
    renderStat2SettingsModal();
    recalculateAndRedrawStat2();
  }
}

function handleStat2ResetAll() {
  if (confirm("Khôi phục toàn bộ cài đặt Stat2 về mặc định ban đầu?")) {
    resetStat2Config(null);
    renderStat2SettingsModal();
    recalculateAndRedrawStat2();
  }
}

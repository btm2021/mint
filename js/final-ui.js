// ============================================================
// final-ui.js — GIAO DIỆN CÀI ĐẶT TOÀN DIỆN & TƯƠNG TÁC (FINAL)
// ============================================================

const FINAL_MA_TYPE_OPTIONS = [
  ["ema", "EMA"], ["vwma", "VWMA"], ["lwma", "LWMA"], ["wma", "WMA"],
  ["hma", "HMA"], ["vwap", "VWAP (rolling)"], ["alma", "ALMA"], ["tema", "TEMA"],
  ["wwsma", "WWSMA"], ["zlema", "ZLEMA"], ["lsma", "LSMA"], ["kama", "KAMA"],
  ["vidya", "VIDYA"], ["smma", "SMMA"], ["mcginley", "McGinley"], ["swma", "SWMA"],
];

const FINAL_SOURCE_OPTIONS = [
  ["close", "Close"], ["open", "Open"], ["high", "High"], ["low", "Low"],
  ["hl2", "HL2 (H+L)/2"], ["hlc3", "HLC3 (H+L+C)/3"], ["ohlc4", "OHLC4 (O+H+L+C)/4"],
];

const FINAL_LINE_STYLE_OPTIONS = [
  ["solid", "Solid (Nét liền)"],
  ["dashed", "Dashed (Nét đứt)"],
  ["dotted", "Dotted (Chấm)"],
];

function updateFinalStatsBar() {
  const el = document.getElementById("final-strategy-stats");
  if (!el) return;
  if (!FINAL_CFG.strategy.enabled || !globalFinalTrades.length) {
    el.style.display = "none";
    return;
  }
  const summary = computeFinalSummary(globalFinalTrades);
  if (!summary) {
    el.style.display = "none";
    return;
  }

  el.style.display = "flex";
  const exitsStr = Object.entries(summary.exits).map(([k, v]) => `${k} <b>${v}</b>`).join(" | ");
  el.innerHTML = `
    <span class="ss-title"><span class="badge-dot"></span>${FINAL_CFG.strategy.name} (${FINAL_CFG.strategy.mode})</span>
    <span>Lệnh <b>${summary.n}</b></span>
    <span>Win <b>${summary.winRate.toFixed(1)}%</b></span>
    <span>Exp <b class="${summary.expR >= 0 ? "up" : "down"}">${summary.expR >= 0 ? "+" : ""}${summary.expR.toFixed(3)}R</b></span>
    <span>PF <b>${Number.isFinite(summary.pf) ? summary.pf.toFixed(2) : "∞"}</b></span>
    <span class="ss-exits">${exitsStr}</span>
  `;
}

function updateFinalIndicatorHUD(logical) {
  const el = document.getElementById("final-indicator-hud");
  if (!el || !globalFinalBars.length) return;

  const n = globalFinalBars.length;
  const idx = Math.max(0, Math.min(n - 1, Math.round(logical ?? n - 1)));
  const bar = globalFinalBars[idx];
  const price = bar.close;
  const pr = getFinalPriceFormat(price).precision;
  const fmt = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr);

  const b1State = globalFinalBot1?.states ? globalFinalBot1.states[idx] : 0;
  const b2State = globalFinalBot2?.states ? globalFinalBot2.states[idx] : 0;
  const vsr1U = globalFinalVsr1?.upperArr ? globalFinalVsr1.upperArr[idx] : NaN;
  const vsr1L = globalFinalVsr1?.lowerArr ? globalFinalVsr1.lowerArr[idx] : NaN;
  const vsr2U = globalFinalVsr2?.upperArr ? globalFinalVsr2.upperArr[idx] : NaN;
  const vsr2L = globalFinalVsr2?.lowerArr ? globalFinalVsr2.lowerArr[idx] : NaN;
  const ovU = globalFinalVsrOverlap?.upperArr ? globalFinalVsrOverlap.upperArr[idx] : NaN;
  const ovL = globalFinalVsrOverlap?.lowerArr ? globalFinalVsrOverlap.lowerArr[idx] : NaN;

  const stBadge = (st) => st === 1 ? `<span class="tag-up">▲ BULL</span>` : st === -1 ? `<span class="tag-down">▼ BEAR</span>` : `<span>—</span>`;
  const isOverlap = Number.isFinite(ovU) && Number.isFinite(ovL);

  // S&D Summary
  const demandCount = globalFinalZones?.demandZones?.length || 0;
  const supplyCount = globalFinalZones?.supplyZones?.length || 0;

  // Trend Summary
  const trendDir = globalFinalTrend?.direction;
  const trendSt = globalFinalTrend?.status;
  const trendBadge = trendDir === "up"
    ? `<span class="tag-up">▲ UP (${trendSt || "—"})</span>`
    : trendDir === "down"
      ? `<span class="tag-down">▼ DOWN (${trendSt || "—"})</span>`
      : `<span class="dim">FORMING</span>`;

  // SMC Summary
  const fvgCount = globalFinalSMC?.fvgs?.filter((f) => !f.mitigated).length || 0;
  const obCount = globalFinalSMC?.orderBlocks?.length || 0;

  el.innerHTML = `
    <div class="hud-item"><span class="hud-lbl">ATR1 (BIAS)</span> ${stBadge(b1State)}</div>
    <div class="hud-item"><span class="hud-lbl">ATR2 (ENTRY)</span> ${stBadge(b2State)}</div>
    <div class="hud-item"><span class="hud-lbl">VSR1</span> <b>${fmt(vsr1L)} – ${fmt(vsr1U)}</b></div>
    <div class="hud-item"><span class="hud-lbl">VSR2</span> <b>${fmt(vsr2L)} – ${fmt(vsr2U)}</b></div>
    <div class="hud-item"><span class="hud-lbl">VSR Overlap</span> <b class="${isOverlap ? "highlight" : "dim"}">${isOverlap ? `${fmt(ovL)} – ${fmt(ovU)}` : "None"}</b></div>
    <div class="hud-item"><span class="hud-lbl">S&D Zones</span> <b>${demandCount}D / ${supplyCount}S</b></div>
    <div class="hud-item"><span class="hud-lbl">Trend</span> ${trendBadge}</div>
    <div class="hud-item"><span class="hud-lbl">SMC</span> <b>${fvgCount} FVG · ${obCount} OB</b></div>
  `;
}

// ==================== TRADE DETAIL MODAL ====================

function openFinalTradeModal(trade) {
  if (!trade) return;
  const overlay = document.getElementById("final-trade-modal-overlay");
  if (!overlay) return;

  const pr = getFinalPriceFormat(trade.entry).precision;
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr);
  const pnlCls = trade.pnlR >= 0 ? "up" : "down";
  const side = trade.side;
  const sideCls = side === "LONG" ? "up" : "down";
  const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleString("vi-VN") : "—";

  overlay.innerHTML = `
    <div class="final-modal-card" onclick="event.stopPropagation()">
      <div class="modal-card-header">
        <div class="modal-card-title">
          <span class="trade-side-badge ${sideCls}">${side === "LONG" ? "▲" : "▼"} ${side}</span>
          <span class="trade-symbol-info">${FINAL_CFG.symbol} · ${FINAL_CFG.interval} · ${FINAL_CFG.strategy.name}</span>
        </div>
        <button class="modal-card-close" onclick="closeFinalTradeModal()">✕</button>
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
          <div class="sec-title">① Thông tin tín hiệu & Bộ lọc Confluence</div>
          <div class="sec-row"><span>Thời điểm</span><b>${fmtDate(trade.entryTime)} → ${fmtDate(trade.exitTime)}</b></div>
          <div class="sec-row"><span>ATRBot 1 (BIAS)</span><b class="${trade.slowState === trade.S ? "up" : "down"}">${trade.slowState === 1 ? "▲ BULL" : "▼ BEAR"} (Đồng thuận)</b></div>
          <div class="sec-row"><span>ATRBot 2 (ENTRY)</span><b class="up">${trade.fastState === 1 ? "▲ BULL" : "▼ BEAR"} (Nến Flip)</b></div>
          <div class="sec-row"><span>VSR 1</span><b>${pf(trade.vsr1Lower)} – ${pf(trade.vsr1Upper)}</b></div>
          <div class="sec-row"><span>VSR 2</span><b>${pf(trade.vsr2Lower)} – ${pf(trade.vsr2Upper)}</b></div>
          <div class="sec-row"><span>VSR Overlap</span><b class="${trade.overlapUpper ? "highlight" : "dim"}">${trade.overlapUpper ? `${pf(trade.overlapLower)} – ${pf(trade.overlapUpper)}` : "Không có"}</b></div>
          ${trade.structConfirmed ? `<div class="sec-row"><span>Xác nhận Cấu Trúc</span><b class="up">✓ ${trade.confirmReason}</b></div>` : ""}
        </div>

        <div class="sec-box">
          <div class="sec-title">② Các mốc giá Quản lý Vị thế</div>
          <div class="sec-row"><span>Entry</span><b class="${sideCls}">${pf(trade.entry)}</b></div>
          <div class="sec-row"><span>Stop Loss (SL ${FINAL_CFG.strategy.sl1}%)</span><b class="down">${pf(trade.sl1Lv)}</b></div>
          <div class="sec-row"><span>Take Profit 1 (TP1 ${FINAL_CFG.strategy.tp1}%)</span><b class="up">${pf(trade.tp1Lv)}</b></div>
          ${trade.tp2Lv != null ? `<div class="sec-row"><span>Take Profit 2 (TP2 ${FINAL_CFG.strategy.tp2}%)</span><b class="up">${pf(trade.tp2Lv)}</b></div>` : ""}
          <div class="sec-row"><span>Chi phí Round-trip</span><b>${FINAL_CFG.strategy.feePct}%</b></div>
        </div>
      </div>
    </div>
  `;
  overlay.style.display = "flex";
}

function closeFinalTradeModal() {
  const overlay = document.getElementById("final-trade-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// ==================== ZONE DETAIL MODAL ====================

function openFinalZoneModal(zone) {
  if (!zone) return;
  const overlay = document.getElementById("final-trade-modal-overlay");
  if (!overlay) return;

  const pr = getFinalPriceFormat(zone.proximalLine).precision;
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr);
  const isDemand = zone.type === "demand";
  const endIdx = zone.endIndex !== null && zone.endIndex !== undefined ? zone.endIndex : zone.invalidatedIndex;
  const isTouched = endIdx !== null;
  const statusLabel = isTouched ? "ĐÃ CHẠM KẾT THÚC (TOUCHED)" : "CÒN HIỆU LỰC (FRESH)";
  const statusCls = isTouched ? "highlight" : "up";

  overlay.innerHTML = `
    <div class="final-modal-card" onclick="event.stopPropagation()">
      <div class="modal-card-header">
        <div class="modal-card-title">
          <span class="trade-side-badge ${isDemand ? "up" : "down"}">${zone.type.toUpperCase()} (${zone.formation})</span>
          <span class="trade-symbol-info">${FINAL_CFG.symbol} · ${FINAL_CFG.interval} · S&D Zone</span>
        </div>
        <button class="modal-card-close" onclick="closeFinalTradeModal()">✕</button>
      </div>

      <div class="trade-stat-grid">
        <div class="trade-stat-box"><span class="lbl">Biên trên (Top)</span><span class="val ${isDemand ? "up" : "down"}">${pf(zone.topPrice || Math.max(zone.proximalLine, zone.distalLine))}</span></div>
        <div class="trade-stat-box"><span class="lbl">Biên dưới (Bottom)</span><span class="val">${pf(zone.bottomPrice || Math.min(zone.proximalLine, zone.distalLine))}</span></div>
        <div class="trade-stat-box"><span class="lbl">Tổng điểm Odds</span><span class="val highlight">${zone.scores ? zone.scores.total.toFixed(1) : "—"} / 5.0★</span></div>
        <div class="trade-stat-box"><span class="lbl">Trạng thái</span><span class="val ${statusCls}">${statusLabel}</span></div>
        <div class="trade-stat-box"><span class="lbl">Độ rộng Zone</span><span class="val">${pf(zone.width)}</span></div>
        <div class="trade-stat-box"><span class="lbl">Số nến Base</span><span class="val">${zone.baseCandles} nến</span></div>
      </div>

      <div class="trade-detail-sections">
        <div class="sec-box">
          <div class="sec-title">① Chi tiết Đánh giá Odds Enhancers & Quét Zone</div>
          <div class="sec-row"><span>Strength (Độ nổ Leg-out)</span><b>${zone.scores?.strength ?? "—"}/2.0 (${zone.scores?.moveOutMultiple?.toFixed(1) || 0}x width)</b></div>
          <div class="sec-row"><span>Time (Số nến Base)</span><b>${zone.scores?.time ?? "—"}/1.0 (${zone.baseCandles} nến base)</b></div>
          <div class="sec-row"><span>Freshness (Độ tươi mới)</span><b>${zone.scores?.freshness ?? "—"}/2.0</b></div>
          <div class="sec-row"><span>Cây nến tạo Zone</span><b>Nến #${zone.baseStartIndex} → #${zone.legOutEndIndex}</b></div>
          ${isTouched ? `<div class="sec-row"><span>Nến đầu tiên chạm giá (First Touch)</span><b class="down">Nến #${endIdx} (Kết thúc Zone)</b></div>` : `<div class="sec-row"><span>Hiệu lực</span><b class="up">Đang hoạt động (Kéo dài tới hiện tại)</b></div>`}
          <div class="sec-row"><span>Formation</span><b>${zone.formation} (${zone.type === "demand" ? "Demand / Vùng Cầu" : "Supply / Vùng Cung"})</b></div>
        </div>
      </div>
    </div>
  `;
  overlay.style.display = "flex";
}

// ==================== SETTINGS MODAL & SIDEBAR ĐA TAB ====================

let activeFinalSettingsTab = "atr1";
let activeSidebarTab = "atr1";

const FINAL_SETTINGS_TABS = [
  { id: "atr1", label: "🟢 ATRBot 1", icon: "🟢" },
  { id: "atr2", label: "🔵 ATRBot 2", icon: "🔵" },
  { id: "vsr1", label: "🟡 VSR 1", icon: "🟡" },
  { id: "vsr2", label: "🔷 VSR 2", icon: "🔷" },
  { id: "vsrOverlap", label: "🟣 VSR Overlap", icon: "🟣" },
  { id: "zone", label: "🧱 S&D Zones", icon: "📦" },
  { id: "trend", label: "📈 Trend & Swings", icon: "〰️" },
  { id: "smc", label: "🧠 SMC (Smart Money)", icon: "🎯" },
  { id: "structural", label: "🏛 Structural", icon: "📐" },
  { id: "strategy", label: "🎯 Chiến Lược", icon: "⚡" },
  { id: "chart", label: "🎨 Giao Diện", icon: "🖥️" },
];

function setFinalNestedProperty(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getFinalNestedProperty(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function bindFinalControl(el, path, type = "text") {
  if (!el) return;
  const updateVal = () => {
    let v;
    if (type === "checkbox") v = el.checked;
    else if (type === "number") v = parseFloat(el.value);
    else v = el.value;

    setFinalNestedProperty(FINAL_CFG, path, v);
    saveFinalConfig();
    syncFinalSidebarToggles();
    if (typeof recalculateAndRedrawFinal === "function") {
      recalculateAndRedrawFinal();
    }
  };

  if (type === "checkbox") el.addEventListener("change", updateVal);
  else if (type === "color") el.addEventListener("input", updateVal);
  else el.addEventListener("change", updateVal);
}

function getFinalSettingsTabHtml(tab) {
  const cfg = FINAL_CFG;
  let html = "";

  const renderSelect = (lbl, path, options, val) => `
    <div class="st-row">
      <label>${lbl}</label>
      <select class="st-select" data-path="${path}">
        ${options.map(([optVal, optLbl]) => `<option value="${optVal}" ${optVal === val ? "selected" : ""}>${optLbl}</option>`).join("")}
      </select>
    </div>
  `;

  const renderNumber = (lbl, path, val, min = 0, max = 500, step = 1) => `
    <div class="st-row">
      <label>${lbl}</label>
      <input type="number" class="st-number" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>
  `;

  const renderColor = (lbl, path, val) => `
    <div class="st-row">
      <label>${lbl}</label>
      <input type="color" class="st-color" data-path="${path}" value="${val}" />
    </div>
  `;

  const renderCheckbox = (lbl, path, checked) => `
    <div class="st-row">
      <label>${lbl}</label>
      <input type="checkbox" class="st-check" data-path="${path}" ${checked ? "checked" : ""} />
    </div>
  `;

  const renderSlider = (lbl, path, val, min = 0, max = 1, step = 0.01) => `
    <div class="st-row">
      <label>${lbl} <b>${val}</b></label>
      <input type="range" class="st-slider" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>
  `;

  // 1. ATRBot 1 & ATRBot 2
  if (tab === "atr1" || tab === "atr2") {
    const c = cfg[tab];
    html = `
      <div class="settings-group">
        <div class="grp-title">① Thông số Tính toán ${c.name}</div>
        ${renderCheckbox("Bật chỉ báo này", `${tab}.enabled`, c.enabled)}
        ${renderSelect("MA Type (16 loại MA)", `${tab}.maType`, FINAL_MA_TYPE_OPTIONS, c.maType)}
        ${renderSelect("Source Nguồn giá", `${tab}.source`, FINAL_SOURCE_OPTIONS, c.source)}
        ${renderNumber("MA Length (Chu kỳ)", `${tab}.maLen`, c.maLen, 1, 500, 1)}
        ${renderNumber("ATR Length", `${tab}.atrLen`, c.atrLen, 1, 500, 1)}
        ${renderNumber("ATR Multiplier (Hệ số SL)", `${tab}.mult`, c.mult, 0.1, 20.0, 0.1)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Đường Trail 1 (MA)</div>
        ${renderCheckbox("Hiển thị Trail 1", `${tab}.showT1`, c.showT1)}
        ${renderColor("Màu sắc Trail 1", `${tab}.t1Color`, c.t1Color)}
        ${renderNumber("Độ dày nét", `${tab}.t1Width`, c.t1Width, 1, 5, 0.5)}
        ${renderSelect("Kiểu nét", `${tab}.t1Style`, FINAL_LINE_STYLE_OPTIONS, c.t1Style)}
      </div>

      <div class="settings-group">
        <div class="grp-title">③ Đường Trail 2 (ATR Trailing Stop)</div>
        ${renderCheckbox("Hiển thị Trail 2", `${tab}.showT2`, c.showT2)}
        ${renderColor("Màu sắc Trail 2", `${tab}.t2Color`, c.t2Color)}
        ${renderNumber("Độ dày nét", `${tab}.t2Width`, c.t2Width, 1, 5, 0.5)}
        ${renderSelect("Kiểu nét", `${tab}.t2Style`, FINAL_LINE_STYLE_OPTIONS, c.t2Style)}
      </div>

      <div class="settings-group">
        <div class="grp-title">④ Vùng Đệm (ATR Cloud)</div>
        ${renderCheckbox("Tô màu vùng đệm (Cloud)", `${tab}.showCloud`, c.showCloud)}
        ${renderColor("Màu Tăng (Bull Cloud)", `${tab}.cloudUpColor`, c.cloudUpColor)}
        ${renderSlider("Độ trong suốt Tăng", `${tab}.cloudUpOpacity`, c.cloudUpOpacity, 0, 1, 0.01)}
        ${renderColor("Màu Giảm (Bear Cloud)", `${tab}.cloudDownColor`, c.cloudDownColor)}
        ${renderSlider("Độ trong suốt Giảm", `${tab}.cloudDownOpacity`, c.cloudDownOpacity, 0, 1, 0.01)}
      </div>
    `;
  }

  // 2. VSR 1 & VSR 2
  else if (tab === "vsr1" || tab === "vsr2") {
    const c = cfg[tab];
    html = `
      <div class="settings-group">
        <div class="grp-title">① Thông số VSR (${c.name})</div>
        ${renderCheckbox("Bật VSR", `${tab}.enabled`, c.enabled)}
        ${renderNumber("Chu kỳ Volume (Length)", `${tab}.length`, c.length, 1, 500, 1)}
        ${renderNumber("Độ lệch Upper (Offset Upper)", `${tab}.offsetUpper`, c.offsetUpper, -50, 50, 0.5)}
        ${renderNumber("Độ lệch Lower (Offset Lower)", `${tab}.offsetLower`, c.offsetLower, -50, 50, 0.5)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Nét vẽ & Vùng giá</div>
        ${renderCheckbox("Hiện đường Upper", `${tab}.showUpper`, c.showUpper)}
        ${renderColor("Màu đường Upper", `${tab}.upperColor`, c.upperColor)}
        ${renderNumber("Độ dày đường Upper", `${tab}.upperWidth`, c.upperWidth, 1, 5, 0.5)}
        ${renderCheckbox("Hiện đường Lower", `${tab}.showLower`, c.showLower)}
        ${renderColor("Màu đường Lower", `${tab}.lowerColor`, c.lowerColor)}
        ${renderNumber("Độ dày đường Lower", `${tab}.lowerWidth`, c.lowerWidth, 1, 5, 0.5)}
        ${renderCheckbox("Tô màu nền giữa Upper/Lower", `${tab}.showFill`, c.showFill)}
        ${renderColor("Màu nền", `${tab}.fillColor`, c.fillColor)}
        ${renderSlider("Độ trong suốt nền", `${tab}.fillOpacity`, c.fillOpacity, 0, 1, 0.01)}
      </div>
    `;
  }

  // 3. VSR Overlap
  else if (tab === "vsrOverlap") {
    const c = cfg.vsrOverlap;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Vùng Chồng Lấn 2 VSR (VSR Overlap)</div>
        ${renderCheckbox("Bật vẽ vùng Overlap", "vsrOverlap.enabled", c.enabled)}
        ${renderCheckbox("Tô màu nền", "vsrOverlap.showFill", c.showFill)}
        ${renderColor("Màu chủ đạo Overlap", "vsrOverlap.fillColor", c.fillColor)}
        ${renderSlider("Độ trong suốt nền", "vsrOverlap.fillOpacity", c.fillOpacity, 0, 1, 0.01)}
        ${renderCheckbox("Họa tiết Gạch Chéo (Diagonal Hatching)", "vsrOverlap.showHatch", c.showHatch)}
        ${renderCheckbox("Hiển thị nhãn Huy hiệu OVERLAP", "vsrOverlap.showLabel", c.showLabel)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Đường Viền Overlap</div>
        ${renderCheckbox("Hiện viền Upper", "vsrOverlap.showUpper", c.showUpper)}
        ${renderColor("Màu viền Upper", "vsrOverlap.upperColor", c.upperColor)}
        ${renderNumber("Độ dày viền Upper", "vsrOverlap.upperWidth", c.upperWidth, 1, 5, 0.5)}
        ${renderCheckbox("Hiện viền Lower", "vsrOverlap.showLower", c.showLower)}
        ${renderColor("Màu viền Lower", "vsrOverlap.lowerColor", c.lowerColor)}
        ${renderNumber("Độ dày viền Lower", "vsrOverlap.lowerWidth", c.lowerWidth, 1, 5, 0.5)}
      </div>
    `;
  }

  // 4. S&D Zones (ForexFlow)
  else if (tab === "zone") {
    const c = cfg.zone;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Cấu hình Thuật toán Zone Detector (Base Isolation)</div>
        ${renderCheckbox("Bật Supply & Demand Zones", "zone.enabled", c.enabled)}
        ${renderSelect("Nguồn xác định biên Zone (Base Source)", "zone.baseSource", [
          ["wicks", "Tính cả High/Low râu nến (Wicks - Khuyên dùng)"],
          ["bodies", "Thân nến (Bodies - Open/Close)"]
        ], c.baseSource || "wicks")}
        ${renderNumber("Điểm Odds tối thiểu (Min Score)", "zone.minScore", c.minScore, 0, 5, 0.5)}
        ${renderNumber("Số nến Leg-out tối thiểu (Min Leg)", "zone.minLegCandles", c.minLegCandles, 1, 5, 1)}
        ${renderNumber("Số nến Base tối đa (Max Base)", "zone.maxBaseCandles", c.maxBaseCandles, 1, 10, 1)}
        ${renderNumber("Hệ số dịch chuyển nổ (Move-out Multiple)", "zone.minMoveOutMultiple", c.minMoveOutMultiple, 1.0, 5.0, 0.5)}
        ${renderNumber("Độ rộng Base tối đa theo ATR", "zone.maxBaseWidthAtr", c.maxBaseWidthAtr, 0.5, 5.0, 0.5)}
        ${renderNumber("Chu kỳ ATR", "zone.atrPeriod", c.atrPeriod, 5, 50, 1)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Trạng thái hiển thị & Nến chạm</div>
        ${renderCheckbox("Hiện Nhãn & Thông tin Zone", "zone.showLabels", c.showLabels)}
        ${renderCheckbox("Hiện Điểm Score trên nhãn", "zone.showScores", c.showScores)}
      </div>

      <div class="settings-group">
        <div class="grp-title">③ Màu sắc & Đường biên</div>
        ${renderColor("Màu Vùng Cầu (Demand)", "zone.demandColor", c.demandColor)}
        ${renderSlider("Độ trong suốt Demand", "zone.demandOpacity", c.demandOpacity, 0, 1, 0.01)}
        ${renderColor("Màu Vùng Cung (Supply)", "zone.supplyColor", c.supplyColor)}
        ${renderSlider("Độ trong suốt Supply", "zone.supplyOpacity", c.supplyOpacity, 0, 1, 0.01)}
        ${renderNumber("Độ dày đường Proximal", "zone.proximalWidth", c.proximalWidth, 1, 5, 0.5)}
        ${renderNumber("Độ dày đường Distal", "zone.distalWidth", c.distalWidth, 1, 5, 0.5)}
      </div>
    `;
  }

  // 5. Trend & Swings (ForexFlow)
  else if (tab === "trend") {
    const c = cfg.trend;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Thuật toán Swing Pivot & Trend Detection</div>
        ${renderCheckbox("Bật Trend & Swing Structure", "trend.enabled", c.enabled)}
        ${renderNumber("Độ mạnh Swing (Strength Radius)", "trend.swingStrength", c.swingStrength, 1, 15, 1)}
        ${renderNumber("Lọc khoảng cách tối thiểu theo ATR", "trend.minSegmentAtr", c.minSegmentAtr, 0, 3, 0.1)}
        ${renderNumber("Số đỉnh đáy Swing tối đa", "trend.maxSwingPoints", c.maxSwingPoints, 5, 100, 5)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Hiển thị & Nét vẽ</div>
        ${renderCheckbox("Vẽ đường ZigZag nối Swing (Segments)", "trend.showSegments", c.showSegments)}
        ${renderColor("Màu đường ZigZag", "trend.segmentColor", c.segmentColor)}
        ${renderNumber("Độ dày đường ZigZag", "trend.segmentWidth", c.segmentWidth, 1, 5, 0.5)}
        ${renderSelect("Kiểu nét ZigZag", "trend.segmentStyle", FINAL_LINE_STYLE_OPTIONS, c.segmentStyle)}
        ${renderCheckbox("Hiện nhãn HH / HL / LH / LL", "trend.showSwingLabels", c.showSwingLabels)}
        ${renderCheckbox("Hiện đường Controlling Swing", "trend.showControllingSwing", c.showControllingSwing)}
      </div>
    `;
  }

  // 6. SMC (Smart Money Concepts)
  else if (tab === "smc") {
    const c = cfg.smc;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Cấu trúc Thị trường (BOS & CHoCH)</div>
        ${renderCheckbox("Bật toàn bộ SMC", "smc.enabled", c.enabled)}
        ${renderCheckbox("Hiện Break of Structure (BOS)", "smc.showBOS", c.showBOS)}
        ${renderCheckbox("Hiện Change of Character (CHoCH)", "smc.showCHoCH", c.showCHoCH)}
        ${renderNumber("Độ nhạy Swing SMC", "smc.swingStrength", c.swingStrength, 1, 15, 1)}
        ${renderColor("Màu đường Tăng (Bullish Struct)", "smc.bullColor", c.bullColor)}
        ${renderColor("Màu đường Giảm (Bearish Struct)", "smc.bearColor", c.bearColor)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Fair Value Gaps (FVG)</div>
        ${renderCheckbox("Hiển thị vùng FVG", "smc.showFVG", c.showFVG)}
        ${renderCheckbox("Ẩn FVG khi đã bị lấp (Mitigated)", "smc.fvgHideMitigated", c.fvgHideMitigated)}
        ${renderColor("Màu Bullish FVG", "smc.fvgBullColor", c.fvgBullColor)}
        ${renderColor("Màu Bearish FVG", "smc.fvgBearColor", c.fvgBearColor)}
        ${renderSlider("Độ trong suốt FVG", "smc.fvgOpacity", c.fvgOpacity, 0, 1, 0.01)}
      </div>

      <div class="settings-group">
        <div class="grp-title">③ Order Blocks (Khối lệnh OB)</div>
        ${renderCheckbox("Hiển thị Order Blocks", "smc.showOrderBlocks", c.showOrderBlocks)}
        ${renderNumber("Hệ số dịch chuyển nổ (Displacement Mult)", "smc.minDisplacementMult", c.minDisplacementMult, 1, 5, 0.5)}
        ${renderColor("Màu Bullish OB", "smc.obBullColor", c.obBullColor)}
        ${renderColor("Màu Bearish OB", "smc.obBearColor", c.obBearColor)}
        ${renderSlider("Độ trong suốt OB", "smc.obOpacity", c.obOpacity, 0, 1, 0.01)}
      </div>

      <div class="settings-group">
        <div class="grp-title">④ Thanh khoản (Equal Highs/Lows & Sweeps)</div>
        ${renderCheckbox("Hiện Quét thanh khoản (Liquidity Sweeps)", "smc.showLiquiditySweeps", c.showLiquiditySweeps)}
        ${renderCheckbox("Hiện Đáy Bằng / Đỉnh Bằng (Equal Levels)", "smc.showEqualLevels", c.showEqualLevels)}
        ${renderNumber("Dung sai Equal Levels (%)", "smc.tolerancePct", c.tolerancePct, 0.01, 1.0, 0.02)}
        ${renderColor("Màu thanh khoản Quét (Sweep Color)", "smc.sweepColor", c.sweepColor)}
      </div>
    `;
  }

  // 7. Structural Breakeven
  else if (tab === "structural") {
    const c = cfg.structural;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Xác nhận Cấu Trúc (Structural Breakeven Confirmation)</div>
        ${renderCheckbox("Bật xác nhận Cấu Trúc cho dời BE", "structural.enabled", c.enabled)}
        ${renderNumber("Số nến Pivot Lookback", "structural.lookback", c.lookback, 1, 10, 1)}
        ${renderCheckbox("Hiện thông báo xác nhận khi dời SL", "structural.showConfirmationNotice", c.showConfirmationNotice)}
      </div>
    `;
  }

  // 8. Chiến Lược (Strategy & Backtest)
  else if (tab === "strategy") {
    const c = cfg.strategy;
    const stratModes = [
      ["statOriginal", "Nguyên bản Stat2 (ATR1 Đồng thuận + ATR2 Flip)"],
      ["allFlips", "Tất cả các Flip của ATR2"],
      ["vsrFilter", "Chỉ vào lệnh trong VSR Overlap"],
      ["zoneConfluence", "Hội tụ S&D Zone (Demand/Supply)"],
      ["smcConfluence", "Hội tụ SMC (Order Block / FVG)"],
    ];

    html = `
      <div class="settings-group">
        <div class="grp-title">① Thông số Chiến lược & Bộ lọc Confluence</div>
        ${renderCheckbox("Bật Mô phỏng Chiến lược & Backtest", "strategy.enabled", c.enabled)}
        ${renderSelect("Chế độ Chiến lược (Mode)", "strategy.mode", stratModes, c.mode)}
        ${renderCheckbox("Yêu cầu Xác nhận Cấu trúc trước khi dời BE", "strategy.useStructuralBE", c.useStructuralBE)}
      </div>

      <div class="settings-group">
        <div class="grp-title">② Take Profit & Stop Loss</div>
        ${renderNumber("Stop Loss SL1 (%)", "strategy.sl1", c.sl1, 0.1, 50, 0.1)}
        ${renderNumber("Take Profit TP1 (%)", "strategy.tp1", c.tp1, 0.1, 100, 0.1)}
        ${renderSlider("Tỷ trọng chốt tại TP1 (Frac1)", "strategy.frac1", c.frac1, 0.1, 1.0, 0.05)}
        ${renderCheckbox("Bật Take Profit TP2", "strategy.hasTp2", c.hasTp2)}
        ${renderNumber("Take Profit TP2 (%)", "strategy.tp2", c.tp2, 0.1, 200, 0.1)}
        ${renderNumber("Dời SL2 sau khi đạt TP1 (% so với Entry, 0 = BE)", "strategy.sl2", c.sl2, -10, 10, 0.1)}
        ${renderNumber("Chi phí giao dịch Round-trip (%)", "strategy.feePct", c.feePct, 0, 1.0, 0.01)}
      </div>

      <div class="settings-group">
        <div class="grp-title">③ Hiển thị trên Biểu đồ</div>
        ${renderCheckbox("Hiện Mũi tên Entry", "strategy.showMarkers", c.showMarkers)}
        ${renderCheckbox("Hiện đường Entry", "strategy.showEntryLine", c.showEntryLine)}
        ${renderCheckbox("Hiện đường SL", "strategy.showSlLine", c.showSlLine)}
        ${renderCheckbox("Hiện đường TP1", "strategy.showTp1Line", c.showTp1Line)}
        ${renderCheckbox("Hiện đường TP2", "strategy.showTp2Line", c.showTp2Line)}
        ${renderCheckbox("Hiện Khung lệnh (Trade Box)", "strategy.showTradeBox", c.showTradeBox)}
        ${renderCheckbox("Hiện Nhãn giá & PnL", "strategy.showLabels", c.showLabels)}
      </div>
    `;
  }

  // 9. Giao diện (Chart Appearance)
  else if (tab === "chart") {
    const c = cfg.chart;
    html = `
      <div class="settings-group">
        <div class="grp-title">① Màu sắc Nến & Biểu đồ</div>
        ${renderColor("Màu Nến Tăng (Up Candle)", "chart.upColor", c.upColor)}
        ${renderColor("Màu Nến Giảm (Down Candle)", "chart.downColor", c.downColor)}
        ${renderColor("Màu Nền Biểu đồ (Background)", "chart.bgColor", c.bgColor)}
        ${renderCheckbox("Hiện Lưới tọa độ (Grid)", "chart.showGrid", c.showGrid)}
        ${renderColor("Màu Lưới (Grid Color)", "chart.gridColor", c.gridColor)}
      </div>
    `;
  }

  return html;
}

function openFinalSettingsModal(tab = "atr1") {
  const modal = document.getElementById("final-settings-modal");
  if (!modal) return;
  activeFinalSettingsTab = tab;
  renderFinalSettingsTabs();
  renderFinalSettingsContent();
  modal.style.display = "flex";
}

function closeFinalSettingsModal() {
  const modal = document.getElementById("final-settings-modal");
  if (modal) modal.style.display = "none";
}

function renderFinalSettingsTabs() {
  const container = document.getElementById("final-settings-tabs");
  if (!container) return;

  container.innerHTML = FINAL_SETTINGS_TABS.map((t) => `
    <button class="settings-tab-btn ${t.id === activeFinalSettingsTab ? "active" : ""}" data-tab="${t.id}">
      <span class="tab-icon">${t.icon}</span>
      <span class="tab-label">${t.label}</span>
    </button>
  `).join("");

  container.querySelectorAll(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFinalSettingsTab = btn.dataset.tab;
      renderFinalSettingsTabs();
      renderFinalSettingsContent();
    });
  });
}

function renderFinalSettingsContent() {
  const container = document.getElementById("final-settings-content");
  if (!container) return;

  const tab = activeFinalSettingsTab;
  let html = getFinalSettingsTabHtml(tab);

  html += `
    <div class="settings-footer-actions">
      <button class="st-reset-btn" id="final-reset-tab-btn">🔄 Khôi phục mặc định tab này</button>
      <button class="st-reset-all-btn" id="final-reset-all-btn">⚠️ Khôi phục toàn bộ mặc định</button>
    </div>
  `;

  container.innerHTML = html;

  // Bind all inputs dynamically
  container.querySelectorAll("[data-path]").forEach((el) => {
    const p = el.dataset.path;
    if (el.type === "checkbox") bindFinalControl(el, p, "checkbox");
    else if (el.type === "number") bindFinalControl(el, p, "number");
    else if (el.type === "color") bindFinalControl(el, p, "color");
    else if (el.type === "range") {
      el.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        const lbl = el.parentElement.querySelector("b");
        if (lbl) lbl.textContent = val;
        setFinalNestedProperty(FINAL_CFG, p, val);
        saveFinalConfig();
        syncFinalSidebarToggles();
        if (typeof recalculateAndRedrawFinal === "function") {
          recalculateAndRedrawFinal();
        }
      });
    } else bindFinalControl(el, p, "text");
  });

  // Bind Reset Buttons
  const resetTabBtn = document.getElementById("final-reset-tab-btn");
  if (resetTabBtn) {
    resetTabBtn.addEventListener("click", () => {
      resetFinalConfig(tab);
      renderFinalSettingsContent();
      renderFinalSidebarTabContent(activeSidebarTab);
      syncFinalSidebarToggles();
      if (typeof recalculateAndRedrawFinal === "function") {
        recalculateAndRedrawFinal();
      }
    });
  }

  const resetAllBtn = document.getElementById("final-reset-all-btn");
  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", () => {
      if (confirm("Bạn có chắc chắn muốn khôi phục toàn bộ cài đặt về mặc định?")) {
        resetFinalConfig(null);
        renderFinalSettingsTabs();
        renderFinalSettingsContent();
        renderFinalSidebarTabs();
        renderFinalSidebarTabContent(activeSidebarTab);
        syncFinalSidebarToggles();
        if (typeof recalculateAndRedrawFinal === "function") {
          recalculateAndRedrawFinal();
        }
      }
    });
  }
}

// ==================== SIDEBAR DRAWER CONTROLLER ====================

function openFinalSidebar() {
  const sidebar = document.getElementById("final-sidebar");
  const backdrop = document.getElementById("final-sidebar-backdrop");
  if (sidebar) sidebar.classList.add("open");
  if (backdrop) backdrop.classList.add("active");
  syncFinalSidebarToggles();
  renderFinalSidebarTabs();
  renderFinalSidebarTabContent(activeSidebarTab);
}

function closeFinalSidebar() {
  const sidebar = document.getElementById("final-sidebar");
  const backdrop = document.getElementById("final-sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");
}

function toggleFinalSidebar() {
  const sidebar = document.getElementById("final-sidebar");
  if (sidebar && sidebar.classList.contains("open")) {
    closeFinalSidebar();
  } else {
    openFinalSidebar();
  }
}

function syncFinalSidebarToggles() {
  const map = {
    "sb-qt-atr1": FINAL_CFG.atr1?.enabled,
    "sb-qt-atr2": FINAL_CFG.atr2?.enabled,
    "sb-qt-vsr1": FINAL_CFG.vsr1?.enabled,
    "sb-qt-vsr2": FINAL_CFG.vsr2?.enabled,
    "sb-qt-overlap": FINAL_CFG.vsrOverlap?.enabled,
    "sb-qt-zone": FINAL_CFG.zone?.enabled,
    "sb-qt-trend": FINAL_CFG.trend?.enabled,
    "sb-qt-smc": FINAL_CFG.smc?.enabled,
    "sb-qt-struct": FINAL_CFG.structural?.enabled,
    "sb-qt-strategy": FINAL_CFG.strategy?.enabled,
  };

  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  }
}

function renderFinalSidebarTabs() {
  const container = document.getElementById("final-sidebar-tab-pills");
  if (!container) return;

  container.innerHTML = FINAL_SETTINGS_TABS.map((t) => `
    <button class="sb-tab-btn ${t.id === activeSidebarTab ? "active" : ""}" data-sbtab="${t.id}">
      <span>${t.icon}</span> ${t.label.replace(/^[^\s]+\s/, "")}
    </button>
  `).join("");

  container.querySelectorAll(".sb-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeSidebarTab = btn.dataset.sbtab;
      renderFinalSidebarTabs();
      renderFinalSidebarTabContent(activeSidebarTab);
    });
  });
}

function renderFinalSidebarTabContent(tab = "atr1") {
  const container = document.getElementById("final-sidebar-tab-content");
  if (!container) return;

  const titleEl = document.getElementById("final-sidebar-right-title");
  const tabObj = FINAL_SETTINGS_TABS.find((t) => t.id === tab);
  if (titleEl && tabObj) {
    titleEl.innerHTML = `<span>${tabObj.icon} ${tabObj.label}</span>`;
  }

  let html = getFinalSettingsTabHtml(tab);
  html += `
    <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
      <button class="st-reset-btn" id="final-sidebar-reset-tab-btn" style="font-size: 11.5px; padding: 6px 14px;">🔄 Khôi phục mặc định tab này</button>
    </div>
  `;
  container.innerHTML = html;

  // Bind all inputs dynamically inside sidebar
  container.querySelectorAll("[data-path]").forEach((el) => {
    const p = el.dataset.path;
    if (el.type === "checkbox") bindFinalControl(el, p, "checkbox");
    else if (el.type === "number") bindFinalControl(el, p, "number");
    else if (el.type === "color") bindFinalControl(el, p, "color");
    else if (el.type === "range") {
      el.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        const lbl = el.parentElement.querySelector("b");
        if (lbl) lbl.textContent = val;
        setFinalNestedProperty(FINAL_CFG, p, val);
        saveFinalConfig();
        syncFinalSidebarToggles();
        if (typeof recalculateAndRedrawFinal === "function") {
          recalculateAndRedrawFinal();
        }
      });
    } else bindFinalControl(el, p, "text");
  });

  const resetTabBtn = document.getElementById("final-sidebar-reset-tab-btn");
  if (resetTabBtn) {
    resetTabBtn.addEventListener("click", () => {
      resetFinalConfig(tab);
      renderFinalSidebarTabContent(tab);
      renderFinalSettingsContent();
      syncFinalSidebarToggles();
      if (typeof recalculateAndRedrawFinal === "function") {
        recalculateAndRedrawFinal();
      }
    });
  }
}

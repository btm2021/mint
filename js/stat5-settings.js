// ============================================================
// stat5-settings.js — MODAL CÀI ĐẶT ĐA TAB CHO STAT5
// Tabs: ATRBot 1 · ATRBot 2 · VSR 1 · VSR 2 · VSR Overlap
//       · Supply & Demand · Chart / Dữ liệu
// ============================================================

const STAT5_MA_TYPE_OPTIONS = [
  ["ema", "EMA"], ["vwma", "VWMA"], ["lwma", "LWMA"], ["wma", "WMA"],
  ["hma", "HMA"], ["vwap", "VWAP (rolling)"], ["alma", "ALMA"], ["tema", "TEMA"],
  ["wwsma", "WWSMA"], ["zlema", "ZLEMA"], ["lsma", "LSMA"], ["kama", "KAMA"],
  ["vidya", "VIDYA"], ["smma", "SMMA"], ["mcginley", "McGinley"], ["swma", "SWMA"],
];

const STAT5_SOURCE_OPTIONS = [
  ["close", "Close"], ["open", "Open"], ["high", "High"], ["low", "Low"],
  ["hl2", "HL2 (H+L)/2"], ["hlc3", "HLC3 (H+L+C)/3"], ["ohlc4", "OHLC4 (O+H+L+C)/4"],
];

const STAT5_LINE_STYLE_OPTIONS = [
  ["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"],
];

let stat5ActiveSettingsTab = "atr1";

function stat5OpenSettingsModal(tab = "atr1") {
  stat5ActiveSettingsTab = tab;
  stat5RenderSettingsModal();
  const modal = document.getElementById("stat5-settings-modal");
  if (modal) modal.style.display = "flex";
}

function stat5CloseSettingsModal() {
  const modal = document.getElementById("stat5-settings-modal");
  if (modal) modal.style.display = "none";
}

function stat5SwitchSettingsTab(tabId) {
  stat5ActiveSettingsTab = tabId;
  stat5RenderSettingsModal();
}

function stat5RenderSettingsModal() {
  const container = document.getElementById("stat5-settings-content");
  const tabNav = document.getElementById("stat5-settings-tabs");
  if (!container || !tabNav) return;

  const tabs = [
    { id: "atr1", label: "ATRBot 1 (BIAS)" },
    { id: "atr2", label: "ATRBot 2 (ENTRY)" },
    { id: "vsr1", label: "VSR 1" },
    { id: "vsr2", label: "VSR 2" },
    { id: "vsrOverlap", label: "VSR Overlap" },
    { id: "snd", label: "Supply & Demand" },
    { id: "general", label: "Chart / Dữ liệu" },
  ];

  tabNav.innerHTML = tabs.map((t) => `
    <button class="settings-tab-btn ${t.id === stat5ActiveSettingsTab ? "active" : ""}" onclick="stat5SwitchSettingsTab('${t.id}')">
      ${t.label}
    </button>
  `).join("");

  const C = STAT5_CFG;
  const select = (label, path, options, val) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <select class="ctrl-select" data-path="${path}">
        ${options.map(([ov, ot]) => `<option value="${ov}" ${String(val) === String(ov) ? "selected" : ""}>${ot}</option>`).join("")}
      </select>
    </div>`;
  const num = (label, path, val, min = 0, max = 500, step = 1) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <input type="number" class="ctrl-num" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>`;
  const toggle = (label, path, checked) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <label class="switch">
        <input type="checkbox" data-path="${path}" ${checked ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>`;
  const color = (label, path, val) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label}</label>
      <div class="color-picker-wrap">
        <input type="color" class="ctrl-color" data-path="${path}" value="${val}" />
        <span class="color-code">${val}</span>
      </div>
    </div>`;
  const slider = (label, path, val, min = 0, max = 1, step = 0.01) => `
    <div class="ctrl-row">
      <label class="ctrl-label">${label} <span class="val-badge">${Math.round(val * 100)}%</span></label>
      <input type="range" class="ctrl-range" data-path="${path}" value="${val}" min="${min}" max="${max}" step="${step}" />
    </div>`;

  const atrBotSection = (prefix) => `
    <div class="panel-sec">
      <div class="panel-sec-header">Tham số Tính toán</div>
      ${toggle("Kích hoạt", `${prefix}.enabled`, C[prefix].enabled)}
      ${select("Nguồn giá (Source)", `${prefix}.source`, STAT5_SOURCE_OPTIONS, C[prefix].source)}
      ${select("Phương pháp MA (MA Type)", `${prefix}.maType`, STAT5_MA_TYPE_OPTIONS, C[prefix].maType)}
      ${num("Chu kỳ MA (MA Length)", `${prefix}.maLen`, C[prefix].maLen, 1, 500, 1)}
      ${num("Chu kỳ ATR (ATR Length)", `${prefix}.atrLen`, C[prefix].atrLen, 1, 500, 1)}
      ${num("Hệ số nhân (ATR Multiplier)", `${prefix}.mult`, C[prefix].mult, 0.1, 20, 0.1)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Đường Trail 1 (MA Line)</div>
      ${toggle("Hiện Trail 1", `${prefix}.showT1`, C[prefix].showT1)}
      ${color("Màu Trail 1", `${prefix}.t1Color`, C[prefix].t1Color)}
      ${num("Độ dày nét (px)", `${prefix}.t1Width`, C[prefix].t1Width, 0.5, 5, 0.5)}
      ${select("Kiểu nét", `${prefix}.t1Style`, STAT5_LINE_STYLE_OPTIONS, C[prefix].t1Style)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Đường Trail 2 (ATR Line)</div>
      ${toggle("Hiện Trail 2", `${prefix}.showT2`, C[prefix].showT2)}
      ${color("Màu Trail 2", `${prefix}.t2Color`, C[prefix].t2Color)}
      ${num("Độ dày nét (px)", `${prefix}.t2Width`, C[prefix].t2Width, 0.5, 5, 0.5)}
      ${select("Kiểu nét", `${prefix}.t2Style`, STAT5_LINE_STYLE_OPTIONS, C[prefix].t2Style)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Mây Vùng Đệm (Cloud Fill)</div>
      ${toggle("Hiện Mây Cloud", `${prefix}.showCloud`, C[prefix].showCloud)}
      ${color("Màu Bullish Up", `${prefix}.cloudUpColor`, C[prefix].cloudUpColor)}
      ${slider("Độ mờ Bullish", `${prefix}.cloudUpOpacity`, C[prefix].cloudUpOpacity)}
      ${color("Màu Bearish Down", `${prefix}.cloudDownColor`, C[prefix].cloudDownColor)}
      ${slider("Độ mờ Bearish", `${prefix}.cloudDownOpacity`, C[prefix].cloudDownOpacity)}
    </div>`;

  const vsrSection = (prefix) => `
    <div class="panel-sec">
      <div class="panel-sec-header">Tham số Tính toán</div>
      ${toggle("Kích hoạt", `${prefix}.enabled`, C[prefix].enabled)}
      ${num("Lookback Length", `${prefix}.len`, C[prefix].len, 1, 500, 1)}
      ${num("Ngưỡng StDev Volume (Threshold)", `${prefix}.thr`, C[prefix].thr, 0.1, 50, 0.5)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Đường Viền Trên (Upper)</div>
      ${toggle("Hiện Upper Line", `${prefix}.showUpper`, C[prefix].showUpper)}
      ${color("Màu Upper Line", `${prefix}.upperColor`, C[prefix].upperColor)}
      ${num("Độ dày nét", `${prefix}.upperWidth`, C[prefix].upperWidth, 0.5, 5, 0.5)}
      ${select("Kiểu nét", `${prefix}.upperStyle`, STAT5_LINE_STYLE_OPTIONS, C[prefix].upperStyle)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Đường Viền Dưới (Lower)</div>
      ${toggle("Hiện Lower Line", `${prefix}.showLower`, C[prefix].showLower)}
      ${color("Màu Lower Line", `${prefix}.lowerColor`, C[prefix].lowerColor)}
      ${num("Độ dày nét", `${prefix}.lowerWidth`, C[prefix].lowerWidth, 0.5, 5, 0.5)}
      ${select("Kiểu nét", `${prefix}.lowerStyle`, STAT5_LINE_STYLE_OPTIONS, C[prefix].lowerStyle)}
    </div>
    <div class="panel-sec">
      <div class="panel-sec-header">Màu Nền Vùng (Fill)</div>
      ${toggle("Hiện Nền", `${prefix}.showFill`, C[prefix].showFill)}
      ${color("Màu Nền", `${prefix}.fillColor`, C[prefix].fillColor)}
      ${slider("Độ mờ Nền", `${prefix}.fillOpacity`, C[prefix].fillOpacity)}
    </div>`;

  let html = "";
  if (stat5ActiveSettingsTab === "atr1") {
    html = atrBotSection("atr1");
  } else if (stat5ActiveSettingsTab === "atr2") {
    html = atrBotSection("atr2");
  } else if (stat5ActiveSettingsTab === "vsr1") {
    html = vsrSection("vsr1");
  } else if (stat5ActiveSettingsTab === "vsr2") {
    html = vsrSection("vsr2");
  } else if (stat5ActiveSettingsTab === "vsrOverlap") {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Vùng Chồng Lấn 2 VSR</div>
        ${toggle("Bật Vùng Chồng Lấn", "vsrOverlap.enabled", C.vsrOverlap.enabled)}
        ${toggle("Hiện Nền Chồng Lấn", "vsrOverlap.showFill", C.vsrOverlap.showFill)}
        ${color("Màu Nền Chồng Lấn", "vsrOverlap.fillColor", C.vsrOverlap.fillColor)}
        ${slider("Độ mờ Nền", "vsrOverlap.fillOpacity", C.vsrOverlap.fillOpacity)}
        ${toggle("Hiệu ứng Gạch chéo", "vsrOverlap.showHatch", C.vsrOverlap.showHatch)}
        ${toggle("Hiện Nhãn ⚡ OVERLAP", "vsrOverlap.showLabel", C.vsrOverlap.showLabel)}
      </div>
      <div class="panel-sec">
        <div class="panel-sec-header">Đường Viền Vùng Chồng Lấn</div>
        ${toggle("Hiện Viền Trên", "vsrOverlap.showUpper", C.vsrOverlap.showUpper)}
        ${color("Màu Viền Trên", "vsrOverlap.upperColor", C.vsrOverlap.upperColor)}
        ${num("Độ dày nét", "vsrOverlap.upperWidth", C.vsrOverlap.upperWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsrOverlap.upperStyle", STAT5_LINE_STYLE_OPTIONS, C.vsrOverlap.upperStyle)}
        ${toggle("Hiện Viền Dưới", "vsrOverlap.showLower", C.vsrOverlap.showLower)}
        ${color("Màu Viền Dưới", "vsrOverlap.lowerColor", C.vsrOverlap.lowerColor)}
        ${num("Độ dày nét", "vsrOverlap.lowerWidth", C.vsrOverlap.lowerWidth, 0.5, 5, 0.5)}
        ${select("Kiểu nét", "vsrOverlap.lowerStyle", STAT5_LINE_STYLE_OPTIONS, C.vsrOverlap.lowerStyle)}
      </div>`;
  } else if (stat5ActiveSettingsTab === "snd") {
    const formations = C.snd.formations;
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Thuật toán Supply &amp; Demand (ForexFlow)</div>
        ${toggle("Bật S&amp;D Zones", "snd.enabled", C.snd.enabled)}
        <div class="ctrl-row">
          <label class="ctrl-label">Preset</label>
          <select class="ctrl-select" data-path="snd.preset">
            <option value="conservative" ${C.snd.preset === "conservative" ? "selected" : ""}>Conservative</option>
            <option value="standard" ${C.snd.preset === "standard" ? "selected" : ""}>Standard</option>
            <option value="aggressive" ${C.snd.preset === "aggressive" ? "selected" : ""}>Aggressive</option>
          </select>
        </div>
        ${num("Điểm tối thiểu (Min Score)", "snd.minScore", C.snd.minScore, 0, 100, 1)}
        ${num("Max Base Width (×ATR)", "snd.maxBaseWidthAtr", C.snd.maxBaseWidthAtr, 0.5, 3, 0.1)}
      </div>
      <div class="panel-sec">
        <div class="panel-sec-header">Formation</div>
        ${toggle("RBR (Demand)", "snd.formations.RBR", formations.RBR)}
        ${toggle("DBD (Supply)", "snd.formations.DBD", formations.DBD)}
        ${toggle("RBD (Supply)", "snd.formations.RBD", formations.RBD)}
        ${toggle("DBR (Demand)", "snd.formations.DBR", formations.DBR)}
      </div>
      <div class="panel-sec">
        <div class="panel-sec-header">Hiển thị &amp; Debug</div>
        ${toggle("Hiện Zone Tested", "snd.showTested", C.snd.showTested)}
        ${toggle("Hiện Zone Invalidated", "snd.showInvalidated", C.snd.showInvalidated)}
        ${toggle("Chế độ DEBUG (log + markers)", "snd.debug", C.snd.debug)}
      </div>`;
  } else {
    html = `
      <div class="panel-sec">
        <div class="panel-sec-header">Cài Đặt Dữ Liệu &amp; Biểu Đồ</div>
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
          <button class="btn-secondary" onclick="stat5ResetTab('${stat5ActiveSettingsTab}')">Reset Tab Hiện Tại</button>
          <button class="btn-danger" onclick="stat5ResetAll()">Reset Toàn Bộ</button>
        </div>
      </div>`;
  }

  container.innerHTML = html;
  stat5BindSettingInputs(container);
}

function stat5BindSettingInputs(container) {
  container.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", (e) => {
      const path = e.target.dataset.path;
      if (!path) return;
      let val;
      if (e.target.type === "checkbox") val = e.target.checked;
      else if (e.target.type === "number" || e.target.type === "range") val = parseFloat(e.target.value);
      else val = e.target.value;

      stat5SetNestedProperty(STAT5_CFG, path, val);

      if (e.target.type === "color") {
        const codeEl = e.target.nextElementSibling;
        if (codeEl) codeEl.textContent = val;
      }
      if (e.target.type === "range") {
        const badgeEl = e.target.parentElement.querySelector(".val-badge");
        if (badgeEl) badgeEl.textContent = `${Math.round(val * 100)}%`;
      }

      stat5SaveConfig();
      stat5RecalculateAndRedraw();
    });
  });
}

function stat5ResetTab(tab) {
  const map = { atr1: "atr1", atr2: "atr2", vsr1: "vsr1", vsr2: "vsr2", vsrOverlap: "vsrOverlap", snd: "snd", general: null };
  if (map[tab] === null) return;
  if (confirm(`Khôi phục mặc định cho tab ${tab}?`)) {
    stat5ResetConfig(map[tab]);
    stat5RenderSettingsModal();
    stat5RecalculateAndRedraw();
  }
}

function stat5ResetAll() {
  if (confirm("Khôi phục toàn bộ cài đặt Stat5 về mặc định?")) {
    stat5ResetConfig(null);
    stat5RenderSettingsModal();
    stat5RecalculateAndRedraw();
  }
}
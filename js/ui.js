function setLoadingText(msg) {
  const el = document.getElementById("loading-text");
  if (el) el.textContent = msg;
}

function hideLoadingScreen() {
  const screen = document.getElementById("loading-screen");
  if (screen) screen.classList.add("hidden");
}

function getCachedSymbolsList() {
  const cached = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith("_DB_v6")) {
      const parts = key.split("_");
      if (parts.length >= 3) cached.add(parts[0]);
    }
  }
  return cached;
}

function getStartSymbol() {
  const last = localStorage.getItem("stat1_lastSymbol");
  if (last) return last;
  const cachedSet = getCachedSymbolsList();
  if (cachedSet.size > 0) return Array.from(cachedSet)[0];
  return "BTCUSDT";
}

function setupSymbolSearchOld() {
  const input = document.getElementById("symbol-input");
  const dropdown = document.getElementById("symbol-dropdown");
  const cachedSet = getCachedSymbolsList();

  function renderDropdown(query) {
    const q = query.trim().toUpperCase();
    let filtered = q ? allSymbols.filter((s) => s.includes(q)) : [...allSymbols];

    filtered.sort((a, b) => {
      const aC = cachedSet.has(a) ? 0 : 1;
      const bC = cachedSet.has(b) ? 0 : 1;
      return aC - bC || a.localeCompare(b);
    });

    const top = filtered.slice(0, 60);
    if (top.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px 14px;color:#555;font-size:12px;">No results</div>`;
      dropdown.classList.add("open");
      return;
    }

    let html = "";
    let hasCachedSection = false;
    let hasOthersSection = false;

    for (const sym of top) {
      const isCached = cachedSet.has(sym);
      if (isCached && !hasCachedSection) {
        html += `<div class="sym-group-label">⚡ Cached</div>`;
        hasCachedSection = true;
      }
      if (!isCached && !hasOthersSection) {
        html += `<div class="sym-group-label">All Symbols</div>`;
        hasOthersSection = true;
      }
      const badge = isCached ? `<span class="sym-badge cached">CACHED</span>` : ``;
      html += `<div class="sym-item" data-sym="${sym}">
            <span class="sym-name">${sym}</span>${badge}
          </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.classList.add("open");

    dropdown.querySelectorAll(".sym-item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const sym = el.dataset.sym;
        selectSymbol(sym);
      });
    });
  }

  input.addEventListener("focus", () => renderDropdown(input.value));
  input.addEventListener("input", () => renderDropdown(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dropdown.classList.remove("open");
      input.blur();
    }
    if (e.key === "Enter") {
      const q = input.value.trim().toUpperCase();
      if (allSymbols.includes(q)) selectSymbol(q);
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#symbol-search-wrapper")) {
      dropdown.classList.remove("open");
    }
  });
}

function setupSymbolSearch() {
  const input = document.getElementById("symbol-input");
  const modal = document.getElementById("symbol-modal");
  const modalInput = document.getElementById("symbol-modal-input");
  const results = document.getElementById("symbol-modal-results");
  const cachedOnly = document.getElementById("symbol-filter-cached");
  const resultCount = document.getElementById("symbol-result-count");
  const closeBtn = document.getElementById("symbol-modal-close");
  let selectedIndex = 0;

  function renderResults(query) {
    const cachedSet = getCachedSymbolsList();
    const q = query.trim().toUpperCase();
    let filtered = q ? allSymbols.filter((s) => s.includes(q)) : [...allSymbols];
    if (cachedOnly.checked) filtered = filtered.filter((s) => cachedSet.has(s));
    filtered.sort((a, b) => (cachedSet.has(a) === cachedSet.has(b) ? a.localeCompare(b) : cachedSet.has(a) ? -1 : 1));

    const top = filtered.slice(0, 100);
    selectedIndex = Math.min(selectedIndex, Math.max(0, top.length - 1));
    resultCount.textContent = `${filtered.length.toLocaleString()} markets`;
    results.innerHTML = top.length ? top.map((sym, index) => {
      const badge = cachedSet.has(sym) ? `<span class="sym-badge cached">CACHED</span>` : "";
      return `<button class="symbol-result${index === selectedIndex ? " active" : ""}" type="button" data-sym="${sym}" data-index="${index}"><span class="sym-name">${sym}</span>${badge}</button>`;
    }).join("") : `<div class="symbol-empty">No matching markets</div>`;

    results.querySelectorAll(".symbol-result").forEach((el) => {
      el.addEventListener("click", () => selectSymbol(el.dataset.sym));
    });
  }

  function openModal(seed = input.value) {
    modalInput.value = seed;
    selectedIndex = 0;
    renderResults(seed);
    modal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modalInput.focus());
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  input.addEventListener("click", () => openModal(input.value));
  input.addEventListener("focus", () => openModal(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); openModal(input.value); }
  });
  modalInput.addEventListener("input", () => { selectedIndex = 0; renderResults(modalInput.value); });
  cachedOnly.addEventListener("change", () => { selectedIndex = 0; renderResults(modalInput.value); });
  modalInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const options = results.querySelectorAll(".symbol-result");
      if (!options.length) return;
      e.preventDefault();
      selectedIndex = (selectedIndex + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      renderResults(modalInput.value);
      results.querySelector(`.symbol-result[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const selected = results.querySelector(`.symbol-result[data-index="${selectedIndex}"]`);
      if (selected) selectSymbol(selected.dataset.sym);
    }
  });
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
}

async function selectSymbol(sym) {
  if (!sym || sym === SYMBOL) {
    document.getElementById("symbol-modal").hidden = true;
    document.body.classList.remove("modal-open");
    return;
  }
  SYMBOL = sym;
  document.getElementById("symbol-input").value = sym;
  document.getElementById("symbol-modal").hidden = true;
  document.body.classList.remove("modal-open");
  localStorage.setItem("stat1_lastSymbol", sym);

  setStatus("loading", `Loading ${sym}...`);
  if (window._tickerWS) {
    window._tickerWS.close();
    window._tickerWS = null;
  }
  await loadSymbol();
  setupTickerWS(sym);
  setupRealtimeWS();
}

function getPriceFormat(priceValue) {
  if (!priceValue || priceValue <= 0) return { precision: 4, minMove: 0.0001 };
  if (priceValue >= 10000) return { precision: 1, minMove: 0.1 };
  if (priceValue >= 1000) return { precision: 2, minMove: 0.01 };
  if (priceValue >= 100) return { precision: 3, minMove: 0.001 };
  return { precision: 4, minMove: 0.0001 };
}

function applyPriceFormat(bars) {
  if (!bars || bars.length === 0) return;
  const lastPrice = bars[bars.length - 1].close;
  const { precision, minMove } = getPriceFormat(lastPrice);
  const fmt = { type: "price", precision, minMove };
  [candleSeries, t1Series, t2Series, t1Series2, t2Series2, vwapSeries].forEach((s) => {
    if (s) s.applyOptions({ priceFormat: fmt });
  });
}

function setStatus(type, text) {
  const el = document.getElementById("status");
  if (type === "loading") {
    el.innerHTML = `<div class="status-loading-spin"></div><span>${text}</span>`;
  } else if (type === "ready") {
    el.innerHTML = `<div class="status-dot"></div><span class="sym-tag">${SYMBOL}</span><span class="intv-tag">${INTERVAL}</span><span class="bars-tag">${text}</span>`;
  } else if (type === "error") {
    el.innerHTML = `<span style="color:var(--danger-color)">${text}</span>`;
  } else {
    el.innerHTML = `<span style="color:#3a4255">${text}</span>`;
  }
}

function setupIntervalPills() {
  const savedInterval = localStorage.getItem("stat1_interval");
  if (savedInterval) INTERVAL = savedInterval;
  const pills = document.querySelectorAll(".iv-btn");
  pills.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.iv === INTERVAL);
  });
  const revealActiveInterval = () => document.querySelector(".iv-btn.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  requestAnimationFrame(revealActiveInterval);
  pills.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const iv = btn.dataset.iv;
      if (iv === INTERVAL) return;
      INTERVAL = iv;
      localStorage.setItem("stat1_interval", iv);
      pills.forEach((b) => b.classList.toggle("active", b.dataset.iv === iv));
      revealActiveInterval();
      if (SYMBOL) {
        setStatus("loading", `Loading ${SYMBOL} ${iv}...`);
        await loadSymbol();
        setupRealtimeWS();
      }
    });
  });
}

function setupSettingsPanel() {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings-panel");
  const closeBtn = document.getElementById("settings-close");
  function togglePanel(force) {
    const isOpen = force !== undefined ? force : !panel.classList.contains("open");
    panel.classList.toggle("open", isOpen);
    btn.classList.toggle("active", isOpen);
    if (isOpen) {
      document.getElementById("cache-panel").classList.remove("open");
      document.getElementById("cache-btn").classList.remove("active");
    }
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  closeBtn.addEventListener("click", () => togglePanel(false));
  document.addEventListener("click", (e) => {
    if (e.target.closest("#indicator-config-modal")) return;
    if (!e.target.closest("#settings-panel") && !e.target.closest("#settings-btn")) togglePanel(false);
  });
}

function setupChartSettingsOld() {
  const fields = {
    atrLength: document.getElementById("setting-atr-length"),
    emaLength: document.getElementById("setting-ema-length"),
    atrMultiplier: document.getElementById("setting-atr-multiplier"),
    barLimit: document.getElementById("setting-bar-limit"),
  };
  fields.atrLength.value = ATR_LENGTH;
  fields.emaLength.value = EMA_LENGTH;
  fields.atrMultiplier.value = ATR_MULT;
  fields.barLimit.value = LIMIT;

  function readField(field, current, min, max, integer = true) {
    const value = Number(field.value);
    if (!Number.isFinite(value) || value < min || value > max) {
      field.value = current;
      return current;
    }
    const result = integer ? Math.round(value) : value;
    field.value = result;
    return result;
  }

  async function applySettings() {
    const nextAtrLength = readField(fields.atrLength, ATR_LENGTH, 1, 500);
    const nextEmaLength = readField(fields.emaLength, EMA_LENGTH, 1, 500);
    const nextMultiplier = readField(fields.atrMultiplier, ATR_MULT, 0.001, 100, false);
    const nextBarLimit = readField(fields.barLimit, LIMIT, MIN_BAR_LIMIT, MAX_BAR_LIMIT);
    const changed = nextAtrLength !== ATR_LENGTH || nextEmaLength !== EMA_LENGTH || nextMultiplier !== ATR_MULT || nextBarLimit !== LIMIT;
    ATR_LENGTH = nextAtrLength;
    EMA_LENGTH = nextEmaLength;
    ATR_MULT = nextMultiplier;
    LIMIT = nextBarLimit;
    localStorage.setItem("stat1_atrLength", ATR_LENGTH);
    localStorage.setItem("stat1_emaLength", EMA_LENGTH);
    localStorage.setItem("stat1_atrMultiplier", ATR_MULT);
    localStorage.setItem("stat1_barLimit", LIMIT);
    if (changed && SYMBOL) {
      setStatus("loading", `Applying settings to ${SYMBOL}...`);
      await loadSymbol();
    }
  }

  document.getElementById("apply-chart-settings").addEventListener("click", applySettings);
  Object.values(fields).forEach((field) => field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applySettings();
  }));
}

function setupIndicatorSettings() {
  const modal = document.getElementById("indicator-config-modal");
  const title = document.getElementById("indicator-config-title");
  const form = document.getElementById("indicator-config-form");
  const closeBtn = document.getElementById("indicator-config-close");
  const cancelBtn = document.getElementById("indicator-config-cancel");
  const applyBtn = document.getElementById("indicator-config-apply");
  let currentIndicator = null;
  const maTypeOptions = [
    ["ema", "EMA"], ["vwma", "VWMA"], ["lwma", "LWMA"], ["wma", "WMA"],
    ["hma", "HMA"], ["vwap", "VWAP (rolling)"], ["alma", "ALMA"], ["tema", "TEMA"],
    ["wwsma", "WWSMA"], ["zlema", "ZLEMA"], ["lsma", "LSMA"], ["kama", "KAMA"],
    ["vidya", "VIDYA"], ["smma", "SMMA"], ["mcginley", "McGinley"], ["swma", "SWMA"],
  ];
  const sourceOptions = [["open", "Open"], ["high", "High"], ["low", "Low"], ["close", "Close"], ["hl2", "HL2"], ["hlc3", "HLC3"], ["ohlc4", "OHLC4"]];

  // Xây danh sách field cho strategy đang active — từ defaults + colors
  function strategyFields() {
    const def = STRATEGY.current;
    if (!def) return [];
    const c = () => STRAT_CFG || def.defaults;
    const showBase = def.defaults.showBaseFields !== false; // SMC tắt field ATRBot chung
    const base = showBase ? [
      ...(def.defaults.mode ? [{ key: "mode", label: "Entry mode", type: "select", options: [["V2", "V2 - market tai close cf"], ["V7", "V7 - cho pullback EMA20"]], value: () => c().mode }] : []),
      { key: "slowAtr", label: "ATR chậm (BIAS) — length", type: "number", min: 1, max: 500, step: 1, value: () => c().slow.atrLen },
      { key: "slowMult", label: "ATR chậm — multiplier", type: "number", min: 0.1, max: 10, step: 0.1, value: () => c().slow.mult },
      { key: "slowMa", label: "ATR chậm — MA length", type: "number", min: 1, max: 500, step: 1, value: () => c().slow.maLen },
      { key: "fastAtr", label: "ATR nhanh (ENTRY) — length", type: "number", min: 1, max: 500, step: 1, value: () => c().fast.atrLen },
      { key: "fastMult", label: "ATR nhanh — multiplier", type: "number", min: 0.1, max: 10, step: 0.1, value: () => c().fast.mult },
      { key: "fastMa", label: "ATR nhanh — MA length", type: "number", min: 1, max: 500, step: 1, value: () => c().fast.maLen },
      { key: "vsrLen", label: "VSR 1 — length", type: "number", min: 1, max: 500, step: 1, value: () => c().vsrLen },
      { key: "vsrThr", label: "VSR 1 — threshold", type: "number", min: 1, max: 20, step: 0.1, value: () => c().vsrThr },
      { key: "vsr2Len", label: "VSR 2 — length", type: "number", min: 0, max: 500, step: 1, value: () => c().vsr2Len },
      { key: "vsr2Thr", label: "VSR 2 — threshold", type: "number", min: 1, max: 20, step: 0.1, value: () => c().vsr2Thr },
      { key: "showVsr2", label: "Hiện VSR 2", type: "select", options: [["0", "Off"], ["1", "On"]], value: () => String(c().showVsr2 ? 1 : 0) },
      { key: "emaLen", label: "EMA length", type: "number", min: 0, max: 500, step: 1, value: () => c().emaLen },
      { key: "showEma", label: "Hiện EMA", type: "select", options: [["0", "Off"], ["1", "On"]], value: () => String(c().showEma ? 1 : 0) },
      ...(def.defaults.wConfirm ? [{ key: "wConfirm", label: "Confirm window", type: "number", min: 2, max: 30, step: 1, value: () => c().wConfirm }] : []),
      ...(def.defaults.maxCycleAge ? [{ key: "maxCycleAge", label: "Max cycle age", type: "number", min: 1, max: 10, step: 1, value: () => c().maxCycleAge }] : []),
      ...(def.defaults.maxPullATR ? [{ key: "maxPullATR", label: "Max pull depth (×ATR)", type: "number", min: 0, max: 2, step: 0.05, value: () => c().maxPullATR }] : []),
      { key: "tp1", label: "TP1 (%)", type: "number", min: 0.1, max: 50, step: 0.5, value: () => c().tp1 },
      { key: "frac1", label: "TP1 fraction", type: "number", min: 0.1, max: 1, step: 0.01, value: () => c().frac1 },
      { key: "tp2", label: "TP2 (%)", type: "number", min: 0, max: 50, step: 0.5, value: () => c().tp2 },
      { key: "sl1", label: "SL (%)", type: "number", min: 0.1, max: 20, step: 0.5, value: () => c().sl1 },
      { key: "feePct", label: "Cost (%/round-trip)", type: "number", min: 0, max: 1, step: 0.01, value: () => c().feePct },
      ...(def.defaults.strict !== undefined ? [{ key: "strict", label: "Strict filters (vol>=0.8, ATR>=0.3%)", type: "select", options: [["0", "Off"], ["1", "On"]], value: () => String(c().strict ? 1 : 0) }] : []),
      { key: "cVsr1", label: "Màu VSR 1", type: "color", value: () => c().colors.vsr1 },
      { key: "cVsr2", label: "Màu VSR 2", type: "color", value: () => c().colors.vsr2 },
      { key: "cSlowUp", label: "Màu ATR chậm UP", type: "color", value: () => c().colors.slowUp },
      { key: "cSlowDown", label: "Màu ATR chậm DOWN", type: "color", value: () => c().colors.slowDown },
      { key: "cFastUp", label: "Màu ATR nhanh UP", type: "color", value: () => c().colors.fastUp },
      { key: "cFastDown", label: "Màu ATR nhanh DOWN", type: "color", value: () => c().colors.fastDown },
      { key: "cEma", label: "Màu EMA", type: "color", value: () => c().colors.ema },
      { key: "cEntry", label: "Màu ENTRY", type: "color", value: () => c().colors.entry },
      { key: "cSl", label: "Màu SL", type: "color", value: () => c().colors.sl },
      { key: "cTp1", label: "Màu TP1", type: "color", value: () => c().colors.tp1 },
      { key: "cTp2", label: "Màu TP2", type: "color", value: () => c().colors.tp2 },
    ] : [];
    const fields = [
      ...base,
      // ---- Stat Original hiển thị ----
      ...(def.defaults.showBiasCloud !== undefined ? [
        { key: "showBiasCloud", label: "Cloud ATRBot BIAS", type: "select", options: [["1", "On"], ["0", "Off"]], value: () => String(c().showBiasCloud ? 1 : 0) },
        { key: "showEntryCloud", label: "Cloud ATRBot ENTRY", type: "select", options: [["1", "On"], ["0", "Off"]], value: () => String(c().showEntryCloud ? 1 : 0) },
        { key: "showVsr", label: "VSR zones", type: "select", options: [["1", "On"], ["0", "Off"]], value: () => String(c().showVsr ? 1 : 0) },
        { key: "showEntries", label: "Điểm vào lệnh (flip)", type: "select", options: [["1", "On"], ["0", "Off"]], value: () => String(c().showEntries ? 1 : 0) },
      ] : []),
    ];
    return fields;
  }

  const configs = {
    atr1: { title: "ATR Bot 1", fields: [
      { key: "source", label: "Source", type: "select", options: sourceOptions, value: () => ATR_SOURCE },
      { key: "maType", label: "MA type", type: "select", options: maTypeOptions, value: () => MA_TYPE },
      { key: "atrLength", label: "ATR length", type: "number", min: 1, max: 500, step: 1, value: () => ATR_LENGTH },
      { key: "emaLength", label: "MA length", type: "number", min: 1, max: 500, step: 1, value: () => EMA_LENGTH },
      { key: "multiplier", label: "Multiplier", type: "number", min: 0.1, max: 10, step: 0.1, value: () => ATR_MULT },
    ] },
    atr2: { title: "ATR Bot 2", fields: [
      { key: "source", label: "Source", type: "select", options: sourceOptions, value: () => ATR2_SOURCE },
      { key: "maType", label: "MA type", type: "select", options: maTypeOptions, value: () => ATR2_MA_TYPE },
      { key: "atrLength", label: "ATR length", type: "number", min: 1, max: 500, step: 1, value: () => ATR2_LENGTH },
      { key: "emaLength", label: "MA length", type: "number", min: 1, max: 500, step: 1, value: () => ATR2_EMA_LENGTH },
      { key: "multiplier", label: "Multiplier", type: "number", min: 0.1, max: 10, step: 0.1, value: () => ATR2_MULT },
    ] },
    vsr: { title: "VSR Zones", fields: [
      { key: "length", label: "Lookback length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_LENGTH },
      { key: "threshold", label: "Threshold", type: "number", min: 1, max: 20, step: 0.1, value: () => VSR_THRESHOLD },
    ] },
    vsrDual: { title: "VSR Dual Zones", fields: [
      { key: "vsr1Length", label: "VSR 1 length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_1_LENGTH },
      { key: "vsr1Threshold", label: "VSR 1 threshold", type: "number", min: 1, max: 20, step: 0.1, value: () => VSR_DUAL_1_THRESHOLD },
      { key: "vsr2Length", label: "VSR 2 length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_2_LENGTH },
      { key: "vsr2Threshold", label: "VSR 2 threshold", type: "number", min: 1, max: 20, step: 0.1, value: () => VSR_DUAL_2_THRESHOLD },
      { key: "emaLength", label: "Price EMA length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_EMA_LENGTH },
      { key: "vidyaLength", label: "Price VIDYA length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_VIDYA_LENGTH },
      { key: "cmoLength", label: "VIDYA CMO length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_CMO_LENGTH },
      { key: "vwapLength", label: "Price VWAP length", type: "number", min: 1, max: 500, step: 1, value: () => VSR_DUAL_VWAP_LENGTH },
    ] },
    vp: { title: "Volume Profile", fields: [
      { key: "rows", label: "Price rows", type: "number", min: 4, max: 200, step: 1, value: () => NUM_ROWS },
      { key: "valueArea", label: "Value area (%)", type: "number", min: 1, max: 100, step: 1, value: () => VA_PCT },
    ] },
    vwap: { title: "VWAP", fields: [
      { key: "anchor", label: "Reset anchor", type: "select", options: [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]], value: () => VWAP_ANCHOR },
    ] },
    statOriginal: { title: "Stat Original", fields: strategyFields() },
    chartData: { title: "Chart data", fields: [
      { key: "barLimit", label: "Stored candles", type: "number", min: MIN_BAR_LIMIT, max: MAX_BAR_LIMIT, step: 500, value: () => LIMIT },
    ] },
  };

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    currentIndicator = null;
  }

  function openModal(indicator) {
    const config = configs[indicator];
    if (!config) return;
    currentIndicator = indicator;
    title.textContent = config.title;
    form.innerHTML = config.fields.map((field) => {
      if (field.type === "select") {
        return `<label>${field.label}<select name="${field.key}">${field.options.map(([value, label]) => `<option value="${value}"${value === field.value() ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
      }
      if (field.type === "color") {
        return `<label class="color-field">${field.label}<input name="${field.key}" type="color" value="${field.value()}" /></label>`;
      }
      return `<label>${field.label}<input name="${field.key}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.value()}" required /></label>`;
    }).join("");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => form.querySelector("input, select")?.focus());
  }

  function numberValue(key, min, max, integer = true) {
    const value = Number(new FormData(form).get(key));
    if (!Number.isFinite(value) || value < min || value > max) return null;
    return integer ? Math.round(value) : value;
  }

  async function applySettings() {
    if (!currentIndicator) return;
    const appliedConfig = configs[currentIndicator];
    if (currentIndicator === "atr1") {
      const atr = numberValue("atrLength", 1, 500), ema = numberValue("emaLength", 1, 500), mult = numberValue("multiplier", 0.1, 10, false);
      if (atr === null || ema === null || mult === null) return;
      const formData = new FormData(form);
      MA_TYPE = ATR_MA_TYPES.includes(formData.get("maType")) ? formData.get("maType") : "ema";
      ATR_SOURCE = ATR_SOURCES.includes(formData.get("source")) ? formData.get("source") : "close";
      ATR_LENGTH = atr; EMA_LENGTH = ema; ATR_MULT = mult;
      localStorage.setItem("stat1_atrMaType", MA_TYPE); localStorage.setItem("stat1_atrSource", ATR_SOURCE); localStorage.setItem("stat1_atrLength", atr); localStorage.setItem("stat1_emaLength", ema); localStorage.setItem("stat1_atrMultiplier", mult);
    } else if (currentIndicator === "atr2") {
      const atr = numberValue("atrLength", 1, 500), ema = numberValue("emaLength", 1, 500), mult = numberValue("multiplier", 0.1, 10, false);
      if (atr === null || ema === null || mult === null) return;
      const formData = new FormData(form);
      ATR2_MA_TYPE = ATR_MA_TYPES.includes(formData.get("maType")) ? formData.get("maType") : "ema";
      ATR2_SOURCE = ATR_SOURCES.includes(formData.get("source")) ? formData.get("source") : "close";
      ATR2_LENGTH = atr; ATR2_EMA_LENGTH = ema; ATR2_MULT = mult;
      localStorage.setItem("stat1_atr2MaType", ATR2_MA_TYPE); localStorage.setItem("stat1_atr2Source", ATR2_SOURCE); localStorage.setItem("stat1_atr2Length", atr); localStorage.setItem("stat1_atr2EmaLength", ema); localStorage.setItem("stat1_atr2Multiplier", mult);
    } else if (currentIndicator === "vsr") {
      const length = numberValue("length", 1, 500), threshold = numberValue("threshold", 1, 20, false);
      if (length === null || threshold === null) return;
      VSR_LENGTH = length; VSR_THRESHOLD = threshold;
      localStorage.setItem("stat1_vsrLength", length); localStorage.setItem("stat1_vsrThreshold", threshold);
    } else if (currentIndicator === "vsrDual") {
      const vsr1Length = numberValue("vsr1Length", 1, 500), vsr1Threshold = numberValue("vsr1Threshold", 1, 20, false);
      const vsr2Length = numberValue("vsr2Length", 1, 500), vsr2Threshold = numberValue("vsr2Threshold", 1, 20, false);
      const emaLength = numberValue("emaLength", 1, 500), vidyaLength = numberValue("vidyaLength", 1, 500);
      const cmoLength = numberValue("cmoLength", 1, 500), vwapLength = numberValue("vwapLength", 1, 500);
      if ([vsr1Length, vsr1Threshold, vsr2Length, vsr2Threshold, emaLength, vidyaLength, cmoLength, vwapLength].some((value) => value === null)) return;
      VSR_DUAL_1_LENGTH = vsr1Length; VSR_DUAL_1_THRESHOLD = vsr1Threshold;
      VSR_DUAL_2_LENGTH = vsr2Length; VSR_DUAL_2_THRESHOLD = vsr2Threshold;
      VSR_DUAL_EMA_LENGTH = emaLength; VSR_DUAL_VIDYA_LENGTH = vidyaLength;
      VSR_DUAL_CMO_LENGTH = cmoLength; VSR_DUAL_VWAP_LENGTH = vwapLength;
      localStorage.setItem("stat1_vsrDual1Length", vsr1Length); localStorage.setItem("stat1_vsrDual1Threshold", vsr1Threshold);
      localStorage.setItem("stat1_vsrDual2Length", vsr2Length); localStorage.setItem("stat1_vsrDual2Threshold", vsr2Threshold);
      localStorage.setItem("stat1_vsrDualEmaLength", emaLength); localStorage.setItem("stat1_vsrDualVidyaLength", vidyaLength);
      localStorage.setItem("stat1_vsrDualCmoLength", cmoLength); localStorage.setItem("stat1_vsrDualVwapLength", vwapLength);
    } else if (currentIndicator === "vp") {
      const rows = numberValue("rows", 4, 200), valueArea = numberValue("valueArea", 1, 100);
      if (rows === null || valueArea === null) return;
      NUM_ROWS = rows; VA_PCT = valueArea;
      localStorage.setItem("stat1_vpRows", rows); localStorage.setItem("stat1_vpValueArea", valueArea);
    } else if (currentIndicator === "vwap") {
      VWAP_ANCHOR = new FormData(form).get("anchor");
      localStorage.setItem("stat1_vwapAnchor", VWAP_ANCHOR);
    } else if (currentIndicator === "statOriginal") {
      const fd = new FormData(form);
      const num = (key, min, max) => numberValue(key, min, max, false);
      const vals = {
        slow: {
          atrLen: num("slowAtr", 1, 500),
          mult: num("slowMult", 0.1, 10),
          maLen: num("slowMa", 1, 500),
        },
        fast: {
          atrLen: num("fastAtr", 1, 500),
          mult: num("fastMult", 0.1, 10),
          maLen: num("fastMa", 1, 500),
        },
        vsrLen: num("vsrLen", 1, 500),
        vsrThr: num("vsrThr", 1, 20),
        vsr2Len: num("vsr2Len", 0, 500),
        vsr2Thr: num("vsr2Thr", 1, 20),
        emaLen: num("emaLen", 0, 500),
        tp1: num("tp1", 0.1, 50),
        frac1: num("frac1", 0.1, 1),
        tp2: num("tp2", 0, 50),
        sl1: num("sl1", 0.1, 20),
        feePct: num("feePct", 0, 1),
      };
      if ([vals.slow.atrLen, vals.slow.mult, vals.slow.maLen, vals.fast.atrLen, vals.fast.mult, vals.fast.maLen,
        vals.vsrLen, vals.vsrThr, vals.vsr2Len, vals.vsr2Thr, vals.emaLen, vals.tp1, vals.frac1, vals.tp2, vals.sl1, vals.feePct].some((v) => v === null)) return;
      STRAT_CFG.slow = { ...STRAT_CFG.slow, ...vals.slow };
      STRAT_CFG.fast = { ...STRAT_CFG.fast, ...vals.fast };
      STRAT_CFG.vsrLen = vals.vsrLen; STRAT_CFG.vsrThr = vals.vsrThr;
      STRAT_CFG.vsr2Len = vals.vsr2Len; STRAT_CFG.vsr2Thr = vals.vsr2Thr;
      STRAT_CFG.emaLen = vals.emaLen;
      STRAT_CFG.tp1 = vals.tp1; STRAT_CFG.frac1 = vals.frac1; STRAT_CFG.tp2 = vals.tp2; STRAT_CFG.sl1 = vals.sl1;
      STRAT_CFG.feePct = vals.feePct;
      STRAT_CFG.showVsr2 = fd.get("showVsr2") === "1";
      STRAT_CFG.showEma = fd.get("showEma") === "1";
      const colorMap = { cVsr1: "vsr1", cVsr2: "vsr2", cSlowUp: "slowUp", cSlowDown: "slowDown", cFastUp: "fastUp", cFastDown: "fastDown", cEma: "ema", cEntry: "entry", cSl: "sl", cTp1: "tp1", cTp2: "tp2" };
      for (const [key, prop] of Object.entries(colorMap)) {
        const v = fd.get(key);
        if (/^#[0-9a-fA-F]{6}$/.test(v)) STRAT_CFG.colors[prop] = v;
      }
      saveStrategyCfg();
    } else if (currentIndicator === "chartData") {
      const barLimit = numberValue("barLimit", MIN_BAR_LIMIT, MAX_BAR_LIMIT);
      if (barLimit === null) return;
      LIMIT = barLimit;
      localStorage.setItem("stat1_barLimit", barLimit);
    }
    drawnVpRects.forEach((item) => { delete item.vp; delete item.vpCache; });
    closeModal();
    if (SYMBOL) {
      setStatus("loading", `Applying ${appliedConfig.title}...`);
      await loadSymbol();
    }
  }

  document.querySelectorAll(".indicator-settings-btn[data-indicator]").forEach((button) => {
    button.addEventListener("click", () => openModal(button.dataset.indicator));
  });
  document.getElementById("chart-data-settings-btn").addEventListener("click", () => openModal("chartData"));
  const strategySettingsBtn = document.getElementById("strategy-settings-btn");
  if (strategySettingsBtn) strategySettingsBtn.addEventListener("click", () => openModal(STRATEGY.current ? STRATEGY.current.key : ""));
  // Form values stay as a draft. Only the explicit Apply & Load button commits them.
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });
  applyBtn.addEventListener("click", applySettings);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  // Keep draft values stable while the user edits. This dialog only closes through
  // its explicit controls (or Escape), never through a click in the backdrop.
  modal.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeModal(); });
}

function setupCacheManager() {
  const btn = document.getElementById("cache-btn");
  const panel = document.getElementById("cache-panel");
  const closeBtn = document.getElementById("cache-close");
  const clearAllBtn = document.getElementById("clear-all-cache");

  function getOHLCVKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith("_DB_v6")) keys.push(key);
    }
    return keys.sort();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  function renderCacheList() {
    const listEl = document.getElementById("cache-list");
    const totalEl = document.getElementById("cache-total-size");
    const keys = getOHLCVKeys();
    if (keys.length === 0) {
      listEl.innerHTML = `<div class="cache-empty">No cached data found</div>`;
      totalEl.textContent = "0 entries";
      return;
    }
    let totalBytes = 0;
    let html = "";
    for (const key of keys) {
      const val = localStorage.getItem(key) || "";
      const bytes = new Blob([val]).size;
      totalBytes += bytes;
      const parts = key.replace("_DB_v6", "").split("_");
      const sym = parts[0];
      const iv = parts.slice(1).join("_");
      let bars = 0;
      try { bars = JSON.parse(val).length; } catch (e) {}
      html += `
            <div class="cache-item">
              <span class="cache-sym">${sym}</span>
              <span class="cache-meta">${iv} &middot; ${bars.toLocaleString()} bars</span>
              <span class="cache-size">${formatBytes(bytes)}</span>
              <button class="cache-del-btn" data-key="${key}" title="Delete">✕</button>
            </div>`;
    }
    listEl.innerHTML = html;
    totalEl.textContent = `${keys.length} entries · ${formatBytes(totalBytes)}`;
    listEl.querySelectorAll(".cache-del-btn").forEach((b) => {
      b.addEventListener("click", () => {
        localStorage.removeItem(b.dataset.key);
        renderCacheList();
      });
    });
  }

  function togglePanel(force) {
    const isOpen = force !== undefined ? force : !panel.classList.contains("open");
    if (isOpen) renderCacheList();
    panel.classList.toggle("open", isOpen);
    btn.classList.toggle("active", isOpen);
    if (isOpen) {
      document.getElementById("settings-panel").classList.remove("open");
      document.getElementById("settings-btn").classList.remove("active");
    }
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  closeBtn.addEventListener("click", () => togglePanel(false));
  clearAllBtn.addEventListener("click", () => {
    const keys = getOHLCVKeys();
    if (keys.length === 0) return;
    if (confirm(`Delete all ${keys.length} cached datasets?`)) {
      keys.forEach((k) => localStorage.removeItem(k));
      renderCacheList();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#cache-panel") && !e.target.closest("#cache-btn")) togglePanel(false);
  });
}

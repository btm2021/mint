let stat3Bars = [];
let stat3ClosedBars = [];
let stat3OpenBar = null;
let stat3Engine = null;
let stat3LoadToken = 0;
let stat3Fvgs = [];
let stat3Structures = [];
let stat3StructureExperiment = null;
let stat3Bot1 = null;
let stat3Bot2 = null;
let stat3Vsr1 = null;
let stat3Vsr2 = null;

function stat3SetStatus(html) {
  const element = document.getElementById("stat2-status");
  if (element) element.innerHTML = html;
}

function stat3SetProgress(percent, active = true) {
  const container = document.getElementById("stat2-progress-bar-container");
  const fill = document.getElementById("stat2-progress-bar-fill");
  if (!container || !fill) return;
  container.classList.toggle("active", active);
  fill.style.width = active ? `${Math.max(5, Math.min(100, percent))}%` : "0%";
}

function stat3BuildEngine() {
  stat3Engine = new OrderBlockEngine({ ...STAT3_CFG.orderBlock });
  stat3Engine.processCandles(stat3ClosedBars);
  stat3Fvgs = calculateFVGs(stat3ClosedBars, stat3Engine.atr, STAT3_CFG.fvg);
  if (typeof calculateConfluentMarketStructure === "function" && STAT3_CFG.marketStructure.confluenceMode) {
    stat3StructureExperiment = calculateConfluentMarketStructure(
      stat3ClosedBars,
      stat3Engine.swings,
      stat3Engine.atr,
      stat3Fvgs,
      stat3Engine.orderBlocks,
      STAT3_CFG.marketStructure,
    );
    stat3Structures = STAT3_CFG.marketStructure.showRejected
      ? [...stat3StructureExperiment.confirmed, ...stat3StructureExperiment.rejected].sort((a, b) => a.breakIndex - b.breakIndex)
      : stat3StructureExperiment.confirmed;
  } else {
    stat3StructureExperiment = null;
    stat3Structures = calculateMarketStructure(
      stat3ClosedBars,
      stat3Engine.swings,
      stat3Engine.atr,
      STAT3_CFG.marketStructure,
    );
  }
  stat3Bot1 = calculateStat2ATRBot(
    stat3ClosedBars,
    STAT3_CFG.atr1.atrLen,
    STAT3_CFG.atr1.maLen,
    STAT3_CFG.atr1.mult,
    STAT3_CFG.atr1.maType,
    STAT3_CFG.atr1.source,
  );
  stat3Bot2 = calculateStat2ATRBot(
    stat3ClosedBars,
    STAT3_CFG.atr2.atrLen,
    STAT3_CFG.atr2.maLen,
    STAT3_CFG.atr2.mult,
    STAT3_CFG.atr2.maType,
    STAT3_CFG.atr2.source,
  );
  stat3Vsr1 = calculateStat2VSR(stat3ClosedBars, STAT3_CFG.vsr1.len, STAT3_CFG.vsr1.threshold);
  stat3Vsr2 = calculateStat2VSR(stat3ClosedBars, STAT3_CFG.vsr2.len, STAT3_CFG.vsr2.threshold);
  stat3RenderEngineResult();
}

function stat3RenderEngineResult() {
  if (!stat3Engine || !stat3OrderBlockPrimitive) return;
  const blocks = stat3Engine.getOrderBlocks({ includeExpired: true });
  stat3OrderBlockPrimitive.setOptions({ ...STAT3_CFG.orderBlock });
  stat3OrderBlockPrimitive.setVisible(STAT3_CFG.orderBlock.enabled);
  stat3OrderBlockPrimitive.setData(blocks);
  updateStat3AnalysisLayers({
    bot1: stat3Bot1,
    bot2: stat3Bot2,
    vsr1: stat3Vsr1,
    vsr2: stat3Vsr2,
    fvgs: stat3Fvgs,
    structures: stat3Structures,
  });
  updateStat3DebugMarkers(stat3Engine.getDebugEvents(), STAT3_CFG.orderBlock.showDebug);

  const rendered = blocks.filter((ob) => ob.score >= STAT3_CFG.orderBlock.minScoreToRender);
  const bullish = rendered.filter((ob) => ob.direction === "bullish" && !["invalidated", "expired"].includes(ob.status)).length;
  const bearish = rendered.filter((ob) => ob.direction === "bearish" && !["invalidated", "expired"].includes(ob.status)).length;
  const invalidated = rendered.filter((ob) => ob.status === "invalidated").length;
  const activeFvgs = stat3Fvgs.filter((gap) => !["filled", "expired"].includes(gap.status)).length;
  const confirmedStructures = stat3StructureExperiment?.confirmed || stat3Structures;
  const latestStructure = confirmedStructures.at(-1);
  const atr1State = stat3Bot1?.states?.at(-1) === 1 ? "↑" : "↓";
  const atr2State = stat3Bot2?.states?.at(-1) === 1 ? "↑" : "↓";
  const stats = document.getElementById("stat3-ob-stats");
  if (stats) {
    stats.innerHTML = `
      <span class="ob-stat-chip">OB <b>${rendered.length.toLocaleString()}</b></span>
      <span class="ob-stat-chip bull">Bull active <b>${bullish}</b></span>
      <span class="ob-stat-chip bear">Bear active <b>${bearish}</b></span>
      <span class="ob-stat-chip">FVG active <b>${activeFvgs}</b></span>
      <span class="ob-stat-chip">Structure <b>${latestStructure ? `${latestStructure.type} ${latestStructure.direction === "bullish" ? "↑" : "↓"}` : "—"}</b></span>
      ${stat3StructureExperiment ? `<span class="ob-stat-chip experiment">Confirmed <b>${stat3StructureExperiment.metrics.confirmed}/${stat3StructureExperiment.metrics.rawBreaks}</b></span>` : ""}
      ${stat3StructureExperiment ? `<span class="ob-stat-chip" title="FVG-only / OB-only / không có evidence">Reject F/O/N <b>${stat3StructureExperiment.metrics.rejectionReasons.fvgOnly}/${stat3StructureExperiment.metrics.rejectionReasons.orderBlockOnly}/${stat3StructureExperiment.metrics.rejectionReasons.noEvidence}</b></span>` : ""}
      <span class="ob-stat-chip">ATR <b>${atr1State}/${atr2State}</b></span>
      <span class="ob-stat-chip">Invalidated <b>${invalidated}</b></span>
    `;
  }
  renderStat4StructurePanel(confirmedStructures, stat3StructureExperiment);
}

function stat3FocusStructureEvent(breakIndex) {
  if (!stat3Chart || !Number.isFinite(breakIndex)) return;
  stat3Chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, breakIndex - 34),
    to: Math.min(Math.max(0, stat3Bars.length - 1) + 6, breakIndex + 22),
  });
}

function renderStat4StructurePanel(events, experiment) {
  const panel = document.getElementById("stat4-structure-panel");
  if (!panel) return;
  panel.hidden = !STAT3_CFG.marketStructure.enabled;
  if (panel.hidden) return;
  const totalConfirmed = (events || []).length;
  const latestEvents = [...(events || [])].sort((a, b) => b.breakIndex - a.breakIndex).slice(0, 20);
  const rawCount = experiment?.metrics.rawBreaks ?? totalConfirmed;
  const rate = rawCount ? Math.round((experiment?.metrics.confirmationRate ?? 1) * 100) : 0;
  const rows = latestEvents.map((event) => {
    const bullish = event.direction === "bullish";
    const delay = Math.max(0, (event.confirmedIndex ?? event.breakIndex) - event.breakIndex);
    const timeText = new Date(event.breakTime * 1000).toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    return `
      <button class="stat4-event-row ${event.direction}" data-break-index="${event.breakIndex}" aria-label="Đi tới ${event.type} ${bullish ? "tăng" : "giảm"} lúc ${timeText}">
        <span class="stat4-event-type">${event.type}</span>
        <span class="stat4-event-main">
          <span class="stat4-event-summary">${bullish ? "Bullish" : "Bearish"} · ${Number(event.price).toFixed(getStat3PriceFormat(event.price).precision)}</span>
          <span class="stat4-event-time">${timeText} · swing #${event.swingIndex} → break #${event.breakIndex}</span>
          <span class="stat4-evidence-row">
            <span class="stat4-evidence-chip ok">FVG ✓</span>
            <span class="stat4-evidence-chip ok">OB ✓${event.evidence?.orderBlockScore != null ? ` ${Number(event.evidence.orderBlockScore).toFixed(1)}` : ""}</span>
            <span class="stat4-evidence-chip">Score ${Number(event.evidenceScore || 0).toFixed(1)}</span>
            ${delay ? `<span class="stat4-evidence-chip delay">Confirm +${delay} bar</span>` : ""}
          </span>
        </span>
      </button>
    `;
  }).join("");

  panel.innerHTML = `
    <div class="stat4-panel-header">
      <div class="stat4-panel-title">BOS / CHOCH</div>
      <span class="stat4-panel-count">${totalConfirmed}/${rawCount} · ${rate}%</span>
      <button class="stat4-panel-action" data-action="latest" title="Đi tới structure mới nhất">⌖</button>
      <button class="stat4-panel-action" data-action="collapse" title="Thu gọn/mở rộng" aria-expanded="${!panel.classList.contains("collapsed")}">${panel.classList.contains("collapsed") ? "+" : "−"}</button>
    </div>
    <div class="stat4-panel-legend">
      <b class="bos">BOS</b> = tiếp diễn cấu trúc hiện tại · <b class="choch">CHOCH</b> = lần xác nhận đầu tiên đổi hướng trend.<br>
      Chỉ hiện khi có <b>close-break + FVG + matching OB</b>. Click một dòng để xem nến.
    </div>
    ${rows ? `<div class="stat4-event-list">${rows}</div>` : `<div class="stat4-empty">Chưa có BOS/CHOCH đạt đủ FVG + OB trong dữ liệu hiện tại. Bật RAW BREAKS để xem các candidate bị loại.</div>`}
  `;

  panel.querySelector('[data-action="collapse"]')?.addEventListener("click", (event) => {
    panel.classList.toggle("collapsed");
    event.currentTarget.textContent = panel.classList.contains("collapsed") ? "+" : "−";
    event.currentTarget.setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
  });
  panel.querySelector('[data-action="latest"]')?.addEventListener("click", () => {
    if (latestEvents[0]) stat3FocusStructureEvent(latestEvents[0].breakIndex);
  });
  panel.querySelectorAll(".stat4-event-row").forEach((row) => {
    row.addEventListener("click", () => {
      panel.querySelectorAll(".stat4-event-row").forEach((item) => item.classList.remove("selected"));
      row.classList.add("selected");
      stat3FocusStructureEvent(Number(row.dataset.breakIndex));
    });
  });
}

async function stat3MergeLatestFuturesBars(symbol, interval, bars, limit) {
  const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=1500`);
  if (!response.ok) throw new Error(`Binance latest HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(payload?.msg || "Binance latest trả về dữ liệu không hợp lệ");
  const unique = new Map((bars || []).map((bar) => [bar.time, bar]));
  payload.forEach((row) => {
    unique.set(row[0] / 1000, {
      time: row[0] / 1000,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      buyVolume: Number(row[9]) || 0,
    });
  });
  const merged = [...unique.values()].sort((a, b) => a.time - b.time).slice(-limit);
  await saveDBCachedBars("binance-futures", symbol, interval, merged);
  return merged;
}

async function loadStat3SymbolData({ fit = false } = {}) {
  const token = ++stat3LoadToken;
  const source = "binance-futures";
  const symbol = String(STAT3_CFG.symbol || "IMXUSDT").trim().toUpperCase();
  const interval = STAT3_CFG.interval || "15m";
  const limit = Number(STAT3_CFG.barLimit) || 200000;
  STAT3_CFG.dataSource = source;
  STAT3_CFG.symbol = symbol;
  saveStat3Config();

  closeAllSourceStreams();
  stat3SetProgress(8);
  stat3SetStatus(`<span class="loading-spin">⏳</span> Đang nạp Binance Futures ${symbol} ${interval}...`);
  try {
    const sourceBars = await fetchSourceKlines(source, symbol, interval, limit, (message, percent = 0) => {
      if (token !== stat3LoadToken) return;
      stat3SetProgress(percent || 12);
      stat3SetStatus(`<span class="loading-spin">⏳</span> ${message}`);
    });
    if (token !== stat3LoadToken) return;
    if (!sourceBars?.length) throw new Error("Không nhận được dữ liệu nến");

    stat3SetStatus(`<span class="loading-spin">⏳</span> Đồng bộ 1.500 nến Futures mới nhất...`);
    const bars = await stat3MergeLatestFuturesBars(symbol, interval, sourceBars, limit);
    if (token !== stat3LoadToken) return;

    stat3Bars = bars.slice().sort((a, b) => a.time - b.time);
    stat3OpenBar = { ...stat3Bars[stat3Bars.length - 1] };
    stat3ClosedBars = stat3Bars.slice(0, -1);
    stat3CandleSeries.setData(stat3Bars);
    stat3CandleSeries.applyOptions({ priceFormat: getStat3PriceFormat(stat3Bars.at(-1).close) });
    stat3BuildEngine();

    document.getElementById("stat2-symbol-input").value = symbol;
    stat3SetProgress(100);
    setTimeout(() => stat3SetProgress(0, false), 350);
    stat3SetStatus(`<span class="ready-dot"></span> [Binance Futures] <span class="process-badge">${stat3Bars.length.toLocaleString()} nến · ${stat3Engine.orderBlocks.length.toLocaleString()} OB · ${stat3Fvgs.length.toLocaleString()} FVG</span>`);
    if (fit) stat3Chart.timeScale().fitContent();
    else stat3Chart.timeScale().fitContent();
    stat3StartStreams(symbol, interval);
  } catch (error) {
    console.error(error);
    stat3SetProgress(0, false);
    stat3SetStatus(`<span style="color:#ff5c7a">Lỗi: ${error.message}</span>`);
  }
}

function stat3StartStreams(symbol, interval) {
  setupSourceTickerStream("binance-futures", symbol, ({ price, changePct }) => {
    const priceElement = document.getElementById("stat2-ticker-price");
    const changeElement = document.getElementById("stat2-ticker-change");
    if (!priceElement || !changeElement) return;
    const precision = getStat3PriceFormat(price).precision;
    priceElement.textContent = Number(price).toFixed(precision);
    changeElement.textContent = `${changePct >= 0 ? "+" : ""}${Number(changePct).toFixed(2)}%`;
    changeElement.className = changePct >= 0 ? "badge-up" : "badge-down";
  });

  setupSourceKlineStream("binance-futures", symbol, interval, (bar) => {
    stat3CandleSeries.update(bar);
    if (!stat3OpenBar) {
      stat3OpenBar = { ...bar };
      stat3Bars.push({ ...bar });
      return;
    }

    if (bar.time === stat3OpenBar.time) {
      stat3OpenBar = { ...bar };
      stat3Bars[stat3Bars.length - 1] = { ...bar };
      return;
    }

    if (bar.time > stat3OpenBar.time) {
      const closed = { ...stat3OpenBar };
      stat3ClosedBars.push(closed);
      stat3OpenBar = { ...bar };
      stat3Bars.push({ ...bar });

      if (stat3Bars.length > STAT3_CFG.barLimit) {
        stat3Bars = stat3Bars.slice(-STAT3_CFG.barLimit);
        stat3ClosedBars = stat3Bars.slice(0, -1);
        stat3CandleSeries.setData(stat3Bars);
        stat3BuildEngine();
      } else {
        stat3BuildEngine();
      }
    }
  });
}

function initStat3Controls() {
  const symbolInput = document.getElementById("stat2-symbol-input");
  symbolInput.value = STAT3_CFG.symbol;
  symbolInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      stat3SetStatus('<span style="color:#ff5c7a">Symbol Futures không hợp lệ</span>');
      return;
    }
    STAT3_CFG.symbol = symbol;
    loadStat3SymbolData();
  });

  document.querySelectorAll(".stat2-iv-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.iv === STAT3_CFG.interval);
    button.addEventListener("click", () => {
      document.querySelectorAll(".stat2-iv-btn").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      STAT3_CFG.interval = button.dataset.iv;
      saveStat3Config();
      loadStat3SymbolData();
    });
  });

  const obToggle = document.getElementById("qt-ob");
  const fvgToggle = document.getElementById("qt-fvg");
  const msToggle = document.getElementById("qt-ms");
  const atr1Toggle = document.getElementById("qt-atr1");
  const atr2Toggle = document.getElementById("qt-atr2");
  const vsr1Toggle = document.getElementById("qt-vsr1");
  const vsr2Toggle = document.getElementById("qt-vsr2");
  const historyToggle = document.getElementById("qt-history");
  const debugToggle = document.getElementById("qt-debug");
  const rawToggle = document.getElementById("qt-raw");
  const fullButton = document.getElementById("qt-full");
  const syncButton = (element, active) => {
    element.classList.toggle("active", !!active);
    element.setAttribute("aria-pressed", String(!!active));
  };
  const syncToggles = () => {
    syncButton(obToggle, STAT3_CFG.orderBlock.enabled);
    syncButton(fvgToggle, STAT3_CFG.fvg.enabled);
    syncButton(msToggle, STAT3_CFG.marketStructure.enabled);
    syncButton(atr1Toggle, STAT3_CFG.atr1.enabled);
    syncButton(atr2Toggle, STAT3_CFG.atr2.enabled);
    syncButton(vsr1Toggle, STAT3_CFG.vsr1.enabled);
    syncButton(vsr2Toggle, STAT3_CFG.vsr2.enabled);
    syncButton(historyToggle, STAT3_CFG.orderBlock.showHistorical && STAT3_CFG.fvg.showHistorical);
    syncButton(debugToggle, STAT3_CFG.orderBlock.showDebug);
    if (rawToggle) syncButton(rawToggle, STAT3_CFG.marketStructure.showRejected);
  };
  const bindLayerToggle = (element, section) => element.addEventListener("click", () => {
    STAT3_CFG[section].enabled = !STAT3_CFG[section].enabled;
    saveStat3Config(); syncToggles(); stat3RenderEngineResult();
  });
  obToggle.addEventListener("click", () => {
    STAT3_CFG.orderBlock.enabled = !STAT3_CFG.orderBlock.enabled;
    saveStat3Config(); syncToggles(); stat3RenderEngineResult();
  });
  bindLayerToggle(fvgToggle, "fvg");
  bindLayerToggle(msToggle, "marketStructure");
  bindLayerToggle(atr1Toggle, "atr1");
  bindLayerToggle(atr2Toggle, "atr2");
  bindLayerToggle(vsr1Toggle, "vsr1");
  bindLayerToggle(vsr2Toggle, "vsr2");
  historyToggle.addEventListener("click", () => {
    const nextValue = !(STAT3_CFG.orderBlock.showHistorical && STAT3_CFG.fvg.showHistorical);
    STAT3_CFG.orderBlock.showHistorical = nextValue;
    STAT3_CFG.fvg.showHistorical = nextValue;
    saveStat3Config(); syncToggles(); stat3RenderEngineResult();
  });
  debugToggle.addEventListener("click", () => {
    STAT3_CFG.orderBlock.showDebug = !STAT3_CFG.orderBlock.showDebug;
    saveStat3Config(); syncToggles(); stat3RenderEngineResult();
  });
  if (rawToggle) {
    rawToggle.addEventListener("click", () => {
      STAT3_CFG.marketStructure.showRejected = !STAT3_CFG.marketStructure.showRejected;
      stat3Structures = STAT3_CFG.marketStructure.showRejected
        ? [...(stat3StructureExperiment?.confirmed || []), ...(stat3StructureExperiment?.rejected || [])].sort((a, b) => a.breakIndex - b.breakIndex)
        : (stat3StructureExperiment?.confirmed || stat3Structures.filter((event) => event.status !== "rejected"));
      saveStat3Config(); syncToggles(); stat3RenderEngineResult();
    });
  }
  fullButton.addEventListener("click", () => stat3Chart.timeScale().fitContent());
  syncToggles();

  initStat3Settings();
}

function initStat3Settings() {
  const modal = document.getElementById("stat2-settings-modal");
  const form = document.getElementById("stat3-settings-form");
  const fields = [...form.querySelectorAll("[name]")];
  const fieldSection = (field) => field.dataset.section || "orderBlock";
  const populate = () => fields.forEach((field) => {
    field.value = STAT3_CFG[fieldSection(field)][field.name];
  });
  const close = () => { modal.style.display = "none"; };
  document.getElementById("stat2-open-settings-btn").addEventListener("click", () => {
    populate();
    modal.style.display = "flex";
  });
  document.getElementById("stat2-settings-close-btn").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    fields.forEach((field) => {
      const value = field.dataset.type === "boolean"
        ? field.value === "true"
        : field.tagName === "SELECT" ? field.value : Number(field.value);
      STAT3_CFG[fieldSection(field)][field.name] = value;
    });
    saveStat3Config();
    close();
    stat3BuildEngine();
  });
  document.getElementById("stat3-reset-settings").addEventListener("click", () => {
    ["orderBlock", "fvg", "marketStructure", "atr1", "atr2", "vsr1", "vsr2"].forEach((section) => {
      STAT3_CFG[section] = stat3Clone(STAT3_DEFAULT_CONFIG[section]);
    });
    saveStat3Config();
    populate();
    stat3BuildEngine();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initStat3Chart();
  initStat3Controls();
  loadStat3SymbolData();
});

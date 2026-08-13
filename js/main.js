function setupToggles() {
  const tAtr1 = document.getElementById("toggle-atr1");
  const tAtr2 = document.getElementById("toggle-atr2");
  const tVsr = document.getElementById("toggle-vsr");
  const tVsrDual = document.getElementById("toggle-vsr-dual");
  const tVsrDualEma = document.getElementById("toggle-vsr-dual-ema");
  const tVsrDualVidya = document.getElementById("toggle-vsr-dual-vidya");
  const tVsrDualVwap = document.getElementById("toggle-vsr-dual-vwap");
  const tVpVol = document.getElementById("toggle-vpvol");
  const tVwap = document.getElementById("toggle-vwap");
  const tDrawVP = document.getElementById("toggle-draw-vp");
  const tDrawRect = document.getElementById("toggle-draw-rect");

  tAtr1.checked = showATR1;
  tAtr2.checked = showATR2;
  tVsr.checked = showVSR;
  tVsrDual.checked = showVSRDual;
  tVsrDualEma.checked = showVSRDualEMA;
  tVsrDualVidya.checked = showVSRDualVIDYA;
  tVsrDualVwap.checked = showVSRDualVWAP;
  tVpVol.checked = showVPVol;
  tVwap.checked = showVWAP;
  tDrawVP.checked = drawingVPModeActive;
  tDrawRect.checked = drawingModeActive;

  // ---- Strategy quick toggles ----
  const stratToggles = [
    ["toggle-strat-entries", "row-strat-entries", "showEntries"],
    ["toggle-strat-biascloud", "row-strat-biascloud", "showBiasCloud"],
    ["toggle-strat-entrycloud", "row-strat-entrycloud", "showEntryCloud"],
    ["toggle-strat-vsr", "row-strat-vsr", "showVsr"],
  ];
  for (const [toggleId, rowId, cfgKey] of stratToggles) {
    const el = document.getElementById(toggleId);
    const row = document.getElementById(rowId);
    if (!el || !row) continue;
    if (STRAT_CFG && STRAT_CFG[cfgKey] !== undefined) {
      el.checked = !!STRAT_CFG[cfgKey];
      el.addEventListener("change", (e) => {
        STRAT_CFG[cfgKey] = e.target.checked ? 1 : 0;
        saveStrategyCfg();
        if (cfgKey === "showEntries") applyStrategyMarkers(); // markers plugin riêng
        requestAnimationFrame(drawOverlay);
      });
    } else {
      row.style.display = "none"; // ẩn với strategy không dùng
    }
  }

  tAtr1.addEventListener("change", (e) => {
    showATR1 = e.target.checked;
    localStorage.setItem("stat1_showATR1", showATR1 ? "1" : "0");
    requestAnimationFrame(drawOverlay);
  });
  tAtr2.addEventListener("change", (e) => {
    showATR2 = e.target.checked;
    localStorage.setItem("stat1_showATR2", showATR2 ? "1" : "0");
    t1Series2.applyOptions({ visible: showATR2 });
    t2Series2.applyOptions({ visible: showATR2 });
  });
  tVsr.addEventListener("change", (e) => {
    showVSR = e.target.checked;
    localStorage.setItem("stat1_showVSR", showVSR ? "1" : "0");
    requestAnimationFrame(drawOverlay);
  });
  tVsrDual.addEventListener("change", (e) => {
    showVSRDual = e.target.checked;
    localStorage.setItem("stat1_showVSRDual", showVSRDual ? "1" : "0");
    document.getElementById("vsr-dual-panel").hidden = !showVSRDual;
    requestAnimationFrame(syncCanvasSize);
  });
  tVsrDualEma.addEventListener("change", (e) => {
    showVSRDualEMA = e.target.checked;
    localStorage.setItem("stat1_showVSRDualEMA", showVSRDualEMA ? "1" : "0");
    vsrDualEmaSeries.applyOptions({ visible: showVSRDualEMA });
    requestAnimationFrame(drawVSRDualOverlay);
  });
  tVsrDualVidya.addEventListener("change", (e) => {
    showVSRDualVIDYA = e.target.checked;
    localStorage.setItem("stat1_showVSRDualVIDYA", showVSRDualVIDYA ? "1" : "0");
    vsrDualVidyaSeries.applyOptions({ visible: showVSRDualVIDYA });
    requestAnimationFrame(drawVSRDualOverlay);
  });
  tVsrDualVwap.addEventListener("change", (e) => {
    showVSRDualVWAP = e.target.checked;
    localStorage.setItem("stat1_showVSRDualVWAP", showVSRDualVWAP ? "1" : "0");
    vsrDualVwapSeries.applyOptions({ visible: showVSRDualVWAP });
    requestAnimationFrame(drawVSRDualOverlay);
  });
  tVpVol.addEventListener("change", (e) => {
    showVPVol = e.target.checked;
    localStorage.setItem("stat1_showVPVol", showVPVol ? "1" : "0");
    requestAnimationFrame(drawOverlay);
  });
  tVwap.addEventListener("change", (e) => {
    showVWAP = e.target.checked;
    localStorage.setItem("stat1_showVWAP", showVWAP ? "1" : "0");
    vwapSeries.applyOptions({ visible: showVWAP });
  });

  tDrawVP.addEventListener("change", (e) => {
    drawingVPModeActive = e.target.checked;
    if (drawingVPModeActive && drawingModeActive) {
      drawingModeActive = false;
      tDrawRect.checked = false;
    }
    chart.applyOptions({ handleScroll: !drawingVPModeActive });
    syncSidebarFromState();
  });

  tDrawRect.addEventListener("change", (e) => {
    drawingModeActive = e.target.checked;
    if (drawingModeActive && drawingVPModeActive) {
      drawingVPModeActive = false;
      tDrawVP.checked = false;
    }
    chart.applyOptions({ handleScroll: !drawingModeActive });
    syncSidebarFromState();
  });
}

async function loadSymbol() {
  if (!SYMBOL) return;
  setLoadingText(`Loading ${SYMBOL} ${INTERVAL}...`);
  const bars = await fetchBinanceData();

  if (bars.length === 0) {
    setStatus("error", `Failed to load ${SYMBOL}`);
    return;
  }

  candleSeries.setData(bars);
  globalBars = bars;
  applyPriceFormat(bars);

  globalCycles = [];
  globalVsrZones = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  calculateBVCVolumes(bars, 20);
  const vwapData = calculateStandardVWAP(globalBars, VWAP_ANCHOR);
  vwapSeries.setData(vwapData);

  const bot1 = calculateATRBot(bars, ATR_LENGTH, EMA_LENGTH, ATR_MULT, MA_TYPE, ATR_SOURCE);
  globalBot1 = bot1;
  globalCycles = bot1.cycles;

  const bot2 = calculateATRBot(bars, ATR2_LENGTH, ATR2_EMA_LENGTH, ATR2_MULT, ATR2_MA_TYPE, ATR2_SOURCE);
  globalBot2 = bot2;
  globalVsrZones = calculateVSR(bars, VSR_LENGTH, VSR_THRESHOLD);
  setVSRDualData(calculateVSRDual(bars, {
    vsr1Length: VSR_DUAL_1_LENGTH,
    vsr1Threshold: VSR_DUAL_1_THRESHOLD,
    vsr2Length: VSR_DUAL_2_LENGTH,
    vsr2Threshold: VSR_DUAL_2_THRESHOLD,
    emaLength: VSR_DUAL_EMA_LENGTH,
    vidyaLength: VSR_DUAL_VIDYA_LENGTH,
    cmoLength: VSR_DUAL_CMO_LENGTH,
    vwapLength: VSR_DUAL_VWAP_LENGTH,
  }));

  t1Series.setData(bot1.t1Data);
  t2Series.setData(bot1.t2Data);
  t1Series2.setData(bot2.t1Data);
  t2Series2.setData(bot2.t2Data);

  recomputeStrategy();

  setStatus("ready", `${bars.length.toLocaleString()} bars`);
  chart.timeScale().scrollToRealTime();
  requestAnimationFrame(() => syncCanvasSize());
}

async function run() {
  mountSharedUI();
  // Strategy được register trong file strategy-*.js (load trước main.js)
  if (!STRATEGY.current) { console.error("No strategy registered!"); return; }
  STRAT_CFG = loadStrategyCfg();
  const nameEl = document.getElementById("strategy-settings-name");
  if (nameEl) nameEl.textContent = STRATEGY.current.name;

  canvas = document.getElementById("overlay-canvas");
  ctx = canvas.getContext("2d");
  initChart();
  document.getElementById("vsr-dual-panel").hidden = !showVSRDual;
  setupToggles();
  setupSettingsPanel();
  setupIndicatorSettings();
  setupIntervalPills();
  setupCacheManager();

  setupSidebar();
  setupAnalyseTool();
  setupInteractions();
  setupStrategyModalBackdrop();

  initResizeObserver();
  setTimeout(() => syncCanvasSize(), 300);

  setLoadingText("Fetching exchange info...");
  allSymbols = await fetchExchangeInfo();
  setupSymbolSearch();

  const startSym = getStartSymbol();
  SYMBOL = startSym;
  document.getElementById("symbol-input").value = startSym;
  setLoadingText(`Loading ${startSym}...`);
  setStatus("loading", `Loading ${startSym}...`);

  await loadSymbol();
  setupTickerWS();
  setupRealtimeWS();
  hideLoadingScreen();
}

window.addEventListener("DOMContentLoaded", run);

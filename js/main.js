function setupToggles() {
  const tAtr1 = document.getElementById("toggle-atr1");
  const tAtr2 = document.getElementById("toggle-atr2");
  const tVsr = document.getElementById("toggle-vsr");
  const tVpVol = document.getElementById("toggle-vpvol");
  const tVwap = document.getElementById("toggle-vwap");
  const tDrawVP = document.getElementById("toggle-draw-vp");
  const tDrawRect = document.getElementById("toggle-draw-rect");

  tAtr1.checked = showATR1;
  tAtr2.checked = showATR2;
  tVsr.checked = showVSR;
  tVpVol.checked = showVPVol;
  tVwap.checked = showVWAP;
  tDrawVP.checked = drawingVPModeActive;
  tDrawRect.checked = drawingModeActive;

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
  const vwapData = calculateStandardVWAP(globalBars);
  vwapSeries.setData(vwapData);

  const bot1 = calculateATRBot(bars, ATR_LENGTH, EMA_LENGTH, ATR_MULT);
  globalBot1 = bot1;
  globalCycles = bot1.cycles;

  const bot2 = calculateATRBot(bars, 10, 14, 1.0);
  globalBot2 = bot2;
  globalVsrZones = calculateVSR(bars, VSR_LENGTH, VSR_THRESHOLD);

  t1Series.setData(bot1.t1Data);
  t2Series.setData(bot1.t2Data);
  t1Series2.setData(bot2.t1Data);
  t2Series2.setData(bot2.t2Data);

  setStatus("ready", `${bars.length.toLocaleString()} bars`);
  chart.timeScale().scrollToRealTime();
  requestAnimationFrame(() => syncCanvasSize());
}

async function run() {
  canvas = document.getElementById("overlay-canvas");
  ctx = canvas.getContext("2d");
  initChart();
  setupToggles();
  setupSettingsPanel();
  setupIntervalPills();
  setupCacheManager();

  setupSidebar();
  setupAnalyseTool();
  setupInteractions();

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

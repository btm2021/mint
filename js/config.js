// === Reactive Config (dynamic, changes when user switches symbol/interval) ===
let SYMBOL = "";
let INTERVAL = "15m";
const DEFAULT_BAR_LIMIT = 50000;
const MIN_BAR_LIMIT = 500;
const MAX_BAR_LIMIT = 50000;

function getStoredNumber(key, fallback, min, max) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function getStoredMaType(key) {
  return localStorage.getItem(key) === "vidya" ? "vidya" : "ema";
}

let LIMIT = getStoredNumber("stat1_barLimit", DEFAULT_BAR_LIMIT, MIN_BAR_LIMIT, MAX_BAR_LIMIT);

// ATR Bot Settings
let ATR_LENGTH = getStoredNumber("stat1_atrLength", 10, 1, 500);
let EMA_LENGTH = getStoredNumber("stat1_emaLength", 21, 1, 500);
let ATR_MULT = getStoredNumber("stat1_atrMultiplier", 1.618, 0.001, 100);
let MA_TYPE = getStoredMaType("stat1_atrMaType");
let ATR2_LENGTH = getStoredNumber("stat1_atr2Length", 10, 1, 500);
let ATR2_EMA_LENGTH = getStoredNumber("stat1_atr2EmaLength", 14, 1, 500);
let ATR2_MULT = getStoredNumber("stat1_atr2Multiplier", 1, 0.001, 100);
let ATR2_MA_TYPE = getStoredMaType("stat1_atr2MaType");

// VP Settings
let NUM_ROWS = getStoredNumber("stat1_vpRows", 24, 4, 200);
let VA_PCT = getStoredNumber("stat1_vpValueArea", 70, 1, 100);

// VSR Settings
let VSR_LENGTH = getStoredNumber("stat1_vsrLength", 20, 1, 500);
let VSR_THRESHOLD = getStoredNumber("stat1_vsrThreshold", 10, 0.01, 1000);
let VWAP_ANCHOR = ["day", "week", "month"].includes(localStorage.getItem("stat1_vwapAnchor"))
  ? localStorage.getItem("stat1_vwapAnchor")
  : "day";

let chart, candleSeries, t1Series, t2Series, t1Series2, t2Series2;
let canvas, ctx;
let globalCycles = [];
let globalVsrZones = [];
// Full indicator results (used by analyse modal to extract exact values)
let globalBot1 = { t1Data: [], t2Data: [], cycles: [] };
let globalBot2 = { t1Data: [], t2Data: [], cycles: [] };

// Measure Tool State
let globalBars = [];
let measureState = {
  modeActive: false,
  step: 0,
  startIdx: null,
  endIdx: null,
};
let lastCrosshairLogical = null;

// Toggles State (Load from localStorage)
let showATR1 = localStorage.getItem("stat1_showATR1") !== "0";
let showATR2 = localStorage.getItem("stat1_showATR2") !== "0";
let showVSR = localStorage.getItem("stat1_showVSR") !== "0";
let showVPVol = localStorage.getItem("stat1_showVPVol") !== "0";
let showVWAP = localStorage.getItem("stat1_showVWAP") !== "0";

// Drawing State
let drawingModeActive = false;
let drawnRects = [];
try {
  let savedRects = localStorage.getItem("stat1_drawnRects");
  if (savedRects) drawnRects = JSON.parse(savedRects);
} catch (e) { }

let drawingVPModeActive = false;
let drawnVpRects = [];
try {
  let savedVps = localStorage.getItem("stat1_drawnVpRects");
  if (savedVps) drawnVpRects = JSON.parse(savedVps);
} catch (e) { }

let vpCreateState = { active: false, logical1: null, logical2: null };
let rectDragState = {
  active: false, mode: "", isVp: false, index: -1,
  startLogical: null, startPrice: null,
  originalLogical1: null, originalLogical2: null,
  originalPrice1: null, originalPrice2: null,
};
let rectCreateState = { active: false, logical1: null, price1: null, logical2: null, price2: null };
let hoveredRectIndex = -1;
let hoveredVpIndex = -1;
let hoveredCorner = "";
let selectedRectIndex = -1;
let selectedVpIndex = -1;
let vwapSeries;
let allSymbols = [];
let analyseChartInstance = null;
let analyseModeActive = false;

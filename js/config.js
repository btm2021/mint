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

const ATR_MA_TYPES = ["ema", "vwma", "lwma", "wma", "hma", "vwap", "alma", "tema", "wwsma", "zlema", "lsma", "kama", "vidya", "smma", "mcginley", "swma"];
const ATR_SOURCES = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"];

function getStoredMaType(key) {
  const value = localStorage.getItem(key);
  return ATR_MA_TYPES.includes(value) ? value : "ema";
}

function getStoredAtrSource(key) {
  const value = localStorage.getItem(key);
  return ATR_SOURCES.includes(value) ? value : "close";
}

let LIMIT = getStoredNumber("stat1_barLimit", DEFAULT_BAR_LIMIT, MIN_BAR_LIMIT, MAX_BAR_LIMIT);

// ATR Bot Settings
let ATR_LENGTH = getStoredNumber("stat1_atrLength", 14, 1, 500);
let EMA_LENGTH = getStoredNumber("stat1_emaLength", 30, 1, 500);
let ATR_MULT = getStoredNumber("stat1_atrMultiplier", 2, 0.1, 10);
let MA_TYPE = getStoredMaType("stat1_atrMaType");
let ATR_SOURCE = getStoredAtrSource("stat1_atrSource");
let ATR2_LENGTH = getStoredNumber("stat1_atr2Length", 14, 1, 500);
let ATR2_EMA_LENGTH = getStoredNumber("stat1_atr2EmaLength", 30, 1, 500);
let ATR2_MULT = getStoredNumber("stat1_atr2Multiplier", 2, 0.1, 10);
let ATR2_MA_TYPE = getStoredMaType("stat1_atr2MaType");
let ATR2_SOURCE = getStoredAtrSource("stat1_atr2Source");

// VP Settings
let NUM_ROWS = getStoredNumber("stat1_vpRows", 24, 4, 200);
let VA_PCT = getStoredNumber("stat1_vpValueArea", 70, 1, 100);

// VSR Settings
let VSR_LENGTH = getStoredNumber("stat1_vsrLength", 10, 1, 500);
let VSR_THRESHOLD = getStoredNumber("stat1_vsrThreshold", 10, 1, 20);
let VSR_DUAL_1_LENGTH = getStoredNumber("stat1_vsrDual1Length", 10, 1, 500);
let VSR_DUAL_1_THRESHOLD = getStoredNumber("stat1_vsrDual1Threshold", 10, 1, 20);
let VSR_DUAL_2_LENGTH = getStoredNumber("stat1_vsrDual2Length", 20, 1, 500);
let VSR_DUAL_2_THRESHOLD = getStoredNumber("stat1_vsrDual2Threshold", 10, 1, 20);
let VSR_DUAL_EMA_LENGTH = getStoredNumber("stat1_vsrDualEmaLength", 20, 1, 500);
let VSR_DUAL_VIDYA_LENGTH = getStoredNumber("stat1_vsrDualVidyaLength", 20, 1, 500);
let VSR_DUAL_CMO_LENGTH = getStoredNumber("stat1_vsrDualCmoLength", 9, 1, 500);
let VSR_DUAL_VWAP_LENGTH = getStoredNumber("stat1_vsrDualVwapLength", 20, 1, 500);
let VWAP_ANCHOR = ["day", "week", "month"].includes(localStorage.getItem("stat1_vwapAnchor"))
  ? localStorage.getItem("stat1_vwapAnchor")
  : "day";

let chart, candleSeries, t1Series, t2Series, t1Series2, t2Series2;
let canvas, ctx;
let vsrDualChart, vsrDual1UpperSeries, vsrDual1LowerSeries, vsrDual2UpperSeries, vsrDual2LowerSeries, vsrDualEmaSeries, vsrDualVidyaSeries, vsrDualVwapSeries, vsrDualCanvas, vsrDualCtx;
let globalVsrDual = null;
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
let showVSRDual = localStorage.getItem("stat1_showVSRDual") !== "0";
let showVSRDualEMA = localStorage.getItem("stat1_showVSRDualEMA") !== "0";
let showVSRDualVIDYA = localStorage.getItem("stat1_showVSRDualVIDYA") !== "0";
let showVSRDualVWAP = localStorage.getItem("stat1_showVSRDualVWAP") !== "0";
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

// === Reactive Config (dynamic, changes when user switches symbol/interval) ===
let SYMBOL = "";
let INTERVAL = "15m";
const LIMIT = 50000;

// ATR Bot Settings
const ATR_LENGTH = 10;
const EMA_LENGTH = 21;
const ATR_MULT = 1.618;

// VP Settings
const NUM_ROWS = 24;
const VA_PCT = 70;

// VSR Settings
const VSR_LENGTH = 20;
const VSR_THRESHOLD = 10.0;

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

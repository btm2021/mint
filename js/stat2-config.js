// ============================================================
// stat2-config.js — CẤU HÌNH TOÀN DIỆN CHO STAT2
// Lưu trữ & đồng bộ localStorage với prefix stat2_
// ============================================================

const STAT2_STORAGE_KEY = "stat2_custom_config_v1";

const STAT2_DEFAULT_CONFIG = {
  // --- Biểu đồ & Dữ liệu ---
  dataSource: "binance-futures",
  symbol: "BTCUSDT",
  interval: "15m",
  barLimit: 100000,
  chart: {
    upColor: "#00E676",
    downColor: "#FF5252",
    bgColor: "#080810",
    gridColor: "rgba(42, 46, 57, 0.4)",
    showGrid: true,
  },

  // --- ATRBot 1 (Chậm / BIAS) ---
  atr1: {
    enabled: true,
    name: "ATRBot 1 (BIAS)",
    source: "close",
    maType: "vidya",
    maLen: 55,
    atrLen: 10,
    mult: 2.0,
    // Trail 1 (MA)
    showT1: true,
    t1Color: "#26A69A",
    t1Width: 2,
    t1Style: "solid", // "solid" | "dashed" | "dotted"
    // Trail 2 (ATR)
    showT2: true,
    t2Color: "#EF5350",
    t2Width: 2,
    t2Style: "solid",
    // Cloud / Vùng đệm
    showCloud: true,
    cloudUpColor: "#00E676",
    cloudUpOpacity: 0.12,
    cloudDownColor: "#FF5252",
    cloudDownOpacity: 0.12,
  },

  // --- ATRBot 2 (Nhanh / ENTRY) ---
  atr2: {
    enabled: true,
    name: "ATRBot 2 (ENTRY)",
    source: "close",
    maType: "ema",
    maLen: 21,
    atrLen: 10,
    mult: 4.0,
    // Trail 1 (MA)
    showT1: true,
    t1Color: "#00BCD4",
    t1Width: 1.5,
    t1Style: "solid",
    // Trail 2 (ATR)
    showT2: true,
    t2Color: "#FF9800",
    t2Width: 1.5,
    t2Style: "solid",
    // Cloud / Vùng đệm
    showCloud: true,
    cloudUpColor: "#00BCD4",
    cloudUpOpacity: 0.08,
    cloudDownColor: "#FF9800",
    cloudDownOpacity: 0.08,
  },

  // --- VSR 1 ---
  vsr1: {
    enabled: true,
    name: "VSR 1",
    len: 10,
    thr: 10.0,
    showUpper: true,
    upperColor: "#FFEB3B",
    upperWidth: 1.2,
    upperStyle: "solid",
    showLower: true,
    lowerColor: "#FFEB3B",
    lowerWidth: 1.2,
    lowerStyle: "solid",
    showFill: true,
    fillColor: "#FFEB3B",
    fillOpacity: 0.10,
  },

  // --- VSR 2 ---
  vsr2: {
    enabled: true,
    name: "VSR 2",
    len: 20,
    thr: 10.0,
    showUpper: true,
    upperColor: "#2196F3",
    upperWidth: 1.2,
    upperStyle: "solid",
    showLower: true,
    lowerColor: "#2196F3",
    lowerWidth: 1.2,
    lowerStyle: "solid",
    showFill: true,
    fillColor: "#2196F3",
    fillOpacity: 0.08,
  },

  // --- VÙNG CHỒNG LẤN 2 VSR (VSR OVERLAP ZONE) ---
  vsrOverlap: {
    enabled: true,
    name: "VSR Overlap (Chồng Lấn)",
    showFill: true,
    fillColor: "#E040FB",
    fillOpacity: 0.32,
    showUpper: true,
    upperColor: "#E040FB",
    upperWidth: 2,
    upperStyle: "solid",
    showLower: true,
    lowerColor: "#E040FB",
    lowerWidth: 2,
    lowerStyle: "solid",
    showHatch: true, // Gạch chéo nổi bật rõ ràng
    showLabel: true, // Hiển thị nhãn OVERLAP
  },

  // --- ENTRY / TP / SL ---
  strategy: {
    enabled: true,
    name: "Stat2 Strategy",
    mode: "statOriginal", // "statOriginal" (Flip ATR2 + Bias ATR1) | "allFlips" (Mọi Flip ATR2) | "vsrFilter" (Trong VSR Overlap)
    tp1: 2.0,
    frac1: 1.0,
    tp2: 4.0,
    hasTp2: false,
    sl1: 2.0,
    sl2: 0.0,
    feePct: 0.14,
    // Hiển thị & Kiểu nét vẽ
    showMarkers: true,
    markerUpColor: "#00E676",
    markerDownColor: "#FF5252",
    markerSize: 1.4,
    showEntryLine: true,
    entryLineColor: "#9AA0A6",
    entryLineWidth: 1,
    entryLineStyle: "dashed",
    showTp1Line: true,
    tp1LineColor: "#FFC107",
    tp1LineWidth: 1.2,
    tp1LineStyle: "dashed",
    showTp2Line: true,
    tp2LineColor: "#00E676",
    tp2LineWidth: 1.2,
    tp2LineStyle: "dashed",
    showSlLine: true,
    slLineColor: "#FF5252",
    slLineWidth: 1.2,
    slLineStyle: "dashed",
    showTradeBox: false,
    winBoxColor: "#00E676",
    lossBoxColor: "#FF5252",
    boxOpacity: 0.05,
    showLabels: true,
    labelBgColor: "rgba(13, 13, 22, 0.92)",
  },
};

// Global config instance
let STAT2_CFG = loadStat2Config();

// Deep clone helper
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Deep merge helper
function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

function loadStat2Config() {
  try {
    const saved = localStorage.getItem(STAT2_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return deepMerge(deepClone(STAT2_DEFAULT_CONFIG), parsed);
    }
  } catch (e) {
    console.warn("Failed to parse saved stat2 config, using defaults", e);
  }
  return deepClone(STAT2_DEFAULT_CONFIG);
}

function saveStat2Config() {
  try {
    localStorage.setItem(STAT2_STORAGE_KEY, JSON.stringify(STAT2_CFG));
  } catch (e) {
    console.error("Failed to save stat2 config to localStorage", e);
  }
}

function resetStat2Config(section = null) {
  if (section && STAT2_DEFAULT_CONFIG[section]) {
    STAT2_CFG[section] = deepClone(STAT2_DEFAULT_CONFIG[section]);
  } else {
    STAT2_CFG = deepClone(STAT2_DEFAULT_CONFIG);
  }
  saveStat2Config();
}

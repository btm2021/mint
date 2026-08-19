// ============================================================
// final-config.js — CẤU HÌNH TOÀN DIỆN CHO FINAL.HTML (STAT2 + FOREXFLOW)
// Lưu trữ & đồng bộ localStorage với prefix final_
// ============================================================

const FINAL_STORAGE_KEY = "final_custom_config_v2";

const FINAL_DEFAULT_CONFIG = {
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
    showT1: true,
    t1Color: "#26A69A",
    t1Width: 2,
    t1Style: "solid",
    showT2: true,
    t2Color: "#EF5350",
    t2Width: 2,
    t2Style: "solid",
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
    showT1: true,
    t1Color: "#00BCD4",
    t1Width: 1.5,
    t1Style: "solid",
    showT2: true,
    t2Color: "#FF9800",
    t2Width: 1.5,
    t2Style: "solid",
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
    name: "VSR Overlap",
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
    showHatch: true,
    showLabel: true,
  },

  // --- 1. S&D ZONES (FOREXFLOW ZONE DETECTOR & SCORER) ---
  zone: {
    enabled: true,
    name: "S&D Zones (ForexFlow)",
    minScore: 2.5,
    minLegCandles: 2,
    maxBaseCandles: 6,
    minMoveOutMultiple: 2.0,
    maxBaseWidthAtr: 1.5,
    atrPeriod: 14,
    showTested: true,
    showInvalidated: true,
    baseSource: "wicks", // "wicks" (Tính cả High/Low râu nến) | "bodies" (Thân nến)
    sweepCutoff: "distal", // "distal" (Quét thủng Distal Line) | "proximal" (Chạm Proximal) | "mitigated50" (Quét 50% zone)
    allowedFormations: ["DBR", "RBR", "RBD", "DBD"],
    demandColor: "#00E676",
    demandOpacity: 0.16,
    supplyColor: "#FF5252",
    supplyOpacity: 0.16,
    proximalWidth: 1.5,
    proximalStyle: "solid",
    distalWidth: 1.5,
    distalStyle: "dashed",
    showLabels: true,
    showScores: true,
  },

  // --- 2. TREND & SWINGS (FOREXFLOW TREND DETECTOR) ---
  trend: {
    enabled: true,
    name: "Trend & Structure (ForexFlow)",
    swingStrength: 3,
    minSegmentAtr: 0.5,
    maxSwingPoints: 25,
    showLabels: true,
    showSegments: true,
    showControllingSwing: true,
    upColor: "#00E676",
    downColor: "#FF5252",
    neutralColor: "#90CAF9",
    lineWidth: 1.8,
    lineStyle: "solid",
    swingPointSize: 4,
  },

  // --- 3. SMC (SMART MONEY CONCEPTS) ---
  smc: {
    enabled: true,
    name: "SMC - Smart Money Concepts",
    swingStrength: 3,
    // Break of Structure (BOS)
    showBOS: true,
    bosBullColor: "#00E676",
    bosBearColor: "#FF5252",
    // Change of Character (CHoCH)
    showCHoCH: true,
    chochBullColor: "#00BCD4",
    chochBearColor: "#FF9800",
    // Fair Value Gaps (FVG)
    showFVG: true,
    fvgBullColor: "#26A69A",
    fvgBearColor: "#EF5350",
    fvgOpacity: 0.14,
    fvgHideMitigated: false,
    minGapPips: 0,
    // Order Blocks (OB)
    showOrderBlocks: true,
    obBullColor: "#00E676",
    obBearColor: "#FF5252",
    obOpacity: 0.22,
    obMinDisplacement: 2.0,
    // Liquidity Sweeps
    showSweeps: true,
    sweepColor: "#FFD600",
    // Equal Highs & Equal Lows (EQH / EQL)
    showEqualLevels: true,
    equalLevelsColor: "#B388FF",
    tolerancePct: 0.15,
  },

  // --- 4. STRUCTURAL BREAKEVEN & CONFIRMATION ---
  structural: {
    enabled: true,
    name: "Structural Confirmation",
    lookback: 3,
    showPoints: true,
    pointColor: "#00E5FF",
    applyToBE: false, // Yêu cầu xác nhận cấu trúc trước khi dời BE trong chiến lược
  },

  // --- CHIẾN LƯỢC ENTRY / TP / SL & BACKTEST ---
  strategy: {
    enabled: true,
    name: "Final Strategy",
    mode: "statOriginal", // "statOriginal" | "allFlips" | "vsrFilter" | "zoneConfluence" | "smcConfluence"
    tp1: 2.0,
    frac1: 1.0,
    tp2: 4.0,
    hasTp2: false,
    sl1: 2.0,
    sl2: 0.0,
    feePct: 0.14,
    useStructuralBE: false,
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
let FINAL_CFG = loadFinalConfig();

// Deep clone helper
function finalDeepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Deep merge helper
function finalDeepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      finalDeepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

function loadFinalConfig() {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(FINAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return finalDeepMerge(finalDeepClone(FINAL_DEFAULT_CONFIG), parsed);
      }
    }
  } catch (e) {
    console.warn("Failed to parse saved final config, using defaults", e);
  }
  return finalDeepClone(FINAL_DEFAULT_CONFIG);
}

function saveFinalConfig() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FINAL_STORAGE_KEY, JSON.stringify(FINAL_CFG));
    }
  } catch (e) {
    console.error("Failed to save final config to localStorage", e);
  }
}

function resetFinalConfig(section = null) {
  if (section && FINAL_DEFAULT_CONFIG[section]) {
    FINAL_CFG[section] = finalDeepClone(FINAL_DEFAULT_CONFIG[section]);
  } else {
    FINAL_CFG = finalDeepClone(FINAL_DEFAULT_CONFIG);
  }
  saveFinalConfig();
}

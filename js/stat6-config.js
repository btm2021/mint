// ============================================================
// stat6-config.js — CẤU HÌNH NHẸ CHO STAT6
// Hiển thị: 2 ATRBot + 2 VSR + VSR Overlap + Demand/Supply zones.
// Mặc định barLimit 1500 nến → load 1 request, recompute nhanh.
// ============================================================

const STAT6_STORAGE_KEY = "stat6_config_v1";

const STAT6_DEFAULT_CONFIG = {
  dataSource: "binance-futures",
  symbol: "BTCUSDT",
  interval: "15m",
  barLimit: 1500,

  chart: {
    upColor: "#00E676",
    downColor: "#FF5252",
    bgColor: "#080810",
    gridColor: "rgba(42, 46, 57, 0.4)",
    showGrid: true,
  },

  atr1: {
    enabled: true,
    source: "close",
    maType: "vidya",
    maLen: 55,
    atrLen: 10,
    mult: 2.0,
    showT1: true, t1Color: "#26A69A", t1Width: 2, t1Style: "solid",
    showT2: true, t2Color: "#EF5350", t2Width: 2, t2Style: "solid",
    showCloud: true, cloudUpColor: "#00E676", cloudUpOpacity: 0.12, cloudDownColor: "#FF5252", cloudDownOpacity: 0.12,
  },
  atr2: {
    enabled: true,
    source: "close",
    maType: "ema",
    maLen: 21,
    atrLen: 10,
    mult: 4.0,
    showT1: true, t1Color: "#00BCD4", t1Width: 1.5, t1Style: "solid",
    showT2: true, t2Color: "#FF9800", t2Width: 1.5, t2Style: "solid",
    showCloud: true, cloudUpColor: "#00BCD4", cloudUpOpacity: 0.08, cloudDownColor: "#FF9800", cloudDownOpacity: 0.08,
  },
  vsr1: {
    enabled: true, len: 10, thr: 10.0,
    showUpper: true, upperColor: "#FFEB3B", upperWidth: 1.2, upperStyle: "solid",
    showLower: true, lowerColor: "#FFEB3B", lowerWidth: 1.2, lowerStyle: "solid",
    showFill: true, fillColor: "#FFEB3B", fillOpacity: 0.10,
  },
  vsr2: {
    enabled: true, len: 20, thr: 10.0,
    showUpper: true, upperColor: "#2196F3", upperWidth: 1.2, upperStyle: "solid",
    showLower: true, lowerColor: "#2196F3", lowerWidth: 1.2, lowerStyle: "solid",
    showFill: true, fillColor: "#2196F3", fillOpacity: 0.08,
  },
  vsrOverlap: {
    enabled: true,
    showFill: true, fillColor: "#E040FB", fillOpacity: 0.32,
    showUpper: true, upperColor: "#E040FB", upperWidth: 2, upperStyle: "solid",
    showLower: true, lowerColor: "#E040FB", lowerWidth: 2, lowerStyle: "solid",
    showHatch: true, showLabel: true,
  },
  snd: {
    enabled: true,
    preset: "standard",
    formations: { RBR: true, DBD: true, RBD: false, DBR: false },
    minScore: 70,
    showTested: true,
    showInvalidated: false,
  },
};

let STAT6_CFG = stat6LoadConfig();

function stat6DeepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function stat6DeepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      stat6DeepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

function stat6LoadConfig() {
  try {
    const saved = localStorage.getItem(STAT6_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return stat6DeepMerge(stat6DeepClone(STAT6_DEFAULT_CONFIG), parsed);
    }
  } catch (e) {
    console.warn("stat6-config: failed to load", e);
  }
  return stat6DeepClone(STAT6_DEFAULT_CONFIG);
}

function stat6SaveConfig() {
  try {
    localStorage.setItem(STAT6_STORAGE_KEY, JSON.stringify(STAT6_CFG));
  } catch (e) { }
}

function stat6BuildAlgorithmConfig() {
  const preset = (SND_PRESETS && SND_PRESETS[STAT6_CFG.snd.preset]) || SND_PRESETS.standard;
  return { ...preset, maxBaseWidthAtr: 1.5 };
}

function stat6ActiveFormations() {
  return Object.keys(STAT6_CFG.snd.formations).filter((f) => STAT6_CFG.snd.formations[f]);
}
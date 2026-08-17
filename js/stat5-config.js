// ============================================================
// stat5-config.js — CẤU HÌNH TOÀN DIỆN STAT5
// Kết hợp: 2 ATRBot + 2 VSR + VSR Overlap (theo cấu trúc stat2)
//          + Supply & Demand zones (preset/formations/score)
//          + Nguồn dữ liệu / symbol / interval / barLimit
// ============================================================

const STAT5_STORAGE_KEY = "stat5_config_v1";

const STAT5_DEFAULT_CONFIG = {
  dataSource: "binance-futures",
  symbol: "BTCUSDT",
  interval: "15m",
  barLimit: 50000,

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

  // --- VÙNG CHỒNG LẤN 2 VSR ---
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

  // --- SUPPLY & DEMAND ZONES ---
  snd: {
    enabled: true,
    preset: "standard",
    formations: { RBR: true, DBD: true, RBD: false, DBR: false },
    minScore: 70,
    maxBaseWidthAtr: 1.5,
    showTested: true,
    showInvalidated: false,
    debug: false,
  },
};

// Global config instance
let STAT5_CFG = stat5LoadConfig();

function stat5DeepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function stat5DeepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      stat5DeepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

function stat5LoadConfig() {
  try {
    const saved = localStorage.getItem(STAT5_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return stat5DeepMerge(stat5DeepClone(STAT5_DEFAULT_CONFIG), parsed);
    }
  } catch (e) {
    console.warn("stat5-config: failed to load saved config", e);
  }
  return stat5DeepClone(STAT5_DEFAULT_CONFIG);
}

function stat5SaveConfig() {
  try {
    localStorage.setItem(STAT5_STORAGE_KEY, JSON.stringify(STAT5_CFG));
  } catch (e) {
    console.error("stat5-config: failed to save config", e);
  }
}

function stat5ResetConfig(section = null) {
  if (section && STAT5_DEFAULT_CONFIG[section]) {
    STAT5_CFG[section] = stat5DeepClone(STAT5_DEFAULT_CONFIG[section]);
  } else {
    STAT5_CFG = stat5DeepClone(STAT5_DEFAULT_CONFIG);
  }
  stat5SaveConfig();
}

// Build algorithm config cho S&D detector từ preset đã chọn.
// Tái sử dụng SND_PRESETS (snd-config.js) + maxBaseWidthAtr config.
function stat5BuildAlgorithmConfig() {
  const preset = (SND_PRESETS && SND_PRESETS[STAT5_CFG.snd.preset]) || SND_PRESETS.standard;
  return { ...preset, maxBaseWidthAtr: STAT5_CFG.snd.maxBaseWidthAtr };
}

function stat5SetNestedProperty(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
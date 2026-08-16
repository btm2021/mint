const STAT3_STORAGE_KEY = "stat3_orderblock_config_v1";

const STAT3_DEFAULT_CONFIG = {
  dataSource: "binance-futures",
  symbol: "IMXUSDT",
  interval: "15m",
  barLimit: 200000,
  chart: {
    upColor: "#00E676",
    downColor: "#FF5252",
    bgColor: "#080810",
    gridColor: "rgba(42, 46, 57, 0.4)",
    showGrid: true,
  },
  orderBlock: {
    enabled: true,
    showHistorical: true,
    showDebug: false,
    bullishColor: "#00E5A8",
    bearishColor: "#FF5C7A",
    atrPeriod: 14,
    swingLeft: 3,
    swingRight: 3,
    sweepBufferATR: 0.05,
    sweepRecoveryBars: 2,
    displacementWindow: 3,
    minDisplacementATR: 1.5,
    minBodyATR: 0.8,
    minDirectionalBodyRatio: 0.65,
    breakBufferATR: 0.05,
    maxBarsSweepToBreak: 12,
    originLookback: 6,
    zoneMode: "full",
    invalidationMode: "close",
    invalidationBufferATR: 0,
    mitigationMode: "midpoint",
    maxActiveBars: 500,
    mergeOverlapRatio: 0.7,
    mergeOriginDistance: 3,
    minScoreToRender: 6,
  },
  fvg: {
    enabled: true,
    showHistorical: true,
    bullishColor: "#26C6DA",
    bearishColor: "#FFB74D",
    minGapATR: 0.1,
    mitigationMode: "midpoint",
    maxActiveBars: 500,
  },
  marketStructure: {
    enabled: true,
    bullishColor: "#40C4FF",
    bearishColor: "#FF6E8A",
    breakBufferATR: 0.05,
  },
  atr1: {
    enabled: true,
    name: "ATRBot 1 (BIAS)",
    source: "close",
    maType: "vidya",
    maLen: 55,
    atrLen: 10,
    mult: 2,
    t1Color: "#26A69A",
    t2Color: "#EF5350",
    lineWidth: 2,
  },
  atr2: {
    enabled: true,
    name: "ATRBot 2 (ENTRY)",
    source: "close",
    maType: "ema",
    maLen: 21,
    atrLen: 10,
    mult: 4,
    t1Color: "#00BCD4",
    t2Color: "#FF9800",
    lineWidth: 1.5,
  },
  vsr1: {
    enabled: true,
    name: "VSR 1",
    len: 10,
    threshold: 10,
    color: "#FFEB3B",
    fillOpacity: 0.08,
  },
  vsr2: {
    enabled: true,
    name: "VSR 2",
    len: 20,
    threshold: 10,
    color: "#536DFE",
    fillOpacity: 0.07,
  },
};

function stat3Clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stat3DeepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  Object.keys(source).forEach((key) => {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      stat3DeepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  });
  return target;
}

function loadStat3Config() {
  try {
    const saved = localStorage.getItem(STAT3_STORAGE_KEY);
    if (saved) return stat3DeepMerge(stat3Clone(STAT3_DEFAULT_CONFIG), JSON.parse(saved));
  } catch (error) {
    console.warn("Không thể đọc cấu hình Stat3, dùng mặc định.", error);
  }
  return stat3Clone(STAT3_DEFAULT_CONFIG);
}

function saveStat3Config() {
  localStorage.setItem(STAT3_STORAGE_KEY, JSON.stringify(STAT3_CFG));
}

function resetStat3Config() {
  STAT3_CFG = stat3Clone(STAT3_DEFAULT_CONFIG);
  saveStat3Config();
}

let STAT3_CFG = loadStat3Config();

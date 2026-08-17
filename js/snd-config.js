// ============================================================
// snd-config.js — CẤU HÌNH SUPPLY & DEMAND DETECTOR
// Mọi threshold nằm trong preset object, không hard-code rải rác.
// ============================================================

// Algorithm presets — equivalent of ForexFlow ZONE_PRESETS.
const SND_PRESETS = {
  conservative: {
    preset: "conservative",
    atrPeriod: 14,
    minLegBodyRatio: 0.65,
    minLegBodyAtr: 1.8,
    maxBaseBodyRatio: 0.30,
    maxBaseCandles: 3,
    minMoveOutMultiple: 3.0,
    minLegCandles: 1,
    freshTestedThreshold: 0.30,
    freshInvalidatedThreshold: 1.0,
  },
  standard: {
    preset: "standard",
    atrPeriod: 14,
    minLegBodyRatio: 0.45,
    minLegBodyAtr: 1.0,
    maxBaseBodyRatio: 0.40,
    maxBaseCandles: 4,
    minMoveOutMultiple: 2.0,
    minLegCandles: 1,
    freshTestedThreshold: 0.30,
    freshInvalidatedThreshold: 1.0,
  },
  aggressive: {
    preset: "aggressive",
    atrPeriod: 14,
    minLegBodyRatio: 0.40,
    minLegBodyAtr: 0.80,
    maxBaseBodyRatio: 0.50,
    maxBaseCandles: 6,
    minMoveOutMultiple: 1.5,
    minLegCandles: 1,
    freshTestedThreshold: 0.40,
    freshInvalidatedThreshold: 1.0,
  },
};

// Width filter: zone bị reject nếu width > maxBaseWidthAtr x local ATR.
const SND_MAX_BASE_WIDTH_ATR = 1.5;

// Supported timeframes (Binance futures intervals).
const SND_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

const SND_STORAGE_KEY = "snd_config_v1";

const SND_DEFAULT_CONFIG = {
  symbol: "BTCUSDT",
  interval: "15m",
  lookback: 1000,
  preset: "standard",
  formations: { RBR: true, DBD: true, RBD: false, DBR: false },
  minScore: 70,
  showTested: true,
  showInvalidated: false,
  debug: false,
};

function sndDeepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function sndLoadConfig() {
  try {
    const saved = localStorage.getItem(SND_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...sndDeepClone(SND_DEFAULT_CONFIG), ...parsed };
    }
  } catch (e) {
    console.warn("snd-config: failed to load saved config", e);
  }
  return sndDeepClone(SND_DEFAULT_CONFIG);
}

function sndSaveConfig() {
  try {
    localStorage.setItem(SND_STORAGE_KEY, JSON.stringify(SND_CFG));
  } catch (e) {
    console.error("snd-config: failed to save config", e);
  }
}

// Global runtime config (loaded once at boot).
let SND_CFG = sndLoadConfig();

// Build the algorithm config object for the detector from the selected preset.
function sndBuildAlgorithmConfig() {
  return {
    ...SND_PRESETS[SND_CFG.preset] || SND_PRESETS.standard,
    maxBaseWidthAtr: SND_MAX_BASE_WIDTH_ATR,
  };
}
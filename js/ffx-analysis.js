// ============================================================
// ffx-analysis.js — BỘ PHÂN TÍCH MỞ RỘNG (port từ ForexFlow)
//  - Regime detection (trending/ranging/volatile/low_volatility)
//  - Divergence detection (RSI + MACD, regular/hidden)
//  - Fibonacci retracement + OTE zone
//  - Key levels (round numbers — crypto-adapted)
//  - Momentum confluence (RSI tại zone)
//  - Compound zones (cụm zone cùng loại trong 0.5×ATR)
// ============================================================

// ─── 1. REGIME DETECTION ──────────────────────────────────────
function ffxDetectRegime(candles) {
  const fallback = { regime: "ranging", confidence: 0, adx: 0, atrPercent: 0, bbWidth: 0 };
  if (candles.length < 50) return fallback;

  const adxResult = ffxComputeADX(candles);
  const adx = adxResult?.adx ?? 0;
  const bb = ffxComputeBollingerBands(candles);
  const bbWidth = bb?.bandwidth ?? 0;

  const atrValues = sndComputeATR(candles, 14);
  const currentATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;
  const currentPrice = candles[candles.length - 1].close;
  const atrPercent = currentPrice !== 0 ? (currentATR / currentPrice) * 100 : 0;

  const halfLen = Math.floor(candles.length / 2);
  const olderBB = ffxComputeBollingerBands(candles.slice(0, halfLen));
  const avgBBWidth = olderBB ? (olderBB.bandwidth + bbWidth) / 2 : bbWidth;
  const olderPrice = candles[halfLen]?.close ?? currentPrice;
  const olderATR = halfLen > 14 ? (atrValues[halfLen - 1] ?? currentATR) : currentATR;
  const avgATRPercent = olderPrice !== 0 ? ((olderATR / olderPrice) * 100 + atrPercent) / 2 : atrPercent;

  const ema20 = ffxComputeEMA(candles, 20);
  const ema50 = ffxComputeEMA(candles, 50);
  const emaAligned = ema20 !== null && ema50 !== null && Math.abs(ema20 - ema50) / currentPrice > 0.001;

  let regime, confidence;
  if (atrPercent > avgATRPercent * 1.5 && bbWidth > avgBBWidth * 1.3) {
    regime = "volatile";
    const volatilityExcess = atrPercent / (avgATRPercent || 1);
    confidence = Math.min(100, Math.round(50 + volatilityExcess * 15));
  } else if (bbWidth < avgBBWidth * 0.5) {
    regime = "low_volatility";
    const squeeze = avgBBWidth !== 0 ? 1 - bbWidth / avgBBWidth : 0.5;
    confidence = Math.min(100, Math.round(50 + squeeze * 50));
  } else if (adx > 25 && emaAligned) {
    regime = "trending";
    const adxStrength = Math.min((adx - 25) / 25, 1);
    confidence = Math.min(100, Math.round(60 + adxStrength * 40));
  } else {
    regime = "ranging";
    const adxWeakness = adx < 20 ? (20 - adx) / 20 : 0;
    confidence = Math.min(100, Math.round(40 + adxWeakness * 40));
  }
  return { regime, confidence, adx, atrPercent, bbWidth };
}

// ─── 2. DIVERGENCE DETECTION (RSI + MACD) ────────────────────
function ffxFindExtrema(values, candles, str, mode) {
  const results = [];
  for (let i = str; i < values.length - str; i++) {
    let ok = true;
    for (let j = 1; j <= str; j++) {
      const cmp = mode === "min"
        ? values[i] >= values[i - j] || values[i] >= values[i + j]
        : values[i] <= values[i - j] || values[i] <= values[i + j];
      if (cmp) { ok = false; break; }
    }
    if (ok) {
      const p = mode === "min" ? candles[i].low : candles[i].high;
      results.push({ value: values[i], price: p, time: candles[i].time, index: i });
    }
  }
  return results;
}

function ffxRsiSeries(candles, period) {
  const c = candles.map((x) => x.close);
  const rsi = new Array(period).fill(50);
  let aG = 0, aL = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) aG += d; else aL -= d;
  }
  aG /= period; aL /= period;
  rsi.push(aL === 0 ? 100 : 100 - 100 / (1 + aG / aL));
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    aG = (aG * (period - 1) + (d > 0 ? d : 0)) / period;
    aL = (aL * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi.push(aL === 0 ? 100 : 100 - 100 / (1 + aG / aL));
  }
  return rsi;
}

function ffxEmaArr(data, p) {
  const k = 2 / (p + 1), out = [];
  let sum = 0;
  for (let i = 0; i < Math.min(p, data.length); i++) {
    sum += data[i];
    out.push(sum / (i + 1));
  }
  for (let i = p; i < data.length; i++) out.push(data[i] * k + out[i - 1] * (1 - k));
  return out;
}

function ffxMacdHistSeries(candles) {
  const c = candles.map((x) => x.close);
  const macd = ffxEmaArr(c, 12).map((f, i) => f - ffxEmaArr(c, 26)[i]);
  const sig = ffxEmaArr(macd, 9);
  return macd.map((m, i) => m - sig[i]);
}

function ffxDivStrength(pDiff, iDiff, range) {
  if (range === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((Math.abs(pDiff) / range + Math.min(Math.abs(iDiff) / 50, 1)) * 50)));
}

function ffxDetectDivergences(candles, values, ind, sw) {
  const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));
  const pLows = ffxFindExtrema(candles.map((c) => c.low), candles, sw, "min");
  const pHighs = ffxFindExtrema(candles.map((c) => c.high), candles, sw, "max");
  const iLows = ffxFindExtrema(values, candles, sw, "min");
  const iHighs = ffxFindExtrema(values, candles, sw, "max");
  const divs = [];
  const near = (arr, idx) => arr.find((x) => Math.abs(x.index - idx) <= sw);

  for (let i = 0; i < pLows.length - 1; i++) {
    const p1 = pLows[i], p2 = pLows[i + 1];
    const i1 = near(iLows, p1.index), i2 = near(iLows, p2.index);
    if (!i1 || !i2) continue;
    const s = ffxDivStrength(p2.price - p1.price, i2.value - i1.value, range);
    if (p2.price < p1.price && i2.value > i1.value)
      divs.push({ type: "regular_bullish", indicator: ind, strength: s, priceSwing1: { price: p1.price, time: p1.time, index: p1.index }, priceSwing2: { price: p2.price, time: p2.time, index: p2.index }, indicatorValue1: i1.value, indicatorValue2: i2.value });
    else if (p2.price > p1.price && i2.value < i1.value)
      divs.push({ type: "hidden_bullish", indicator: ind, strength: s, priceSwing1: { price: p1.price, time: p1.time, index: p1.index }, priceSwing2: { price: p2.price, time: p2.time, index: p2.index }, indicatorValue1: i1.value, indicatorValue2: i2.value });
  }
  for (let i = 0; i < pHighs.length - 1; i++) {
    const p1 = pHighs[i], p2 = pHighs[i + 1];
    const i1 = near(iHighs, p1.index), i2 = near(iHighs, p2.index);
    if (!i1 || !i2) continue;
    const s = ffxDivStrength(p2.price - p1.price, i2.value - i1.value, range);
    if (p2.price > p1.price && i2.value < i1.value)
      divs.push({ type: "regular_bearish", indicator: ind, strength: s, priceSwing1: { price: p1.price, time: p1.time, index: p1.index }, priceSwing2: { price: p2.price, time: p2.time, index: p2.index }, indicatorValue1: i1.value, indicatorValue2: i2.value });
    else if (p2.price < p1.price && i2.value > i1.value)
      divs.push({ type: "hidden_bearish", indicator: ind, strength: s, priceSwing1: { price: p1.price, time: p1.time, index: p1.index }, priceSwing2: { price: p2.price, time: p2.time, index: p2.index }, indicatorValue1: i1.value, indicatorValue2: i2.value });
  }
  return divs;
}

function ffxDetectRSIDivergence(candles, rsiPeriod = 14, swingStrength = 5) {
  if (candles.length < rsiPeriod + swingStrength * 2 + 1) return [];
  return ffxDetectDivergences(candles, ffxRsiSeries(candles, rsiPeriod), "rsi", swingStrength);
}

function ffxDetectMACDDivergence(candles, swingStrength = 5) {
  if (candles.length < 34 + swingStrength * 2) return [];
  return ffxDetectDivergences(candles, ffxMacdHistSeries(candles), "macd", swingStrength);
}

// ─── 3. FIBONACCI ─────────────────────────────────────────────
const FFX_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const FFX_FIB_EXTENSIONS = [1.0, 1.272, 1.618, 2.0, 2.618];
const FFX_FIB_LABELS = { 0: "0%", 0.236: "23.6%", 0.382: "38.2%", 0.5: "50%", 0.618: "61.8%", 0.786: "78.6%", 1: "100%", 1.272: "127.2%", 1.618: "161.8%", 2: "200%", 2.618: "261.8%" };

function ffxFiboLabel(r) {
  return FFX_FIB_LABELS[r] ?? `${(r * 100).toFixed(1)}%`;
}
function ffxRetrace(base, range, ratio, up) {
  return up ? base - range * ratio : base + range * ratio;
}

function ffxComputeFibonacciRetracement(swingHigh, swingLow, direction) {
  const range = swingHigh - swingLow;
  const up = direction === "up";
  const base = up ? swingHigh : swingLow;
  const levels = FFX_FIB_LEVELS.map((r) => ({ ratio: r, price: ffxRetrace(base, range, r, up), label: ffxFiboLabel(r) }));
  const extensions = FFX_FIB_EXTENSIONS.map((r) => ({
    ratio: r,
    label: ffxFiboLabel(r),
    price: up ? swingLow + range * r : swingHigh - range * r,
  }));
  const ote618 = ffxRetrace(base, range, 0.618, up);
  const ote786 = ffxRetrace(base, range, 0.786, up);
  const oteZone = { high: Math.max(ote618, ote786), low: Math.min(ote618, ote786) };
  return { swingHigh, swingLow, direction, levels, oteZone, extensions };
}

// Tự động tính fib từ 2 swing gần nhất (high + low) của trend detector
function ffxFindFibonacciFromSwings(swings) {
  if (!swings || swings.length < 2) return null;
  let lastHigh = null, lastLow = null;
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (s.type === "high" && !lastHigh) lastHigh = s;
    if (s.type === "low" && !lastLow) lastLow = s;
    if (lastHigh && lastLow) break;
  }
  if (!lastHigh || !lastLow) return null;
  const direction = lastHigh.candleIndex > lastLow.candleIndex ? "down" : "up";
  return ffxComputeFibonacciRetracement(lastHigh.price, lastLow.price, direction);
}

// ─── 4. KEY LEVELS (crypto-adapted round numbers) ────────────
function ffxRoundStep(price) {
  if (!price || price <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
  return magnitude >= 100 ? magnitude / 2 : magnitude;
}

// Tìm các round-number levels gần price (trong proximity)
function ffxFindKeyLevels(price, proximityRatio = 0.004) {
  const levels = [];
  if (!price || price <= 0) return levels;
  const step = ffxRoundStep(price);
  const proximity = Math.max(step * 0.5, price * proximityRatio);
  const base = Math.floor(price / step) * step;
  for (const candidate of [base, base + step]) {
    const dist = Math.abs(price - candidate);
    if (dist <= proximity && candidate > 0) {
      levels.push({ price: candidate, type: "round_number", distance: dist });
    }
  }
  return levels.sort((a, b) => a.distance - b.distance);
}

function ffxScoreKeyLevels(entryPrice) {
  const levels = ffxFindKeyLevels(entryPrice);
  return {
    value: levels.length > 0 ? 1 : 0,
    max: 1,
    label: levels.length > 0 ? "Good" : "Poor",
    explanation: levels.length > 0 ? `Near round number ${levels[0].price.toFixed(4)}` : "No key level nearby",
  };
}

// ─── 5. MOMENTUM CONFLUENCE (RSI tại zone) ────────────────────
function ffxScoreMomentum(zoneType, candles) {
  if (candles.length < 15) {
    return { value: 0, max: 1, label: "Momentum", explanation: "Insufficient data" };
  }
  let score = 0;
  const parts = [];
  const rsi = ffxComputeRSI(candles);
  if (rsi !== null) {
    if (zoneType === "demand" && rsi < 35) {
      score += 0.5;
      parts.push(`RSI oversold (${rsi.toFixed(0)})`);
    } else if (zoneType === "supply" && rsi > 65) {
      score += 0.5;
      parts.push(`RSI overbought (${rsi.toFixed(0)})`);
    }
  }
  if (candles.length >= 30) {
    const midpoint = Math.floor(candles.length / 2);
    const firstHalf = candles.slice(0, midpoint);
    const secondHalf = candles.slice(midpoint);
    const rsiFirst = ffxComputeRSI(firstHalf);
    const rsiSecond = ffxComputeRSI(secondHalf);
    if (rsiFirst !== null && rsiSecond !== null) {
      if (zoneType === "demand") {
        const priceFirst = Math.min(...firstHalf.map((c) => c.low));
        const priceSecond = Math.min(...secondHalf.map((c) => c.low));
        if (priceSecond < priceFirst && rsiSecond > rsiFirst) {
          score += 0.5;
          parts.push("Bullish RSI divergence");
        }
      } else {
        const priceFirst = Math.max(...firstHalf.map((c) => c.high));
        const priceSecond = Math.max(...secondHalf.map((c) => c.high));
        if (priceSecond > priceFirst && rsiSecond < rsiFirst) {
          score += 0.5;
          parts.push("Bearish RSI divergence");
        }
      }
    }
  }
  score = Math.min(1, score);
  return {
    value: score,
    max: 1,
    label: "Momentum",
    explanation: parts.length > 0 ? parts.join("; ") : "No momentum confluence at zone",
  };
}

// ─── 6. COMPOUND ZONES ────────────────────────────────────────
// Cụm ≥2 zone cùng loại trong 0.5×ATR = accumulation/distribution.
function ffxDetectCompoundZones(zones, atr) {
  if (zones.length < 2 || atr <= 0) {
    return zones.map((z) => ({ ...z, compoundCount: 0 }));
  }
  const proximityThreshold = atr * 0.5;
  const result = zones.map((z) => ({ ...z, compoundCount: 0 }));
  for (let i = 0; i < result.length; i++) {
    let clusterCount = 0;
    for (let j = 0; j < result.length; j++) {
      if (i === j) continue;
      if (result[j].type !== result[i].type) continue;
      if (Math.abs(result[i].proximal - result[j].proximal) <= proximityThreshold) clusterCount++;
    }
    result[i].compoundCount = clusterCount;
  }
  return result;
}

function ffxCompoundBonus(compoundCount) {
  return compoundCount >= 1 ? 1 : 0;
}

// ─── 7. SESSION CLASSIFIER (port từ session-classifier.ts) ───
// Crypto 24/7 nhưng phiên London/NY vẫn có liquidity tốt hơn.
function ffxClassifySession(date) {
  const d = date || new Date();
  const utcHour = d.getUTCHours();
  if (utcHour >= 7 && utcHour < 10) return "london_open";
  if (utcHour >= 10 && utcHour < 12) return "london";
  if (utcHour >= 12 && utcHour < 15) return "ny_open";
  if (utcHour >= 15 && utcHour < 17) return "ny";
  if (utcHour >= 0 && utcHour < 7) return "asian";
  return "off_hours";
}

const FFX_SESSION_QUALITY = {
  london_open: 1.0,
  ny_open: 1.0,
  london: 0.8,
  ny: 0.7,
  asian: 0.5,
  off_hours: 0.2,
};

function ffxSessionQuality(session) {
  return FFX_SESSION_QUALITY[session] ?? 0.2;
}

// ─── 8. MARKET CONFLUENCE (port từ confluence-scoring.ts) ────
// Chấm điểm hội tụ cho CẢ hai chiều (buy/sell) ở trạng thái thị trường
// hiện tại: Trend (EMA50/200) + Momentum (RSI) + Volatility (ADX)
// + Session quality → điểm 0-10 mỗi chiều, trả bias mạnh hơn.

function ffxConfTrend(candles, direction) {
  if (candles.length < 200) {
    return { score: 5, detail: { alignment: "insufficient_data" } };
  }
  const ema50Series = ffxComputeEMASeries(candles, 50);
  const ema200Series = ffxComputeEMASeries(candles, 200);
  const ema50 = ema50Series[ema50Series.length - 1];
  const ema200 = ema200Series[ema200Series.length - 1];
  const price = candles[candles.length - 1].close;

  const isBullishTrend = ema50 > ema200 && price > ema50;
  const isBearishTrend = ema50 < ema200 && price < ema50;
  const isBuy = direction === "buy";

  let score, alignment;
  if (isBuy && isBullishTrend) { score = 10; alignment = "with_trend"; }
  else if (!isBuy && isBearishTrend) { score = 10; alignment = "with_trend"; }
  else if (isBuy && isBearishTrend) { score = 0; alignment = "against_trend"; }
  else if (!isBuy && isBullishTrend) { score = 0; alignment = "against_trend"; }
  else {
    const priceAboveEma200 = price > ema200;
    score = isBuy === priceAboveEma200 ? 5 : 3;
    alignment = "neutral";
  }
  return { score, detail: { ema50, ema200, price, alignment } };
}

function ffxConfMomentum(candles, direction) {
  const rsi = ffxComputeRSI(candles, 14);
  if (rsi === null) return { score: 5, detail: { rsi: 0, zone: "insufficient_data" } };
  const isBuy = direction === "buy";
  let score, zone;
  if (rsi >= 80) { zone = "overbought"; score = isBuy ? 1 : 7; }
  else if (rsi <= 20) { zone = "oversold"; score = isBuy ? 7 : 1; }
  else if (rsi >= 70) { zone = "high"; score = isBuy ? 4 : 6; }
  else if (rsi <= 30) { zone = "low"; score = isBuy ? 6 : 4; }
  else if (isBuy && rsi >= 50) { zone = "bullish"; score = rsi >= 55 && rsi <= 65 ? 10 : 8; }
  else if (!isBuy && rsi < 50) { zone = "bearish"; score = rsi >= 35 && rsi <= 45 ? 10 : 8; }
  else { zone = isBuy ? "bearish" : "bullish"; score = 2; }
  return { score, detail: { rsi, zone } };
}

function ffxConfVolatility(candles) {
  const adxResult = ffxComputeADX(candles, 14);
  if (!adxResult) return { score: 5, detail: { adx: 0, regime: "insufficient_data" } };
  const { adx, plusDI, minusDI } = adxResult;
  let score, regime;
  if (adx >= 30) { score = 10; regime = "trending"; }
  else if (adx >= 25) { score = 8; regime = "trending"; }
  else if (adx >= 20) { score = 6; regime = "weak_trend"; }
  else if (adx >= 15) { score = 3; regime = "ranging"; }
  else { score = 1; regime = "ranging"; }
  return { score, detail: { adx, plusDI, minusDI, regime } };
}

function ffxConfSession() {
  const session = ffxClassifySession();
  const quality = ffxSessionQuality(session);
  let score;
  if (session === "london_open" || session === "ny_open") score = 10;
  else if (session === "london") score = 7;
  else if (quality >= 0.7) score = 6;
  else if (quality >= 0.45) score = 4;
  else score = 1;
  return { score, detail: { session, quality } };
}

// Trọng số mặc định (giống ForexFlow TVAlertsQualityConfig)
const FFX_CONFLUENCE_WEIGHTS = { trend: 3, momentum: 2, volatility: 2, session: 1 };

// Bias thị trường: chấm confluence cho cả buy & sell, trả chiều mạnh hơn.
function ffxMarketConfluence(candles) {
  const trend = { buy: ffxConfTrend(candles, "buy"), sell: ffxConfTrend(candles, "sell") };
  const momentum = { buy: ffxConfMomentum(candles, "buy"), sell: ffxConfMomentum(candles, "sell") };
  const volatility = ffxConfVolatility(candles);
  const session = ffxConfSession();

  const totalW =
    FFX_CONFLUENCE_WEIGHTS.trend +
    FFX_CONFLUENCE_WEIGHTS.momentum +
    FFX_CONFLUENCE_WEIGHTS.volatility +
    FFX_CONFLUENCE_WEIGHTS.session;

  const weighted = (t, m) =>
    (t.score * FFX_CONFLUENCE_WEIGHTS.trend +
      m.score * FFX_CONFLUENCE_WEIGHTS.momentum +
      volatility.score * FFX_CONFLUENCE_WEIGHTS.volatility +
      session.score * FFX_CONFLUENCE_WEIGHTS.session) / totalW;

  const buyScore = Math.round(weighted(trend.buy, momentum.buy) * 10) / 10;
  const sellScore = Math.round(weighted(trend.sell, momentum.sell) * 10) / 10;

  let direction = "neutral";
  if (buyScore - sellScore >= 2) direction = "buy";
  else if (sellScore - buyScore >= 2) direction = "sell";

  return {
    direction,
    buy: buyScore,
    sell: sellScore,
    factors: {
      trend: { buy: trend.buy, sell: trend.sell },
      momentum: { buy: momentum.buy, sell: momentum.sell },
      volatility,
      session,
    },
    weights: FFX_CONFLUENCE_WEIGHTS,
  };
}
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
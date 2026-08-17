// ============================================================
// ffx-trend.js — TREND DETECTION (port trung thành từ ForexFlow
// trend-detector.ts). Swing analysis: N-bar pivots lọc bằng ATR,
// HH/HL/LH/LL, segments, controlling swing, trend status.
// Bỏ pip (crypto dùng giá thô).
// ============================================================

let ffxTrendId = 0;
function ffxUid() {
  return `sw_${Date.now()}_${++ffxTrendId}`;
}

const FFX_MAX_TREND_CANDLES = 500;

// Adaptive swing strength: sub-hourly 3, 30m+ 5
function ffxDefaultSwingStrength(timeframe) {
  switch (String(timeframe || "").toLowerCase()) {
    case "1m":
    case "3m":
    case "5m":
    case "15m":
      return 3;
    default:
      return 5;
  }
}

function ffxEmptyTrend(instrument, timeframe, currentPrice, candlesAnalyzed) {
  return {
    instrument,
    timeframe,
    direction: null,
    status: "forming",
    swingPoints: [],
    segments: [],
    controllingSwing: null,
    controllingSwingDistance: null,
    currentPrice,
    candlesAnalyzed,
  };
}

// ─── Main entry ──────────────────────────────────────────────
function ffxDetectTrend(candles, timeframe, config, currentPrice) {
  if (candles.length > FFX_MAX_TREND_CANDLES) {
    candles = candles.slice(-FFX_MAX_TREND_CANDLES);
  }
  const n = candles.length;
  if (n < 10) {
    return ffxEmptyTrend("", timeframe, currentPrice, n);
  }

  const strength = config.swingStrength || ffxDefaultSwingStrength(timeframe);
  const atrValues = sndComputeATR(candles, 14);
  const currentAtr = atrValues[atrValues.length - 1] ?? 0;

  const rawSwings = ffxDetectSwingPoints(candles, strength);
  const filtered = ffxFilterSwingsByAtr(rawSwings, candles, atrValues, config.minSegmentAtr);
  const swings = filtered.slice(-config.maxSwingPoints);

  if (swings.length < 3) {
    return ffxEmptyTrend("", timeframe, currentPrice, n);
  }

  const segments = ffxBuildSegments(swings);

  // Trailing segment từ swing cuối đến giá hiện tại
  if (swings.length >= 2) {
    const lastSwing = swings[swings.length - 1];
    const lastCandle = candles[n - 1];
    const trailingDir = currentPrice > lastSwing.price ? "up" : "down";
    const trailingDistance = Math.abs(currentPrice - lastSwing.price);
    if (currentAtr > 0 && trailingDistance > currentAtr * 0.2) {
      segments.push({
        id: ffxUid(),
        from: lastSwing,
        to: {
          id: ffxUid(),
          type: trailingDir === "up" ? "high" : "low",
          price: currentPrice,
          time: lastCandle.time,
          label: "H",
          candleIndex: n - 1,
        },
        direction: trailingDir,
        candleCount: Math.abs(n - 1 - lastSwing.candleIndex),
        isBreakout: false,
      });
    }
  }

  const terminationBuffer = currentAtr * 0.25;
  const identified = ffxIdentifyTrend(swings, currentPrice, terminationBuffer);
  ffxLabelSwingPoints(swings, identified.direction);
  ffxMarkBreakoutSegment(segments, swings, identified.direction);

  return {
    instrument: "",
    timeframe,
    direction: identified.direction,
    status: identified.status,
    swingPoints: swings,
    segments,
    controllingSwing: identified.controllingSwing,
    controllingSwingDistance:
      identified.controllingSwing
        ? Math.abs(currentPrice - identified.controllingSwing.price)
        : null,
    currentPrice,
    candlesAnalyzed: n,
  };
}

// ─── Step 2: Swing points (N-bar method) ─────────────────────
function ffxDetectSwingPoints(candles, strength) {
  const swings = [];
  const n = candles.length;
  for (let i = strength; i < n - strength; i++) {
    const c = candles[i];
    let isSwingLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].close <= c.close) { isSwingLow = false; break; }
    }
    let isSwingHigh = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].close >= c.close) { isSwingHigh = false; break; }
    }
    if (isSwingLow) {
      swings.push({ id: ffxUid(), type: "low", price: c.low, time: c.time, label: "L", candleIndex: i });
    } else if (isSwingHigh) {
      swings.push({ id: ffxUid(), type: "high", price: c.high, time: c.time, label: "H", candleIndex: i });
    }
  }
  return ffxDeduplicateSwings(swings);
}

function ffxDeduplicateSwings(swings) {
  if (swings.length <= 1) return swings;
  const result = [swings[0]];
  for (let i = 1; i < swings.length; i++) {
    const current = swings[i];
    const last = result[result.length - 1];
    if (current.type === last.type) {
      if (current.type === "low" && current.price < last.price) result[result.length - 1] = current;
      else if (current.type === "high" && current.price > last.price) result[result.length - 1] = current;
    } else {
      result.push(current);
    }
  }
  return result;
}

// ─── Step 3: Lọc swing quá gần nhau theo ATR ─────────────────
function ffxFilterSwingsByAtr(swings, candles, atrValues, minSegmentAtr) {
  if (swings.length <= 2 || minSegmentAtr <= 0) return swings;
  const result = [swings[0]];
  for (let i = 1; i < swings.length; i++) {
    const current = swings[i];
    const prev = result[result.length - 1];
    const atrAtSwing = atrValues[current.candleIndex] ?? atrValues[atrValues.length - 1] ?? 0;
    if (atrAtSwing <= 0) { result.push(current); continue; }
    const distance = Math.abs(current.price - prev.price);
    if (distance >= atrAtSwing * minSegmentAtr) result.push(current);
  }
  return result;
}

// ─── Step 5: Segments ─────────────────────────────────────────
function ffxBuildSegments(swings) {
  const segments = [];
  for (let i = 0; i < swings.length - 1; i++) {
    const from = swings[i], to = swings[i + 1];
    segments.push({
      id: ffxUid(),
      from,
      to,
      direction: to.price > from.price ? "up" : "down",
      candleCount: Math.abs(to.candleIndex - from.candleIndex),
      isBreakout: false,
    });
  }
  return segments;
}

// ─── Step 6: Identify trend (right-to-left) ──────────────────
function ffxIdentifyTrend(swings, currentPrice, terminationBuffer = 0) {
  if (swings.length < 4) {
    return { direction: null, status: "forming", controllingSwing: null };
  }
  const recentLows = [];
  const recentHighs = [];
  for (let i = swings.length - 1; i >= 0 && (recentLows.length < 3 || recentHighs.length < 3); i--) {
    const sw = swings[i];
    if (sw.type === "low" && recentLows.length < 3) recentLows.unshift(sw);
    if (sw.type === "high" && recentHighs.length < 3) recentHighs.unshift(sw);
  }
  const up = ffxCheckUptrend(recentLows, recentHighs, currentPrice, terminationBuffer);
  if (up) return up;
  const down = ffxCheckDowntrend(recentLows, recentHighs, currentPrice, terminationBuffer);
  if (down) return down;
  return { direction: null, status: "forming", controllingSwing: null };
}

function ffxCheckUptrend(lows, highs, currentPrice, terminationBuffer) {
  if (lows.length < 2 || highs.length < 2) return null;
  const prevLow = lows[lows.length - 2], lastLow = lows[lows.length - 1];
  if (lastLow.price <= prevLow.price) return null;
  const prevHigh = highs[highs.length - 2], lastHigh = highs[highs.length - 1];
  if (lastHigh.price <= prevHigh.price) return null;
  if (lastLow.time <= prevHigh.time) return null;
  const controllingSwing = lastLow;
  if (currentPrice < controllingSwing.price - terminationBuffer) {
    return { direction: "up", status: "terminated", controllingSwing };
  }
  return { direction: "up", status: "confirmed", controllingSwing };
}

function ffxCheckDowntrend(lows, highs, currentPrice, terminationBuffer) {
  if (lows.length < 2 || highs.length < 2) return null;
  const prevHigh = highs[highs.length - 2], lastHigh = highs[highs.length - 1];
  if (lastHigh.price >= prevHigh.price) return null;
  const prevLow = lows[lows.length - 2], lastLow = lows[lows.length - 1];
  if (lastLow.price >= prevLow.price) return null;
  if (lastHigh.time <= prevLow.time) return null;
  const controllingSwing = lastHigh;
  if (currentPrice > controllingSwing.price + terminationBuffer) {
    return { direction: "down", status: "terminated", controllingSwing };
  }
  return { direction: "down", status: "confirmed", controllingSwing };
}

// ─── Step 7: Label swing points (HH/HL/LH/LL) ────────────────
function ffxLabelSwingPoints(swings) {
  let lastHigh = null, lastLow = null;
  for (const sw of swings) {
    if (sw.type === "high") {
      sw.label = !lastHigh ? "H" : sw.price > lastHigh.price ? "HH" : "LH";
      lastHigh = sw;
    } else {
      sw.label = !lastLow ? "L" : sw.price > lastLow.price ? "HL" : "LL";
      lastLow = sw;
    }
  }
}

// ─── Step 8: Breakout segment ─────────────────────────────────
function ffxMarkBreakoutSegment(segments, swings, direction) {
  if (!direction || segments.length < 3) return;
  const targetLabel = direction === "up" ? "HH" : "LL";
  const breakoutSwing = swings.find((sw) => sw.label === targetLabel);
  if (!breakoutSwing) return;
  const seg = segments.find((s) => s.to.id === breakoutSwing.id);
  if (seg) seg.isBreakout = true;
}
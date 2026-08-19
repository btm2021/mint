// ============================================================
// final-forexflow.js — PURE ALGORITHMS PORT FROM FOREXFLOW (package/shared/src)
// 1. Zone Detector & Scorer (Supply & Demand / Base Isolation)
// 2. Trend Detector (Swings, HH/HL/LH/LL, Segments, Controlling Swing)
// 3. SMC Detector (BOS, CHoCH, FVG, Order Blocks, Liquidity Sweeps, Equal Levels)
// 4. Structural Breakeven & Swing Structure Confirmation
// ============================================================

let _ffxUidCounter = 0;
function ffxUid(prefix = "ffx") {
  return `${prefix}_${Date.now()}_${++_ffxUidCounter}`;
}

// ─── UTILS: ATR & CANDLE CLASSIFICATION ─────────────────────

function ffxComputeATR(candles, period = 14) {
  if (!candles || candles.length === 0) return [];
  const p = parseInt(period, 10) || 14;
  const n = candles.length;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (!c) {
      tr[i] = 0;
      continue;
    }
    if (i === 0 || !candles[i - 1]) {
      tr[i] = (c.high ?? 0) - (c.low ?? 0);
    } else {
      const prev = candles[i - 1];
      const h_l = (c.high ?? 0) - (c.low ?? 0);
      const h_pc = Math.abs((c.high ?? 0) - (prev.close ?? 0));
      const l_pc = Math.abs((c.low ?? 0) - (prev.close ?? 0));
      tr[i] = Math.max(h_l, h_pc, l_pc);
    }
  }
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    atr[i] = i === 0 ? tr[i] : (atr[i - 1] * (p - 1) + tr[i]) / p;
  }
  return atr;
}

function ffxClassifyCandles(candles, atrPeriod = 14, minBodyVsAtr = 1.0, minBodyRatio = 0.5) {
  if (!candles || candles.length === 0) return { classified: [], atrValues: [] };
  const p = parseInt(atrPeriod, 10) || 14;
  const atrValues = ffxComputeATR(candles, p);
  const n = candles.length;
  const result = new Array(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (!c) {
      result[i] = { open: 0, high: 0, low: 0, close: 0, volume: 0, time: 0, index: i, bodySize: 0, totalRange: 0, bodyRatio: 0, bodyVsAtr: 0, isBullish: false, classification: "neutral" };
      continue;
    }
    const high = Number(c.high) || 0;
    const low = Number(c.low) || 0;
    const open = Number(c.open) || 0;
    const close = Number(c.close) || 0;
    const totalRange = Math.max(0, high - low);
    const bodySize = Math.abs(close - open);
    const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;
    const atr = atrValues[i] || totalRange || 1;
    const bodyVsAtr = bodySize / atr;
    const isBullish = close >= open;

    let classification = "neutral";
    if (bodyVsAtr >= minBodyVsAtr && bodyRatio >= minBodyRatio) {
      classification = "leg";
    } else if (bodyRatio <= 0.5 && bodyVsAtr < 1.0) {
      classification = "base";
    }

    result[i] = {
      ...c,
      open,
      high,
      low,
      close,
      index: i,
      bodySize,
      totalRange,
      bodyRatio,
      bodyVsAtr,
      isBullish,
      classification,
    };
  }
  return { classified: result, atrValues };
}

// ─── 1. ZONE DETECTOR & SCORER (SUPPLY & DEMAND) ─────────────

function ffxDetermineFormation(legInBullish, legOutBullish) {
  if (!legInBullish && legOutBullish) return { formation: "DBR", zoneType: "demand" };
  if (legInBullish && legOutBullish) return { formation: "RBR", zoneType: "demand" };
  if (legInBullish && !legOutBullish) return { formation: "RBD", zoneType: "supply" };
  return { formation: "DBD", zoneType: "supply" };
}

function ffxPlaceZoneLines(zoneType, baseCandles, baseSource = "wicks") {
  if (!baseCandles || baseCandles.length === 0) return null;
  let proximalLine, distalLine;
  const useWicks = baseSource === "wicks";

  if (zoneType === "demand") {
    proximalLine = -Infinity;
    distalLine = Infinity;
    for (const c of baseCandles) {
      if (!c) continue;
      const topEdge = useWicks ? (Number(c.high) || 0) : Math.max(Number(c.open) || 0, Number(c.close) || 0);
      const botEdge = Number(c.low) || 0;
      proximalLine = Math.max(proximalLine, topEdge);
      distalLine = Math.min(distalLine, botEdge);
    }
  } else {
    proximalLine = Infinity;
    distalLine = -Infinity;
    for (const c of baseCandles) {
      if (!c) continue;
      const botEdge = useWicks ? (Number(c.low) || 0) : Math.min(Number(c.open) || 0, Number(c.close) || 0);
      const topEdge = Number(c.high) || 0;
      proximalLine = Math.min(proximalLine, botEdge);
      distalLine = Math.max(distalLine, topEdge);
    }
  }

  if (!Number.isFinite(proximalLine) || !Number.isFinite(distalLine)) return null;
  if (proximalLine === distalLine) return null;
  if (zoneType === "demand" && proximalLine <= distalLine) return null;
  if (zoneType === "supply" && proximalLine >= distalLine) return null;

  return { proximalLine, distalLine };
}

function ffxDetectExplosiveMove(classified, startIdx, direction, minLegCandles = 2) {
  let count = 0;
  let endIdx = startIdx;
  const isUp = direction === "up";
  const minLegs = parseInt(minLegCandles, 10) || 2;

  for (let i = startIdx; i < classified.length; i++) {
    const c = classified[i];
    if (!c) break;
    if (c.classification === "leg" && c.isBullish === isUp) {
      count++;
      endIdx = i;
    } else {
      break;
    }
  }

  return {
    isExplosive: count >= minLegs,
    startIdx,
    endIdx,
    consecutiveLegs: count,
  };
}

function ffxFindBaseCluster(classified, legOutStartIdx, maxBaseCandles = 6) {
  let baseStart = -1;
  let legInIdx = -1;
  const maxBase = parseInt(maxBaseCandles, 10) || 6;

  for (let i = legOutStartIdx - 1; i >= 0 && (legOutStartIdx - i) <= maxBase; i--) {
    const c = classified[i];
    if (!c) continue;
    if (c.classification === "base") {
      baseStart = i;
    } else if (c.classification === "leg") {
      legInIdx = i;
      break;
    } else {
      if (baseStart === -1) baseStart = i;
    }
  }

  if (baseStart === -1 || legInIdx === -1) return null;
  const baseEnd = legOutStartIdx - 1;
  const baseCandles = classified.slice(baseStart, baseEnd + 1);
  if (baseCandles.length === 0 || baseCandles.length > maxBase) return null;

  return {
    legInIdx,
    startIdx: baseStart,
    endIdx: baseEnd,
    candles: baseCandles,
  };
}

function ffxZonesOverlap(a, b) {
  const aLow = Math.min(a.proximalLine, a.distalLine);
  const aHigh = Math.max(a.proximalLine, a.distalLine);
  const bLow = Math.min(b.proximalLine, b.distalLine);
  const bHigh = Math.max(b.proximalLine, b.distalLine);

  const ovLow = Math.max(aLow, bLow);
  const ovHigh = Math.min(aHigh, bHigh);
  if (ovHigh <= ovLow) return 0;

  const ovW = ovHigh - ovLow;
  const minW = Math.min(aHigh - aLow, bHigh - bLow);
  return minW > 0 ? ovW / minW : 0;
}

function ffxDetectZones(candles, config = {}) {
  const cfg = {
    atrPeriod: parseInt(config.atrPeriod, 10) || 14,
    minLegCandles: parseInt(config.minLegCandles, 10) || 2,
    maxBaseCandles: parseInt(config.maxBaseCandles, 10) || 6,
    minMoveOutMultiple: parseFloat(config.minMoveOutMultiple) || 1.5,
    maxBaseWidthAtr: parseFloat(config.maxBaseWidthAtr) || 2.0,
    minScore: parseFloat(config.minScore) || 1.0,
    baseSource: config.baseSource || "wicks",
    allowedFormations: config.allowedFormations || ["DBR", "RBR", "RBD", "DBD"],
    showTested: config.showTested ?? true,
    showInvalidated: config.showInvalidated ?? true,
  };

  if (!candles || candles.length < cfg.atrPeriod + 5) {
    return { zones: [], demandZones: [], supplyZones: [] };
  }

  const { classified, atrValues } = ffxClassifyCandles(candles, cfg.atrPeriod);
  const rawCandidates = [];
  const usedIndices = new Set();

  const tryAdd = (move, base, direction) => {
    const legInCandle = classified[base.legInIdx];
    if (!legInCandle) return false;
    const { formation, zoneType } = ffxDetermineFormation(legInCandle.isBullish, direction === "up");

    if (cfg.allowedFormations && !cfg.allowedFormations.includes(formation)) return false;

    const lines = ffxPlaceZoneLines(zoneType, base.candles, cfg.baseSource);
    if (!lines) return false;

    const topPrice = Math.max(lines.proximalLine, lines.distalLine);
    const bottomPrice = Math.min(lines.proximalLine, lines.distalLine);
    const zoneWidth = topPrice - bottomPrice;

    const localAtr = atrValues[base.endIdx] || atrValues[atrValues.length - 1] || 0;
    if (localAtr > 0 && zoneWidth > localAtr * cfg.maxBaseWidthAtr) return false;

    for (let j = base.legInIdx; j <= move.endIdx; j++) usedIndices.add(j);

    const baseStartCandle = candles[base.startIdx];
    const baseEndCandle = candles[base.endIdx];

    // ── KIỂM TRA ĐIỂM KẾT THÚC DỰA TRÊN MỨC GIÁ CHẠM ĐẦU TIÊN (TÍNH CẢ HIGH LOW) ──
    let endIndex = null;
    let endTime = null;
    let firstTouchPrice = null;
    const scanStart = move.endIdx + 1;

    for (let k = scanStart; k < candles.length; k++) {
      const bar = candles[k];
      if (!bar) continue;
      const barHigh = Number(bar.high) || 0;
      const barLow = Number(bar.low) || 0;

      if (zoneType === "demand") {
        // Vùng Cầu: Giá sau khi nổ lên, cây nến đầu tiên có râu dưới chạm/quét vào vùng [bottomPrice, topPrice]
        if (barLow <= topPrice) {
          endIndex = k;
          endTime = bar.time;
          firstTouchPrice = barLow;
          break;
        }
      } else {
        // Vùng Cung: Giá sau khi sập xuống, cây nến đầu tiên có râu trên chạm/quét vào vùng [bottomPrice, topPrice]
        if (barHigh >= bottomPrice) {
          endIndex = k;
          endTime = bar.time;
          firstTouchPrice = barHigh;
          break;
        }
      }
    }

    // Tính điểm Odds Enhancers
    let moveOutExtreme = direction === "up" ? -Infinity : Infinity;
    for (let m = move.startIdx; m <= move.endIdx; m++) {
      if (!candles[m]) continue;
      if (direction === "up") moveOutExtreme = Math.max(moveOutExtreme, candles[m].high);
      else moveOutExtreme = Math.min(moveOutExtreme, candles[m].low);
    }
    const moveOutDistance = direction === "up" ? (moveOutExtreme - topPrice) : (bottomPrice - moveOutExtreme);
    const moveOutMultiple = zoneWidth > 0 ? (moveOutDistance / zoneWidth) : 0;
    const strengthScore = moveOutMultiple >= cfg.minMoveOutMultiple ? 2 : 1;
    const timeScore = base.candles.length <= 3 ? 1 : 0.5;
    const freshnessScore = endIndex === null ? 2 : 1;
    const totalScore = strengthScore + timeScore + freshnessScore;

    rawCandidates.push({
      id: ffxUid(`zone_${formation}`),
      type: zoneType,
      formation,
      topPrice,
      bottomPrice,
      proximalLine: lines.proximalLine,
      distalLine: lines.distalLine,
      baseStartIndex: base.startIdx,
      baseEndIndex: base.endIdx,
      baseStartTime: baseStartCandle ? baseStartCandle.time : 0,
      baseEndTime: baseEndCandle ? baseEndCandle.time : 0,
      baseCandles: base.candles.length,
      legOutStartIndex: move.startIdx,
      legOutEndIndex: move.endIdx,
      legInIndex: base.legInIdx,
      endIndex,
      endTime,
      firstTouchPrice,
      isTouched: endIndex !== null,
      invalidatedIndex: endIndex, // backward compat
      invalidatedTime: endTime,
      width: zoneWidth,
      status: endIndex !== null ? "touched" : "active",
      scores: {
        total: totalScore,
        strength: strengthScore,
        time: timeScore,
        freshness: freshnessScore,
        moveOutMultiple,
        testCount: endIndex !== null ? 1 : 0,
      },
    });
    return true;
  };

  // Quét từ đầu đến cuối (Toàn bộ dữ liệu)
  // Pass 1: Leg-first right-to-left
  for (let i = classified.length - 1; i >= cfg.atrPeriod + 2; i--) {
    if (usedIndices.has(i)) continue;
    const c = classified[i];
    if (!c || c.classification !== "leg") continue;

    const dir = c.isBullish ? "up" : "down";
    const move = ffxDetectExplosiveMove(classified, i, dir, cfg.minLegCandles);
    if (!move.isExplosive) continue;

    const base = ffxFindBaseCluster(classified, move.startIdx, cfg.maxBaseCandles);
    if (!base) continue;
    tryAdd(move, base, dir);
  }

  // Pass 2: Displacement scan
  const MIN_DISP_ATR = 1.5;
  for (let i = cfg.atrPeriod + 1; i < classified.length - 2; i++) {
    if (usedIndices.has(i)) continue;
    const c = classified[i];
    if (!c || c.classification !== "base") continue;

    let clusterEnd = i;
    for (let j = i + 1; j < classified.length && clusterEnd - i + 1 < cfg.maxBaseCandles; j++) {
      if (usedIndices.has(j) || !classified[j] || classified[j].classification !== "base") break;
      clusterEnd = j;
    }
    const baseLen = clusterEnd - i + 1;
    if (baseLen > cfg.maxBaseCandles) { i = clusterEnd; continue; }

    const legInIdx = i - 1;
    if (legInIdx < cfg.atrPeriod || usedIndices.has(legInIdx)) continue;
    const legIn = classified[legInIdx];
    if (!legIn || legIn.bodyVsAtr < 0.5 || legIn.bodyRatio < 0.3) continue;

    const legOutStart = clusterEnd + 1;
    if (legOutStart >= classified.length) continue;

    const localAtr = atrValues[clusterEnd] || atrValues[atrValues.length - 1] || 0;
    if (localAtr <= 0) continue;
    const minDisp = localAtr * MIN_DISP_ATR;

    const baseCandles = classified.slice(i, clusterEnd + 1);
    const baseHigh = Math.max(...baseCandles.map((b) => b.high));
    const baseLow = Math.min(...baseCandles.map((b) => b.low));

    let maxUpDisp = 0, upEnd = legOutStart;
    for (let j = legOutStart; j < Math.min(legOutStart + 5, classified.length); j++) {
      if (usedIndices.has(j) || !classified[j]) break;
      const h = classified[j].high;
      if (h - baseHigh > maxUpDisp) { maxUpDisp = h - baseHigh; upEnd = j; }
    }

    let maxDownDisp = 0, downEnd = legOutStart;
    for (let j = legOutStart; j < Math.min(legOutStart + 5, classified.length); j++) {
      if (usedIndices.has(j) || !classified[j]) break;
      const l = classified[j].low;
      if (baseLow - l > maxDownDisp) { maxDownDisp = baseLow - l; downEnd = j; }
    }

    if (maxUpDisp >= minDisp && maxUpDisp >= maxDownDisp) {
      const base = { legInIdx, startIdx: i, endIdx: clusterEnd, candles: baseCandles };
      const move = { startIdx: legOutStart, endIdx: upEnd };
      if (tryAdd(move, base, "up")) { i = clusterEnd; continue; }
    }
    if (maxDownDisp >= minDisp && maxDownDisp > maxUpDisp) {
      const base = { legInIdx, startIdx: i, endIdx: clusterEnd, candles: baseCandles };
      const move = { startIdx: legOutStart, endIdx: downEnd };
      if (tryAdd(move, base, "down")) { i = clusterEnd; continue; }
    }
  }

  rawCandidates.sort((a, b) => b.scores.total - a.scores.total);
  const deduped = [];
  const dropped = new Set();

  for (const z of rawCandidates) {
    if (dropped.has(z.id)) continue;
    const dup = deduped.some((acc) => acc.type === z.type && ffxZonesOverlap(acc, z) > 0.25);
    if (dup) {
      dropped.add(z.id);
      continue;
    }
    deduped.push(z);
  }

  const demandZones = deduped.filter((z) => z.type === "demand");
  const supplyZones = deduped.filter((z) => z.type === "supply");

  return {
    zones: deduped,
    demandZones,
    supplyZones,
  };
}

// ─── 2. TREND DETECTOR (SWINGS & STRUCTURE) ──────────────────

function ffxDefaultSwingStrength(tf) {
  switch (String(tf || "").toLowerCase()) {
    case "1m":
    case "3m":
    case "5m":
    case "15m":
      return 3;
    default:
      return 5;
  }
}

function ffxDetectSwingPoints(candles, strength = 3) {
  const str = parseInt(strength, 10) || 3;
  const swings = [];
  const n = candles ? candles.length : 0;
  if (n < str * 2 + 1) return swings;

  for (let i = str; i < n - str; i++) {
    const c = candles[i];
    if (!c) continue;
    let isLow = true;
    let isHigh = true;

    for (let j = 1; j <= str; j++) {
      const prev = candles[i - j];
      const next = candles[i + j];
      if (!prev || !next) continue;
      if (prev.high >= c.high || next.high >= c.high) isHigh = false;
      if (prev.low <= c.low || next.low <= c.low) isLow = false;
    }

    if (isHigh) {
      swings.push({ id: ffxUid("sw_h"), type: "high", price: c.high, time: c.time, label: "H", index: i, candleIndex: i });
    }
    if (isLow) {
      swings.push({ id: ffxUid("sw_l"), type: "low", price: c.low, time: c.time, label: "L", index: i, candleIndex: i });
    }
  }

  return ffxDeduplicateSwings(swings);
}

function ffxDeduplicateSwings(swings) {
  if (!swings || swings.length <= 1) return swings || [];
  const result = [swings[0]];
  for (let i = 1; i < swings.length; i++) {
    const curr = swings[i];
    const prev = result[result.length - 1];
    if (!curr || !prev) continue;
    if (curr.type === prev.type) {
      if (curr.type === "low" && curr.price < prev.price) result[result.length - 1] = curr;
      else if (curr.type === "high" && curr.price > prev.price) result[result.length - 1] = curr;
    } else {
      result.push(curr);
    }
  }
  return result;
}

function ffxFilterSwingsByAtr(swings, atrValues, minSegmentAtr = 0.5) {
  const minAtr = parseFloat(minSegmentAtr) || 0.5;
  if (!swings || swings.length <= 2 || minAtr <= 0) return swings || [];
  const result = [swings[0]];
  for (let i = 1; i < swings.length; i++) {
    const curr = swings[i];
    const prev = result[result.length - 1];
    if (!curr || !prev) continue;
    const atrAtSwing = atrValues[curr.index] || atrValues[atrValues.length - 1] || 0;
    if (atrAtSwing <= 0) { result.push(curr); continue; }
    const dist = Math.abs(curr.price - prev.price);
    if (dist >= atrAtSwing * minAtr) result.push(curr);
  }
  return result;
}

function ffxBuildSegments(swings) {
  const segments = [];
  if (!swings || swings.length < 2) return segments;
  for (let i = 0; i < swings.length - 1; i++) {
    const from = swings[i];
    const to = swings[i + 1];
    if (!from || !to) continue;
    segments.push({
      id: ffxUid("seg"),
      from,
      to,
      direction: to.price > from.price ? "up" : "down",
      isBreakout: false,
    });
  }
  return segments;
}

function ffxIdentifyTrend(swings, currentPrice, terminationBuffer = 0) {
  if (!swings || swings.length < 4) {
    return { direction: null, status: "forming", controllingSwing: null };
  }
  const recentLows = [];
  const recentHighs = [];
  for (let i = swings.length - 1; i >= 0 && (recentLows.length < 3 || recentHighs.length < 3); i--) {
    const sw = swings[i];
    if (!sw) continue;
    if (sw.type === "low" && recentLows.length < 3) recentLows.unshift(sw);
    if (sw.type === "high" && recentHighs.length < 3) recentHighs.unshift(sw);
  }

  // Uptrend check
  if (recentLows.length >= 2 && recentHighs.length >= 2) {
    const prevL = recentLows[recentLows.length - 2], lastL = recentLows[recentLows.length - 1];
    const prevH = recentHighs[recentHighs.length - 2], lastH = recentHighs[recentHighs.length - 1];
    if (lastL && prevL && lastH && prevH && lastL.price > prevL.price && lastH.price > prevH.price && lastL.time > prevH.time) {
      const controllingSwing = lastL;
      const status = currentPrice < controllingSwing.price - terminationBuffer ? "terminated" : "confirmed";
      return { direction: "up", status, controllingSwing };
    }
  }

  // Downtrend check
  if (recentLows.length >= 2 && recentHighs.length >= 2) {
    const prevH = recentHighs[recentHighs.length - 2], lastH = recentHighs[recentHighs.length - 1];
    const prevL = recentLows[recentLows.length - 2], lastL = recentLows[recentLows.length - 1];
    if (lastH && prevH && lastL && prevL && lastH.price < prevH.price && lastL.price < prevL.price && lastH.time > prevL.time) {
      const controllingSwing = lastH;
      const status = currentPrice > controllingSwing.price + terminationBuffer ? "terminated" : "confirmed";
      return { direction: "down", status, controllingSwing };
    }
  }

  return { direction: null, status: "forming", controllingSwing: null };
}

function ffxLabelSwingPoints(swings) {
  if (!swings) return;
  let lastH = null, lastL = null;
  for (const sw of swings) {
    if (!sw) continue;
    if (sw.type === "high") {
      sw.label = !lastH ? "H" : sw.price > lastH.price ? "HH" : "LH";
      lastH = sw;
    } else {
      sw.label = !lastL ? "L" : sw.price > lastL.price ? "HL" : "LL";
      lastL = sw;
    }
  }
}

function ffxDetectTrend(candles, timeframe = "15m", config = {}) {
  const strengthVal = parseInt(config.swingStrength, 10) || ffxDefaultSwingStrength(timeframe);
  const cfg = {
    swingStrength: strengthVal,
    minSegmentAtr: parseFloat(config.minSegmentAtr) ?? 0.5,
    maxSwingPoints: parseInt(config.maxSwingPoints, 10) || 25,
  };

  const n = candles ? candles.length : 0;
  if (n < 15) {
    return { direction: null, status: "forming", swingPoints: [], segments: [], controllingSwing: null };
  }

  const lastCandle = candles[n - 1];
  const currentPrice = lastCandle ? lastCandle.close : 0;
  const atrValues = ffxComputeATR(candles, 14);
  const currentAtr = atrValues[atrValues.length - 1] || 0;

  const rawSwings = ffxDetectSwingPoints(candles, cfg.swingStrength);
  const filtered = ffxFilterSwingsByAtr(rawSwings, atrValues, cfg.minSegmentAtr);
  const swings = filtered.slice(-cfg.maxSwingPoints);

  if (swings.length < 3) {
    return { direction: null, status: "forming", swingPoints: swings, segments: [], controllingSwing: null };
  }

  const segments = ffxBuildSegments(swings);
  const terminationBuffer = currentAtr * 0.25;
  const identified = ffxIdentifyTrend(swings, currentPrice, terminationBuffer);
  ffxLabelSwingPoints(swings);

  return {
    direction: identified.direction,
    status: identified.status,
    swingPoints: swings,
    segments,
    controllingSwing: identified.controllingSwing,
    currentPrice,
  };
}

// ─── 3. SMC (SMART MONEY CONCEPTS) ───────────────────────────

function ffxDetectMarketStructure(swings) {
  const events = [];
  if (!swings || swings.length < 4) return events;

  let trend = "none";
  let lastHigh = null;
  let lastLow = null;

  const emit = (broken, dir, time, breakIdx) => {
    const isContinuation = (dir === "bullish" && trend === "up") || (dir === "bearish" && trend === "down");
    const isReversal = (dir === "bullish" && trend === "down") || (dir === "bearish" && trend === "up");
    const type = isReversal ? "choch" : "bos";

    events.push({
      id: ffxUid("smc_struct"),
      type,
      direction: dir,
      level: broken.price,
      time,
      breakIndex: breakIdx,
      swingBroken: broken,
    });
    trend = dir === "bullish" ? "up" : "down";
  };

  for (const swing of swings) {
    if (!swing) continue;
    if (swing.type === "high") {
      if (lastHigh && lastLow && swing.price > lastHigh.price) {
        emit(lastHigh, "bullish", swing.time, swing.index);
      }
      lastHigh = swing;
    } else {
      if (lastLow && lastHigh && swing.price < lastLow.price) {
        emit(lastLow, "bearish", swing.time, swing.index);
      }
      lastLow = swing;
    }
  }

  return events;
}

function ffxDetectFairValueGaps(candles, minGapPips = 0) {
  const gaps = [];
  if (!candles || candles.length < 3) return gaps;
  const minPips = parseFloat(minGapPips) || 0;

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];
    if (!prev || !curr || !next) continue;

    // Bullish FVG: prev.high < next.low
    if (prev.high < next.low) {
      const gapSize = next.low - prev.high;
      if (gapSize >= minPips) {
        let mitigated = false;
        let mitigatedIndex = null;
        for (let j = i + 2; j < candles.length; j++) {
          const c = candles[j];
          if (!c) continue;
          const bodyLow = Math.min(c.open, c.close);
          if (bodyLow <= next.low) {
            mitigated = true;
            mitigatedIndex = j;
            break;
          }
        }
        gaps.push({
          id: ffxUid("fvg_bull"),
          type: "bullish",
          high: next.low,
          low: prev.high,
          midpoint: (next.low + prev.high) / 2,
          gapSize,
          time: curr.time,
          index: i,
          mitigated,
          mitigatedIndex,
        });
      }
    }

    // Bearish FVG: prev.low > next.high
    if (prev.low > next.high) {
      const gapSize = prev.low - next.high;
      if (gapSize >= minPips) {
        let mitigated = false;
        let mitigatedIndex = null;
        for (let j = i + 2; j < candles.length; j++) {
          const c = candles[j];
          if (!c) continue;
          const bodyHigh = Math.max(c.open, c.close);
          if (bodyHigh >= next.high) {
            mitigated = true;
            mitigatedIndex = j;
            break;
          }
        }
        gaps.push({
          id: ffxUid("fvg_bear"),
          type: "bearish",
          high: prev.low,
          low: next.high,
          midpoint: (prev.low + next.high) / 2,
          gapSize,
          time: curr.time,
          index: i,
          mitigated,
          mitigatedIndex,
        });
      }
    }
  }

  return gaps;
}

function ffxDetectOrderBlocks(candles, swings, minDisplacementMult = 2.0) {
  const blocks = [];
  if (!candles || candles.length < 5) return blocks;
  const mult = parseFloat(minDisplacementMult) || 2.0;

  const swingIdxByType = {
    high: new Set((swings || []).filter((s) => s && s.type === "high").map((s) => s.index)),
    low: new Set((swings || []).filter((s) => s && s.type === "low").map((s) => s.index)),
  };

  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i];
    if (!c) continue;
    const bodySize = Math.abs(c.close - c.open);
    if (bodySize === 0) continue;

    // Bullish OB: bearish candle before strong up move
    if (c.close < c.open) {
      for (let j = i + 1; j < Math.min(i + 6, candles.length); j++) {
        const cj = candles[j];
        if (!cj) continue;
        if (swingIdxByType.high.has(j) || cj.close > c.high) {
          const move = cj.high - c.low;
          if (move >= bodySize * mult) {
            blocks.push({
              id: ffxUid("ob_bull"),
              type: "bullish",
              high: c.high,
              low: c.low,
              time: c.time,
              index: i,
              displacement: move,
            });
            break;
          }
        }
      }
    }

    // Bearish OB: bullish candle before strong down move
    if (c.close > c.open) {
      for (let j = i + 1; j < Math.min(i + 6, candles.length); j++) {
        const cj = candles[j];
        if (!cj) continue;
        if (swingIdxByType.low.has(j) || cj.close < c.low) {
          const move = c.high - cj.low;
          if (move >= bodySize * mult) {
            blocks.push({
              id: ffxUid("ob_bear"),
              type: "bearish",
              high: c.high,
              low: c.low,
              time: c.time,
              index: i,
              displacement: move,
            });
            break;
          }
        }
      }
    }
  }

  return blocks;
}

function ffxDetectEqualLevels(swings, tolerancePct = 0.15) {
  if (!swings || swings.length < 2) return [];
  const tol = parseFloat(tolerancePct) || 0.15;
  const highs = swings.filter((s) => s && s.type === "high");
  const lows = swings.filter((s) => s && s.type === "low");

  const group = (arr, type) => {
    const levels = [];
    const used = new Set();
    for (let i = 0; i < arr.length; i++) {
      if (used.has(i)) continue;
      const anchor = arr[i];
      if (!anchor) continue;
      const grp = [anchor];
      const thresh = anchor.price * (tol / 100);

      for (let j = i + 1; j < arr.length; j++) {
        if (!used.has(j) && arr[j] && Math.abs(arr[j].price - anchor.price) <= thresh) {
          grp.push(arr[j]);
          used.add(j);
        }
      }

      if (grp.length >= 2) {
        used.add(i);
        const avgP = grp.reduce((s, x) => s + x.price, 0) / grp.length;
        levels.push({
          id: ffxUid(type),
          type,
          price: avgP,
          count: grp.length,
          swings: grp,
        });
      }
    }
    return levels;
  };

  return [...group(highs, "equal_highs"), ...group(lows, "equal_lows")];
}

function ffxDetectLiquiditySweeps(candles, swings, tolerancePct = 0.15) {
  const sweeps = [];
  if (!candles || !swings || swings.length < 3) return sweeps;
  const equalLevels = ffxDetectEqualLevels(swings, tolerancePct);

  for (const level of equalLevels) {
    const validSwings = level.swings.filter(Boolean);
    if (validSwings.length === 0) continue;
    const lastSwingIdx = Math.max(...validSwings.map((s) => s.index));
    for (let i = lastSwingIdx + 1; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      const isHighSweep = level.type === "equal_highs" && c.high > level.price && c.close < level.price;
      const isLowSweep = level.type === "equal_lows" && c.low < level.price && c.close > level.price;

      if (isHighSweep || isLowSweep) {
        sweeps.push({
          id: ffxUid("sweep"),
          type: isLowSweep ? "bullish" : "bearish",
          level: level.price,
          sweepHigh: c.high,
          sweepLow: c.low,
          time: c.time,
          index: i,
        });
        break;
      }
    }
  }

  return sweeps;
}

function ffxDetectSMC(candles, config = {}) {
  const cfg = {
    swingStrength: parseInt(config.swingStrength, 10) || 3,
    minDisplacementMult: parseFloat(config.minDisplacementMult) || 2.0,
    tolerancePct: parseFloat(config.tolerancePct) || 0.15,
    minGapPips: parseFloat(config.minGapPips) || 0,
  };

  if (!candles || candles.length < 10) {
    return { swings: [], structureEvents: [], fvgs: [], orderBlocks: [], sweeps: [], equalLevels: [] };
  }

  const swings = ffxDetectSwingPoints(candles, cfg.swingStrength);
  const structureEvents = ffxDetectMarketStructure(swings);
  const fvgs = ffxDetectFairValueGaps(candles, cfg.minGapPips);
  const orderBlocks = ffxDetectOrderBlocks(candles, swings, cfg.minDisplacementMult);
  const sweeps = ffxDetectLiquiditySweeps(candles, swings, cfg.tolerancePct);
  const equalLevels = ffxDetectEqualLevels(swings, cfg.tolerancePct);

  return {
    swings,
    structureEvents,
    fvgs,
    orderBlocks,
    sweeps,
    equalLevels,
  };
}

// ─── 4. STRUCTURAL CONFIRMATION (BREAKEVEN / TRADES) ──────────

function ffxCheckStructuralConfirmation(direction, entryPrice, candles, lookback = 3) {
  const lb = parseInt(lookback, 10) || 3;
  if (!candles || candles.length < lb * 2 + 1) {
    return { confirmed: false, swingPrice: null, reason: "Insufficient candles for structural check" };
  }

  const isLong = direction === "long" || direction === 1;

  if (isLong) {
    for (let i = lb; i < candles.length - lb; i++) {
      const c = candles[i];
      if (!c) continue;
      const low = c.low;
      let isSwingLow = true;
      for (let j = 1; j <= lb; j++) {
        const prev = candles[i - j];
        const next = candles[i + j];
        if (!prev || !next) continue;
        if (prev.low <= low || next.low <= low) {
          isSwingLow = false; break;
        }
      }
      if (isSwingLow && low > entryPrice) {
        return {
          confirmed: true,
          swingPrice: low,
          reason: `Higher Low formed at ${low.toFixed(4)} (above entry ${entryPrice.toFixed(4)})`,
        };
      }
    }
    return { confirmed: false, swingPrice: null, reason: "No Higher Low formed above entry yet" };
  } else {
    for (let i = lb; i < candles.length - lb; i++) {
      const c = candles[i];
      if (!c) continue;
      const high = c.high;
      let isSwingHigh = true;
      for (let j = 1; j <= lb; j++) {
        const prev = candles[i - j];
        const next = candles[i + j];
        if (!prev || !next) continue;
        if (prev.high >= high || next.high >= high) {
          isSwingHigh = false; break;
        }
      }
      if (isSwingHigh && high < entryPrice) {
        return {
          confirmed: true,
          swingPrice: high,
          reason: `Lower High formed at ${high.toFixed(4)} (below entry ${entryPrice.toFixed(4)})`,
        };
      }
    }
    return { confirmed: false, swingPrice: null, reason: "No Lower High formed below entry yet" };
  }
}

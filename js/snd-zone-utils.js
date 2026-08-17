// ============================================================
// snd-zone-utils.js — TIỆN ÍCH CẤU TRÚC ZONE
// Port từ zone-utils.ts của ForexFlow:
//   - detectExplosiveMove  → phát hiện LEG-OUT
//   - findBaseCluster      → tách BASE ngay trước leg-out
//   - computeFreshness     → testCount / penetration / invalidated
//   - zonesOverlap         → dedup
// ============================================================

// ─── Explosive Move (LEG-OUT) ────────────────────────────────
// Bắt đầu tại một nến leg. Cho phép tối đa 1 nến không phải leg xen giữa
// (vd: pullback nhỏ) nhưng nến đó vẫn phải đóng đúng hướng. endIdx luôn
// trỏ về nến leg thật cuối cùng — nến trung gian không được tính vào leg.
function sndDetectExplosiveMove(candles, startIdx, direction, minLegCandles) {
  const MAX_GAP = 1;
  let lastLegIdx = -1;
  let legCount = 0;
  let gapCount = 0;

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const isLeg = c.classification === "leg";
    const correctDirection = direction === "up" ? c.isBullish : !c.isBullish;

    if (i === startIdx) {
      if (!isLeg || !correctDirection) break;
      legCount++;
      lastLegIdx = i;
      continue;
    }

    // Mọi nến sau đó phải đóng đúng hướng
    const prevClose = candles[i - 1].close;
    const closesInDirection = direction === "up" ? c.close > prevClose : c.close < prevClose;
    if (!closesInDirection) break;

    if (isLeg && correctDirection) {
      legCount++;
      lastLegIdx = i;
      gapCount = 0;
    } else {
      gapCount++;
      if (gapCount > MAX_GAP) break;
    }
  }

  return {
    startIdx,
    endIdx: lastLegIdx >= startIdx ? lastLegIdx : startIdx,
    isExplosive: legCount >= minLegCandles,
    consecutiveLegs: legCount,
    direction,
  };
}

// ─── Base Cluster ────────────────────────────────────────────
// Đi ngược từ leg-out để tìm BASE. CHỈ các nến được phân loại "base"
// mới thuộc cluster; nến leg/neutral chấm dứt bước đi. Nến leg-in (ngay
// trước base) phải là leg hoặc gần-leg (bodyVsAtr >= 0.7, bodyRatio >= 0.35).
function sndFindBaseCluster(candles, legOutIdx, maxBaseCandles, legInAtrThreshold = 0.7) {
  const baseCandles = [];
  let baseStartIdx = legOutIdx - 1;

  for (let i = legOutIdx - 1; i >= 0; i--) {
    const c = candles[i];

    if (c.classification !== "base") {
      baseStartIdx = i + 1;
      break;
    }

    baseCandles.unshift(c);
    baseStartIdx = i;

    if (baseCandles.length > maxBaseCandles) return null;
    if (i === 0) return null;
  }

  if (baseCandles.length === 0) return null;

  const legInIdx = baseStartIdx - 1;
  if (legInIdx < 0) return null;

  const legIn = candles[legInIdx];
  const isValidLegIn =
    legIn.classification === "leg" ||
    (legIn.bodyVsAtr >= legInAtrThreshold && legIn.bodyRatio >= 0.35);
  if (!isValidLegIn) return null;

  return {
    startIdx: baseStartIdx,
    endIdx: legOutIdx - 1,
    candles: baseCandles,
    legInIdx,
  };
}

// ─── Zone Width ──────────────────────────────────────────────
function sndComputeZoneWidth(proximal, distal) {
  return Math.abs(proximal - distal);
}

// ─── Freshness & Lifecycle ───────────────────────────────────
// Quét các nến SAU leg-out để xác định:
//   testCount          — số lần giá quay lại vùng
//   penetrationPercent — độ xuyên sâu tối đa (0..1)
//   invalidated        — giá đã phá qua distal chưa
//   invalidatedAt/Idx  — thời điểm bị phá
//   status             — fresh | tested | invalidated
function sndComputeFreshness(zoneType, proximal, distal, candles, afterIndex) {
  const zoneWidth = Math.abs(proximal - distal);
  if (zoneWidth === 0) {
    return { testCount: 0, penetrationPercent: 0, invalidated: false, invalidatedAt: null, invalidatedIndex: null, status: "fresh" };
  }

  let testCount = 0;
  let maxPenetration = 0;
  let inZone = false;
  let invalidated = false;
  let invalidatedAt = null;
  let invalidatedIndex = null;

  for (let i = afterIndex; i < candles.length; i++) {
    const c = candles[i];

    if (zoneType === "demand") {
      // Demand: giá đi từ trên xuống vào vùng.
      if (c.low <= proximal) {
        if (!inZone) {
          testCount++;
          inZone = true;
        }
        const penetrationPrice = proximal - c.low;
        const pct = Math.min(penetrationPrice / zoneWidth, 1);
        maxPenetration = Math.max(maxPenetration, pct);
        if (c.low <= distal && !invalidated) {
          invalidated = true;
          invalidatedAt = c.time;
          invalidatedIndex = i;
        }
      } else {
        inZone = false;
      }
    } else {
      // Supply: giá đi từ dưới lên vào vùng.
      if (c.high >= proximal) {
        if (!inZone) {
          testCount++;
          inZone = true;
        }
        const penetrationPrice = c.high - proximal;
        const pct = Math.min(penetrationPrice / zoneWidth, 1);
        maxPenetration = Math.max(maxPenetration, pct);
        if (c.high >= distal && !invalidated) {
          invalidated = true;
          invalidatedAt = c.time;
          invalidatedIndex = i;
        }
      } else {
        inZone = false;
      }
    }
  }

  const status = invalidated ? "invalidated" : testCount > 0 ? "tested" : "fresh";

  return { testCount, penetrationPercent: maxPenetration, invalidated, invalidatedAt, invalidatedIndex, status };
}

// ─── Zone Overlap (dedup) ────────────────────────────────────
// Tỷ lệ chồng lấn = overlap / width của vùng nhỏ hơn.
function sndZonesOverlap(a, b) {
  const aLow = Math.min(a.proximal, a.distal);
  const aHigh = Math.max(a.proximal, a.distal);
  const bLow = Math.min(b.proximal, b.distal);
  const bHigh = Math.max(b.proximal, b.distal);

  const overlapLow = Math.max(aLow, bLow);
  const overlapHigh = Math.min(aHigh, bHigh);
  if (overlapHigh <= overlapLow) return 0;

  const overlapWidth = overlapHigh - overlapLow;
  const smallerWidth = Math.min(aHigh - aLow, bHigh - bLow);
  return smallerWidth > 0 ? overlapWidth / smallerWidth : 0;
}
// ============================================================
// snd-zone-scorer.js — CHẤM ĐIỂM ZONE (0..100)
// Adapt 3 Odds Enhancers của ForexFlow (Strength/Time/Freshness)
// sang thang điểm 0..100:
//
//   Strength  (0..2):   move-out so với zone width (0..1.5)
//                       + phá qua zone đối lập trước đó (0..0.5)
//   Time      (0..1):   số nến base càng ít càng tốt (1-3 → 1)
//   Freshness (0..2):   chưa test → 2, test nông → 1, test sâu → 0
//
//   total = 0..5  →  score = round(total / 5 * 100)
// ============================================================

function sndScoreStrength(zone, classified, opposing, config) {
  const zoneWidth = Math.abs(zone.proximal - zone.distal);

  // Extreme của leg-out: demand lấy high cao nhất, supply lấy low thấp nhất
  let moveOutExtreme;
  if (zone.type === "demand") {
    moveOutExtreme = -Infinity;
    for (let i = zone.legOut.startIndex; i <= zone.legOut.endIndex; i++) {
      moveOutExtreme = Math.max(moveOutExtreme, classified[i].high);
    }
  } else {
    moveOutExtreme = Infinity;
    for (let i = zone.legOut.startIndex; i <= zone.legOut.endIndex; i++) {
      moveOutExtreme = Math.min(moveOutExtreme, classified[i].low);
    }
  }

  const moveOutDistance =
    zone.type === "demand" ? moveOutExtreme - zone.proximal : zone.proximal - moveOutExtreme;
  const moveOutMultiple = zoneWidth > 0 ? moveOutDistance / zoneWidth : 0;
  // 1.0 lúc đạt threshold, cấp tối đa 1.5 (departure càng mạnh điểm càng cao)
  const moveOutScore = Math.min(1.5, moveOutMultiple / config.minMoveOutMultiple);

  // Breakout: leg-out phá qua proximal của zone đối lập hình thành trước đó
  let breakoutScore = 0;
  let breakoutExplanation = "no opposing zone breakout";
  for (const opp of opposing) {
    if (opp.base.endIndex >= zone.base.startIndex) continue;

    if (zone.type === "demand" && opp.type === "supply") {
      if (moveOutExtreme > opp.proximal) {
        breakoutScore = 0.5;
        breakoutExplanation = "broke past opposing supply zone";
        break;
      }
    } else if (zone.type === "supply" && opp.type === "demand") {
      if (moveOutExtreme < opp.proximal) {
        breakoutScore = 0.5;
        breakoutExplanation = "broke past opposing demand zone";
        break;
      }
    }
  }

  const strength = moveOutScore + breakoutScore;
  return {
    value: strength,
    max: 2,
    moveOutMultiple,
    moveOutScore,
    breakoutScore,
    explanation:
      `moveOut ${moveOutMultiple.toFixed(2)}x zoneWidth, ` +
      (breakoutScore > 0 ? breakoutExplanation : "no breakout"),
  };
}

function sndScoreTime(baseCandles) {
  let value, label, explanation;
  if (baseCandles <= 3) {
    value = 1;
    label = "Best";
    explanation = `${baseCandles} basing candle(s) — minimal time at zone`;
  } else if (baseCandles <= 6) {
    value = 0.5;
    label = "Good";
    explanation = `${baseCandles} basing candles — moderate time at zone`;
  } else {
    value = 0;
    label = "Poor";
    explanation = `${baseCandles} basing candles — extended time at zone`;
  }
  return { value, max: 1, label, explanation };
}

function sndScoreFreshness(zone, classified, config) {
  const freshness = sndComputeFreshness(
    zone.type,
    zone.proximal,
    zone.distal,
    classified,
    zone.legOut.endIndex + 1,
  );

  let value, label, explanation;
  if (freshness.testCount === 0) {
    value = 2;
    label = "Best";
    explanation = "Zone never tested — maximum unfilled orders remain";
  } else if (freshness.penetrationPercent <= config.freshTestedThreshold) {
    value = 1;
    label = "Good";
    explanation = `Tested ${freshness.testCount} time(s), ~${Math.round(freshness.penetrationPercent * 100)}% penetration`;
  } else {
    value = 0;
    label = "Poor";
    explanation = `Deeply tested (~${Math.round(freshness.penetrationPercent * 100)}% penetration)`;
  }

  return {
    score: { value, max: 2, label, explanation },
    testCount: freshness.testCount,
    penetrationPercent: freshness.penetrationPercent,
  };
}

// Score tổng hợp. `opposing` là các candidate loại ngược lại.
function sndScoreZone(zone, classified, opposing, config) {
  const strength = sndScoreStrength(zone, classified, opposing, config);
  const time = sndScoreTime(zone.base.candles);
  const freshness = sndScoreFreshness(zone, classified, config);

  const total = strength.value + time.value + freshness.score.value;
  const score = Math.round((total / 5) * 100);

  return {
    scores: { strength, time, freshness: freshness.score, total },
    score,
    testCount: freshness.testCount,
    penetrationPercent: freshness.penetrationPercent,
  };
}

// ============================================================
// EXTENDED SCORING (port từ scoreZoneExtended của ForexFlow)
// 7 Odds Enhancers: Strength + Time + Freshness (base 0-5)
//                  + Trend + Momentum + Profit Zone + Compound (0-7)
// extendedTotal: 0-12 → proScore: 0-100
// ctx = {
//   trendData,        // từ ffxDetectTrend
//   allZones,         // các zone đã detect (cho R:R tới zone đối lập)
//   currentPrice,     // giá hiện tại
//   momentumValue,    // 0-1 từ ffxScoreMomentum (tính ở app layer)
//   compoundCount,    // từ ffxDetectCompoundZones
// }
// ============================================================

// Trend alignment: demand + uptrend / supply + downtrend.
function sndScoreTrend(zoneType, trendData) {
  if (!trendData || !trendData.direction) {
    return { value: 0, max: 2, label: "Poor", explanation: "No trend detected" };
  }
  const aligned =
    (zoneType === "demand" && trendData.direction === "up") ||
    (zoneType === "supply" && trendData.direction === "down");
  if (!aligned) {
    return {
      value: 0,
      max: 2,
      label: "Poor",
      explanation: `${trendData.direction === "up" ? "Uptrend" : "Downtrend"} opposes ${zoneType} zone`,
    };
  }
  if (trendData.status === "confirmed") {
    return { value: 2, max: 2, label: "Best", explanation: `Confirmed ${trendData.direction}trend aligns with ${zoneType} zone` };
  }
  if (trendData.status === "forming") {
    return { value: 1, max: 2, label: "Good", explanation: `Forming ${trendData.direction}trend aligns with ${zoneType} zone` };
  }
  return { value: 0, max: 2, label: "Poor", explanation: "Trend terminated" };
}

// Profit zone: R:R tới zone đối lập còn fresh gần nhất.
// ≥3:1 → 3, ≥2:1 → 2, ≥1:1 → 1, <1:1 hoặc không có → 0 (fallback 2:1).
function sndScoreProfitZone(zone, allZones) {
  const risk = Math.abs(zone.proximal - zone.distal);
  if (risk === 0) return { value: 0, max: 3, label: "Poor", explanation: "Zero risk distance" };

  const opposingType = zone.type === "demand" ? "supply" : "demand";
  const freshOpposing = (allZones || [])
    .filter((z) => z.type === opposingType && z.status === "fresh" && z.testCount === 0)
    .sort((a, b) => (zone.type === "demand" ? a.proximal - b.proximal : b.proximal - a.proximal));

  let reward, tpSource;
  if (freshOpposing.length > 0) {
    reward = Math.abs(freshOpposing[0].proximal - zone.proximal);
    tpSource = "opposing fresh zone";
  } else {
    reward = risk * 2;
    tpSource = "2:1 fallback (no opposing zone)";
  }

  const rr = reward / risk;
  let value, label;
  if (rr >= 3) { value = 3; label = "Best"; }
  else if (rr >= 2) { value = 2; label = "Good"; }
  else if (rr >= 1) { value = 1; label = "Fair"; }
  else { value = 0; label = "Poor"; }

  return { value, max: 3, label, explanation: `${rr.toFixed(1)}:1 R:R to ${tpSource}` };
}

// Extended scoring tổng hợp. Trả về đầy đủ breakdown + proScore.
function sndScoreZoneExtended(zone, classified, opposing, config, ctx = {}) {
  const base = sndScoreZone(zone, classified, opposing, config);
  const trend = sndScoreTrend(zone.type, ctx.trendData);
  const profitZone = sndScoreProfitZone(zone, ctx.allZones);

  const momentumValue = ctx.momentumValue ?? 0;
  const compoundCount = ctx.compoundCount ?? 0;
  const momentum = {
    value: Math.max(0, Math.min(1, momentumValue)),
    max: 1,
    label: "Momentum",
    explanation: momentumValue > 0 ? "RSI confluence at zone" : "No momentum confluence",
  };
  const compound = {
    value: ffxCompoundBonus(compoundCount),
    max: 1,
    label: "Compound",
    explanation: compoundCount >= 1 ? `Part of ${compoundCount + 1}-zone compound cluster` : "Standalone zone",
  };

  const extendedTotal = Math.round((base.scores.total + trend.value + momentum.value + profitZone.value + compound.value) * 100) / 100;
  const proScore = Math.round((extendedTotal / 12) * 100);

  return {
    base,
    trend,
    momentum,
    profitZone,
    compound,
    compoundCount,
    extendedTotal,
    proScore,
  };
}
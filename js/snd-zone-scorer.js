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
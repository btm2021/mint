// ============================================================
// snd-candle-classifier.js — PHÂN LOẠI NẾN (LEG / BASE / NEUTRAL)
// Port trung thành logic classifyCandles của ForexFlow.
//
// LEG:   thân nến mạnh theo cả bodyRatio lẫn bodyVsAtr
// BASE:  thân nến nhỏ theo bodyRatio VÀ nhỏ theo bodyVsAtr
//        (cả hai điều kiện cùng thoả — nến mạnh không được xếp BASE)
// NEUTRAL: mọi trường hợp còn lại
// ============================================================

function sndClassifyCandles(candles, config) {
  const atr = sndComputeATR(candles, config.atrPeriod);

  return candles.map((c, i) => {
    const bodySize = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const bodyRatio = range > 0 ? bodySize / range : 0;
    const isBullish = c.close >= c.open;
    const bodyVsAtr = atr[i] > 0 ? bodySize / atr[i] : 0;

    let classification;
    if (bodyRatio >= config.minLegBodyRatio && bodyVsAtr >= config.minLegBodyAtr) {
      classification = "leg";
    } else if (bodyRatio <= config.maxBaseBodyRatio && bodyVsAtr < config.minLegBodyAtr * 0.8) {
      classification = "base";
    } else {
      classification = "neutral";
    }

    return {
      ...c,
      index: i,
      atr: atr[i],
      classification,
      bodySize,
      range,
      bodyRatio,
      isBullish,
      bodyVsAtr,
    };
  });
}
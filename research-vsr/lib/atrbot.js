// Tái hiện trạng thái trend của ATRBot (mặc định: EMA(close,30) + ATR(14) x2)
// từ calculateATRBot trong js/indicators.js — chỉ lấy state (1 = uptrend, -1 = downtrend).
export function calculateTrendStates(bars, atrLen = 14, maLen = 30, mult = 2) {
  const n = bars.length;
  const alpha = 2 / (maLen + 1);
  const trail1 = new Array(n);
  const atr = new Array(n);

  for (let i = 0; i < n; i++) {
    const tr = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - bars[i - 1].close),
          Math.abs(bars[i].low - bars[i - 1].close),
        );
    atr[i] = i === 0 ? tr : (atr[i - 1] * (atrLen - 1) + tr) / atrLen;
    trail1[i] = i === 0 ? bars[i].close : alpha * bars[i].close + (1 - alpha) * trail1[i - 1];
  }

  const trail2 = new Array(n);
  const states = new Array(n);
  for (let i = 0; i < n; i++) {
    const loss = atr[i] * mult;
    const t1 = trail1[i];
    const prevT2 = i === 0 ? 0 : trail2[i - 1];
    const prevT1 = i === 0 ? t1 : trail1[i - 1];
    if (t1 > prevT2) {
      trail2[i] = prevT1 > prevT2 ? Math.max(prevT2, t1 - loss) : t1 - loss;
    } else {
      trail2[i] = t1 < prevT2 && prevT1 < prevT2 ? Math.min(prevT2, t1 + loss) : t1 + loss;
    }
    states[i] = t1 > trail2[i] ? 1 : -1;
  }
  return states;
}

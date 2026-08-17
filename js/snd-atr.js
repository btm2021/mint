// ============================================================
// snd-atr.js — WILDER ATR (port của ForexFlow computeATR)
// Seeded bằng SMA của period đầu, sau đó Wilder smoothing.
// ============================================================

function sndComputeATR(candles, period) {
  const n = candles.length;
  if (n === 0) return [];

  const atr = new Array(n).fill(0);

  // True Range (candle đầu dùng high-low)
  const tr = new Array(n);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }

  if (n < period) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += tr[i];
      atr[i] = sum / (i + 1);
    }
    return atr;
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
    atr[i] = sum / (i + 1);
  }
  atr[period - 1] = sum / period;

  for (let i = period; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}
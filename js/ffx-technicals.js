// ============================================================
// ffx-technicals.js — TECHNICAL INDICATORS (port từ ForexFlow
// technical-indicators.ts): EMA, RSI, MACD, Bollinger, ADX,
// Williams %R, Stochastic. Pure functions, không phụ thuộc DOM.
// ============================================================

function ffxCloses(candles) {
  return candles.map((c) => c.close);
}

function ffxEmaSeries(data, period) {
  const k = 2 / (period + 1);
  const result = [];
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) {
    sum += data[i];
    result.push(sum / (i + 1));
  }
  for (let i = period; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function ffxComputeEMASeries(candles, period) {
  const data = ffxCloses(candles);
  if (data.length === 0 || period < 1) return [];
  return ffxEmaSeries(data, period);
}

function ffxComputeEMA(candles, period) {
  if (candles.length < period) return null;
  const series = ffxComputeEMASeries(candles, period);
  return series[series.length - 1] ?? null;
}

// RSI (Wilder's smoothing)
function ffxComputeRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const data = ffxCloses(candles);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = data[i] - data[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < data.length; i++) {
    const delta = data[i] - data[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function ffxComputeMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow + signal - 1) return null;
  const fastEma = ffxEmaSeries(ffxCloses(candles), fast);
  const slowEma = ffxEmaSeries(ffxCloses(candles), slow);
  const macdLine = candles.map((_, i) => fastEma[i] - slowEma[i]);
  const signalSeries = ffxEmaSeries(macdLine, signal);
  const last = macdLine.length - 1;
  return { macdLine: macdLine[last], signalLine: signalSeries[last], histogram: macdLine[last] - signalSeries[last] };
}

function ffxComputeBollingerBands(candles, period = 20, stdDevMultiplier = 2.0) {
  if (candles.length < period) return null;
  const data = ffxCloses(candles);
  const slice = data.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const bandwidth = middle !== 0 ? (upper - lower) / middle : 0;
  const range = upper - lower;
  const currentClose = data[data.length - 1];
  const percentB = range !== 0 ? (currentClose - lower) / range : 0.5;
  return { upper, middle, lower, bandwidth, percentB };
}

function ffxComputeWilliamsR(candles, period = 14) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const highestHigh = Math.max(...slice.map((c) => c.high));
  const lowestLow = Math.min(...slice.map((c) => c.low));
  const close = candles[candles.length - 1].close;
  const range = highestHigh - lowestLow;
  if (range === 0) return -50;
  return ((highestHigh - close) / range) * -100;
}

// ADX với +DI/-DI (Wilder's smoothing)
function ffxComputeADX(candles, period = 14) {
  if (candles.length < period * 2) return null;
  const n = candles.length;
  const tr = [candles[0].high - candles[0].low];
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr) => {
    const out = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += arr[i];
    out.push(sum);
    for (let i = period; i < arr.length; i++) {
      out.push(out[out.length - 1] - out[out.length - 1] / period + arr[i]);
    }
    return out;
  };
  const smoothTR = smooth(tr);
  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);
  const dx = [];
  let lastPlusDI = 0, lastMinusDI = 0;
  for (let i = 0; i < smoothTR.length; i++) {
    const atr = smoothTR[i];
    const pdi = atr !== 0 ? (smoothPlusDM[i] / atr) * 100 : 0;
    const mdi = atr !== 0 ? (smoothMinusDM[i] / atr) * 100 : 0;
    const diSum = pdi + mdi;
    dx.push(diSum !== 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
    lastPlusDI = pdi;
    lastMinusDI = mdi;
  }
  if (dx.length < period) return null;
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return { adx, plusDI: lastPlusDI, minusDI: lastMinusDI };
}

function ffxComputeStochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod + dPeriod - 1) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map((c) => c.high));
    const lowestLow = Math.min(...slice.map((c) => c.low));
    const range = highestHigh - lowestLow;
    kValues.push(range !== 0 ? ((candles[i].close - lowestLow) / range) * 100 : 50);
  }
  const recentK = kValues.slice(-dPeriod);
  const d = recentK.reduce((a, b) => a + b, 0) / dPeriod;
  return { k: kValues[kValues.length - 1], d };
}
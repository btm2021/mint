// ============================================================
// final-indicators.js — TÍNH TOÁN 2 ATRBOT, 2 VSR & VÙNG CHỒNG LẤN CHO FINAL.HTML
// ============================================================

// 1. ATRBot Algorithm (16 MA types + 7 Sources)
function calculateFinalATRBot(bars, atrLen = 14, maLen = 30, mult = 2.0, maType = "ema", source = "close") {
  if (!bars || bars.length === 0) return { t1Data: [], t2Data: [], cycles: [], t1Arr: [], t2Arr: [], states: [] };

  const aLen = parseInt(atrLen, 10) || 14;
  const mLen = parseInt(maLen, 10) || 30;
  const mMult = parseFloat(mult) || 2.0;

  const sourceValue = (bar) => {
    if (!bar) return 0;
    switch (String(source).toLowerCase()) {
      case "open": return Number(bar.open) || 0;
      case "high": return Number(bar.high) || 0;
      case "low": return Number(bar.low) || 0;
      case "hl2": return ((Number(bar.high) || 0) + (Number(bar.low) || 0)) / 2;
      case "hlc3": return ((Number(bar.high) || 0) + (Number(bar.low) || 0) + (Number(bar.close) || 0)) / 3;
      case "ohlc4": return ((Number(bar.open) || 0) + (Number(bar.high) || 0) + (Number(bar.low) || 0) + (Number(bar.close) || 0)) / 4;
      default: return Number(bar.close) || 0;
    }
  };

  const values = bars.map(sourceValue);
  const n = bars.length;
  const windowStart = (index, length) => Math.max(0, index - length + 1);

  const wmaAt = (series, index, length) => {
    const start = windowStart(index, Math.max(1, length));
    let weightedSum = 0, weightSum = 0, weight = 1;
    for (let j = start; j <= index; j++, weight++) {
      weightedSum += (series[j] || 0) * weight;
      weightSum += weight;
    }
    return weightSum === 0 ? (series[index] || 0) : weightedSum / weightSum;
  };

  // True Range
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = bars[i];
    if (!c) { tr[i] = 0; continue; }
    if (i === 0 || !bars[i - 1]) {
      tr[i] = (c.high || 0) - (c.low || 0);
    } else {
      const prev = bars[i - 1];
      const h_l = (c.high || 0) - (c.low || 0);
      const h_pc = Math.abs((c.high || 0) - (prev.close || 0));
      const l_pc = Math.abs((c.low || 0) - (prev.close || 0));
      tr[i] = Math.max(h_l, h_pc, l_pc);
    }
  }

  // Wilder RMA ATR
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    atr[i] = i === 0 ? tr[i] : (atr[i - 1] * (aLen - 1) + tr[i]) / aLen;
  }

  // Trail 1 (MA)
  const trail1 = new Array(n);
  const normalizedType = String(maType).toLowerCase();
  const alpha = 2 / (mLen + 1);
  const ema1 = [], ema2 = [], ema3 = [], rawHull = [];
  const wwsma = [], kama = [];

  for (let i = 0; i < n; i++) {
    const value = values[i] || 0;
    const start = windowStart(i, mLen);
    const count = i - start + 1;

    switch (normalizedType) {
      case "vwma": {
        let priceVolume = 0, volume = 0;
        for (let j = start; j <= i; j++) {
          const v = bars[j]?.volume || 0;
          priceVolume += values[j] * v;
          volume += v;
        }
        trail1[i] = volume === 0 ? value : priceVolume / volume;
        break;
      }
      case "wma":
      case "lwma":
        trail1[i] = wmaAt(values, i, mLen);
        break;
      case "hma":
      case "hull": {
        rawHull[i] = 2 * wmaAt(values, i, Math.max(1, Math.floor(mLen / 2))) - wmaAt(values, i, mLen);
        trail1[i] = wmaAt(rawHull, i, Math.max(1, Math.floor(Math.sqrt(mLen))));
        break;
      }
      case "vwap": {
        let priceVolume = 0, volume = 0;
        for (let j = start; j <= i; j++) {
          const b = bars[j];
          const typicalPrice = b ? ((b.high || 0) + (b.low || 0) + (b.close || 0)) / 3 : values[j];
          const v = b?.volume || 0;
          priceVolume += typicalPrice * v;
          volume += v;
        }
        trail1[i] = volume === 0 ? value : priceVolume / volume;
        break;
      }
      case "alma": {
        const center = Math.floor(0.85 * (mLen - 1));
        const sigma = mLen / 6;
        let weightedSum = 0, weightSum = 0;
        for (let j = start; j <= i; j++) {
          const position = j - start;
          const weight = Math.exp(-((position - center) ** 2) / (2 * sigma ** 2));
          weightedSum += values[j] * weight;
          weightSum += weight;
        }
        trail1[i] = weightSum === 0 ? value : weightedSum / weightSum;
        break;
      }
      case "tema":
        ema1[i] = i === 0 ? value : alpha * value + (1 - alpha) * ema1[i - 1];
        ema2[i] = i === 0 ? value : alpha * ema1[i] + (1 - alpha) * ema2[i - 1];
        ema3[i] = i === 0 ? value : alpha * ema2[i] + (1 - alpha) * ema3[i - 1];
        trail1[i] = 3 * ema1[i] - 3 * ema2[i] + ema3[i];
        break;
      case "wwsma": {
        if (count < mLen) {
          let sum = 0;
          for (let j = start; j <= i; j++) sum += values[j];
          trail1[i] = sum / count;
        } else {
          trail1[i] = (wwsma[i - 1] * (mLen - 1) + value) / mLen;
        }
        wwsma[i] = trail1[i];
        break;
      }
      case "zlema": {
        const lag = Math.floor((mLen - 1) / 2);
        const deLagged = i >= lag ? value + (value - (values[i - lag] || value)) : value;
        trail1[i] = i === 0 ? deLagged : alpha * deLagged + (1 - alpha) * trail1[i - 1];
        break;
      }
      case "lsma": {
        if (count === 1) { trail1[i] = value; break; }
        let sumIndex = 0, sumValue = 0, sumIndexValue = 0, sumIndexSquared = 0;
        for (let j = 0; j < count; j++) {
          const sample = values[start + j] || 0;
          sumIndex += j; sumValue += sample; sumIndexValue += j * sample; sumIndexSquared += j * j;
        }
        const denominator = count * sumIndexSquared - sumIndex ** 2;
        const slope = denominator === 0 ? 0 : (count * sumIndexValue - sumIndex * sumValue) / denominator;
        trail1[i] = (sumValue - slope * sumIndex) / count + slope * (count - 1);
        break;
      }
      case "kama": {
        if (i <= mLen) {
          trail1[i] = value;
        } else {
          let volatility = 0;
          for (let j = i - mLen + 1; j <= i; j++) volatility += Math.abs((values[j] || 0) - (values[j - 1] || 0));
          const efficiencyRatio = volatility === 0 ? 0 : Math.abs(value - (values[i - mLen] || value)) / volatility;
          const smoothingConstant = (efficiencyRatio * (2 / 3 - 2 / 31) + 2 / 31) ** 2;
          trail1[i] = (kama[i - 1] || value) + smoothingConstant * (value - (kama[i - 1] || value));
        }
        kama[i] = trail1[i];
        break;
      }
      case "vidya": {
        let gains = 0, losses = 0;
        for (let j = Math.max(1, i - mLen + 1); j <= i; j++) {
          const change = (values[j] || 0) - (values[j - 1] || 0);
          gains += Math.max(change, 0);
          losses += Math.max(-change, 0);
        }
        const movement = gains + losses;
        const cmo = movement === 0 ? 0 : Math.abs((gains - losses) / movement);
        trail1[i] = i === 0 ? value : alpha * cmo * value + (1 - alpha * cmo) * (trail1[i - 1] || value);
        break;
      }
      case "smma": {
        if (i < mLen - 1) trail1[i] = value;
        else if (i === mLen - 1) {
          let sum = 0;
          for (let j = 0; j < mLen; j++) sum += values[j] || 0;
          trail1[i] = sum / mLen;
        } else trail1[i] = ((trail1[i - 1] || value) * (mLen - 1) + value) / mLen;
        break;
      }
      case "mcginley": {
        if (i === 0) trail1[i] = value;
        else {
          const prevT1 = trail1[i - 1] || value;
          const ratio = prevT1 !== 0 ? value / prevT1 : 1;
          trail1[i] = prevT1 + (value - prevT1) / (mLen * (ratio ** 4 || 1));
        }
        break;
      }
      case "swma":
        trail1[i] = i < 3 ? value : ((values[i - 3] || value) + 2 * (values[i - 2] || value) + 2 * (values[i - 1] || value) + value) / 6;
        break;
      case "ema":
      default:
        trail1[i] = i === 0 ? value : alpha * value + (1 - alpha) * (trail1[i - 1] || value);
    }
  }

  // Trail 2 & Trend State
  const trail2 = new Array(n);
  const states = new Array(n);

  for (let i = 0; i < n; i++) {
    const loss = (atr[i] || 0) * mMult;
    const t1 = trail1[i];
    const previousTrail2 = i === 0 ? 0 : (trail2[i - 1] || 0);
    const previousTrail1 = i === 0 ? t1 : (trail1[i - 1] || t1);

    if (t1 > previousTrail2) {
      trail2[i] = previousTrail1 > previousTrail2 ? Math.max(previousTrail2, t1 - loss) : t1 - loss;
    } else {
      trail2[i] = t1 < previousTrail2 && previousTrail1 < previousTrail2 ? Math.min(previousTrail2, t1 + loss) : t1 + loss;
    }
    states[i] = t1 > trail2[i] ? 1 : -1;
  }

  const t1Data = [];
  const t2Data = [];
  const cycles = [];
  let currentCycle = null;

  for (let i = 0; i < n; i++) {
    const t = bars[i]?.time || 0;
    t1Data.push({ time: t, value: trail1[i] });
    t2Data.push({ time: t, value: trail2[i] });

    if (currentCycle === null) {
      currentCycle = {
        state: states[i],
        startIndex: i,
        endIndex: i,
      };
    } else if (currentCycle.state !== states[i]) {
      cycles.push(currentCycle);
      currentCycle = {
        state: states[i],
        startIndex: i,
        endIndex: i,
      };
    } else {
      currentCycle.endIndex = i;
    }
  }

  if (currentCycle) cycles.push(currentCycle);

  return {
    t1Data,
    t2Data,
    cycles,
    t1Arr: trail1,
    t2Arr: trail2,
    states,
    atrArr: atr,
  };
}

// 2. VSR Algorithm
function calculateFinalVSR(bars, length = 10, threshold = 10.0) {
  if (!bars || bars.length === 0) return { zones: [], upperArr: [], lowerArr: [] };
  const vLen = parseInt(length, 10) || 10;
  const vThr = parseFloat(threshold) || 10.0;
  const n = bars.length;
  const zones = [];
  let prev_volume = NaN, prev_high = NaN, prev_low = NaN, prev_close = NaN, prev_stdev = NaN;
  const volume_changes = [];
  let vsr_upper = NaN, vsr_lower = NaN;
  let currentZone = null;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (!b) continue;
    let change = 0;
    if (!isNaN(prev_volume) && prev_volume !== 0) change = (b.volume || 0) / prev_volume - 1;

    volume_changes.push(change);
    if (volume_changes.length > vLen) volume_changes.shift();

    let stdev = 0;
    if (volume_changes.length >= 2) {
      const sum = volume_changes.reduce((a, x) => a + x, 0);
      const mean = sum / volume_changes.length;
      const variance = volume_changes.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / volume_changes.length;
      stdev = Math.sqrt(variance);
    }

    let signal = 0;
    if (!isNaN(prev_stdev) && prev_stdev !== 0 && volume_changes.length >= 2) signal = Math.abs(change / prev_stdev);

    if (signal > vThr && !isNaN(prev_high)) {
      const p_upper = Math.max(prev_high, prev_close);
      const p_lower = Math.min(prev_low, prev_close);

      let isOverlap = false;
      if (!isNaN(vsr_upper) && !isNaN(vsr_lower)) {
        if (p_lower <= vsr_upper && vsr_lower <= p_upper) isOverlap = true;
      }

      if (isOverlap) {
        const mergedUpper = Math.max(vsr_upper, p_upper);
        const mergedLower = Math.min(vsr_lower, p_lower);
        if (mergedUpper !== vsr_upper || mergedLower !== vsr_lower) {
          if (currentZone) { currentZone.endIndex = i - 1; zones.push(currentZone); }
          vsr_upper = mergedUpper;
          vsr_lower = mergedLower;
          currentZone = { startIndex: i, endIndex: i, upper: vsr_upper, lower: vsr_lower };
        } else if (currentZone) {
          currentZone.endIndex = i;
        }
      } else {
        vsr_upper = p_upper;
        vsr_lower = p_lower;
        if (currentZone) {
          currentZone.endIndex = i - 1;
          zones.push(currentZone);
        }
        currentZone = { startIndex: i, endIndex: i, upper: vsr_upper, lower: vsr_lower };
      }
    } else if (currentZone) {
      currentZone.endIndex = i;
    }
    prev_volume = b.volume; prev_high = b.high; prev_low = b.low; prev_close = b.close; prev_stdev = stdev;
  }
  if (currentZone) {
    currentZone.endIndex = n - 1;
    zones.push(currentZone);
  }

  const upperArr = new Array(n).fill(NaN);
  const lowerArr = new Array(n).fill(NaN);
  for (const z of zones) {
    const end = Math.min(z.endIndex, n - 1);
    for (let i = z.startIndex; i <= end; i++) {
      upperArr[i] = z.upper;
      lowerArr[i] = z.lower;
    }
  }

  return { zones, upperArr, lowerArr };
}

// 3. VSR Overlap Zone Algorithm
function calculateFinalVSROverlap(bars, vsr1Res, vsr2Res) {
  if (!bars || bars.length === 0 || !vsr1Res || !vsr2Res) return { zones: [], upperArr: [], lowerArr: [] };
  const n = bars.length;
  const upperArr = new Array(n).fill(NaN);
  const lowerArr = new Array(n).fill(NaN);
  const zones = [];

  let currentOverlap = null;

  for (let i = 0; i < n; i++) {
    const u1 = vsr1Res.upperArr?.[i];
    const l1 = vsr1Res.lowerArr?.[i];
    const u2 = vsr2Res.upperArr?.[i];
    const l2 = vsr2Res.lowerArr?.[i];

    if (Number.isFinite(u1) && Number.isFinite(l1) && Number.isFinite(u2) && Number.isFinite(l2)) {
      const overlapUpper = Math.min(u1, u2);
      const overlapLower = Math.max(l1, l2);

      if (overlapUpper >= overlapLower) {
        upperArr[i] = overlapUpper;
        lowerArr[i] = overlapLower;

        if (!currentOverlap) {
          currentOverlap = {
            startIndex: i,
            endIndex: i,
            upper: overlapUpper,
            lower: overlapLower,
          };
        } else if (
          Math.abs(currentOverlap.upper - overlapUpper) < 1e-6 &&
          Math.abs(currentOverlap.lower - overlapLower) < 1e-6
        ) {
          currentOverlap.endIndex = i;
        } else {
          currentOverlap.endIndex = i - 1;
          zones.push(currentOverlap);
          currentOverlap = {
            startIndex: i,
            endIndex: i,
            upper: overlapUpper,
            lower: overlapLower,
          };
        }
        continue;
      }
    }

    if (currentOverlap) {
      currentOverlap.endIndex = i - 1;
      zones.push(currentOverlap);
      currentOverlap = null;
    }
  }

  if (currentOverlap) {
    currentOverlap.endIndex = n - 1;
    zones.push(currentOverlap);
  }

  return { zones, upperArr, lowerArr };
}

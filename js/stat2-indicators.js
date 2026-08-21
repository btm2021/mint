// ============================================================
// stat2-indicators.js — TÍNH TOÁN 2 ATRBOT, 2 VSR & VÙNG CHỒNG LẤN
// ============================================================

// 1. ATRBot Algorithm (16 MA types + 7 Sources)
// opts (tuỳ chọn, chỉ stat2 dùng): {
//   adaptive: { enabled, mode: "er"|"vol", erLen, minMult, maxMult },
//   smoothT2: { enabled, len }
// }
function calculateStat2ATRBot(bars, atrLen = 14, maLen = 30, mult = 2.0, maType = "ema", source = "close", opts = null) {
  if (!bars || bars.length === 0) return { t1Data: [], t2Data: [], cycles: [], t1Arr: [], t2Arr: [], states: [] };

  const sourceValue = (bar) => {
    switch (String(source).toLowerCase()) {
      case "open": return bar.open;
      case "high": return bar.high;
      case "low": return bar.low;
      case "hl2": return (bar.high + bar.low) / 2;
      case "hlc3": return (bar.high + bar.low + bar.close) / 3;
      case "ohlc4": return (bar.open + bar.high + bar.low + bar.close) / 4;
      default: return bar.close;
    }
  };

  const values = bars.map(sourceValue);
  const n = bars.length;
  const windowStart = (index, length) => Math.max(0, index - length + 1);

  const wmaAt = (series, index, length) => {
    const start = windowStart(index, Math.max(1, length));
    let weightedSum = 0, weightSum = 0, weight = 1;
    for (let j = start; j <= index; j++, weight++) {
      weightedSum += series[j] * weight;
      weightSum += weight;
    }
    return weightSum === 0 ? series[index] : weightedSum / weightSum;
  };

  // True Range
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = bars[i].high - bars[i].low;
    } else {
      const h_l = bars[i].high - bars[i].low;
      const h_pc = Math.abs(bars[i].high - bars[i - 1].close);
      const l_pc = Math.abs(bars[i].low - bars[i - 1].close);
      tr[i] = Math.max(h_l, h_pc, l_pc);
    }
  }

  // Wilder RMA ATR
  const atr = new Array(n);
  for (let i = 0; i < n; i++) {
    atr[i] = i === 0 ? tr[i] : (atr[i - 1] * (atrLen - 1) + tr[i]) / atrLen;
  }

  // --- Cải tiến Trail 2 #1: Multiplier thích ứng ---
  // "er"  : Kaufman Efficiency Ratio — xu hướng mạnh (ER→1) => trail siết về minMult,
  //         đi ngang/giả (ER→0) => trail nới ra maxMult để tránh flip nhiễu.
  // "vol" : Tỉ lệ ATR nhanh/chậm — biến động mở rộng (VR>1) => nới trail,
  //         biến động co lại (VR<1) => siết trail để giữ lợi nhuận.
  const adp = opts && opts.adaptive ? opts.adaptive : null;
  const adpEnabled = !!(adp && adp.enabled);
  const effMultArr = new Array(n).fill(mult);

  if (adpEnabled) {
    const minRaw = Number.isFinite(+adp.minMult) ? +adp.minMult : mult * 0.5;
    const maxRaw = Number.isFinite(+adp.maxMult) ? +adp.maxMult : mult * 2;
    const lo = Math.min(minRaw, maxRaw);
    const hi = Math.max(minRaw, maxRaw);
    const erLen = Math.max(1, Math.floor(+adp.erLen || 20));
    const mode = String(adp.mode || "er").toLowerCase();

    // ATR nhanh cho chế độ "vol" (nửa chu kỳ ATR chính)
    let atrFast = null;
    if (mode === "vol") {
      const fastLen = Math.max(1, Math.floor(atrLen / 2));
      atrFast = new Array(n);
      for (let i = 0; i < n; i++) {
        atrFast[i] = i === 0 ? tr[i] : (atrFast[i - 1] * (fastLen - 1) + tr[i]) / fastLen;
      }
    }

    for (let i = 0; i < n; i++) {
      let m = mult;
      if (mode === "vol") {
        const vr = atr[i] > 0 ? atrFast[i] / atr[i] : 1;
        m = mult * vr;
      } else {
        // Efficiency Ratio trên cửa sổ erLen (dùng dữ liệu sẵn có khi chưa đủ dài)
        const start = Math.max(1, i - erLen + 1);
        const change = Math.abs(values[i] - values[start - 1]);
        let volatility = 0;
        for (let j = start; j <= i; j++) volatility += Math.abs(values[j] - values[j - 1]);
        const er = volatility > 0 ? change / volatility : 0;
        m = lo + (hi - lo) * (1 - er);
      }
      effMultArr[i] = Math.min(hi, Math.max(lo, m));
    }
  }

  // Trail 1 (MA)
  const trail1 = new Array(n);
  const normalizedType = String(maType).toLowerCase();
  const alpha = 2 / (maLen + 1);
  const ema1 = [], ema2 = [], ema3 = [], rawHull = [];
  const wwsma = [], kama = [];

  for (let i = 0; i < n; i++) {
    const value = values[i];
    const start = windowStart(i, maLen);
    const count = i - start + 1;

    switch (normalizedType) {
      case "vwma": {
        let priceVolume = 0, volume = 0;
        for (let j = start; j <= i; j++) { priceVolume += values[j] * bars[j].volume; volume += bars[j].volume; }
        trail1[i] = volume === 0 ? value : priceVolume / volume;
        break;
      }
      case "wma":
      case "lwma":
        trail1[i] = wmaAt(values, i, maLen);
        break;
      case "hma":
      case "hull": {
        rawHull[i] = 2 * wmaAt(values, i, Math.max(1, Math.floor(maLen / 2))) - wmaAt(values, i, maLen);
        trail1[i] = wmaAt(rawHull, i, Math.max(1, Math.floor(Math.sqrt(maLen))));
        break;
      }
      case "vwap": {
        let priceVolume = 0, volume = 0;
        for (let j = start; j <= i; j++) {
          const typicalPrice = (bars[j].high + bars[j].low + bars[j].close) / 3;
          priceVolume += typicalPrice * bars[j].volume;
          volume += bars[j].volume;
        }
        trail1[i] = volume === 0 ? value : priceVolume / volume;
        break;
      }
      case "alma": {
        const center = Math.floor(0.85 * (maLen - 1));
        const sigma = maLen / 6;
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
        if (count < maLen) {
          let sum = 0;
          for (let j = start; j <= i; j++) sum += values[j];
          trail1[i] = sum / count;
        } else {
          trail1[i] = (wwsma[i - 1] * (maLen - 1) + value) / maLen;
        }
        wwsma[i] = trail1[i];
        break;
      }
      case "zlema": {
        const lag = Math.floor((maLen - 1) / 2);
        const deLagged = i >= lag ? value + (value - values[i - lag]) : value;
        trail1[i] = i === 0 ? deLagged : alpha * deLagged + (1 - alpha) * trail1[i - 1];
        break;
      }
      case "lsma": {
        if (count === 1) { trail1[i] = value; break; }
        let sumIndex = 0, sumValue = 0, sumIndexValue = 0, sumIndexSquared = 0;
        for (let j = 0; j < count; j++) {
          const sample = values[start + j];
          sumIndex += j; sumValue += sample; sumIndexValue += j * sample; sumIndexSquared += j * j;
        }
        const denominator = count * sumIndexSquared - sumIndex ** 2;
        const slope = denominator === 0 ? 0 : (count * sumIndexValue - sumIndex * sumValue) / denominator;
        trail1[i] = (sumValue - slope * sumIndex) / count + slope * (count - 1);
        break;
      }
      case "kama": {
        if (i <= maLen) {
          trail1[i] = value;
        } else {
          let volatility = 0;
          for (let j = i - maLen + 1; j <= i; j++) volatility += Math.abs(values[j] - values[j - 1]);
          const efficiencyRatio = volatility === 0 ? 0 : Math.abs(value - values[i - maLen]) / volatility;
          const smoothingConstant = (efficiencyRatio * (2 / 3 - 2 / 31) + 2 / 31) ** 2;
          trail1[i] = kama[i - 1] + smoothingConstant * (value - kama[i - 1]);
        }
        kama[i] = trail1[i];
        break;
      }
      case "vidya": {
        let gains = 0, losses = 0;
        for (let j = Math.max(1, i - maLen + 1); j <= i; j++) {
          const change = values[j] - values[j - 1];
          gains += Math.max(change, 0);
          losses += Math.max(-change, 0);
        }
        const movement = gains + losses;
        const cmo = movement === 0 ? 0 : Math.abs((gains - losses) / movement);
        trail1[i] = i === 0 ? value : alpha * cmo * value + (1 - alpha * cmo) * trail1[i - 1];
        break;
      }
      case "smma": {
        if (i < maLen - 1) trail1[i] = value;
        else if (i === maLen - 1) {
          let sum = 0;
          for (let j = 0; j < maLen; j++) sum += values[j];
          trail1[i] = sum / maLen;
        } else trail1[i] = (trail1[i - 1] * (maLen - 1) + value) / maLen;
        break;
      }
      case "mcginley": {
        if (i === 0) trail1[i] = value;
        else {
          const ratio = value / trail1[i - 1];
          trail1[i] = trail1[i - 1] + (value - trail1[i - 1]) / (maLen * (ratio ** 4 || 1));
        }
        break;
      }
      case "swma":
        trail1[i] = i < 3 ? value : (values[i - 3] + 2 * values[i - 2] + 2 * values[i - 1] + value) / 6;
        break;
      case "ema":
      default:
        trail1[i] = i === 0 ? value : alpha * value + (1 - alpha) * trail1[i - 1];
    }
  }

  // Trail 2 & Trend State
  const trail2 = new Array(n);

  for (let i = 0; i < n; i++) {
    const loss = atr[i] * (adpEnabled ? effMultArr[i] : mult);
    const t1 = trail1[i];
    const previousTrail2 = i === 0 ? 0 : trail2[i - 1];
    const previousTrail1 = i === 0 ? t1 : trail1[i - 1];

    if (t1 > previousTrail2) {
      trail2[i] = previousTrail1 > previousTrail2 ? Math.max(previousTrail2, t1 - loss) : t1 - loss;
    } else {
      trail2[i] = t1 < previousTrail2 && previousTrail1 < previousTrail2 ? Math.min(previousTrail2, t1 + loss) : t1 + loss;
    }
  }

  // --- Cải tiến Trail 2 #2: Làm mượt Trail 2 bằng EMA ngắn ---
  // Giảm nhiễu ở vùng giá đi ngang => ít flip giả hơn cho strategy.
  // State (states/cycles) được suy ra từ Trail 2 ĐÃ làm mượt.
  const smCfg = opts && opts.smoothT2 ? opts.smoothT2 : null;
  let finalTrail2 = trail2;
  if (smCfg && smCfg.enabled) {
    const smLen = Math.max(1, Math.floor(+smCfg.len || 5));
    const a = 2 / (smLen + 1);
    const smoothed = new Array(n);
    for (let i = 0; i < n; i++) {
      smoothed[i] = i === 0 ? trail2[0] : a * trail2[i] + (1 - a) * smoothed[i - 1];
    }
    finalTrail2 = smoothed;
  }

  const states = new Array(n); // 1 = Bullish, -1 = Bearish
  for (let i = 0; i < n; i++) {
    states[i] = trail1[i] > finalTrail2[i] ? 1 : -1;
  }

  // Build Output Data & Extract Cycles
  const t1Data = [];
  const t2Data = [];
  const cycles = [];
  let currentCycle = null;

  for (let i = 0; i < n; i++) {
    const t = bars[i].time;
    t1Data.push({ time: t, value: trail1[i] });
    t2Data.push({ time: t, value: finalTrail2[i] });

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
    t2Arr: finalTrail2,
    rawT2Arr: trail2,
    states,
    atrArr: atr,
    multArr: adpEnabled ? effMultArr : null,
  };
}

// 2. VSR Algorithm (Volume Spread Resistance / Support)
function calculateStat2VSR(bars, length = 10, threshold = 10.0) {
  if (!bars || bars.length === 0) return { zones: [], upperArr: [], lowerArr: [] };
  const n = bars.length;
  const zones = [];
  let prev_volume = NaN, prev_high = NaN, prev_low = NaN, prev_close = NaN, prev_stdev = NaN;
  const volume_changes = [];
  let vsr_upper = NaN, vsr_lower = NaN;
  let currentZone = null;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    let change = 0;
    if (!isNaN(prev_volume) && prev_volume !== 0) change = b.volume / prev_volume - 1;

    volume_changes.push(change);
    if (volume_changes.length > length) volume_changes.shift();

    let stdev = 0;
    if (volume_changes.length >= 2) {
      const sum = volume_changes.reduce((a, x) => a + x, 0);
      const mean = sum / volume_changes.length;
      const variance = volume_changes.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / volume_changes.length;
      stdev = Math.sqrt(variance);
    }

    let signal = 0;
    if (!isNaN(prev_stdev) && prev_stdev !== 0 && volume_changes.length >= 2) signal = Math.abs(change / prev_stdev);

    if (signal > threshold && !isNaN(prev_high)) {
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

  // Populate contiguous price arrays for fast querying
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

// 3. VSR Overlap Zone Algorithm (Vùng chồng lấn của 2 VSR)
function calculateStat2VSROverlap(bars, vsr1Res, vsr2Res) {
  if (!bars || bars.length === 0 || !vsr1Res || !vsr2Res) return { zones: [], upperArr: [], lowerArr: [] };
  const n = bars.length;
  const upperArr = new Array(n).fill(NaN);
  const lowerArr = new Array(n).fill(NaN);
  const zones = [];

  let currentOverlap = null;

  for (let i = 0; i < n; i++) {
    const u1 = vsr1Res.upperArr[i];
    const l1 = vsr1Res.lowerArr[i];
    const u2 = vsr2Res.upperArr[i];
    const l2 = vsr2Res.lowerArr[i];

    // Check if both VSRs are active on bar i and their intervals overlap
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

// 4. ADVANCED SUPPLY & DEMAND ZONES (thuật toán nâng cao riêng cho stat2)
// Nền tảng chuyên sâu — cấu trúc lệnh tổ chức:
//   Swing Pivot → Displacement Leg-Out → FVG Imbalance → Volume Confirm
//   → Zone Construction → Composite Score → Mitigation Tracking
//
//   * Swing Pivot: đỉnh/đáy phân dạng (fractal) với sức mạnh L/R nến
//   * Displacement: cú rời vùng phải ≥ dispAtrMult × ATR trong dispLookforward nến
//     (chứng minh dòng lệnh tổ chức đã khớp tại vùng)
//   * Body Dominance: thân nến cùng hướng chiếm tỷ trọng trong leg-out
//   * FVG (Fair Value Gap): mất cân bằng 3 nến low[k+1] > high[k-1] (bull)
//     — dấu hiệu order flow một chiều, không có sự đối ứng
//   * Volume: leg-out phải có volume ≥ volMult × trung bình
//   * Score 0-100 = Displacement(30) + FVG(20) + Volume(20) + Base Tightness(15) + Recency(15)
//   * Mitigation: fresh → tested (giá quay lại chạm) → broken (close xuyên distal)
function calculateStat2SDZones(bars, cfg = {}) {
  const empty = { zones: [], demand: [], supply: [] };
  if (!bars || bars.length < 30) return empty;

  const n = bars.length;
  const L = Math.max(1, Math.floor(cfg.pivotLeft ?? 3));
  const R = Math.max(1, Math.floor(cfg.pivotRight ?? 3));
  const legInLookback = Math.max(2, Math.floor(cfg.legInLookback ?? 10));
  const dispLookforward = Math.max(2, Math.floor(cfg.dispLookforward ?? 8));
  const dispAtrMult = Math.max(0.5, +cfg.dispAtrMult || 2.0);
  const bodyDominance = Math.min(0.95, Math.max(0.05, +cfg.bodyDominance || 0.55));
  const requireFvg = !!cfg.requireFvg;
  const useVolume = !!cfg.useVolume;
  const volMult = Math.max(1.0, +cfg.volMult || 1.3);
  const maxBaseWidthAtr = Math.max(0.3, +cfg.maxBaseWidthAtr || 2.0);
  const minScore = Number.isFinite(+cfg.minScore) ? +cfg.minScore : 55;
  const mergeOverlapPct = Math.min(0.9, Math.max(0, Number.isFinite(+cfg.mergeOverlapPct) ? +cfg.mergeOverlapPct : 0.35));
  const maxZones = Math.max(1, Math.floor(cfg.maxZones || 10));

  // --- ATR Wilder 14 ---
  const atrLen = 14;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    tr[i] = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  }
  const atr = new Array(n);
  for (let i = 0; i < n; i++) atr[i] = i === 0 ? tr[0] : (atr[i - 1] * (atrLen - 1) + tr[i]) / atrLen;

  // --- SMA Volume (lookback 20) cho volume ratio ---
  const volLookback = 20;
  const volSma = new Array(n);
  let volSum = 0;
  for (let i = 0; i < n; i++) {
    volSum += bars[i].volume;
    if (i >= volLookback) volSum -= bars[i - volLookback].volume;
    volSma[i] = volSum / Math.min(i + 1, volLookback);
  }

  // --- Bước 1+2+3: Quét pivot → validate displacement → dựng zone ---
  const candidates = [];

  for (let p = L; p <= n - 1 - R; p++) {
    const a = atr[p];
    if (!(a > 0)) continue;

    // Fractal pivot: low/high của p là cực trị trong cửa sổ [p-L, p+R]
    let isPLow = true, isPHigh = true;
    for (let j = p - L; j <= p + R; j++) {
      if (j === p) continue;
      if (bars[j].low < bars[p].low) isPLow = false;
      if (bars[j].high > bars[p].high) isPHigh = false;
      if (!isPLow && !isPHigh) break;
    }
    if (!isPLow && !isPHigh) continue;

    const outEnd = Math.min(p + dispLookforward, n - 1);
    if (outEnd <= p + 1) continue; // cần tối thiểu 2 nến leg-out

    for (const kind of ["demand", "supply"]) {
      if (kind === "demand" && !isPLow) continue;
      if (kind === "supply" && !isPHigh) continue;
      const pivot = bars[p];

      // Displacement: cú rời giá phải đủ mạnh so với ATR
      let moveExtreme;
      if (kind === "demand") {
        moveExtreme = -Infinity;
        for (let k = p + 1; k <= outEnd; k++) moveExtreme = Math.max(moveExtreme, bars[k].high);
      } else {
        moveExtreme = Infinity;
        for (let k = p + 1; k <= outEnd; k++) moveExtreme = Math.min(moveExtreme, bars[k].low);
      }
      const moveDist = kind === "demand" ? moveExtreme - pivot.low : pivot.high - moveExtreme;
      const moveATR = moveDist / a;
      if (moveATR < dispAtrMult) continue;

      // Body dominance: áp lực một chiều trong leg-out
      let upBody = 0, downBody = 0;
      for (let k = p + 1; k <= outEnd; k++) {
        const body = bars[k].close - bars[k].open;
        if (body > 0) upBody += body; else downBody -= body;
      }
      const totalBody = upBody + downBody;
      const dominance = totalBody > 0 ? (kind === "demand" ? upBody : downBody) / totalBody : 0;
      if (dominance < bodyDominance) continue;

      // FVG 3 nến trong leg-out (imbalance = order flow một chiều)
      let hasFvg = false;
      for (let k = p + 2; k <= outEnd - 1; k++) {
        if (kind === "demand") { if (bars[k + 1].low > bars[k - 1].high) { hasFvg = true; break; } }
        else { if (bars[k + 1].high < bars[k - 1].low) { hasFvg = true; break; } }
      }
      if (requireFvg && !hasFvg) continue;

      // Volume xác nhận participation tổ chức
      let outVol = 0;
      for (let k = p + 1; k <= outEnd; k++) outVol += bars[k].volume;
      const outVolAvg = outVol / (outEnd - p);
      const baseVol = volSma[p] > 0 ? volSma[p] : 1;
      const volRatio = outVolAvg / baseVol;
      if (useVolume && volRatio < volMult) continue;

      // Dựng vùng từ cụm gốc: pivot + nến láng giềng nằm gọn trong base
      let proximal, distal;
      if (kind === "demand") {
        distal = pivot.low;
        proximal = Math.max(pivot.open, pivot.close);
        for (let k = Math.max(0, p - 2); k <= Math.min(n - 1, p + 2); k++) {
          if (k === p) continue;
          if (bars[k].low >= distal - a * 0.15 && bars[k].high <= proximal + a * 0.15) {
            distal = Math.min(distal, bars[k].low);
            proximal = Math.max(proximal, Math.max(bars[k].open, bars[k].close));
          }
        }
      } else {
        distal = pivot.high;
        proximal = Math.min(pivot.open, pivot.close);
        for (let k = Math.max(0, p - 2); k <= Math.min(n - 1, p + 2); k++) {
          if (k === p) continue;
          if (bars[k].high <= distal + a * 0.15 && bars[k].low >= proximal - a * 0.15) {
            distal = Math.max(distal, bars[k].high);
            proximal = Math.min(proximal, Math.min(bars[k].open, bars[k].close));
          }
        }
      }

      const width = Math.abs(proximal - distal);
      if (width <= 0) continue;
      const widthATR = width / a;
      if (widthATR > maxBaseWidthAtr) continue;

      // Formation theo hướng leg-in (trend trước khi vào base)
      const refIdx = Math.max(0, p - legInLookback);
      const legInUp = bars[p].close > bars[refIdx].close;
      let formation;
      if (kind === "demand") formation = legInUp ? "RBR" : "DBR";
      else formation = legInUp ? "RBD" : "DBD";

      // Composite score 0-100
      const sDisp = Math.min(30, (moveATR / 5) * 30);
      const sFvg = hasFvg ? 20 : 0;
      const sVol = useVolume ? Math.min(20, Math.max(0, (volRatio - 1) * 20)) : 10;
      const sBase = widthATR <= 0.5 ? 15 : Math.max(0, 15 * (1 - (widthATR - 0.5) / Math.max(0.01, maxBaseWidthAtr - 0.5)));
      const sRecency = 15 * (p / (n - 1));
      const score = Math.round(sDisp + sFvg + sVol + sBase + sRecency);

      candidates.push({
        type: kind,
        formation,
        pivotIndex: p,
        startIndex: p,
        endIndex: outEnd,
        proximal,
        distal,
        score,
        scores: {
          displacement: Math.round(sDisp),
          fvg: sFvg,
          volume: Math.round(sVol),
          baseTightness: Math.round(sBase),
          recency: Math.round(sRecency),
        },
        moveATR: +moveATR.toFixed(2),
        widthATR: +widthATR.toFixed(2),
        volRatio: +volRatio.toFixed(2),
        hasFvg,
        dominance: +dominance.toFixed(2),
        status: "fresh",
        testCount: 0,
        testedIndex: null,
        brokenIndex: null,
      });
    }
  }

  // --- Bước 4: Mitigation tracking (fresh → tested → broken) ---
  for (const z of candidates) {
    let inZone = false;
    for (let t = z.endIndex + 1; t < n; t++) {
      const b = bars[t];
      if (z.type === "demand") {
        if (b.close < z.distal) { z.status = "broken"; z.brokenIndex = t; break; }
        const touching = b.low <= z.proximal;
        if (touching && !inZone) {
          z.testCount++;
          z.testedIndex = t;
          z.status = "tested";
        }
        inZone = touching;
      } else {
        if (b.close > z.distal) { z.status = "broken"; z.brokenIndex = t; break; }
        const touching = b.high >= z.proximal;
        if (touching && !inZone) {
          z.testCount++;
          z.testedIndex = t;
          z.status = "tested";
        }
        inZone = touching;
      }
    }
  }

  // --- Bước 5: Lọc minScore & gộp zone cùng loại chồng lấn ---
  const passed = candidates.filter((z) => z.score >= minScore);
  const mergeGroup = (list) => {
    const sorted = [...list].sort((x, y) => y.score - x.score);
    const kept = [];
    for (const z of sorted) {
      const dup = kept.some((k) => {
        const ovTop = Math.min(k.proximal, z.proximal);
        const ovBot = Math.max(k.distal, z.distal);
        if (ovTop <= ovBot) return false;
        const overlapH = ovTop - ovBot;
        const minH = Math.min(Math.abs(k.proximal - k.distal), Math.abs(z.proximal - z.distal));
        return overlapH / minH > mergeOverlapPct;
      });
      if (!dup) kept.push(z);
    }
    return kept;
  };

  let demands = mergeGroup(passed.filter((z) => z.type === "demand"));
  let supplies = mergeGroup(passed.filter((z) => z.type === "supply"));

  // --- Bước 6: Giới hạn số lượng (zone active ưu tiên hơn broken) ---
  const rank = (z) => (z.status === "broken" ? z.score - 10000 : z.score);
  demands = demands.sort((a, b) => rank(b) - rank(a)).slice(0, maxZones);
  supplies = supplies.sort((a, b) => rank(b) - rank(a)).slice(0, maxZones);

  const zones = [...demands, ...supplies].sort((a, b) => a.startIndex - b.startIndex);

  return { zones, demand: demands, supply: supplies };
}

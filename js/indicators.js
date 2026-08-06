function calculateATRBot(bars, atrLen, maLen, mult, maType = "ema", source = "close") {
  if (bars.length === 0) return { t1Data: [], t2Data: [], cycles: [] };

  // Trail 1 uses the configured price source. ATR itself always uses OHLC.
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
  const windowStart = (index, length) => Math.max(0, index - length + 1);
  const wmaAt = (series, index, length) => {
    const start = windowStart(index, Math.max(1, length));
    let weightedSum = 0, weightSum = 0, weight = 1;
    for (let j = start; j <= index; j++, weight++) {
      weightedSum += series[j] * weight;
      weightSum += weight;
    }
    return weightedSum / weightSum;
  };

  // 1. True Range
  const tr = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      tr[i] = bars[i].high - bars[i].low;
    } else {
      let h_l = bars[i].high - bars[i].low;
      let h_pc = Math.abs(bars[i].high - bars[i - 1].close);
      let l_pc = Math.abs(bars[i].low - bars[i - 1].close);
      tr[i] = Math.max(h_l, h_pc, l_pc);
    }
  }

  // 2. Wilder RMA, seeded by the first True Range (not an initial SMA).
  const atr = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    atr[i] = i === 0 ? tr[i] : (atr[i - 1] * (atrLen - 1) + tr[i]) / atrLen;
  }

  // 3. Trail 1 MA. Every branch deliberately emits values during warm-up,
  // matching the custom-study rules documented in indicator.md.
  const trail1 = new Array(bars.length);
  const normalizedType = String(maType).toLowerCase();
  const alpha = 2 / (maLen + 1);
  const ema1 = [], ema2 = [], ema3 = [], rawHull = [];
  const wwsma = [], kama = [];

  for (let i = 0; i < bars.length; i++) {
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
        trail1[i] = weightedSum / weightSum;
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
        const slope = (count * sumIndexValue - sumIndex * sumValue) / denominator;
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
          trail1[i] = trail1[i - 1] + (value - trail1[i - 1]) / (maLen * ratio ** 4);
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

  // 4. Calculate Trail2 & State
  const trail2 = new Array(bars.length);
  const state = new Array(bars.length); // 1 = Uptrend, -1 = Downtrend

  for (let i = 0; i < bars.length; i++) {
    const loss = atr[i] * mult;
    const t1 = trail1[i];
    const previousTrail2 = i === 0 ? 0 : trail2[i - 1];
    const previousTrail1 = i === 0 ? t1 : trail1[i - 1];

    if (t1 > previousTrail2) {
      trail2[i] = previousTrail1 > previousTrail2 ? Math.max(previousTrail2, t1 - loss) : t1 - loss;
    } else {
      trail2[i] = t1 < previousTrail2 && previousTrail1 < previousTrail2 ? Math.min(previousTrail2, t1 + loss) : t1 + loss;
    }
    state[i] = t1 > trail2[i] ? 1 : -1;
  }

  // 5. Build LWC Line Data & Extract Cycles
  let t1Data = [];
  let t2Data = [];
  let cycles = [];
  let currentCycle = null;

  for (let i = 0; i < bars.length; i++) {
    let t = bars[i].time;
    let isUp = state[i] === 1;
    let color = isUp ? "#00E676" : "#FF5252";

    t1Data.push({ time: t, value: trail1[i], color: color });
    t2Data.push({ time: t, value: trail2[i], color: color });

    let barData = { ...bars[i], t1: trail1[i], t2: trail2[i] };

    if (currentCycle === null) {
      currentCycle = {
        state: state[i],
        startIndex: i,
        endIndex: i,
        bars: [barData],
      };
    } else if (currentCycle.state !== state[i]) {
      cycles.push(currentCycle);
      currentCycle = {
        state: state[i],
        startIndex: i,
        endIndex: i,
        bars: [barData],
      };
    } else {
      currentCycle.endIndex = i;
      currentCycle.bars.push(barData);
    }
  }

  if (currentCycle) {
    cycles.push(currentCycle);
  }
  return { t1Data, t2Data, cycles };
}

// Bulk Volume Classification (BVC) Algorithm
function calculateBVCVolumes(bars, windowSize = 20) {
  function normalCDF(x) {
    let t = 1 / (1 + 0.2316419 * Math.abs(x));
    let d = 0.3989423 * Math.exp((-x * x) / 2);
    let prob =
      d *
      t *
      (0.3193815 +
        t *
        (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  let deltaPArray = bars.map((b) => b.close - b.open);

  for (let i = 0; i < bars.length; i++) {
    let b = bars[i];
    let startIdx = Math.max(0, i - windowSize + 1);
    let count = i - startIdx + 1;

    let mean = 0;
    for (let j = startIdx; j <= i; j++) mean += deltaPArray[j];
    mean /= count;

    let variance = 0;
    for (let j = startIdx; j <= i; j++)
      variance += Math.pow(deltaPArray[j] - mean, 2);
    variance /= count;

    let stdDev = Math.sqrt(variance);
    let deltaP = deltaPArray[i];

    let Z = 0;
    if (stdDev > 1e-10) {
      Z = deltaP / stdDev;
    } else {
      Z = deltaP > 0 ? 3 : deltaP < 0 ? -3 : 0;
    }

    let phiZ = normalCDF(Z);
    b.bvcBuy = b.volume * phiZ;
    b.bvcSell = b.volume * (1 - phiZ);
  }
}

function calculateFRVP(bars) {
  let numRows = NUM_ROWS;
  let vaPct = VA_PCT;
  if (bars.length === 0)
    return {
      rows: [],
      maxVol: 0,
      pocPrice: 0,
      pocDelta: 0,
      vahPrice: 0,
      valPrice: 0,
    };

  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  bars.forEach((d) => {
    if (d.high > highestHigh) highestHigh = d.high;
    if (d.low < lowestLow) lowestLow = d.low;
  });

  if (highestHigh === -Infinity || lowestLow === Infinity || Math.abs(highestHigh - lowestLow) < 1e-10) {
    return {
      rows: [],
      maxVol: 0,
      pocPrice: 0,
      pocDelta: 0,
      vahPrice: 0,
      valPrice: 0,
    };
  }

  let rowHeight = (highestHigh - lowestLow) / numRows;
  let rows = new Array(numRows).fill(0).map((_, i) => ({
    priceTop: highestHigh - i * rowHeight,
    priceBottom: highestHigh - (i + 1) * rowHeight,
    vol: 0,
    buyVol: 0,
    sellVol: 0,
    poc: false,
    vah: false,
    val: false,
    inVA: false,
  }));

  for (let b of bars) {
    if (b.volume <= 0) continue;
    let startRow = Math.floor((highestHigh - b.high) / rowHeight);
    let endRow = Math.floor((highestHigh - b.low) / rowHeight);
    startRow = Math.max(0, Math.min(numRows - 1, startRow));
    endRow = Math.max(0, Math.min(numRows - 1, endRow));

    let bBuy = b.bvcBuy || 0;
    let bSell = b.bvcSell || 0;

    if (b.high === b.low) {
      rows[startRow].vol += b.volume;
      rows[startRow].buyVol += bBuy;
      rows[startRow].sellVol += bSell;
      continue;
    }

    let totalOverlap = 0;
    let overlapInfos = [];
    for (let r = startRow; r <= endRow; r++) {
      let rowTop = highestHigh - r * rowHeight;
      let rowBottom = highestHigh - (r + 1) * rowHeight;
      let overlapBottom = Math.max(b.low, rowBottom);
      let overlapTop = Math.min(b.high, rowTop);
      let overlap = overlapTop - overlapBottom;
      if (overlap > 0) {
        overlapInfos.push({ r, overlap });
        totalOverlap += overlap;
      }
    }

    if (totalOverlap > 0) {
      for (let info of overlapInfos) {
        let pct = info.overlap / totalOverlap;
        rows[info.r].vol += pct * b.volume;
        rows[info.r].buyVol += pct * bBuy;
        rows[info.r].sellVol += pct * bSell;
      }
    } else {
      rows[startRow].vol += b.volume;
      rows[startRow].buyVol += bBuy;
      rows[startRow].sellVol += bSell;
    }
  }

  let pocIndex = 0;
  let maxVol = 0;
  rows.forEach((r, index) => {
    let totalRowVol = r.buyVol + r.sellVol;
    if (totalRowVol > maxVol) {
      maxVol = totalRowVol;
      pocIndex = index;
    }
  });

  let pocDelta = rows[pocIndex].buyVol - rows[pocIndex].sellVol;
  rows[pocIndex].poc = true;
  let pocPrice = (rows[pocIndex].priceTop + rows[pocIndex].priceBottom) / 2;

  let totalVol = rows.reduce((sum, r) => sum + r.vol, 0);
  let vaVol = maxVol;
  rows[pocIndex].inVA = true;
  let upIndex = pocIndex - 1;
  let downIndex = pocIndex + 1;

  while (vaVol < totalVol * (vaPct / 100)) {
    let volUp = upIndex >= 0 ? rows[upIndex].vol : 0;
    let volDown = downIndex < numRows ? rows[downIndex].vol : 0;
    if (volUp === 0 && volDown === 0) break;
    if (volUp > volDown) {
      vaVol += volUp;
      rows[upIndex].inVA = true;
      upIndex--;
    } else {
      vaVol += volDown;
      rows[downIndex].inVA = true;
      downIndex++;
    }
  }

  let vahPrice = rows.find((r) => r.inVA)?.priceTop || highestHigh;
  let valPrice = [...rows].reverse().find((r) => r.inVA)?.priceBottom || lowestLow;

  return { rows, pocPrice, pocDelta, vahPrice, valPrice, maxVol };
}

function calculateVSR(bars, length = 20, threshold = 10.0) {
  let zones = [];
  let prev_volume = NaN, prev_high = NaN, prev_low = NaN, prev_close = NaN, prev_stdev = NaN;
  let volume_changes = [];
  let vsr_upper = NaN, vsr_lower = NaN;
  let currentZone = null;

  for (let i = 0; i < bars.length; i++) {
    let b = bars[i];
    let change = 0;
    if (!isNaN(prev_volume) && prev_volume !== 0) change = b.volume / prev_volume - 1;

    volume_changes.push(change);
    if (volume_changes.length > length) volume_changes.shift();

    let stdev = 0;
    if (volume_changes.length >= 2) {
      let sum = volume_changes.reduce((a, x) => a + x, 0);
      let mean = sum / volume_changes.length;
      let variance = volume_changes.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / volume_changes.length;
      stdev = Math.sqrt(variance);
    }

    let signal = 0;
    if (!isNaN(prev_stdev) && prev_stdev !== 0 && volume_changes.length >= 2) signal = Math.abs(change / prev_stdev);

    if (signal > threshold && !isNaN(prev_high)) {
      let p_upper = Math.max(prev_high, prev_close);
      let p_lower = Math.min(prev_low, prev_close);

      let isOverlap = false;
      if (!isNaN(vsr_upper) && !isNaN(vsr_lower)) {
        if (p_lower <= vsr_upper && vsr_lower <= p_upper) isOverlap = true;
      }

      if (isOverlap) {
        const mergedUpper = Math.max(vsr_upper, p_upper);
        const mergedLower = Math.min(vsr_lower, p_lower);
        // A plot update starts on this bar. Do not rewrite prior candles with
        // the merged range: that would repaint historical VSR output.
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
    currentZone.endIndex = bars.length - 1;
    zones.push(currentZone);
  }
  return zones;
}

// VSR Dual Zones mirrors the custom study described in indicator.md.  Each VSR
// keeps separate volume/stdev/zone state, while the three price lines share the
// panel's price scale.
function calculateVSRDual(bars, options = {}) {
  const config = {
    vsr1Length: 10, vsr1Threshold: 10,
    vsr2Length: 20, vsr2Threshold: 10,
    emaLength: 20, vidyaLength: 20, cmoLength: 9, vwapLength: 20,
    ...options,
  };
  const values = {
    vsr1Upper: [], vsr1Lower: [], vsr2Upper: [], vsr2Lower: [],
    ema: [], vidya: [], vwap: [],
  };
  const data = {
    vsr1Upper: [], vsr1Lower: [], vsr2Upper: [], vsr2Lower: [],
    ema: [], vidya: [], vwap: [],
  };
  const buffers = [[], []];
  const lengths = [config.vsr1Length, config.vsr2Length];
  const thresholds = [config.vsr1Threshold, config.vsr2Threshold];
  const zones = [{ upper: NaN, lower: NaN }, { upper: NaN, lower: NaN }];
  const previousStdev = [NaN, NaN];
  const priceChanges = [];
  const vwapWindow = [];
  let previousVolume = NaN, previousHigh = NaN, previousLow = NaN, previousClose = NaN;
  let ema = NaN, vidya = NaN;
  const stdev = (items) => {
    if (items.length < 2) return 0;
    const mean = items.reduce((sum, value) => sum + value, 0) / items.length;
    return Math.sqrt(items.reduce((sum, value) => sum + (value - mean) ** 2, 0) / items.length);
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const change = Number.isFinite(previousVolume) && previousVolume !== 0 ? bar.volume / previousVolume - 1 : 0;
    const currentStdev = [0, 0];
    for (let j = 0; j < 2; j++) {
      buffers[j].push(change);
      if (buffers[j].length > lengths[j]) buffers[j].shift();
      currentStdev[j] = stdev(buffers[j]);
      const signal = previousStdev[j] && buffers[j].length >= 2 ? Math.abs(change / previousStdev[j]) : 0;
      if (signal > thresholds[j] && Number.isFinite(previousHigh)) {
        const proposedUpper = Math.max(previousHigh, previousClose);
        const proposedLower = Math.min(previousLow, previousClose);
        const zone = zones[j];
        const overlaps = Number.isFinite(zone.upper) && proposedLower <= zone.upper && zone.lower <= proposedUpper;
        zone.upper = overlaps ? Math.max(zone.upper, proposedUpper) : proposedUpper;
        zone.lower = overlaps ? Math.min(zone.lower, proposedLower) : proposedLower;
      }
    }

    const alpha = 2 / (config.emaLength + 1);
    ema = Number.isFinite(ema) ? alpha * bar.close + (1 - alpha) * ema : bar.close;
    if (i > 0) {
      priceChanges.push(bar.close - previousClose);
      if (priceChanges.length > config.cmoLength) priceChanges.shift();
    }
    let cmo = 0;
    if (priceChanges.length >= config.cmoLength) {
      const gains = priceChanges.reduce((sum, delta) => sum + Math.max(delta, 0), 0);
      const losses = priceChanges.reduce((sum, delta) => sum + Math.max(-delta, 0), 0);
      cmo = gains + losses ? 100 * (gains - losses) / (gains + losses) : 0;
    }
    const vidyaAlpha = (2 / (config.vidyaLength + 1)) * Math.abs(cmo) / 100;
    vidya = Number.isFinite(vidya) ? vidyaAlpha * bar.close + (1 - vidyaAlpha) * vidya : bar.close;

    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    vwapWindow.push({ price: typicalPrice, volume: bar.volume });
    if (vwapWindow.length > config.vwapLength) vwapWindow.shift();
    const volumeTotal = vwapWindow.reduce((sum, item) => sum + item.volume, 0);
    const vwap = volumeTotal ? vwapWindow.reduce((sum, item) => sum + item.price * item.volume, 0) / volumeTotal : typicalPrice;

    const output = [zones[0].upper, zones[0].lower, zones[1].upper, zones[1].lower, ema, vidya, vwap];
    const keys = ["vsr1Upper", "vsr1Lower", "vsr2Upper", "vsr2Lower", "ema", "vidya", "vwap"];
    keys.forEach((key, index) => {
      values[key].push(output[index]);
      if (Number.isFinite(output[index])) data[key].push({ time: bar.time, value: output[index] });
    });
    previousVolume = bar.volume;
    previousHigh = bar.high;
    previousLow = bar.low;
    previousClose = bar.close;
    previousStdev[0] = currentStdev[0];
    previousStdev[1] = currentStdev[1];
  }
  return { values, data };
}

function calculateStandardVWAP(bars, anchor = "day") {
  let vwapData = [];
  if (!bars || bars.length === 0) return vwapData;
  let currentDay = null;
  let sumVol = 0;
  let sumVolPrice = 0;

  for (let i = 0; i < bars.length; i++) {
    let b = bars[i];
    let date = new Date(b.time * 1000);
    let periodKey;
    if (anchor === "month") {
      periodKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    } else if (anchor === "week") {
      const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7)));
      periodKey = weekStart.toISOString().slice(0, 10);
    } else {
      periodKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
    }
    if (periodKey !== currentDay) {
      currentDay = periodKey;
      sumVol = 0;
      sumVolPrice = 0;
    }
    let typPrice = (b.high + b.low + b.close) / 3;
    sumVol += b.volume;
    sumVolPrice += b.volume * typPrice;
    b.vwap = sumVol > 0 ? sumVolPrice / sumVol : b.close;
    vwapData.push({ time: b.time, value: b.vwap });
  }
  return vwapData;
}

function roundPrice(val) {
  const scale = getPriceFormat(SYMBOL);
  return parseFloat(val.toFixed(scale));
}

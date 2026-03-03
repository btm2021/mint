function calculateATRBot(bars, atrLen, emaLen, mult) {
  if (bars.length === 0) return { t1Data: [], t2Data: [], cycles: [] };

  // 1. Calculate TR
  let tr = new Array(bars.length);
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

  // 2. Calculate ATR (RMA of TR)
  let atr = new Array(bars.length);
  let alpha = 1 / atrLen;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i < atrLen) {
      sum += tr[i];
      atr[i] = sum / (i + 1);
    } else {
      atr[i] = alpha * tr[i] + (1 - alpha) * atr[i - 1];
    }
  }

  // 3. Calculate EMA
  let ema = new Array(bars.length);
  let k = 2 / (emaLen + 1);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) ema[i] = bars[i].close;
    else ema[i] = bars[i].close * k + ema[i - 1] * (1 - k);
  }

  // 4. Calculate Trail2 & State
  let trail2 = new Array(bars.length);
  let state = new Array(bars.length); // 1 = Uptrend, -1 = Downtrend

  for (let i = 0; i < bars.length; i++) {
    let loss = atr[i] * mult;
    let t1 = ema[i];

    if (i === 0) {
      trail2[i] = t1 - loss;
      state[i] = 1;
      continue;
    }

    let prev_t2 = trail2[i - 1];
    let prev_t1 = ema[i - 1];
    let curr_t2;

    if (t1 > prev_t2 && prev_t1 > prev_t2) {
      curr_t2 = Math.max(prev_t2, t1 - loss);
    } else if (t1 < prev_t2 && prev_t1 < prev_t2) {
      curr_t2 = Math.min(prev_t2, t1 + loss);
    } else if (t1 > prev_t2) {
      curr_t2 = t1 - loss;
    } else {
      curr_t2 = t1 + loss;
    }

    trail2[i] = curr_t2;
    state[i] = t1 > curr_t2 ? 1 : -1;
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

    t1Data.push({ time: t, value: ema[i], color: color });
    t2Data.push({ time: t, value: trail2[i], color: color });

    let barData = { ...bars[i], t1: ema[i], t2: trail2[i] };

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
        vsr_upper = Math.max(vsr_upper, p_upper);
        vsr_lower = Math.min(vsr_lower, p_lower);
        if (currentZone) {
          currentZone.upper = vsr_upper;
          currentZone.lower = vsr_lower;
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

function calculateStandardVWAP(bars) {
  let vwapData = [];
  if (!bars || bars.length === 0) return vwapData;
  let currentDay = null;
  let sumVol = 0;
  let sumVolPrice = 0;

  for (let i = 0; i < bars.length; i++) {
    let b = bars[i];
    let date = new Date(b.time * 1000);
    let dayStr = date.getUTCFullYear() + "-" + date.getUTCMonth() + "-" + date.getUTCDate();
    if (dayStr !== currentDay) {
      currentDay = dayStr;
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

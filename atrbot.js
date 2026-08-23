/**
 * ATR Bot Indicator Engine
 * Converted from td-pwa/chart/custom_studies/atr-bot.js
 * ATR Dynamic Trail with Multi-MA and Trend State Detection
 */

const ATRBot = (function () {
  'use strict';

  /**
   * Calculate ATR Bot Moving Average (Trail 1) and ATR Dynamic Trailing Stop (Trail 2)
   * @param {Array<{open: number, high: number, low: number, close: number, volume: number, time: number}>} ohlcv
   * @param {Object} [options]
   * @param {number} [options.atrLength=14] - ATR Period
   * @param {number} [options.atrMult=2.0] - ATR Multiplier
   * @param {string} [options.source="close"] - Source price (open, high, low, close, hl2, hlc3, ohlc4)
   * @param {string} [options.maType="EMA"] - Moving Average type (EMA, SMA, VWMA, LWMA, HMA, WMA, ALMA, TEMA, ZLEMA, KAMA, VIDYA, SMMA, McGinley, SWMA)
   * @param {number} [options.maLength=30] - Moving Average Period
   * @returns {Array<{trail1: number, trail2: number, trend: number, isBuy: boolean, isSell: boolean, atr: number, time: number}>}
   */
  function calculate(ohlcv, options = {}) {
    if (!ohlcv || !Array.isArray(ohlcv)) {
      throw new Error("ATRBot.calculate requires an array of OHLCV candles");
    }

    const atrLength = options.atrLength !== undefined ? Number(options.atrLength) : 14;
    const atrMult = options.atrMult !== undefined ? Number(options.atrMult) : 2.0;
    const sourceType = options.source || "close";
    const maType = options.maType || "EMA";
    const maLength = options.maLength !== undefined ? Number(options.maLength) : 30;

    const n = ohlcv.length;
    const results = new Array(n);

    // Running state variables
    let prevClose = NaN;
    let prevATR = NaN;
    let prevTrail1 = NaN;
    let prevTrail2 = NaN;
    let prevTrend = 0;

    // MA specific buffers
    let prevEMA = NaN;
    const vwmaBuffer = [];
    const lwmaBuffer = [];
    const hullWma1 = [];
    const hullWma2 = [];
    const hullWma3 = [];
    const wmaBuffer = [];
    const almaBuffer = [];
    let temaEma1 = NaN, temaEma2 = NaN, temaEma3 = NaN;
    let zlemaPrev = NaN;
    const lsmaBuffer = [];
    const kamaBuffer = [];
    let kamaPrev = NaN;
    const vidyaBuffer = [];
    let vidyaPrev = NaN;
    let smmaSum = 0, smmaCount = 0, smmaPrev = NaN;
    let mcginleyPrev = NaN;
    const swmaBuffer = [];

    for (let i = 0; i < n; i++) {
      const bar = ohlcv[i];
      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      const volume = Number(bar.volume || 0);

      // 1. Get Source Price
      let src = close;
      switch (sourceType.toLowerCase()) {
        case "open": src = open; break;
        case "high": src = high; break;
        case "low": src = low; break;
        case "hl2": src = (high + low) / 2; break;
        case "hlc3": src = (high + low + close) / 3; break;
        case "ohlc4": src = (open + high + low + close) / 4; break;
        default: src = close; break;
      }

      // 2. Calculate Moving Average (Trail 1)
      let trail1 = src;

      switch (maType.toUpperCase()) {
        case "EMA": {
          if (isNaN(prevEMA)) {
            trail1 = src;
          } else {
            const alpha = 2.0 / (maLength + 1);
            trail1 = alpha * src + (1 - alpha) * prevEMA;
          }
          prevEMA = trail1;
          break;
        }

        case "SMA": {
          lwmaBuffer.push(src);
          if (lwmaBuffer.length > maLength) lwmaBuffer.shift();
          const sum = lwmaBuffer.reduce((a, b) => a + b, 0);
          trail1 = sum / lwmaBuffer.length;
          break;
        }

        case "VWMA": {
          vwmaBuffer.push({ price: src, volume: volume });
          if (vwmaBuffer.length > maLength) vwmaBuffer.shift();
          let sumPv = 0, sumV = 0;
          for (let j = 0; j < vwmaBuffer.length; j++) {
            sumPv += vwmaBuffer[j].price * vwmaBuffer[j].volume;
            sumV += vwmaBuffer[j].volume;
          }
          trail1 = sumV > 0 ? sumPv / sumV : src;
          break;
        }

        case "LWMA": {
          lwmaBuffer.push(src);
          if (lwmaBuffer.length > maLength) lwmaBuffer.shift();
          let sumW = 0, weightSum = 0;
          for (let j = 0; j < lwmaBuffer.length; j++) {
            const weight = j + 1;
            sumW += lwmaBuffer[j] * weight;
            weightSum += weight;
          }
          trail1 = weightSum > 0 ? sumW / weightSum : src;
          break;
        }

        case "HMA":
        case "HULL": {
          const halfLen = Math.floor(maLength / 2);
          const sqrtLen = Math.floor(Math.sqrt(maLength));
          hullWma1.push(src);
          hullWma2.push(src);
          if (hullWma1.length > halfLen) hullWma1.shift();
          if (hullWma2.length > maLength) hullWma2.shift();

          let wma1Sum = 0, wma1W = 0;
          for (let j = 0; j < hullWma1.length; j++) {
            const w = j + 1;
            wma1Sum += hullWma1[j] * w;
            wma1W += w;
          }
          const wma1 = wma1W > 0 ? wma1Sum / wma1W : src;

          let wma2Sum = 0, wma2W = 0;
          for (let j = 0; j < hullWma2.length; j++) {
            const w = j + 1;
            wma2Sum += hullWma2[j] * w;
            wma2W += w;
          }
          const wma2 = wma2W > 0 ? wma2Sum / wma2W : src;

          const rawHull = 2 * wma1 - wma2;
          hullWma3.push(rawHull);
          if (hullWma3.length > sqrtLen) hullWma3.shift();

          let wma3Sum = 0, wma3W = 0;
          for (let j = 0; j < hullWma3.length; j++) {
            const w = j + 1;
            wma3Sum += hullWma3[j] * w;
            wma3W += w;
          }
          trail1 = wma3W > 0 ? wma3Sum / wma3W : src;
          break;
        }

        case "WMA": {
          wmaBuffer.push(src);
          if (wmaBuffer.length > maLength) wmaBuffer.shift();
          let sumW = 0, weightSum = 0;
          for (let j = 0; j < wmaBuffer.length; j++) {
            const weight = j + 1;
            sumW += wmaBuffer[j] * weight;
            weightSum += weight;
          }
          trail1 = weightSum > 0 ? sumW / weightSum : src;
          break;
        }

        case "TEMA": {
          const alpha = 2.0 / (maLength + 1);
          if (isNaN(temaEma1)) {
            temaEma1 = src;
            temaEma2 = src;
            temaEma3 = src;
          } else {
            temaEma1 = alpha * src + (1 - alpha) * temaEma1;
            temaEma2 = alpha * temaEma1 + (1 - alpha) * temaEma2;
            temaEma3 = alpha * temaEma2 + (1 - alpha) * temaEma3;
          }
          trail1 = 3 * temaEma1 - 3 * temaEma2 + temaEma3;
          break;
        }

        case "ZLEMA": {
          const lag = Math.floor((maLength - 1) / 2);
          const lagPrice = i >= lag ? Number(ohlcv[i - lag].close) : src;
          const zlemaSrc = src + (src - lagPrice);
          const alpha = 2.0 / (maLength + 1);
          if (isNaN(zlemaPrev)) {
            trail1 = zlemaSrc;
          } else {
            trail1 = alpha * zlemaSrc + (1 - alpha) * zlemaPrev;
          }
          zlemaPrev = trail1;
          break;
        }

        case "KAMA": {
          kamaBuffer.push(src);
          if (kamaBuffer.length > maLength + 1) kamaBuffer.shift();
          if (kamaBuffer.length > maLength) {
            const change = Math.abs(src - kamaBuffer[0]);
            let vol = 0;
            for (let j = 1; j < kamaBuffer.length; j++) {
              vol += Math.abs(kamaBuffer[j] - kamaBuffer[j - 1]);
            }
            const er = vol > 0 ? change / vol : 0;
            const fastest = 2.0 / (2 + 1);
            const slowest = 2.0 / (30 + 1);
            const sc = Math.pow(er * (fastest - slowest) + slowest, 2);
            trail1 = isNaN(kamaPrev) ? src : kamaPrev + sc * (src - kamaPrev);
            kamaPrev = trail1;
          } else {
            trail1 = isNaN(kamaPrev) ? src : kamaPrev;
          }
          break;
        }

        case "SMMA": {
          if (isNaN(smmaPrev)) {
            smmaSum += src;
            smmaCount++;
            if (smmaCount >= maLength) {
              trail1 = smmaSum / maLength;
              smmaPrev = trail1;
            } else {
              trail1 = src;
            }
          } else {
            trail1 = (smmaPrev * (maLength - 1) + src) / maLength;
            smmaPrev = trail1;
          }
          break;
        }

        case "VIDYA": {
          // VIDYA (Variable Index Dynamic Average) using Chande Momentum Oscillator (CMO)
          const cmoLength = options.cmoLength !== undefined ? Number(options.cmoLength) : 9;

          if (isNaN(vidyaPrev)) {
            trail1 = src;
            vidyaPrev = src;
            prevClose = src;
          } else {
            const change = src - prevClose;
            if (change > 0) {
              vidyaBuffer.push({ gain: change, loss: 0 });
            } else if (change < 0) {
              vidyaBuffer.push({ gain: 0, loss: Math.abs(change) });
            } else {
              vidyaBuffer.push({ gain: 0, loss: 0 });
            }

            if (vidyaBuffer.length > cmoLength) {
              vidyaBuffer.shift();
            }

            let cmo = 0;
            if (vidyaBuffer.length >= cmoLength) {
              let sumGains = 0, sumLosses = 0;
              for (let j = 0; j < vidyaBuffer.length; j++) {
                sumGains += vidyaBuffer[j].gain;
                sumLosses += vidyaBuffer[j].loss;
              }
              const sumTotal = sumGains + sumLosses;
              if (sumTotal !== 0) {
                cmo = ((sumGains - sumLosses) / sumTotal) * 100;
              }
            }

            const emaAlpha = 2.0 / (maLength + 1);
            const alpha = emaAlpha * (Math.abs(cmo) / 100);

            trail1 = alpha * src + (1 - alpha) * vidyaPrev;
            vidyaPrev = trail1;
          }
          break;
        }

        default: {
          // Default to EMA
          if (isNaN(prevEMA)) {
            trail1 = src;
          } else {
            const alpha = 2.0 / (maLength + 1);
            trail1 = alpha * src + (1 - alpha) * prevEMA;
          }
          prevEMA = trail1;
          break;
        }
      }

      // 3. Calculate True Range & ATR (RMA Wilder's Smoothing)
      let tr = 0;
      if (isNaN(prevClose)) {
        tr = high - low;
      } else {
        tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      }

      let atr = tr;
      if (isNaN(prevATR)) {
        atr = tr;
      } else {
        atr = (prevATR * (atrLength - 1) + tr) / atrLength;
      }
      const atrValue = atr * atrMult;

      // 4. Calculate Trail 2 (Dynamic ATR Trailing Stop)
      let trail2 = trail1;
      const t2Prev = isNaN(prevTrail2) ? 0 : prevTrail2;
      const t1Prev = isNaN(prevTrail1) ? trail1 : prevTrail1;

      if (trail1 > t2Prev) {
        if (t1Prev > t2Prev) {
          trail2 = Math.max(t2Prev, trail1 - atrValue);
        } else {
          trail2 = trail1 - atrValue;
        }
      } else {
        if (trail1 < t2Prev && t1Prev < t2Prev) {
          trail2 = Math.min(t2Prev, trail1 + atrValue);
        } else {
          trail2 = trail1 + atrValue;
        }
      }

      // 5. Determine Trend and Flip Signals
      const trend = trail1 > trail2 ? 1 : (trail1 < trail2 ? -1 : prevTrend);
      const isBuy = trend === 1 && prevTrend === -1;
      const isSell = trend === -1 && prevTrend === 1;

      // Store history
      prevClose = close;
      prevATR = atr;
      prevTrail1 = trail1;
      prevTrail2 = trail2;
      prevTrend = trend;

      results[i] = {
        trail1: trail1,
        trail2: trail2,
        trend: trend,
        isBuy: isBuy,
        isSell: isSell,
        atr: atr,
        time: bar.time
      };
    }

    return results;
  }

  return {
    calculate: calculate
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ATRBot;
}

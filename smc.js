/**
 * Smart Money Concepts (SMC) - JavaScript Engine
 * Ported 1:1 from https://github.com/joshyattridge/smart-money-concepts
 */

const SMC = (function () {
  'use strict';

  /**
   * FVG - Fair Value Gap
   * 
   * A fair value gap is when the previous high is lower than the next low if the current candle is bullish.
   * Or when the previous low is higher than the next high if the current candle is bearish.
   *
   * @param {Array<{open: number, high: number, low: number, close: number}>} ohlc
   * @param {boolean} [joinConsecutive=false] - if true, consecutive FVGs in the same direction are merged
   * @returns {Array<{fvg: number|null, top: number|null, bottom: number|null, mitigatedIndex: number|null}>}
   *          fvg: 1 (Bullish), -1 (Bearish), null (None)
   *          top: top price level of FVG
   *          bottom: bottom price level of FVG
   *          mitigatedIndex: candle index that mitigated the FVG, or null if unmitigated
   */
  function fvg(ohlc, joinConsecutive = false) {
    if (!ohlc || !Array.isArray(ohlc)) {
      throw new Error("SMC.fvg requires an array of OHLC candles");
    }

    const n = ohlc.length;
    const fvgArr = new Array(n).fill(null);
    const topArr = new Array(n).fill(null);
    const bottomArr = new Array(n).fill(null);
    const mitigatedIndexArr = new Array(n).fill(null);

    if (n < 3) {
      const emptyResult = new Array(n);
      for (let i = 0; i < n; i++) {
        emptyResult[i] = { fvg: null, top: null, bottom: null, mitigatedIndex: null };
      }
      return emptyResult;
    }

    // Step 1: Detect FVGs for candles from 1 to n - 2
    // Equivalent to:
    // (shift(1) < shift(-1) & close > open) | (shift(1) > shift(-1) & close < open)
    for (let i = 1; i < n - 1; i++) {
      const prevHigh = Number(ohlc[i - 1].high);
      const prevLow = Number(ohlc[i - 1].low);
      const nextHigh = Number(ohlc[i + 1].high);
      const nextLow = Number(ohlc[i + 1].low);
      const curOpen = Number(ohlc[i].open);
      const curClose = Number(ohlc[i].close);

      // Bullish FVG
      if (prevHigh < nextLow && curClose > curOpen) {
        fvgArr[i] = 1;
        topArr[i] = nextLow;
        bottomArr[i] = prevHigh;
      }
      // Bearish FVG
      else if (prevLow > nextHigh && curClose < curOpen) {
        fvgArr[i] = -1;
        topArr[i] = prevLow;
        bottomArr[i] = nextHigh;
      }
    }

    // Step 2: Join consecutive FVGs if joinConsecutive is true
    if (joinConsecutive) {
      for (let i = 0; i < n - 1; i++) {
        if (fvgArr[i] !== null && fvgArr[i] === fvgArr[i + 1]) {
          topArr[i + 1] = Math.max(topArr[i], topArr[i + 1]);
          bottomArr[i + 1] = Math.min(bottomArr[i], bottomArr[i + 1]);
          fvgArr[i] = null;
          topArr[i] = null;
          bottomArr[i] = null;
        }
      }
    }

    // Step 3: Calculate MitigatedIndex
    // In Python:
    // mitigated_index = np.zeros(len(ohlc), dtype=np.int32)
    // for i in np.where(~np.isnan(fvg))[0]:
    //   if np.any(mask): j = np.argmax(mask) + i + 2; mitigated_index[i] = j
    // mitigated_index = np.where(np.isnan(fvg), np.nan, mitigated_index)
    for (let i = 0; i < n; i++) {
      if (fvgArr[i] === null) continue;

      const isBull = fvgArr[i] === 1;
      const topVal = topArr[i];
      const btmVal = bottomArr[i];
      let mitIndex = 0; // Default 0 for unmitigated, matching Python np.zeros

      for (let j = i + 2; j < n; j++) {
        if (isBull) {
          if (Number(ohlc[j].low) <= topVal) {
            mitIndex = j;
            break;
          }
        } else {
          if (Number(ohlc[j].high) >= btmVal) {
            mitIndex = j;
            break;
          }
        }
      }

      mitigatedIndexArr[i] = mitIndex;
    }

    // Step 4: Package clean array of result objects
    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        fvg: fvgArr[i],
        top: topArr[i],
        bottom: bottomArr[i],
        mitigatedIndex: mitigatedIndexArr[i]
      };
    }

    return result;
  }

  return {
    fvg: fvg
  };
})();

// Support Node.js CommonJS & Browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SMC;
}

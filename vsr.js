/**
 * Volume Spike Reversal (VSR) Indicator
 * Converted from td-pwa/chart/custom_studies/vsr.js
 */

const VSR = (function () {
  'use strict';

  /**
   * Calculate VSR (Volume Spike Reversal) levels and zones
   * @param {Array<{open: number, high: number, low: number, close: number, volume: number, time: number}>} ohlcv
   * @param {Object} [options]
   * @param {number} [options.length=10] - Volume SD Length
   * @param {number} [options.threshold=10.0] - Volume Spike Threshold
   * @returns {Array<{upper: number|null, lower: number|null, signal: number, isSpike: boolean, time: number}>}
   */
  function calculate(ohlcv, options = {}) {
    if (!ohlcv || !Array.isArray(ohlcv)) {
      throw new Error("VSR.calculate requires an array of OHLCV candles");
    }

    const length = options.length !== undefined ? Number(options.length) : 10;
    const threshold = options.threshold !== undefined ? Number(options.threshold) : 10.0;

    const n = ohlcv.length;
    const results = new Array(n);

    let prevVolume = NaN;
    let prevStdev = NaN;
    let vsrUpper = NaN;
    let vsrLower = NaN;
    const volumeChanges = [];

    for (let i = 0; i < n; i++) {
      const bar = ohlcv[i];
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      const volume = Number(bar.volume || 0);

      // 1. Calculate volume percentage change: volume / prev_volume - 1
      let change = 0;
      if (!isNaN(prevVolume) && prevVolume !== 0) {
        change = volume / prevVolume - 1;
      }

      volumeChanges.push(change);
      if (volumeChanges.length > length) {
        volumeChanges.shift();
      }

      // 2. Calculate standard deviation of volume changes
      let stdev = 0;
      if (volumeChanges.length >= 2) {
        const sum = volumeChanges.reduce((a, b) => a + b, 0);
        const mean = sum / volumeChanges.length;
        const variance = volumeChanges.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / volumeChanges.length;
        stdev = Math.sqrt(variance);
      }

      // 3. Calculate difference & signal: change / prev_stdev
      let difference = 0;
      let signal = 0;
      if (!isNaN(prevStdev) && prevStdev !== 0 && volumeChanges.length >= 2) {
        difference = change / prevStdev;
        signal = Math.abs(difference);
      }

      // 4. Create / update VSR zone when signal > threshold
      let isSpike = false;
      if (signal > threshold && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
        isSpike = true;
        const proposedUpper = Math.max(high, close);
        const proposedLower = Math.min(low, close);

        // Check for overlap with existing VSR zone
        let isOverlap = false;
        if (!isNaN(vsrUpper) && !isNaN(vsrLower)) {
          if (proposedLower <= vsrUpper && vsrLower <= proposedUpper) {
            isOverlap = true;
          }
        }

        if (isOverlap) {
          vsrUpper = Math.max(vsrUpper, proposedUpper);
          vsrLower = Math.min(vsrLower, proposedLower);
        } else {
          vsrUpper = proposedUpper;
          vsrLower = proposedLower;
        }
      }

      prevVolume = volume;
      prevStdev = stdev;

      results[i] = {
        upper: !isNaN(vsrUpper) ? vsrUpper : null,
        lower: !isNaN(vsrLower) ? vsrLower : null,
        signal: signal,
        isSpike: isSpike,
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
  module.exports = VSR;
}

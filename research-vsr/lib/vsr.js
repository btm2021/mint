// Tái hiện CHÍNH XÁC logic calculateVSR trong js/indicators.js (project mint)
// Chỉ khác: ngoài zones còn trả về upper/lower/signal theo từng nến để phục vụ nghiên cứu.
export function calculateVSR(bars, length, threshold) {
  const n = bars.length;
  const uppers = new Array(n).fill(NaN);
  const lowers = new Array(n).fill(NaN);
  const signals = new Array(n).fill(0);
  const zones = [];

  let prevVolume = NaN, prevHigh = NaN, prevLow = NaN, prevClose = NaN, prevStdev = NaN;
  const volumeChanges = [];
  let upper = NaN, lower = NaN;
  let currentZone = null;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    let change = 0;
    if (!Number.isNaN(prevVolume) && prevVolume !== 0) change = b.volume / prevVolume - 1;

    volumeChanges.push(change);
    if (volumeChanges.length > length) volumeChanges.shift();

    let stdev = 0;
    if (volumeChanges.length >= 2) {
      const sum = volumeChanges.reduce((a, x) => a + x, 0);
      const mean = sum / volumeChanges.length;
      const variance = volumeChanges.reduce((a, x) => a + (x - mean) ** 2, 0) / volumeChanges.length;
      stdev = Math.sqrt(variance);
    }

    let signal = 0;
    if (!Number.isNaN(prevStdev) && prevStdev !== 0 && volumeChanges.length >= 2) {
      signal = Math.abs(change / prevStdev);
    }
    signals[i] = signal;

    if (signal > threshold && !Number.isNaN(prevHigh)) {
      const pUpper = Math.max(prevHigh, prevClose);
      const pLower = Math.min(prevLow, prevClose);

      let isOverlap = false;
      if (!Number.isNaN(upper) && !Number.isNaN(lower)) {
        if (pLower <= upper && lower <= pUpper) isOverlap = true;
      }

      if (isOverlap) {
        const mergedUpper = Math.max(upper, pUpper);
        const mergedLower = Math.min(lower, pLower);
        if (mergedUpper !== upper || mergedLower !== lower) {
          if (currentZone) {
            currentZone.endIndex = i - 1;
            zones.push(currentZone);
          }
          upper = mergedUpper;
          lower = mergedLower;
          currentZone = {
            startIndex: i, endIndex: i, upper, lower,
            merges: currentZone ? currentZone.merges + 1 : 1,
            triggerChange: change, triggerSignal: signal,
          };
        } else if (currentZone) {
          currentZone.endIndex = i;
        }
      } else {
        upper = pUpper;
        lower = pLower;
        if (currentZone) {
          currentZone.endIndex = i - 1;
          zones.push(currentZone);
        }
        currentZone = {
          startIndex: i, endIndex: i, upper, lower,
          merges: 0, triggerChange: change, triggerSignal: signal,
        };
      }
    } else if (currentZone) {
      currentZone.endIndex = i;
    }

    uppers[i] = upper;
    lowers[i] = lower;

    prevVolume = b.volume; prevHigh = b.high; prevLow = b.low; prevClose = b.close; prevStdev = stdev;
  }

  if (currentZone) {
    currentZone.endIndex = n - 1;
    zones.push(currentZone);
  }
  return { zones, uppers, lowers, signals };
}

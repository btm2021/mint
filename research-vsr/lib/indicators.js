// Tái hiện EMA(20) và Standard VWAP (anchor theo ngày) từ js/indicators.js
// để dùng làm bộ lọc/features thay thế nến trong phân tích.
export function calcEma(bars, len = 20) {
  const alpha = 2 / (len + 1);
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    out[i] = i === 0 ? bars[i].close : alpha * bars[i].close + (1 - alpha) * out[i - 1];
  }
  return out;
}

// Giống calculateStandardVWAP: reset theo ngày UTC, typical price = (H+L+C)/3
export function calcDayVwap(bars) {
  const out = new Array(bars.length).fill(NaN);
  let curDay = "";
  let sumVol = 0, sumVolPrice = 0;
  for (let i = 0; i < bars.length; i++) {
    const d = new Date(bars[i].time * 1000);
    const day = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (day !== curDay) {
      curDay = day;
      sumVol = 0;
      sumVolPrice = 0;
    }
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    sumVol += bars[i].volume;
    sumVolPrice += bars[i].volume * tp;
    out[i] = sumVol > 0 ? sumVolPrice / sumVol : bars[i].close;
  }
  return out;
}

export function avgVolume(bars, idx, windowSize = 20) {
  const start = Math.max(0, idx - windowSize);
  if (idx - start < 1) return NaN;
  let sum = 0, count = 0;
  for (let i = start; i < idx; i++) { sum += bars[i].volume; count++; }
  return count ? sum / count : NaN;
}

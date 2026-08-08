// Lõi chung: trả trail1, trail2, states
function core(bars, atrLen, maLen, mult, maType) {
  const n = bars.length;
  const alpha = 2 / (maLen + 1);
  const trail1 = new Array(n);
  const atr = new Array(n);

  for (let i = 0; i < n; i++) {
    const tr = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - bars[i - 1].close),
          Math.abs(bars[i].low - bars[i - 1].close),
        );
    atr[i] = i === 0 ? tr : (atr[i - 1] * (atrLen - 1) + tr) / atrLen;

    const value = bars[i].close;
    if (maType === "vidya") {
      if (i === 0) { trail1[i] = value; continue; }
      let gains = 0, losses = 0;
      for (let j = Math.max(1, i - maLen + 1); j <= i; j++) {
        const ch = bars[j].close - bars[j - 1].close;
        if (ch > 0) gains += ch;
        else losses -= ch;
      }
      const movement = gains + losses;
      const cmo = movement === 0 ? 0 : Math.abs((gains - losses) / movement);
      trail1[i] = alpha * cmo * value + (1 - alpha * cmo) * trail1[i - 1];
    } else {
      trail1[i] = i === 0 ? value : alpha * value + (1 - alpha) * trail1[i - 1];
    }
  }

  const trail2 = new Array(n);
  const states = new Array(n);
  for (let i = 0; i < n; i++) {
    const loss = atr[i] * mult;
    const t1 = trail1[i];
    const prevT2 = i === 0 ? 0 : trail2[i - 1];
    const prevT1 = i === 0 ? t1 : trail1[i - 1];
    if (t1 > prevT2) {
      trail2[i] = prevT1 > prevT2 ? Math.max(prevT2, t1 - loss) : t1 - loss;
    } else {
      trail2[i] = t1 < prevT2 && prevT1 < prevT2 ? Math.min(prevT2, t1 + loss) : t1 + loss;
    }
    states[i] = t1 > trail2[i] ? 1 : -1;
  }
  return { states, trail1, trail2, atr };
}

export function calculateTrendStates(bars, atrLen = 14, maLen = 30, mult = 2, maType = "ema") {
  return core(bars, atrLen, maLen, mult, maType).states;
}

// Trả đủ { states, trail1, trail2, atr } — dùng để đo sức mạnh trend (|trail1-trail2|/price)
export function calculateTrendFull(bars, atrLen = 14, maLen = 30, mult = 2, maType = "ema") {
  return core(bars, atrLen, maLen, mult, maType);
}

async function fetchExchangeInfo() {
  try {
    const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
    const data = await res.json();
    const list = data.symbols
      .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT")
      .map((s) => ({
        symbol: s.symbol,
        priceScale: s.pricePrecision,
        minMove: 1 / Math.pow(10, s.pricePrecision),
      }));
    localStorage.setItem("stat1_symbols", JSON.stringify(list));
    localStorage.setItem("stat1_symbols_ts", Date.now());
    return list;
  } catch (e) {
    console.error("Fetch exchangeInfo failed", e);
    return [];
  }
}

async function fetchBinanceData() {
  const cacheKey = `${SYMBOL}_${INTERVAL}_DB_v6`;
  const statusText = document.getElementById("status");
  let existingBars = [];

  // 1. Load existing cache
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.length > 0 && Array.isArray(parsed[0])) {
        existingBars = parsed.map((p) => ({
          time: p[0],
          open: p[1],
          high: p[2],
          low: p[3],
          close: p[4],
          volume: p[5],
          buyVolume: p[6],
        }));
      }
    } catch (e) {
      console.error("Cache parsing error", e);
    }
  }

  const batchSize = 1500;
  const unique = new Map();
  existingBars.forEach((b) => unique.set(b.time * 1000, b));

  // 2. Fetch missing NEW data (forward)
  let lastTime =
    existingBars.length > 0
      ? existingBars[existingBars.length - 1].time * 1000
      : 0;
  if (lastTime > 0) {
    statusText.innerHTML = `<span class="status-loading">Checking for new data... (${SYMBOL})</span>`;
    try {
      let startTime = lastTime + 1;
      let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${batchSize}&startTime=${startTime}`;
      let res = await fetch(url);
      let data = await res.json();
      if (data && data.length > 0 && !data.code) {
        data.forEach((d) => {
          unique.set(d[0], {
            time: d[0] / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            buyVolume: parseFloat(d[9]),
          });
        });
        console.log(`Added ${data.length} new bars.`);
      }
    } catch (e) {
      console.error("Fetch new data failed", e);
    }
  }

  // 3. Fetch missing HISTORICAL data (backward)
  let currentSize = unique.size;
  if (currentSize < LIMIT) {
    let firstTime =
      existingBars.length > 0 ? existingBars[0].time * 1000 : Date.now();
    let endTime = firstTime - 1;

    while (unique.size < LIMIT) {
      statusText.innerHTML = `<span class="status-loading">Loading ${SYMBOL} history... (${unique.size.toLocaleString()} / ${LIMIT.toLocaleString()})</span>`;
      let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${batchSize}&endTime=${endTime}`;

      try {
        let res = await fetch(url);
        let data = await res.json();

        if (!data || data.length === 0 || data.code) break;

        data.forEach((d) => {
          unique.set(d[0], {
            time: d[0] / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            buyVolume: parseFloat(d[9]),
          });
        });

        endTime = data[0][0] - 1;
        if (data.length < batchSize) break;
      } catch (e) {
        console.error("Fetch history failed", e);
        break;
      }
    }
  }

  // 4. Sort and Limit
  let sorted = Array.from(unique.values()).sort(
    (a, b) => a.time - b.time,
  );
  if (sorted.length > LIMIT) {
    sorted = sorted.slice(sorted.length - LIMIT);
  }

  // 5. Cache as array of arrays
  const compressed = sorted.map((c) => [
    c.time,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
    c.buyVolume,
  ]);

  try {
    localStorage.setItem(cacheKey, JSON.stringify(compressed));
  } catch (err) {
    console.warn("Storage full, clearing old keys...");
    localStorage.clear(); // Extreme cleanup
    try {
      localStorage.setItem(cacheKey, JSON.stringify(compressed));
    } catch (e) { }
  }

  return sorted;
}

function setupTickerWS() {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${SYMBOL.toLowerCase()}@ticker`);
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    const priceText = document.getElementById("ticker-price");
    const changeText = document.getElementById("ticker-change");
    if (!priceText || !changeText) return;

    const oldPrice = parseFloat(priceText.innerText);
    const newPrice = parseFloat(d.c);
    const scale = getPriceFormat(newPrice);
    priceText.innerText = newPrice.toFixed(scale.precision);

    if (newPrice > oldPrice) {
      priceText.className = "tick-up";
    } else if (newPrice < oldPrice) {
      priceText.className = "tick-down";
    }

    const cp = parseFloat(d.P);
    changeText.innerText = (cp >= 0 ? "+" : "") + cp.toFixed(2) + "%";
    changeText.className = cp >= 0 ? "up" : "down";
  };
  ws.onerror = () => { };
}

function setupRealtimeWS() {
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${SYMBOL.toLowerCase()}@kline_${INTERVAL}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const k = msg.k;
    const bar = {
      time: k.t / 1000,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      buyVolume: parseFloat(k.V),
    };

    candleSeries.update(bar);

    // Update globalBars
    if (globalBars.length > 0) {
      const last = globalBars[globalBars.length - 1];
      if (last.time === bar.time) {
        globalBars[globalBars.length - 1] = bar;
      } else {
        globalBars.push(bar);
        if (globalBars.length > LIMIT) globalBars.shift();
      }
    } else {
      globalBars.push(bar);
    }

    // Indicators
    const atr1 = calculateATRBot(globalBars, ATR_LENGTH, EMA_LENGTH, ATR_MULT);
    const atr2 = calculateATRBot(globalBars, 10, 14, 1.0);
    const vsr = calculateVSR(globalBars, VSR_LENGTH, VSR_THRESHOLD);
    const vwap = calculateStandardVWAP(globalBars);

    if (showATR1 && atr1.length > 0) {
      const lastA = atr1[atr1.length - 1];
      t1Series.update(lastA);
      t2Series.update(lastA);
    }
    if (showATR2 && atr2.length > 0) {
      const lastA = atr2[atr2.length - 1];
      t1Series2.update(lastA);
      t2Series2.update(lastA);
    }
    if (showVSR && vsr.length > 0) {
      globalVsrZones = vsr;
    }
    if (showVWAP && vwap.length > 0) {
      vwapSeries.update(vwap[vwap.length - 1]);
    }

    // Measure tool live update
    if (measureState.modeActive && measureState.step === 1) {
      measureState.endIdx = globalBars.length - 1;
    }
  };
}

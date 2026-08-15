// ============================================================
// datasources.js — QUẢN LÝ ĐA NGUỒN DỮ LIỆU & CACHE INDEXEDDB
// Hỗ trợ: Binance Futures, Binance Spot, OKX Perp, Bybit, OANDA Forex
// Quy tắc: Nếu thiếu > 50 bar mới tải mới, còn lại dùng cache DB có sẵn.
// ============================================================

const DATA_SOURCES = {
  "binance-futures": {
    id: "binance-futures",
    name: "Binance Futures",
    shortName: "Binance Fut",
    category: "coin",
    type: "crypto",
    badge: "FUTURES",
    color: "#F0B90B",
    icon: "🟡",
    defaultSymbol: "BTCUSDT",
  },
  "binance-spot": {
    id: "binance-spot",
    name: "Binance Spot",
    shortName: "Binance Spot",
    category: "coin",
    type: "crypto",
    badge: "SPOT",
    color: "#F3BA2F",
    icon: "🪙",
    defaultSymbol: "BTCUSDT",
  },
  "okx-perp": {
    id: "okx-perp",
    name: "OKX Perpetual",
    shortName: "OKX Perp",
    category: "coin",
    type: "crypto",
    badge: "OKX",
    color: "#FFFFFF",
    icon: "⬛",
    defaultSymbol: "BTC-USDT-SWAP",
  },
  "bybit": {
    id: "bybit",
    name: "Bybit Linear",
    shortName: "Bybit",
    category: "coin",
    type: "crypto",
    badge: "BYBIT",
    color: "#F7A600",
    icon: "🟠",
    defaultSymbol: "BTCUSDT",
  },
  "oanda": {
    id: "oanda",
    name: "OANDA Forex",
    shortName: "OANDA",
    category: "forex",
    type: "forex",
    badge: "OANDA",
    color: "#00A651",
    icon: "💱",
    defaultSymbol: "XAU_USD",
    config: {
      baseUrl: "https://api-fxpractice.oanda.com/v3",
      streamUrl: "https://stream-fxpractice.oanda.com/v3",
      accountId: "101-004-27015242-001",
      apiKey: "7a53c4eeff879ba6118ddc416c2d2085-4a766a7d07af7bd629c07b451fe92984",
      forexPairs: [
        "XAU_USD", "XAU_EUR", "XAU_AUD", "XAU_CAD", "XAU_CHF", "XAU_NZD", "XAU_GBP", "XAU_JPY",
        "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD",
        "EUR_GBP", "EUR_JPY", "GBP_JPY", "EUR_CHF", "AUD_JPY", "GBP_CHF", "EUR_AUD",
        "EUR_CAD", "GBP_CAD", "AUD_CAD", "AUD_NZD", "CAD_JPY", "CHF_JPY", "NZD_JPY",
        "GBP_AUD", "GBP_NZD", "EUR_NZD", "AUD_CHF", "NZD_CHF", "CAD_CHF", "NZD_CAD"
      ],
    },
  },
};

// Global Stream Handles
let activeDataSourceWS = null;
let activeDataSourceTickerWS = null;
let activeDataSourcePollingTimer = null;

function getSourceInfo(sourceKey) {
  return DATA_SOURCES[sourceKey] || DATA_SOURCES["binance-futures"];
}

function getIntervalSeconds(iv) {
  switch (iv) {
    case "1m": return 60;
    case "5m": return 300;
    case "15m": return 900;
    case "1h": return 3600;
    case "4h": return 14400;
    case "1d": return 86400;
    default: return 900;
  }
}

// ==================== 1. FETCH SYMBOLS LIST ====================

async function fetchSymbolsForSource(sourceKey) {
  const src = getSourceInfo(sourceKey);
  const cacheKey = `symbols_cache_${src.id}`;

  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) { }
  }

  try {
    let symbols = [];

    if (src.id === "binance-futures") {
      const res = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
      const data = await res.json();
      symbols = (data.symbols || [])
        .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT")
        .map((s) => s.symbol);
    } else if (src.id === "binance-spot") {
      const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
      const data = await res.json();
      symbols = (data.symbols || [])
        .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT")
        .map((s) => s.symbol);
    } else if (src.id === "okx-perp") {
      const res = await fetch("https://www.okx.com/api/v5/public/instruments?instType=SWAP");
      const data = await res.json();
      symbols = (data.data || [])
        .filter((s) => s.state === "live" && s.instId.endsWith("-USDT-SWAP"))
        .map((s) => s.instId);
    } else if (src.id === "bybit") {
      const res = await fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000");
      const data = await res.json();
      symbols = (data.result?.list || [])
        .filter((s) => s.status === "Trading" && s.symbol.endsWith("USDT"))
        .map((s) => s.symbol);
    } else if (src.id === "oanda") {
      symbols = [...src.config.forexPairs];
    }

    if (symbols.length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(symbols));
      return symbols;
    }
  } catch (err) {
    console.warn(`Fetch symbols failed for ${src.id}:`, err);
  }

  // Fallback defaults
  if (src.id === "oanda") return [...src.config.forexPairs];
  if (src.id === "okx-perp") return ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"];
  return ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
}

// ==================== 2. FETCH KLINES (VỚI QUY TẮC CACHE >50 BARS) ====================

async function fetchSourceKlines(sourceKey, symbol, interval, limit = 50000, onProgress = null) {
  const src = getSourceInfo(sourceKey);

  // 1. Đọc dữ liệu từ Database Trình Duyệt (IndexedDB)
  const existingBars = (await getDBCachedBars(src.id, symbol, interval)) || [];

  if (existingBars.length > 0) {
    const lastBarTime = existingBars[existingBars.length - 1].time; // in seconds
    const now = Math.floor(Date.now() / 1000);
    const intervalSec = getIntervalSeconds(interval);
    const missingForwardBars = Math.max(0, Math.floor((now - lastBarTime) / intervalSec));

    // QUY TẮC: Nếu thiếu <= 50 bars thì DÙNG TRỰC TIẾP CACHE CÓ SẴN (Không cần gọi API nạp lại)
    if (missingForwardBars <= 50 && existingBars.length >= Math.min(limit, 500)) {
      console.log(`[DB CACHE] ${src.id}:${symbol} ${interval} chỉ thiếu ${missingForwardBars} bars (<= 50 bars). Dùng trực tiếp ${existingBars.length} nến từ IndexedDB!`);
      if (onProgress) onProgress(`Sử dụng dữ liệu cache DB (${existingBars.length.toLocaleString()} nến)...`);
      return existingBars.sort((a, b) => a.time - b.time).slice(-limit);
    }

    console.log(`[DB CACHE] ${src.id}:${symbol} ${interval} thiếu ${missingForwardBars} bars (> 50 bars). Cần cập nhật nến mới...`);
  }

  const unique = new Map();
  existingBars.forEach((b) => unique.set(b.time * 1000, b));

  if (src.id === "binance-futures" || src.id === "binance-spot") {
    const isFutures = src.id === "binance-futures";
    const baseUrl = isFutures ? "https://fapi.binance.com/fapi/v1/klines" : "https://api.binance.com/api/v3/klines";
    const batchSize = isFutures ? 1500 : 1000;

    // Fetch Newest
    let lastTime = existingBars.length > 0 ? existingBars[existingBars.length - 1].time * 1000 : 0;
    if (lastTime > 0) {
      if (onProgress) onProgress("Đang tải nến mới từ Binance...");
      try {
        const res = await fetch(`${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${batchSize}&startTime=${lastTime + 1}`);
        const data = await res.json();
        if (Array.isArray(data) && !data.code) {
          data.forEach((d) => {
            unique.set(d[0], {
              time: d[0] / 1000,
              open: parseFloat(d[1]),
              high: parseFloat(d[2]),
              low: parseFloat(d[3]),
              close: parseFloat(d[4]),
              volume: parseFloat(d[5]),
              buyVolume: parseFloat(d[9]) || 0,
            });
          });
        }
      } catch (e) { }
    }

    // Fetch History nếu chưa đủ nến yêu cầu
    if (unique.size < limit) {
      let firstTime = existingBars.length > 0 ? existingBars[0].time * 1000 : Date.now();
      let endTime = firstTime - 1;

      while (unique.size < limit) {
        const pct = Math.min(99, Math.round((unique.size / limit) * 100));
        if (onProgress) onProgress(`Binance: Đang nạp lịch sử ${unique.size.toLocaleString()} / ${limit.toLocaleString()} nến (${pct}%)...`, pct);
        try {
          const res = await fetch(`${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${batchSize}&endTime=${endTime}`);
          const data = await res.json();
          if (!Array.isArray(data) || data.length === 0 || data.code) break;
          data.forEach((d) => {
            unique.set(d[0], {
              time: d[0] / 1000,
              open: parseFloat(d[1]),
              high: parseFloat(d[2]),
              low: parseFloat(d[3]),
              close: parseFloat(d[4]),
              volume: parseFloat(d[5]),
              buyVolume: parseFloat(d[9]) || 0,
            });
          });
          endTime = data[0][0] - 1;
          if (data.length < batchSize) break;
        } catch (e) {
          break;
        }
      }
    }
  } else if (src.id === "okx-perp") {
    const okxBarMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };
    const bar = okxBarMap[interval] || "15m";
    const batchSize = 300;

    let after = "";
    while (unique.size < limit) {
      const pct = Math.min(99, Math.round((unique.size / limit) * 100));
      if (onProgress) onProgress(`OKX: Đang nạp ${unique.size.toLocaleString()} / ${limit.toLocaleString()} nến (${pct}%)...`, pct);
      try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${bar}&limit=${batchSize}${after ? `&after=${after}` : ""}`;
        const res = await fetch(url);
        const json = await res.json();
        const data = json.data;
        if (!Array.isArray(data) || data.length === 0) break;

        data.forEach((d) => {
          const ts = parseInt(d[0]);
          unique.set(ts, {
            time: ts / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            buyVolume: parseFloat(d[6]) || 0,
          });
        });

        after = data[data.length - 1][0];
        if (data.length < batchSize) break;
      } catch (e) {
        break;
      }
    }
  } else if (src.id === "bybit") {
    const bybitIvMap = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
    const bybitIv = bybitIvMap[interval] || "15";
    const batchSize = 1000;

    let endTime = Date.now();
    while (unique.size < limit) {
      const pct = Math.min(99, Math.round((unique.size / limit) * 100));
      if (onProgress) onProgress(`Bybit: Đang nạp ${unique.size.toLocaleString()} / ${limit.toLocaleString()} nến (${pct}%)...`, pct);
      try {
        const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitIv}&limit=${batchSize}&end=${endTime}`;
        const res = await fetch(url);
        const json = await res.json();
        const data = json.result?.list;
        if (!Array.isArray(data) || data.length === 0) break;

        data.forEach((d) => {
          const ts = parseInt(d[0]);
          unique.set(ts, {
            time: ts / 1000,
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            buyVolume: 0,
          });
        });

        const oldest = parseInt(data[data.length - 1][0]);
        if (oldest >= endTime) break;
        endTime = oldest - 1;
        if (data.length < batchSize) break;
      } catch (e) {
        break;
      }
    }
  } else if (src.id === "oanda") {
    const oandaGranMap = { "1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D" };
    const gran = oandaGranMap[interval] || "M15";
    const cfg = src.config;
    const batchSize = 5000;

    let toParam = "";

    while (unique.size < limit) {
      const pct = Math.min(99, Math.round((unique.size / limit) * 100));
      if (onProgress) onProgress(`OANDA: Đang nạp lịch sử ${unique.size.toLocaleString()} / ${limit.toLocaleString()} nến (${pct}%)...`, pct);

      try {
        let url = `${cfg.baseUrl}/instruments/${symbol}/candles?price=M&granularity=${gran}&count=${batchSize}`;
        if (toParam) {
          url += `&to=${encodeURIComponent(toParam)}`;
        }

        const res = await fetch(url, {
          headers: {
            "Authorization": `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
          },
        });
        const json = await res.json();
        const candles = json.candles || [];
        if (!Array.isArray(candles) || candles.length === 0) break;

        candles.forEach((c) => {
          const ts = Math.floor(new Date(c.time).getTime() / 1000);
          const mid = c.mid || c.bid || c.ask || {};
          if (mid.c) {
            unique.set(ts * 1000, {
              time: ts,
              open: parseFloat(mid.o),
              high: parseFloat(mid.h),
              low: parseFloat(mid.l),
              close: parseFloat(mid.c),
              volume: c.volume || 1,
              buyVolume: 0,
            });
          }
        });

        // Tìm mốc thời gian nến cổ nhất trong batch để lùi tiếp về quá khứ
        const oldestIso = candles[0].time;
        const oldestTs = new Date(oldestIso).getTime();
        const nextTo = new Date(oldestTs - 1000).toISOString();

        if (nextTo === toParam) break;
        toParam = nextTo;

        if (candles.length < 50) break; // Hết dữ liệu lịch sử trên máy chủ OANDA
      } catch (e) {
        console.warn("OANDA Candles fetch failed:", e);
        break;
      }
    }
  }

  let sorted = Array.from(unique.values()).sort((a, b) => a.time - b.time);
  if (sorted.length > limit) sorted = sorted.slice(sorted.length - limit);

  // Lưu bền vững vào IndexedDB
  await saveDBCachedBars(src.id, symbol, interval, sorted);

  return sorted;
}

// ==================== 3. REALTIME TICKER & KLINES STREAMS ====================

function closeAllSourceStreams() {
  if (activeDataSourceWS) {
    try { activeDataSourceWS.close(); } catch (e) { }
    activeDataSourceWS = null;
  }
  if (activeDataSourceTickerWS) {
    try { activeDataSourceTickerWS.close(); } catch (e) { }
    activeDataSourceTickerWS = null;
  }
  if (activeDataSourcePollingTimer) {
    clearInterval(activeDataSourcePollingTimer);
    activeDataSourcePollingTimer = null;
  }
}

function setupSourceTickerStream(sourceKey, symbol, onTick) {
  const src = getSourceInfo(sourceKey);

  if (src.id === "binance-futures") {
    const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@ticker`);
    activeDataSourceTickerWS = ws;
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.c) onTick({ price: parseFloat(d.c), changePct: parseFloat(d.P) });
    };
  } else if (src.id === "binance-spot") {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`);
    activeDataSourceTickerWS = ws;
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.c) onTick({ price: parseFloat(d.c), changePct: parseFloat(d.P) });
    };
  } else if (src.id === "okx-perp") {
    const ws = new WebSocket(`wss://ws.okx.com:8443/ws/v5/public`);
    activeDataSourceTickerWS = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "tickers", instId: symbol }] }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.data && msg.data[0]) {
        const t = msg.data[0];
        const lastP = parseFloat(t.last);
        const open24 = parseFloat(t.open24h) || lastP;
        const changePct = open24 > 0 ? ((lastP - open24) / open24) * 100 : 0;
        onTick({ price: lastP, changePct });
      }
    };
  } else if (src.id === "bybit") {
    const ws = new WebSocket(`wss://stream.bybit.com/v5/public/linear`);
    activeDataSourceTickerWS = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [`tickers.${symbol}`] }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.data && msg.data.lastPrice) {
        const p = parseFloat(msg.data.lastPrice);
        const cp = parseFloat(msg.data.price24hPcnt || 0) * 100;
        onTick({ price: p, changePct: cp });
      }
    };
  } else if (src.id === "oanda") {
    // OANDA Polling Pricing
    const cfg = src.config;
    const pollPrice = async () => {
      try {
        const res = await fetch(`${cfg.baseUrl}/accounts/${cfg.accountId}/pricing?instruments=${symbol}`, {
          headers: { "Authorization": `Bearer ${cfg.apiKey}` },
        });
        const json = await res.json();
        if (json.prices && json.prices[0]) {
          const p = json.prices[0];
          const bid = parseFloat(p.closeoutBid || p.bids?.[0]?.price || 0);
          const ask = parseFloat(p.closeoutAsk || p.asks?.[0]?.price || 0);
          const mid = (bid + ask) / 2;
          onTick({ price: mid, changePct: 0 });
        }
      } catch (e) { }
    };
    pollPrice();
    activeDataSourcePollingTimer = setInterval(pollPrice, 2000);
  }
}

function setupSourceKlineStream(sourceKey, symbol, interval, onBarUpdate) {
  const src = getSourceInfo(sourceKey);

  if (src.id === "binance-futures") {
    const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`);
    activeDataSourceWS = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const k = msg.k;
      if (!k) return;
      onBarUpdate({
        time: k.t / 1000,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        buyVolume: parseFloat(k.V) || 0,
      });
    };
  } else if (src.id === "binance-spot") {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
    activeDataSourceWS = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const k = msg.k;
      if (!k) return;
      onBarUpdate({
        time: k.t / 1000,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        buyVolume: parseFloat(k.V) || 0,
      });
    };
  } else if (src.id === "okx-perp") {
    const okxBarMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };
    const bar = okxBarMap[interval] || "15m";
    const ws = new WebSocket(`wss://ws.okx.com:8443/ws/v5/public`);
    activeDataSourceWS = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: `candle${bar}`, instId: symbol }] }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.data && msg.data[0]) {
        const d = msg.data[0];
        onBarUpdate({
          time: parseInt(d[0]) / 1000,
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
          buyVolume: parseFloat(d[6]) || 0,
        });
      }
    };
  } else if (src.id === "bybit") {
    const bybitIvMap = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
    const bybitIv = bybitIvMap[interval] || "15";
    const ws = new WebSocket(`wss://stream.bybit.com/v5/public/linear`);
    activeDataSourceWS = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [`kline.${bybitIv}.${symbol}`] }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.data && msg.data[0]) {
        const k = msg.data[0];
        onBarUpdate({
          time: parseInt(k.start) / 1000,
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume),
          buyVolume: 0,
        });
      }
    };
  }
}

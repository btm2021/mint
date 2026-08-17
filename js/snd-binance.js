// ============================================================
// snd-binance.js — BINANCE USD-M FUTURES (REST + WebSocket)
// REST : GET /fapi/v1/klines          → historical OHLCV
// WS   : <symbol>@kline_<interval>    → realtime
// Mọi price được parseFloat sang number trước khi vào detector.
// ============================================================

const SND_FAPI_BASE = "https://fapi.binance.com";
const SND_FSTREAM_WS = "wss://fstream.binance.com/ws";

function sndNormalizeKline(d) {
  return {
    time: d[0] / 1000,
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  };
}

// Load historical candles (1 request, tối đa 1500).
async function sndFetchKlines(symbol, interval, limit) {
  const url = `${SND_FAPI_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${Math.min(limit, 1500)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Binance klines error: ${JSON.stringify(data)}`);
  return data.map(sndNormalizeKline);
}

// Danh sách symbols cho search modal.
async function sndFetchSymbols() {
  const cached = localStorage.getItem("snd_symbols");
  if (cached) {
    try {
      const list = JSON.parse(cached);
      if (Array.isArray(list) && list.length > 0) return list;
    } catch (e) {
      localStorage.removeItem("snd_symbols");
    }
  }
  const res = await fetch(`${SND_FAPI_BASE}/fapi/v1/exchangeInfo`);
  const data = await res.json();
  const list = (data.symbols || [])
    .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT")
    .map((s) => s.symbol);
  localStorage.setItem("snd_symbols", JSON.stringify(list));
  return list;
}

// WebSocket kline stream. Callbacks nhận normalized bar.
// onBar       — mọi update (kể cả nến đang chạy)
// onBarClosed — chỉ khi k.x === true (nến đã đóng)
function sndConnectKlineWS(symbol, interval, onBar, onBarClosed) {
  if (window._sndKlineWS) {
    window._sndKlineWS.close();
    window._sndKlineWS = null;
  }
  const ws = new WebSocket(`${SND_FSTREAM_WS}/${symbol.toLowerCase()}@kline_${interval}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const k = msg.k;
    if (!k) return;
    const bar = sndNormalizeKline([k.t, k.o, k.h, k.l, k.c, k.v]);
    if (onBar) onBar(bar);
    if (k.x === true && onBarClosed) onBarClosed(bar);
  };
  ws.onerror = () => {
    console.warn("snd-binance: kline WS error");
  };
  window._sndKlineWS = ws;
  return ws;
}

function sndCloseKlineWS() {
  if (window._sndKlineWS) {
    window._sndKlineWS.close();
    window._sndKlineWS = null;
  }
}
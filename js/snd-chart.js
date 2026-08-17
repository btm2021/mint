// ============================================================
// snd-chart.js — TRADINGVIEW LIGHTWEIGHT CHARTS + ZONE OVERLAY
// Dùng canvas overlay (giống pattern chart.js hiện hữu của project)
// để vẽ zone RBR/DBD. Detector hoàn toàn tách khỏi rendering.
// ============================================================

let sndChart = null;
let sndCandleSeries = null;
let sndCanvas = null;
let sndCtx = null;
let sndZones = [];        // zones kèm extent ngang để render/hit-test
let sndCandles = [];
let sndClassified = [];
let sndShowDebug = false;
let sndHoverCallback = null;

const SND_ZONE_COLORS = {
  demand: "#00E676",
  supply: "#FF5252",
};

const SND_ZONE_OPACITY = {
  fresh: 0.22,
  tested: 0.12,
  invalidated: 0.06,
};

function sndInitChart(containerId, overlayCanvasId) {
  const container = document.getElementById(containerId);
  sndChart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: "solid", color: "#080810" },
      textColor: "#C3C6CE",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "rgba(42, 46, 57, 0.5)" },
      horzLines: { color: "rgba(42, 46, 57, 0.3)" },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#1e2438" },
    rightPriceScale: { borderColor: "#1e2438" },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  sndCandleSeries = sndChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: "#00E676",
    downColor: "#FF5252",
    borderVisible: false,
    wickUpColor: "#00E676",
    wickDownColor: "#FF5252",
  });

  sndCanvas = document.getElementById(overlayCanvasId);
  sndCtx = sndCanvas.getContext("2d");

  sndChart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(sndRedrawOverlay));
  sndChart.subscribeCrosshairMove((param) => {
    const zone = sndHitTestZone(param);
    if (sndHoverCallback) sndHoverCallback(zone, param);
    requestAnimationFrame(sndRedrawOverlay);
  });

  return sndChart;
}

function sndSetHoverCallback(cb) {
  sndHoverCallback = cb;
}

function sndSetCandles(bars) {
  sndCandles = bars;
  sndCandleSeries.setData(bars);
  sndApplyPriceFormat(bars);
  // Fit toàn bộ dữ liệu khi load — không chỉ hiện ~160 nến cuối
  sndChart.timeScale().fitContent();
  sndSyncCanvas();
}

function sndUpdateCandle(bar) {
  sndCandleSeries.update(bar);
}

function sndApplyPriceFormat(bars) {
  if (!bars.length) return;
  const price = bars[bars.length - 1].close;
  let precision = 4, minMove = 0.0001;
  if (price >= 10000) { precision = 1; minMove = 0.1; }
  else if (price >= 1000) { precision = 2; minMove = 0.01; }
  else if (price >= 100) { precision = 3; minMove = 0.001; }
  sndCandleSeries.applyOptions({ priceFormat: { type: "price", precision, minMove } });
}

// Gán zones để render; tính extent ngang (từ base → invalidated/current).
function sndSetZones(zones, candles) {
  const lastIndex = candles.length - 1;
  sndZones = zones.map((z) => ({
    ...z,
    _startIdx: z.base.startIndex,
    _endIdx: z.invalidatedIndex !== null && z.invalidatedIndex !== undefined ? z.invalidatedIndex : lastIndex,
  }));
}

function sndSetClassified(classified) {
  sndClassified = classified;
}

function sndSetDebug(enabled) {
  sndShowDebug = enabled;
}

function sndSyncCanvas() {
  if (!sndChart || !sndCanvas) return;
  const container = document.getElementById("snd-chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  sndChart.resize(width, height);
  const chartWidth = sndChart.timeScale().width();
  sndCanvas.width = chartWidth;
  sndCanvas.height = height;
  sndCanvas.style.width = chartWidth + "px";
  sndCanvas.style.height = height + "px";
  sndRedrawOverlay();
}

function sndRedrawOverlay() {
  if (!sndChart || !sndCandleSeries || !sndCtx) return;
  const ctx = sndCtx;
  const timeScale = sndChart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  ctx.clearRect(0, 0, sndCanvas.width, sndCanvas.height);
  if (!range) return;

  // Debug: đánh dấu classification của từng nến
  if (sndShowDebug && sndClassified.length) {
    const clsColor = { leg: "#FFC107", base: "#2196F3", neutral: "rgba(255,255,255,0.25)" };
    for (let i = Math.max(0, Math.floor(range.from)); i <= Math.min(sndClassified.length - 1, Math.ceil(range.to)); i++) {
      const c = sndClassified[i];
      const x = timeScale.logicalToCoordinate(i);
      if (x === null) continue;
      const y = sndCandleSeries.priceToCoordinate(c.low);
      if (y === null) continue;
      ctx.fillStyle = clsColor[c.classification] || clsColor.neutral;
      const size = c.classification === "leg" ? 3.5 : c.classification === "base" ? 3 : 2;
      ctx.beginPath();
      ctx.arc(x, y + 8, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Zones
  for (const z of sndZones) {
    if (z._endIdx < range.from || z._startIdx > range.to) continue;

    let x1 = timeScale.logicalToCoordinate(z._startIdx);
    let x2 = timeScale.logicalToCoordinate(z._endIdx);
    if (x1 === null) x1 = -1000;
    if (x2 === null) x2 = sndCanvas.width + 1000;

    const yProx = sndCandleSeries.priceToCoordinate(z.proximal);
    const yDist = sndCandleSeries.priceToCoordinate(z.distal);
    if (yProx === null || yDist === null) continue;

    const top = Math.min(yProx, yDist);
    const bottom = Math.max(yProx, yDist);
    const color = SND_ZONE_COLORS[z.type] || "#888";
    const opacity = SND_ZONE_OPACITY[z.status] ?? 0.1;

    ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.05)" : hexToRgba(color, opacity);
    ctx.fillRect(x1, top, x2 - x1, bottom - top);

    // Viền proximal/distal
    ctx.strokeStyle = z.status === "invalidated" ? "rgba(128,128,128,0.4)" : hexToRgba(color, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, yProx); ctx.lineTo(x2, yProx);
    ctx.moveTo(x1, yDist); ctx.lineTo(x2, yDist);
    ctx.stroke();

    // Label: "RBR 87"
    const label = `${z.formation} ${z.score}`;
    const labelY = yProx - 16 < 0 ? yProx + 2 : yProx - 16;
    ctx.font = "600 11px Outfit, sans-serif";
    const textW = ctx.measureText(label).width + 8;
    const labelX = Math.max(2, x1 + 2);
    ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.7)" : hexToRgba(color, 0.85);
    ctx.fillRect(labelX, labelY, textW, 14);
    ctx.fillStyle = "#0B0B0E";
    ctx.fillText(label, labelX + 4, labelY + 11);
  }
}

// Hit-test zone dưới con trỏ từ crosshair param.
function sndHitTestZone(param) {
  if (!param || param.logical === undefined || param.point === undefined) return null;
  const logical = param.logical;
  const price = param.seriesData && param.seriesData.get && param.seriesData.get(sndCandleSeries);
  const priceVal = price && price.close !== undefined ? price.close : param.point ? sndCandleSeries.coordinateToPrice(param.point.y) : null;
  if (priceVal === null || priceVal === undefined) return null;

  const idx = Math.floor(logical);
  for (const z of sndZones) {
    if (idx < z._startIdx || idx > z._endIdx) continue;
    const lo = Math.min(z.proximal, z.distal);
    const hi = Math.max(z.proximal, z.distal);
    if (priceVal >= lo && priceVal <= hi) return z;
  }
  return null;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function sndInitResizeObserver() {
  const wrapper = document.getElementById("snd-chart-wrapper");
  if (!wrapper) return;
  new ResizeObserver(() => sndSyncCanvas()).observe(wrapper);
}
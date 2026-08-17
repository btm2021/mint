// ============================================================
// stat6-chart.js — BIỂU ĐỒ NHẸ: S&D ZONES + 2 VSR + 2 ATRBOT
// Overlay canvas vẽ: zones (RBR/DBD + label) → VSR 1/2 + overlap
// → ATRBot clouds + trails. Không analysis pipeline, không debug.
// ============================================================

let stat6Chart = null;
let stat6CandleSeries = null;
let stat6Canvas = null;
let stat6Ctx = null;

let globalStat6Bars = [];
let globalStat6Bot1 = null;
let globalStat6Bot2 = null;
let globalStat6Vsr1 = null;
let globalStat6Vsr2 = null;
let globalStat6VsrOverlap = null;
let stat6Zones = [];
let stat6HoverCallback = null;

function stat6HexToRgba(hex, alpha = 1.0) {
  if (!hex) return `rgba(255, 255, 255, ${alpha})`;
  const clean = String(hex).replace("#", "");
  let r = 255, g = 255, b = 255;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    ? `rgba(${r}, ${g}, ${b}, ${alpha})`
    : `rgba(255, 255, 255, ${alpha})`;
}

function stat6GetDashArray(style) {
  switch (style) {
    case "dashed": return [6, 4];
    case "dotted": return [2, 3];
    default: return [];
  }
}

function stat6PriceFormat(price) {
  if (!price || price >= 500) return { type: "price", precision: 2, minMove: 0.01 };
  if (price >= 1) return { type: "price", precision: 4, minMove: 0.0001 };
  if (price >= 0.01) return { type: "price", precision: 6, minMove: 0.000001 };
  return { type: "price", precision: 8, minMove: 0.00000001 };
}

function initStat6Chart() {
  const container = document.getElementById("stat6-chart-container");
  stat6Canvas = document.getElementById("stat6-overlay-canvas");
  stat6Ctx = stat6Canvas.getContext("2d");

  const cfg = STAT6_CFG.chart;
  stat6Chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: "solid", color: cfg.bgColor || "#080810" },
      textColor: "#C3C6CE",
      fontFamily: "'Outfit', -apple-system, sans-serif",
    },
    grid: {
      vertLines: { color: cfg.showGrid ? cfg.gridColor : "rgba(0,0,0,0)" },
      horzLines: { color: cfg.showGrid ? cfg.gridColor : "rgba(0,0,0,0)" },
    },
    crosshair: { mode: 0 },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#1e2435", minBarSpacing: 0.05 },
    rightPriceScale: { borderColor: "#1e2435", scaleMargins: { top: 0.08, bottom: 0.08 } },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  stat6CandleSeries = stat6Chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: cfg.upColor || "#00E676",
    downColor: cfg.downColor || "#FF5252",
    borderVisible: false,
    wickUpColor: cfg.upColor || "#00E676",
    wickDownColor: cfg.downColor || "#FF5252",
  });

  stat6Chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    requestAnimationFrame(drawStat6Overlay);
  });

  stat6Chart.subscribeCrosshairMove((param) => {
    const zone = stat6HitTestZone(param);
    if (stat6HoverCallback) stat6HoverCallback(zone, param);
    requestAnimationFrame(drawStat6Overlay);
  });

  const observer = new ResizeObserver(() => syncStat6CanvasSize());
  observer.observe(document.getElementById("stat6-chart-wrapper"));
}

function syncStat6CanvasSize() {
  if (!stat6Chart || !stat6CandleSeries || !stat6Canvas) return;
  const container = document.getElementById("stat6-chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  stat6Chart.resize(width, height);
  const chartWidth = stat6Chart.timeScale().width();
  stat6Canvas.width = chartWidth;
  stat6Canvas.height = height;
  stat6Canvas.style.width = chartWidth + "px";
  stat6Canvas.style.height = height + "px";
  drawStat6Overlay();
}

function stat6SetBars(bars) {
  globalStat6Bars = bars;
  stat6CandleSeries.setData(bars);
  stat6CandleSeries.applyOptions({ priceFormat: stat6PriceFormat(bars[bars.length - 1]?.close) });
  // Fit toàn bộ dữ liệu khi load — hiển thị đủ số nến đã tải
  stat6Chart.timeScale().fitContent();
  syncStat6CanvasSize();
}

function stat6UpdateCandle(bar) {
  stat6CandleSeries.update(bar);
}

function stat6SetZones(zones, candles) {
  const lastIndex = candles.length - 1;
  stat6Zones = zones.map((z) => ({
    ...z,
    _startIdx: z.base.startIndex,
    _endIdx: z.invalidatedIndex !== null && z.invalidatedIndex !== undefined ? z.invalidatedIndex : lastIndex,
  }));
}

function stat6SetHoverCallback(cb) {
  stat6HoverCallback = cb;
}

// ==================== OVERLAY ====================

function drawStat6Overlay() {
  if (!stat6Chart || !stat6CandleSeries || !stat6Ctx || !globalStat6Bars.length) return;
  const timeScale = stat6Chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  if (!range) return;

  const ctx = stat6Ctx;
  ctx.clearRect(0, 0, stat6Canvas.width, stat6Canvas.height);

  // ── 1. S&D ZONES ──
  if (STAT6_CFG.snd.enabled) {
    for (const z of stat6Zones) {
      if (z._endIdx < range.from || z._startIdx > range.to) continue;
      let x1 = timeScale.logicalToCoordinate(z._startIdx);
      let x2 = timeScale.logicalToCoordinate(z._endIdx);
      if (x1 === null) x1 = -1000;
      if (x2 === null) x2 = stat6Canvas.width + 1000;

      const yProx = stat6CandleSeries.priceToCoordinate(z.proximal);
      const yDist = stat6CandleSeries.priceToCoordinate(z.distal);
      if (yProx === null || yDist === null) continue;

      const top = Math.min(yProx, yDist);
      const bottom = Math.max(yProx, yDist);
      const color = z.type === "demand" ? "#00E676" : "#FF5252";
      const opacity = z.status === "fresh" ? 0.18 : z.status === "tested" ? 0.10 : 0.05;

      ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.05)" : stat6HexToRgba(color, opacity);
      ctx.fillRect(x1, top, x2 - x1, bottom - top);

      ctx.strokeStyle = z.status === "invalidated" ? "rgba(128,128,128,0.4)" : stat6HexToRgba(color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, yProx); ctx.lineTo(x2, yProx);
      ctx.moveTo(x1, yDist); ctx.lineTo(x2, yDist);
      ctx.stroke();

      const label = `${z.formation} ${z.score}`;
      const labelY = yProx - 16 < 0 ? yProx + 2 : yProx - 16;
      ctx.font = "600 10px 'Outfit', sans-serif";
      const textW = ctx.measureText(label).width + 8;
      const labelX = Math.max(2, x1 + 2);
      ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.7)" : stat6HexToRgba(color, 0.85);
      ctx.fillRect(labelX, labelY, textW, 13);
      ctx.fillStyle = "#0B0B0E";
      ctx.fillText(label, labelX + 4, labelY + 10);
    }
  }

  // ── 2. VSR 1 & VSR 2 ──
  const drawVsr = (res, vsrCfg) => {
    if (!res || !res.zones || !vsrCfg.enabled) return;
    for (const z of res.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = stat6Canvas.width + 1000;
      const yU = stat6CandleSeries.priceToCoordinate(z.upper);
      const yL = stat6CandleSeries.priceToCoordinate(z.lower);
      if (yU === null || yL === null) continue;
      const topY = Math.min(yU, yL), botY = Math.max(yU, yL);
      const w = xE - xS;

      if (vsrCfg.showFill) {
        ctx.fillStyle = stat6HexToRgba(vsrCfg.fillColor, vsrCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, botY - topY);
      }
      if (vsrCfg.showUpper) {
        ctx.strokeStyle = vsrCfg.upperColor;
        ctx.lineWidth = vsrCfg.upperWidth;
        ctx.setLineDash(stat6GetDashArray(vsrCfg.upperStyle));
        ctx.beginPath(); ctx.moveTo(xS, topY); ctx.lineTo(xE, topY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (vsrCfg.showLower) {
        ctx.strokeStyle = vsrCfg.lowerColor;
        ctx.lineWidth = vsrCfg.lowerWidth;
        ctx.setLineDash(stat6GetDashArray(vsrCfg.lowerStyle));
        ctx.beginPath(); ctx.moveTo(xS, botY); ctx.lineTo(xE, botY); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  if (globalStat6Vsr1) drawVsr(globalStat6Vsr1, STAT6_CFG.vsr1);
  if (globalStat6Vsr2) drawVsr(globalStat6Vsr2, STAT6_CFG.vsr2);

  // ── 3. VSR OVERLAP ──
  if (globalStat6VsrOverlap && STAT6_CFG.vsrOverlap.enabled) {
    const ovCfg = STAT6_CFG.vsrOverlap;
    for (const z of globalStat6VsrOverlap.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = stat6Canvas.width + 1000;
      const yU = stat6CandleSeries.priceToCoordinate(z.upper);
      const yL = stat6CandleSeries.priceToCoordinate(z.lower);
      if (yU === null || yL === null) continue;
      const topY = Math.min(yU, yL), botY = Math.max(yU, yL);
      const h = Math.max(2, botY - topY), w = Math.max(4, xE - xS);

      if (ovCfg.showFill) {
        ctx.fillStyle = stat6HexToRgba(ovCfg.fillColor, ovCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, h);
        if (ovCfg.showHatch) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xS, topY, w, h);
          ctx.clip();
          ctx.strokeStyle = stat6HexToRgba(ovCfg.fillColor, 0.65);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const step = 12;
          for (let hx = xS - h - 50; hx < xE + h + 50; hx += step) {
            ctx.moveTo(hx, botY);
            ctx.lineTo(hx + h + 50, topY - 50);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
      if (ovCfg.showUpper) {
        ctx.strokeStyle = ovCfg.upperColor;
        ctx.lineWidth = ovCfg.upperWidth;
        ctx.setLineDash(stat6GetDashArray(ovCfg.upperStyle));
        ctx.beginPath(); ctx.moveTo(xS, topY); ctx.lineTo(xE, topY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ovCfg.showLower) {
        ctx.strokeStyle = ovCfg.lowerColor;
        ctx.lineWidth = ovCfg.lowerWidth;
        ctx.setLineDash(stat6GetDashArray(ovCfg.lowerStyle));
        ctx.beginPath(); ctx.moveTo(xS, botY); ctx.lineTo(xE, botY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ovCfg.showLabel) {
        const lx = Math.min(stat6Canvas.width - 70, Math.max(xS + 8, xE - 70));
        const ly = topY + h / 2;
        ctx.fillStyle = "rgba(16, 4, 26, 0.9)";
        ctx.fillRect(lx, ly - 8, 65, 16);
        ctx.strokeStyle = ovCfg.upperColor;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(lx, ly - 8, 65, 16);
        ctx.fillStyle = ovCfg.upperColor;
        ctx.font = "bold 9px 'Outfit', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⚡ OVERLAP", lx + 32.5, ly);
      }
    }
  }

  // ── 4. ATRBOTS ──
  const drawLineSeg = (arr, color, width, style) => {
    if (!arr || !arr.length) return;
    const first = Math.max(0, Math.floor(range.from) - 1);
    const last = Math.min(arr.length - 1, Math.ceil(range.to) + 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(stat6GetDashArray(style));
    let drawing = false;
    for (let i = first; i <= last; i++) {
      const val = arr[i];
      if (!Number.isFinite(val)) { drawing = false; continue; }
      const x = timeScale.logicalToCoordinate(i);
      const y = stat6CandleSeries.priceToCoordinate(val);
      if (x === null || y === null) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const drawCloud = (bot, upColor, upOpacity, downColor, downOpacity) => {
    if (!bot || !bot.cycles || !bot.t1Arr || !bot.t2Arr) return;
    for (const cyc of bot.cycles) {
      if (cyc.endIndex < range.from || cyc.startIndex > range.to) continue;
      ctx.beginPath();
      let moved = false;
      const endLimit = Math.min(cyc.endIndex, bot.t1Arr.length - 1);
      for (let i = cyc.startIndex; i <= endLimit; i++) {
        if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
        const x = timeScale.logicalToCoordinate(i);
        const y = stat6CandleSeries.priceToCoordinate(bot.t1Arr[i]);
        if (x !== null && y !== null) {
          if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
        }
      }
      if (moved) {
        for (let i = endLimit; i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i);
          const y = stat6CandleSeries.priceToCoordinate(bot.t2Arr[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = cyc.state === 1 ? stat6HexToRgba(upColor, upOpacity) : stat6HexToRgba(downColor, downOpacity);
        ctx.fill();
      }
    }
  };

  if (globalStat6Bot1 && STAT6_CFG.atr1.enabled) {
    const c = STAT6_CFG.atr1;
    if (c.showCloud) drawCloud(globalStat6Bot1, c.cloudUpColor, c.cloudUpOpacity, c.cloudDownColor, c.cloudDownOpacity);
    if (c.showT1) drawLineSeg(globalStat6Bot1.t1Arr, c.t1Color, c.t1Width, c.t1Style);
    if (c.showT2) drawLineSeg(globalStat6Bot1.t2Arr, c.t2Color, c.t2Width, c.t2Style);
  }
  if (globalStat6Bot2 && STAT6_CFG.atr2.enabled) {
    const c = STAT6_CFG.atr2;
    if (c.showCloud) drawCloud(globalStat6Bot2, c.cloudUpColor, c.cloudUpOpacity, c.cloudDownColor, c.cloudDownOpacity);
    if (c.showT1) drawLineSeg(globalStat6Bot2.t1Arr, c.t1Color, c.t1Width, c.t1Style);
    if (c.showT2) drawLineSeg(globalStat6Bot2.t2Arr, c.t2Color, c.t2Width, c.t2Style);
  }
}

// Hit-test zone dưới crosshair.
function stat6HitTestZone(param) {
  if (!param || param.logical === undefined || param.point === undefined) return null;
  const logical = param.logical;
  const price = param.seriesData && param.seriesData.get ? param.seriesData.get(stat6CandleSeries) : null;
  const priceVal = price && price.close !== undefined ? price.close : stat6CandleSeries.coordinateToPrice(param.point.y);
  if (priceVal === null || priceVal === undefined) return null;

  const idx = Math.floor(logical);
  for (const z of stat6Zones) {
    if (idx < z._startIdx || idx > z._endIdx) continue;
    const lo = Math.min(z.proximal, z.distal);
    const hi = Math.max(z.proximal, z.distal);
    if (priceVal >= lo && priceVal <= hi) return z;
  }
  return null;
}
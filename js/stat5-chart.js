// ============================================================
// stat5-chart.js — BIỂU ĐỒ & RENDER OVERLAY TỔNG HỢP
// Canvas overlay vẽ (từ dưới lên):
//   1. Supply & Demand zones (RBR/DBD + label + status opacity)
//   2. VSR 1 / VSR 2 / VSR Overlap
//   3. ATRBot 1 & 2 (mây cloud + trail lines)
//   4. Debug markers (classification LEG/BASE/NEUTRAL)
// Detector hoàn toàn tách khỏi rendering (chỉ nhận zones + classified).
// ============================================================

let stat5Chart = null;
let stat5CandleSeries = null;
let stat5Canvas = null;
let stat5Ctx = null;

let globalStat5Bars = [];
let globalStat5Bot1 = null;
let globalStat5Bot2 = null;
let globalStat5Vsr1 = null;
let globalStat5Vsr2 = null;
let globalStat5VsrOverlap = null;
let stat5Zones = [];
let stat5Classified = [];
let stat5ShowDebug = false;
let stat5HoverCallback = null;
let stat5LastCrosshairLogical = null;

function stat5HexToRgba(hex, alpha = 1.0) {
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

function stat5GetDashArray(style) {
  switch (style) {
    case "dashed": return [6, 4];
    case "dotted": return [2, 3];
    default: return [];
  }
}

function stat5PriceFormat(price) {
  if (!price || price >= 500) return { type: "price", precision: 2, minMove: 0.01 };
  if (price >= 1) return { type: "price", precision: 4, minMove: 0.0001 };
  if (price >= 0.01) return { type: "price", precision: 6, minMove: 0.000001 };
  return { type: "price", precision: 8, minMove: 0.00000001 };
}

function initStat5Chart() {
  const container = document.getElementById("stat5-chart-container");
  stat5Canvas = document.getElementById("stat5-overlay-canvas");
  stat5Ctx = stat5Canvas.getContext("2d");

  const cfg = STAT5_CFG.chart;

  stat5Chart = LightweightCharts.createChart(container, {
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

  stat5CandleSeries = stat5Chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: cfg.upColor || "#00E676",
    downColor: cfg.downColor || "#FF5252",
    borderVisible: false,
    wickUpColor: cfg.upColor || "#00E676",
    wickDownColor: cfg.downColor || "#FF5252",
  });

  stat5Chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    requestAnimationFrame(drawStat5Overlay);
  });

  stat5Chart.subscribeCrosshairMove((param) => {
    if (param && param.logical !== undefined) stat5LastCrosshairLogical = param.logical;
    const zone = stat5HitTestZone(param);
    if (stat5HoverCallback) stat5HoverCallback(zone, param);
    requestAnimationFrame(drawStat5Overlay);
  });

  const observer = new ResizeObserver(() => syncStat5CanvasSize());
  observer.observe(document.getElementById("stat5-chart-wrapper"));
}

function syncStat5CanvasSize() {
  if (!stat5Chart || !stat5CandleSeries || !stat5Canvas) return;
  const container = document.getElementById("stat5-chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  stat5Chart.resize(width, height);
  const chartWidth = stat5Chart.timeScale().width();
  stat5Canvas.width = chartWidth;
  stat5Canvas.height = height;
  stat5Canvas.style.width = chartWidth + "px";
  stat5Canvas.style.height = height + "px";
  drawStat5Overlay();
}

function stat5SetBars(bars) {
  globalStat5Bars = bars;
  stat5CandleSeries.setData(bars);
  stat5CandleSeries.applyOptions({ priceFormat: stat5PriceFormat(bars[bars.length - 1]?.close) });
  // Fit toàn bộ dữ liệu khi load — mặc định scrollToRealTime chỉ hiện ~160 nến cuối
  stat5Chart.timeScale().fitContent();
  syncStat5CanvasSize();
}

function stat5UpdateCandle(bar) {
  stat5CandleSeries.update(bar);
}

function stat5SetZones(zones, candles) {
  const lastIndex = candles.length - 1;
  stat5Zones = zones.map((z) => ({
    ...z,
    _startIdx: z.base.startIndex,
    _endIdx: z.invalidatedIndex !== null && z.invalidatedIndex !== undefined ? z.invalidatedIndex : lastIndex,
  }));
}

function stat5SetClassified(classified) {
  stat5Classified = classified;
}

function stat5SetDebug(enabled) {
  stat5ShowDebug = enabled;
}

function stat5SetHoverCallback(cb) {
  stat5HoverCallback = cb;
}

// ==================== OVERLAY ====================

function drawStat5Overlay() {
  if (!stat5Chart || !stat5CandleSeries || !stat5Ctx || !globalStat5Bars.length) return;
  const timeScale = stat5Chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  if (!range) return;

  const ctx = stat5Ctx;
  ctx.clearRect(0, 0, stat5Canvas.width, stat5Canvas.height);

  // ── 1. S&D ZONES ──
  if (STAT5_CFG.snd.enabled) {
    for (const z of stat5Zones) {
      if (z._endIdx < range.from || z._startIdx > range.to) continue;
      let x1 = timeScale.logicalToCoordinate(z._startIdx);
      let x2 = timeScale.logicalToCoordinate(z._endIdx);
      if (x1 === null) x1 = -1000;
      if (x2 === null) x2 = stat5Canvas.width + 1000;

      const yProx = stat5CandleSeries.priceToCoordinate(z.proximal);
      const yDist = stat5CandleSeries.priceToCoordinate(z.distal);
      if (yProx === null || yDist === null) continue;

      const top = Math.min(yProx, yDist);
      const bottom = Math.max(yProx, yDist);
      const color = z.type === "demand" ? "#00E676" : "#FF5252";
      const opacity = z.status === "fresh" ? 0.18 : z.status === "tested" ? 0.10 : 0.05;

      ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.05)" : stat5HexToRgba(color, opacity);
      ctx.fillRect(x1, top, x2 - x1, bottom - top);

      ctx.strokeStyle = z.status === "invalidated" ? "rgba(128,128,128,0.4)" : stat5HexToRgba(color, 0.5);
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
      ctx.fillStyle = z.status === "invalidated" ? "rgba(128,128,128,0.7)" : stat5HexToRgba(color, 0.85);
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
      if (xE === null) xE = stat5Canvas.width + 1000;
      const yU = stat5CandleSeries.priceToCoordinate(z.upper);
      const yL = stat5CandleSeries.priceToCoordinate(z.lower);
      if (yU === null || yL === null) continue;
      const topY = Math.min(yU, yL), botY = Math.max(yU, yL);
      const w = xE - xS;

      if (vsrCfg.showFill) {
        ctx.fillStyle = stat5HexToRgba(vsrCfg.fillColor, vsrCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, botY - topY);
      }
      if (vsrCfg.showUpper) {
        ctx.strokeStyle = vsrCfg.upperColor;
        ctx.lineWidth = vsrCfg.upperWidth;
        ctx.setLineDash(stat5GetDashArray(vsrCfg.upperStyle));
        ctx.beginPath(); ctx.moveTo(xS, topY); ctx.lineTo(xE, topY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (vsrCfg.showLower) {
        ctx.strokeStyle = vsrCfg.lowerColor;
        ctx.lineWidth = vsrCfg.lowerWidth;
        ctx.setLineDash(stat5GetDashArray(vsrCfg.lowerStyle));
        ctx.beginPath(); ctx.moveTo(xS, botY); ctx.lineTo(xE, botY); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  if (globalStat5Vsr1) drawVsr(globalStat5Vsr1, STAT5_CFG.vsr1);
  if (globalStat5Vsr2) drawVsr(globalStat5Vsr2, STAT5_CFG.vsr2);

  // ── 3. VSR OVERLAP ──
  if (globalStat5VsrOverlap && STAT5_CFG.vsrOverlap.enabled) {
    const ovCfg = STAT5_CFG.vsrOverlap;
    for (const z of globalStat5VsrOverlap.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = stat5Canvas.width + 1000;
      const yU = stat5CandleSeries.priceToCoordinate(z.upper);
      const yL = stat5CandleSeries.priceToCoordinate(z.lower);
      if (yU === null || yL === null) continue;
      const topY = Math.min(yU, yL), botY = Math.max(yU, yL);
      const h = Math.max(2, botY - topY), w = Math.max(4, xE - xS);

      if (ovCfg.showFill) {
        ctx.fillStyle = stat5HexToRgba(ovCfg.fillColor, ovCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, h);
        if (ovCfg.showHatch) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xS, topY, w, h);
          ctx.clip();
          ctx.strokeStyle = stat5HexToRgba(ovCfg.fillColor, 0.65);
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
        ctx.setLineDash(stat5GetDashArray(ovCfg.upperStyle));
        ctx.beginPath(); ctx.moveTo(xS, topY); ctx.lineTo(xE, topY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ovCfg.showLower) {
        ctx.strokeStyle = ovCfg.lowerColor;
        ctx.lineWidth = ovCfg.lowerWidth;
        ctx.setLineDash(stat5GetDashArray(ovCfg.lowerStyle));
        ctx.beginPath(); ctx.moveTo(xS, botY); ctx.lineTo(xE, botY); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ovCfg.showLabel) {
        const lx = Math.min(stat5Canvas.width - 70, Math.max(xS + 8, xE - 70));
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

  // ── 4. ATRBOTS (cloud + lines) ──
  const drawLineSeg = (arr, color, width, style) => {
    if (!arr || !arr.length) return;
    const first = Math.max(0, Math.floor(range.from) - 1);
    const last = Math.min(arr.length - 1, Math.ceil(range.to) + 1);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(stat5GetDashArray(style));
    let drawing = false;
    for (let i = first; i <= last; i++) {
      const val = arr[i];
      if (!Number.isFinite(val)) { drawing = false; continue; }
      const x = timeScale.logicalToCoordinate(i);
      const y = stat5CandleSeries.priceToCoordinate(val);
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
        const y = stat5CandleSeries.priceToCoordinate(bot.t1Arr[i]);
        if (x !== null && y !== null) {
          if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
        }
      }
      if (moved) {
        for (let i = endLimit; i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i);
          const y = stat5CandleSeries.priceToCoordinate(bot.t2Arr[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = cyc.state === 1 ? stat5HexToRgba(upColor, upOpacity) : stat5HexToRgba(downColor, downOpacity);
        ctx.fill();
      }
    }
  };

if (globalStat5Bot1 && STAT5_CFG.atr1.enabled) {
    const c = STAT5_CFG.atr1;
    if (c.showCloud) drawCloud(globalStat5Bot1, c.cloudUpColor, c.cloudUpOpacity, c.cloudDownColor, c.cloudDownOpacity);
    if (c.showT1) drawLineSeg(globalStat5Bot1.t1Arr, c.t1Color, c.t1Width, c.t1Style);
    if (c.showT2) drawLineSeg(globalStat5Bot1.t2Arr, c.t2Color, c.t2Width, c.t2Style);
  }
  if (globalStat5Bot2 && STAT5_CFG.atr2.enabled) {
    const c = STAT5_CFG.atr2;
    if (c.showCloud) drawCloud(globalStat5Bot2, c.cloudUpColor, c.cloudUpOpacity, c.cloudDownColor, c.cloudDownOpacity);
    if (c.showT1) drawLineSeg(globalStat5Bot2.t1Arr, c.t1Color, c.t1Width, c.t1Style);
    if (c.showT2) drawLineSeg(globalStat5Bot2.t2Arr, c.t2Color, c.t2Width, c.t2Style);
  }

  // ── 5. DEBUG CLASSIFICATION MARKERS ──
  if (stat5ShowDebug && stat5Classified.length) {
    const clsColor = { leg: "#FFC107", base: "#2196F3", neutral: "rgba(255,255,255,0.25)" };
    for (let i = Math.max(0, Math.floor(range.from)); i <= Math.min(stat5Classified.length - 1, Math.ceil(range.to)); i++) {
      const c = stat5Classified[i];
      const x = timeScale.logicalToCoordinate(i);
      if (x === null) continue;
      const y = stat5CandleSeries.priceToCoordinate(c.low);
      if (y === null) continue;
      ctx.fillStyle = clsColor[c.classification] || clsColor.neutral;
      const size = c.classification === "leg" ? 3.5 : c.classification === "base" ? 3 : 2;
      ctx.beginPath();
      ctx.arc(x, y + 8, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 6. FOREXFLOW EXTENDED ANALYSIS OVERLAYS ──
  if (STAT5_CFG.analysis.enabled) stat5DrawAnalysis(ctx, timeScale, range);
}

// Vẽ các overlay phân tích mở rộng (trend / divergence / fibonacci / key levels).
function stat5DrawAnalysis(ctx, timeScale, range) {
  const cfg = STAT5_CFG.analysis;

  // ── Key levels (round numbers gần giá hiện tại) ──
  if (cfg.keyLevels && stat5KeyLevels && stat5KeyLevels.length) {
    ctx.font = "500 10px 'Outfit', sans-serif";
    for (const kl of stat5KeyLevels) {
      const y = stat5CandleSeries.priceToCoordinate(kl.price);
      if (y === null) continue;
      ctx.strokeStyle = "rgba(255,193,7,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(stat5Canvas.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,193,7,0.8)";
      const label = `● ${kl.price.toFixed(4)}`;
      ctx.fillText(label, stat5Canvas.width - ctx.measureText(label).width - 8, y - 5);
    }
  }

  // ── Fibonacci retracement + OTE zone ──
  if (cfg.fibonacci && stat5Fib) {
    const fib = stat5Fib;
    const xStart = -1000;
    const xEnd = stat5Canvas.width + 1000;

    // OTE zone (61.8% – 78.6%)
    const yOteH = stat5CandleSeries.priceToCoordinate(fib.oteZone.high);
    const yOteL = stat5CandleSeries.priceToCoordinate(fib.oteZone.low);
    if (yOteH !== null && yOteL !== null) {
      const top = Math.min(yOteH, yOteL), bot = Math.max(yOteH, yOteL);
      ctx.fillStyle = "rgba(171,71,188,0.08)";
      ctx.fillRect(xStart, top, xEnd - xStart, bot - top);
    }

    ctx.font = "500 9.5px 'Outfit', sans-serif";
    for (const lv of fib.levels) {
      const y = stat5CandleSeries.priceToCoordinate(lv.price);
      if (y === null) continue;
      const isOte = lv.ratio === 0.618 || lv.ratio === 0.786;
      ctx.strokeStyle = isOte ? "rgba(171,71,188,0.5)" : "rgba(255,255,255,0.22)";
      ctx.lineWidth = isOte ? 1.5 : 1;
      ctx.setLineDash(isOte ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isOte ? "#AB47BC" : "rgba(255,255,255,0.45)";
      const label = `fib ${lv.label}`;
      ctx.fillText(label, 8, y - 4);
    }
  }

  // ── Divergence markers (RSI/MACD) ──
  if (cfg.divergence && stat5Divergences && stat5Divergences.length) {
    ctx.font = "500 9px 'Outfit', sans-serif";
    for (const d of stat5Divergences) {
      const x1 = timeScale.logicalToCoordinate(d.priceSwing1.index);
      const x2 = timeScale.logicalToCoordinate(d.priceSwing2.index);
      const y1 = stat5CandleSeries.priceToCoordinate(d.priceSwing1.price);
      const y2 = stat5CandleSeries.priceToCoordinate(d.priceSwing2.price);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      const bullish = d.type.includes("bullish");
      const color = bullish ? "#00E676" : "#FF5252";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label tại swing mới
      const lx = Math.max(2, x2 + 4);
      const ly = y2 - 8;
      ctx.fillStyle = "rgba(10,10,20,0.85)";
      const label = `${d.indicator} ${d.type.replace("_", " ")} ${d.strength}`;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillRect(lx, ly - 8, tw, 14);
      ctx.fillStyle = color;
      ctx.fillText(label, lx + 4, ly + 3);
    }
  }

  // ── Trend: segments + swing points + controlling swing ──
  if (cfg.trend && stat5Trend) {
    const trend = stat5Trend;

    // Segments (nối các swing)
    if (trend.segments) {
      for (const seg of trend.segments) {
        const x1 = timeScale.logicalToCoordinate(seg.from.candleIndex);
        const x2 = timeScale.logicalToCoordinate(seg.to.candleIndex);
        const y1 = stat5CandleSeries.priceToCoordinate(seg.from.price);
        const y2 = stat5CandleSeries.priceToCoordinate(seg.to.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        const isBreakout = seg.isBreakout;
        ctx.strokeStyle = seg.direction === "up"
          ? (isBreakout ? "rgba(0,230,118,0.95)" : "rgba(0,230,118,0.45)")
          : (isBreakout ? "rgba(255,82,82,0.95)" : "rgba(255,82,82,0.45)");
        ctx.lineWidth = isBreakout ? 2.2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Swing points + labels (HH/HL/LH/LL)
    if (trend.swingPoints) {
      ctx.font = "600 9.5px ui-monospace, Menlo, monospace";
      for (const sw of trend.swingPoints) {
        const x = timeScale.logicalToCoordinate(sw.candleIndex);
        const y = stat5CandleSeries.priceToCoordinate(sw.price);
        if (x === null || y === null) continue;
        const isHigh = sw.type === "high";
        ctx.fillStyle = isHigh ? "#FF5252" : "#00E676";
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0B0B0E";
        ctx.lineWidth = 1;
        ctx.stroke();

        const labelY = isHigh ? y - 9 : y + 15;
        const isControlling = trend.controllingSwing && trend.controllingSwing.id === sw.id;
        if (isControlling) {
          ctx.strokeStyle = "rgba(255,193,7,0.55)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(x - 60, y);
          ctx.lineTo(x + 60, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = isControlling ? "#FFC107" : isHigh ? "#FF8A80" : "#69F0AE";
        ctx.fillText(sw.label, x + 6, labelY);
      }
    }

    // Trend direction + status label (góc trái trên vùng trend mới nhất)
    if (trend.direction) {
      const lastSwing = trend.swingPoints[trend.swingPoints.length - 1];
      if (lastSwing) {
        const x = timeScale.logicalToCoordinate(lastSwing.candleIndex);
        const y = stat5CandleSeries.priceToCoordinate(lastSwing.price);
        if (x !== null && y !== null) {
          const up = trend.direction === "up";
          const label = `${up ? "▲ UPTREND" : "▼ DOWNTREND"} · ${trend.status}`;
          ctx.font = "700 10px 'Outfit', sans-serif";
          const tw = ctx.measureText(label).width + 12;
          ctx.fillStyle = "rgba(10,10,20,0.9)";
          ctx.fillRect(x + 20, y + (up ? -34 : 6), tw, 17);
          ctx.fillStyle = up ? "#00E676" : "#FF5252";
          ctx.fillText(label, x + 26, y + (up ? -21 : 17));
        }
      }
    }
  }
}

// Hit-test zone dưới crosshair.
function stat5HitTestZone(param) {
  if (!param || param.logical === undefined || param.point === undefined) return null;
  const logical = param.logical;
  const price = param.seriesData && param.seriesData.get ? param.seriesData.get(stat5CandleSeries) : null;
  const priceVal = price && price.close !== undefined ? price.close : stat5CandleSeries.coordinateToPrice(param.point.y);
  if (priceVal === null || priceVal === undefined) return null;

  const idx = Math.floor(logical);
  for (const z of stat5Zones) {
    if (idx < z._startIdx || idx > z._endIdx) continue;
    const lo = Math.min(z.proximal, z.distal);
    const hi = Math.max(z.proximal, z.distal);
    if (priceVal >= lo && priceVal <= hi) return z;
  }
  return null;
}
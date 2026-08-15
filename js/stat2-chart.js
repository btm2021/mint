// ============================================================
// stat2-chart.js — KHỞI TẠO BIỂU ĐỒ & RENDER CANVAS OVERLAY
// ============================================================

let stat2Chart = null;
let stat2CandleSeries = null;
let stat2Canvas = null;
let stat2Ctx = null;

let globalStat2Bars = [];
let globalStat2Bot1 = null;
let globalStat2Bot2 = null;
let globalStat2Vsr1 = null;
let globalStat2Vsr2 = null;
let globalStat2VsrOverlap = null;
let globalStat2Trades = [];
let stat2LastCrosshairLogical = null;

function hexToRgba(hex, alpha = 1.0) {
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

function getDashArray(style) {
  switch (style) {
    case "dashed": return [6, 4];
    case "dotted": return [2, 3];
    case "solid":
    default:
      return [];
  }
}

function getStat2PriceFormat(price) {
  if (!price || price >= 500) return { type: "price", precision: 2, minMove: 0.01 };
  if (price >= 1) return { type: "price", precision: 4, minMove: 0.0001 };
  if (price >= 0.01) return { type: "price", precision: 6, minMove: 0.000001 };
  return { type: "price", precision: 8, minMove: 0.00000001 };
}

function initStat2Chart() {
  const container = document.getElementById("stat2-chart-container");
  stat2Canvas = document.getElementById("stat2-overlay-canvas");
  stat2Ctx = stat2Canvas.getContext("2d");

  const cfg = STAT2_CFG.chart;

  stat2Chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: "solid", color: cfg.bgColor || "#080810" },
      textColor: "#C3C6CE",
      fontFamily: "'Outfit', -apple-system, sans-serif",
    },
    grid: {
      vertLines: { color: cfg.showGrid ? cfg.gridColor : "rgba(0,0,0,0)" },
      horzLines: { color: cfg.showGrid ? cfg.gridColor : "rgba(0,0,0,0)" },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 3 },
      horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 3 },
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: "#1e2435",
    },
    rightPriceScale: {
      borderColor: "#1e2435",
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  const priceFmt = { type: "price", precision: 2, minMove: 0.01 };

  stat2CandleSeries = stat2Chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: cfg.upColor || "#00E676",
    downColor: cfg.downColor || "#FF5252",
    borderVisible: false,
    wickUpColor: cfg.upColor || "#00E676",
    wickDownColor: cfg.downColor || "#FF5252",
    priceFormat: priceFmt,
  });

  stat2Chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    requestAnimationFrame(drawStat2Overlay);
  });

  stat2Chart.subscribeCrosshairMove((param) => {
    if (param && param.logical !== undefined) {
      stat2LastCrosshairLogical = param.logical;
      updateStat2IndicatorHUD(param.logical);
    }
    requestAnimationFrame(drawStat2Overlay);
  });

  // Handle Resize
  const observer = new ResizeObserver(() => syncStat2CanvasSize());
  observer.observe(document.getElementById("stat2-chart-wrapper"));
}

function syncStat2CanvasSize() {
  if (!stat2Chart || !stat2CandleSeries || !stat2Canvas) return;
  const container = document.getElementById("stat2-chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  stat2Chart.resize(width, height);
  const chartWidth = stat2Chart.timeScale().width();
  stat2Canvas.width = chartWidth;
  stat2Canvas.height = height;
  stat2Canvas.style.width = chartWidth + "px";
  stat2Canvas.style.height = height + "px";

  drawStat2Overlay();
}

// ==================== VẼ OVERLAY 2D ====================

function drawStat2Overlay() {
  if (!stat2Chart || !stat2CandleSeries || !stat2Ctx || !globalStat2Bars.length) return;
  const timeScale = stat2Chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  if (!range) return;

  const ctx = stat2Ctx;
  ctx.clearRect(0, 0, stat2Canvas.width, stat2Canvas.height);

  const cfg = STAT2_CFG;
  const lastClose = globalStat2Bars[globalStat2Bars.length - 1].close;
  const pr = getStat2PriceFormat(lastClose);
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr.precision);

  // Helper vẽ đường line liên tục từ array giá
  const drawLineSeg = (arr, color, width = 1.5, style = "solid") => {
    if (!arr || !arr.length) return;
    const first = Math.max(0, Math.floor(range.from) - 1);
    const last = Math.min(arr.length - 1, Math.ceil(range.to) + 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(getDashArray(style));

    let drawing = false;
    for (let i = first; i <= last; i++) {
      const val = arr[i];
      if (!Number.isFinite(val)) { drawing = false; continue; }
      const x = timeScale.logicalToCoordinate(i);
      const y = stat2CandleSeries.priceToCoordinate(val);
      if (x === null || y === null) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(x, y); drawing = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Helper vẽ mây ATR Cloud
  const drawCloud = (cycles, t1Arr, t2Arr, upColor, upOpacity, downColor, downOpacity) => {
    if (!cycles || !cycles.length) return;
    for (const cyc of cycles) {
      if (cyc.endIndex < range.from || cyc.startIndex > range.to) continue;
      ctx.beginPath();
      let moved = false;
      const endLimit = Math.min(cyc.endIndex, t1Arr.length - 1);

      // Đi xuôi theo Trail 1
      for (let i = cyc.startIndex; i <= endLimit; i++) {
        if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
        const x = timeScale.logicalToCoordinate(i);
        const y = stat2CandleSeries.priceToCoordinate(t1Arr[i]);
        if (x !== null && y !== null) {
          if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
        }
      }

      // Đi ngược theo Trail 2
      if (moved) {
        for (let i = endLimit; i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i);
          const y = stat2CandleSeries.priceToCoordinate(t2Arr[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        const isUp = cyc.state === 1;
        ctx.fillStyle = isUp ? hexToRgba(upColor, upOpacity) : hexToRgba(downColor, downOpacity);
        ctx.fill();
      }
    }
  };

  // Helper vẽ các vùng VSR Zones
  const drawVsrZones = (zones, vsrCfg) => {
    if (!zones || !zones.length || !vsrCfg.enabled) return;
    for (const z of zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = stat2Canvas.width + 1000;
      const yUpper = stat2CandleSeries.priceToCoordinate(z.upper);
      const yLower = stat2CandleSeries.priceToCoordinate(z.lower);
      if (yUpper === null || yLower === null) continue;

      const topY = Math.min(yUpper, yLower);
      const botY = Math.max(yUpper, yLower);
      const w = xE - xS;

      // Nền Zone
      if (vsrCfg.showFill) {
        ctx.fillStyle = hexToRgba(vsrCfg.fillColor, vsrCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, botY - topY);
      }

      // Viền Upper
      if (vsrCfg.showUpper) {
        ctx.strokeStyle = vsrCfg.upperColor;
        ctx.lineWidth = vsrCfg.upperWidth;
        ctx.setLineDash(getDashArray(vsrCfg.upperStyle));
        ctx.beginPath();
        ctx.moveTo(xS, topY);
        ctx.lineTo(xE, topY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Viền Lower
      if (vsrCfg.showLower) {
        ctx.strokeStyle = vsrCfg.lowerColor;
        ctx.lineWidth = vsrCfg.lowerWidth;
        ctx.setLineDash(getDashArray(vsrCfg.lowerStyle));
        ctx.beginPath();
        ctx.moveTo(xS, botY);
        ctx.lineTo(xE, botY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  // ================= 1. VẼ VSR 1 =================
  if (globalStat2Vsr1 && cfg.vsr1.enabled) {
    drawVsrZones(globalStat2Vsr1.zones, cfg.vsr1);
  }

  // ================= 2. VẼ VSR 2 =================
  if (globalStat2Vsr2 && cfg.vsr2.enabled) {
    drawVsrZones(globalStat2Vsr2.zones, cfg.vsr2);
  }

  // ================= 3. VẼ VÙNG CHỒNG LẤN 2 VSR (VSR OVERLAP) =================
  if (globalStat2VsrOverlap && cfg.vsrOverlap.enabled) {
    const ovCfg = cfg.vsrOverlap;
    for (const z of globalStat2VsrOverlap.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = stat2Canvas.width + 1000;

      const yUpper = stat2CandleSeries.priceToCoordinate(z.upper);
      const yLower = stat2CandleSeries.priceToCoordinate(z.lower);
      if (yUpper === null || yLower === null) continue;

      const topY = Math.min(yUpper, yLower);
      const botY = Math.max(yUpper, yLower);
      const h = Math.max(2, botY - topY);
      const w = Math.max(4, xE - xS);

      // A. Nền chồng lấn nổi bật
      if (ovCfg.showFill) {
        ctx.fillStyle = hexToRgba(ovCfg.fillColor, ovCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, h);

        // B. Pattern Gạch Chéo Chuẩn (Diagonal Hatching)
        if (ovCfg.showHatch) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xS, topY, w, h);
          ctx.clip(); // Giới hạn chỉ vẽ trong vùng overlap

          ctx.strokeStyle = hexToRgba(ovCfg.fillColor, 0.65);
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

      // C. Viền Upper của Overlap
      if (ovCfg.showUpper) {
        ctx.strokeStyle = ovCfg.upperColor;
        ctx.lineWidth = ovCfg.upperWidth;
        ctx.setLineDash(getDashArray(ovCfg.upperStyle));
        ctx.beginPath();
        ctx.moveTo(xS, topY);
        ctx.lineTo(xE, topY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // D. Viền Lower của Overlap
      if (ovCfg.showLower) {
        ctx.strokeStyle = ovCfg.lowerColor;
        ctx.lineWidth = ovCfg.lowerWidth;
        ctx.setLineDash(getDashArray(ovCfg.lowerStyle));
        ctx.beginPath();
        ctx.moveTo(xS, botY);
        ctx.lineTo(xE, botY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // E. Nhãn Huy Hiệu OVERLAP
      if (ovCfg.showLabel) {
        const lx = Math.min(stat2Canvas.width - 70, Math.max(xS + 8, xE - 70));
        const ly = topY + (h / 2);
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

  // ================= 4. VẼ ATRBOT 1 (BIAS / CHẬM) =================
  if (globalStat2Bot1 && cfg.atr1.enabled) {
    const c1 = cfg.atr1;
    if (c1.showCloud) {
      drawCloud(globalStat2Bot1.cycles, globalStat2Bot1.t1Arr, globalStat2Bot1.t2Arr, c1.cloudUpColor, c1.cloudUpOpacity, c1.cloudDownColor, c1.cloudDownOpacity);
    }
    if (c1.showT1) drawLineSeg(globalStat2Bot1.t1Arr, c1.t1Color, c1.t1Width, c1.t1Style);
    if (c1.showT2) drawLineSeg(globalStat2Bot1.t2Arr, c1.t2Color, c1.t2Width, c1.t2Style);
  }

  // ================= 5. VẼ ATRBOT 2 (ENTRY / NHANH) =================
  if (globalStat2Bot2 && cfg.atr2.enabled) {
    const c2 = cfg.atr2;
    if (c2.showCloud) {
      drawCloud(globalStat2Bot2.cycles, globalStat2Bot2.t1Arr, globalStat2Bot2.t2Arr, c2.cloudUpColor, c2.cloudUpOpacity, c2.cloudDownColor, c2.cloudDownOpacity);
    }
    if (c2.showT1) drawLineSeg(globalStat2Bot2.t1Arr, c2.t1Color, c2.t1Width, c2.t1Style);
    if (c2.showT2) drawLineSeg(globalStat2Bot2.t2Arr, c2.t2Color, c2.t2Width, c2.t2Style);
  }

  // ================= 6. VẼ ENTRY / TP / SL =================
  if (cfg.strategy.enabled && globalStat2Trades.length) {
    const sCfg = cfg.strategy;

    const renderTag = (txt, x, y, color) => {
      ctx.font = "10px 'Outfit', sans-serif";
      const tw = ctx.measureText(txt).width + 8;
      let bx = x;
      if (bx + tw > stat2Canvas.width) bx = stat2Canvas.width - tw - 2;
      if (bx < 0) bx = 2;
      const by = y - 7;
      ctx.fillStyle = sCfg.labelBgColor || "rgba(13, 13, 22, 0.92)";
      ctx.fillRect(bx, by, tw, 15);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, tw, 15);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, bx + 4, by + 8);
    };

    for (const t of globalStat2Trades) {
      if (t.exitIdx < range.from || t.entryIdx > range.to) continue;

      let x1 = timeScale.logicalToCoordinate(t.entryIdx);
      let x2 = timeScale.logicalToCoordinate(t.exitIdx);
      if (x1 === null) x1 = -1000;
      if (x2 === null) x2 = stat2Canvas.width + 1000;
      if (x2 <= x1) x2 = x1 + 8;

      const hi = Math.max(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? -Infinity);
      const lo = Math.min(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? Infinity);
      const yHi = stat2CandleSeries.priceToCoordinate(hi);
      const yLo = stat2CandleSeries.priceToCoordinate(lo);

      // A. Khung lệnh (Trade Box Fill)
      if (sCfg.showTradeBox && yHi !== null && yLo !== null) {
        const boxColor = t.pnlPct >= 0 ? sCfg.winBoxColor : sCfg.lossBoxColor;
        ctx.fillStyle = hexToRgba(boxColor, sCfg.boxOpacity);
        ctx.fillRect(x1, yHi, x2 - x1, yLo - yHi);
      }

      // B. Hàm vẽ đường ngang
      const drawLevel = (price, color, width, style) => {
        const y = stat2CandleSeries.priceToCoordinate(price);
        if (y === null) return null;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(getDashArray(style));
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
        return y;
      };

      const yEn = sCfg.showEntryLine ? drawLevel(t.entry, sCfg.entryLineColor, sCfg.entryLineWidth, sCfg.entryLineStyle) : stat2CandleSeries.priceToCoordinate(t.entry);
      const ySl = sCfg.showSlLine ? drawLevel(t.sl1Lv, sCfg.slLineColor, sCfg.slLineWidth, sCfg.slLineStyle) : stat2CandleSeries.priceToCoordinate(t.sl1Lv);
      const yTp1 = sCfg.showTp1Line ? drawLevel(t.tp1Lv, sCfg.tp1LineColor, sCfg.tp1LineWidth, sCfg.tp1LineStyle) : stat2CandleSeries.priceToCoordinate(t.tp1Lv);
      const yTp2 = (sCfg.hasTp2 && sCfg.showTp2Line && t.tp2Lv != null) ? drawLevel(t.tp2Lv, sCfg.tp2LineColor, sCfg.tp2LineWidth, sCfg.tp2LineStyle) : null;

      // C. Mũi tên Entry (Arrow Marker)
      if (sCfg.showMarkers && yEn !== null) {
        const xE = Math.max(0, x1);
        ctx.beginPath();
        if (t.S === 1) {
          ctx.moveTo(xE - 6, yEn + 6);
          ctx.lineTo(xE + 6, yEn + 6);
          ctx.lineTo(xE, yEn - 6);
        } else {
          ctx.moveTo(xE - 6, yEn - 6);
          ctx.lineTo(xE + 6, yEn - 6);
          ctx.lineTo(xE, yEn + 6);
        }
        ctx.closePath();
        ctx.fillStyle = t.S === 1 ? sCfg.markerUpColor : sCfg.markerDownColor;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // D. Nhãn Giá & Kết quả (Price Labels)
      if (sCfg.showLabels) {
        if (yEn !== null && sCfg.showEntryLine) renderTag("ENTRY " + pf(t.entry), x1 + 4, yEn, sCfg.entryLineColor);
        if (ySl !== null && sCfg.showSlLine) renderTag("SL " + pf(t.sl1Lv), x2 - 80, ySl, sCfg.slLineColor);
        if (yTp1 !== null && sCfg.showTp1Line) renderTag("TP1 " + pf(t.tp1Lv), x2 - 80, yTp1, sCfg.tp1LineColor);
        if (yTp2 !== null && sCfg.showTp2Line) renderTag("TP2 " + pf(t.tp2Lv), x2 - 80, yTp2, sCfg.tp2LineColor);

        // Nhãn Kết quả thoát lệnh
        const yEx = stat2CandleSeries.priceToCoordinate(t.exit);
        if (yEx !== null) {
          const outcomeTxt = `${t.exitType} ${t.pnlR >= 0 ? "+" : ""}${t.pnlR.toFixed(2)}R (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%)`;
          renderTag(outcomeTxt, x2 - 110, yEx, t.pnlR >= 0 ? sCfg.tp1LineColor : sCfg.slLineColor);
        }
      }
    }
  }
}

// Click Hit-Test tìm lệnh được nhấn (Chính xác quanh điểm Entry / Marker)
function hitTestStat2Trade(logical, price) {
  if (!STAT2_CFG.strategy.enabled || !globalStat2Trades.length || logical == null || price == null) return null;
  let best = null, minDistance = Infinity;

  for (const t of globalStat2Trades) {
    // Chỉ kích hoạt khi click gần nến Entry hoặc nến Exit (phạm vi hẹp 1.5 bar)
    const nearEntry = Math.abs(logical - t.entryIdx) <= 1.5;
    const nearExit = Math.abs(logical - t.exitIdx) <= 1.5;
    if (!nearEntry && !nearExit) continue;

    const relPriceDist = Math.abs(price - t.entry) / (t.entry || 1);
    if (relPriceDist > 0.02) continue; // Phải click gần mức giá Entry (trong vòng 2%)

    const dist = Math.abs(logical - t.entryIdx) + relPriceDist * 10;
    if (dist < minDistance) {
      minDistance = dist;
      best = t;
    }
  }
  return best;
}


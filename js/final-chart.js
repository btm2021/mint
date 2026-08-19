// ============================================================
// final-chart.js — KHỞI TẠO BIỂU ĐỒ & RENDER CANVAS OVERLAY TOÀN DIỆN
// Hỗ trợ: ATRBot 1&2, VSR 1&2, Overlap, S&D Zones, Trend, SMC, Structural, Trades
// ============================================================

let finalChart = null;
let finalCandleSeries = null;
let finalCanvas = null;
let finalCtx = null;

let globalFinalBars = [];
let globalFinalBot1 = null;
let globalFinalBot2 = null;
let globalFinalVsr1 = null;
let globalFinalVsr2 = null;
let globalFinalVsrOverlap = null;
let globalFinalZones = null;
let globalFinalTrend = null;
let globalFinalSMC = null;
let globalFinalTrades = [];
let finalLastCrosshairLogical = null;

function finalHexToRgba(hex, alpha = 1.0) {
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

function finalGetDashArray(style) {
  switch (style) {
    case "dashed": return [6, 4];
    case "dotted": return [2, 3];
    case "solid":
    default:
      return [];
  }
}

function getFinalPriceFormat(price) {
  if (!price || price >= 500) return { type: "price", precision: 2, minMove: 0.01 };
  if (price >= 1) return { type: "price", precision: 4, minMove: 0.0001 };
  if (price >= 0.01) return { type: "price", precision: 6, minMove: 0.000001 };
  return { type: "price", precision: 8, minMove: 0.00000001 };
}

function initFinalChart() {
  const container = document.getElementById("final-chart-container");
  finalCanvas = document.getElementById("final-overlay-canvas");
  if (!container || !finalCanvas) return;
  finalCtx = finalCanvas.getContext("2d");

  const cfg = FINAL_CFG.chart;

  finalChart = LightweightCharts.createChart(container, {
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

  finalCandleSeries = finalChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: cfg.upColor || "#00E676",
    downColor: cfg.downColor || "#FF5252",
    borderVisible: false,
    wickUpColor: cfg.upColor || "#00E676",
    wickDownColor: cfg.downColor || "#FF5252",
    priceFormat: priceFmt,
  });

  finalChart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    requestAnimationFrame(drawFinalOverlay);
  });

  finalChart.subscribeCrosshairMove((param) => {
    if (param && param.logical !== undefined) {
      finalLastCrosshairLogical = param.logical;
      if (typeof updateFinalIndicatorHUD === "function") {
        updateFinalIndicatorHUD(param.logical);
      }
    }
    requestAnimationFrame(drawFinalOverlay);
  });

  const observer = new ResizeObserver(() => syncFinalCanvasSize());
  observer.observe(document.getElementById("final-chart-wrapper"));
}

function syncFinalCanvasSize() {
  if (!finalChart || !finalCandleSeries || !finalCanvas) return;
  const container = document.getElementById("final-chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  finalChart.resize(width, height);
  const chartWidth = finalChart.timeScale().width();
  finalCanvas.width = chartWidth;
  finalCanvas.height = height;
  finalCanvas.style.width = chartWidth + "px";
  finalCanvas.style.height = height + "px";

  drawFinalOverlay();
}

// ==================== VẼ OVERLAY 2D TOÀN DIỆN ====================

function drawFinalOverlay() {
  if (!finalChart || !finalCandleSeries || !finalCtx || !globalFinalBars.length) return;
  const timeScale = finalChart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  if (!range) return;

  const ctx = finalCtx;
  ctx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);

  const cfg = FINAL_CFG;
  const lastClose = globalFinalBars[globalFinalBars.length - 1].close;
  const pr = getFinalPriceFormat(lastClose);
  const pf = (v) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(pr.precision);

  // Helper vẽ tag/pill
  const renderPill = (txt, x, y, bgCol, borderCol, textCol, fontSize = 9) => {
    ctx.font = `bold ${fontSize}px 'Outfit', sans-serif`;
    const tw = ctx.measureText(txt).width + 8;
    let bx = x;
    if (bx + tw > finalCanvas.width) bx = finalCanvas.width - tw - 2;
    if (bx < 2) bx = 2;
    const by = y - 7;
    ctx.fillStyle = bgCol;
    ctx.fillRect(bx, by, tw, 15);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, tw, 15);
    ctx.fillStyle = textCol;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, bx + 4, by + 8);
  };

  // Helper vẽ đường line liên tục từ array
  const drawLineSeg = (arr, color, width = 1.5, style = "solid") => {
    if (!arr || !arr.length) return;
    const first = Math.max(0, Math.floor(range.from) - 1);
    const last = Math.min(arr.length - 1, Math.ceil(range.to) + 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(finalGetDashArray(style));

    let drawing = false;
    for (let i = first; i <= last; i++) {
      const val = arr[i];
      if (!Number.isFinite(val)) { drawing = false; continue; }
      const x = timeScale.logicalToCoordinate(i);
      const y = finalCandleSeries.priceToCoordinate(val);
      if (x === null || y === null) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(x, y); drawing = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Helper vẽ ATR Cloud
  const drawCloud = (cycles, t1Arr, t2Arr, upColor, upOpacity, downColor, downOpacity) => {
    if (!cycles || !cycles.length) return;
    for (const cyc of cycles) {
      if (cyc.endIndex < range.from || cyc.startIndex > range.to) continue;
      ctx.beginPath();
      let moved = false;
      const endLimit = Math.min(cyc.endIndex, t1Arr.length - 1);

      for (let i = cyc.startIndex; i <= endLimit; i++) {
        if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
        const x = timeScale.logicalToCoordinate(i);
        const y = finalCandleSeries.priceToCoordinate(t1Arr[i]);
        if (x !== null && y !== null) {
          if (!moved) { ctx.moveTo(x, y); moved = true; } else ctx.lineTo(x, y);
        }
      }

      if (moved) {
        for (let i = endLimit; i >= cyc.startIndex; i--) {
          if (i < Math.floor(range.from) || i > Math.ceil(range.to)) continue;
          const x = timeScale.logicalToCoordinate(i);
          const y = finalCandleSeries.priceToCoordinate(t2Arr[i]);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        const isUp = cyc.state === 1;
        ctx.fillStyle = isUp ? finalHexToRgba(upColor, upOpacity) : finalHexToRgba(downColor, downOpacity);
        ctx.fill();
      }
    }
  };

  // Helper vẽ VSR Zones
  const drawVsrZones = (zones, vsrCfg) => {
    if (!zones || !zones.length || !vsrCfg.enabled) return;
    for (const z of zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = finalCanvas.width + 1000;
      const yUpper = finalCandleSeries.priceToCoordinate(z.upper);
      const yLower = finalCandleSeries.priceToCoordinate(z.lower);
      if (yUpper === null || yLower === null) continue;

      const topY = Math.min(yUpper, yLower);
      const botY = Math.max(yUpper, yLower);
      const w = xE - xS;

      if (vsrCfg.showFill) {
        ctx.fillStyle = finalHexToRgba(vsrCfg.fillColor, vsrCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, botY - topY);
      }
      if (vsrCfg.showUpper) {
        ctx.strokeStyle = vsrCfg.upperColor;
        ctx.lineWidth = vsrCfg.upperWidth;
        ctx.setLineDash(finalGetDashArray(vsrCfg.upperStyle));
        ctx.beginPath();
        ctx.moveTo(xS, topY);
        ctx.lineTo(xE, topY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (vsrCfg.showLower) {
        ctx.strokeStyle = vsrCfg.lowerColor;
        ctx.lineWidth = vsrCfg.lowerWidth;
        ctx.setLineDash(finalGetDashArray(vsrCfg.lowerStyle));
        ctx.beginPath();
        ctx.moveTo(xS, botY);
        ctx.lineTo(xE, botY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  // ================= 1. VSR 1 & VSR 2 =================
  if (globalFinalVsr1 && cfg.vsr1.enabled) drawVsrZones(globalFinalVsr1.zones, cfg.vsr1);
  if (globalFinalVsr2 && cfg.vsr2.enabled) drawVsrZones(globalFinalVsr2.zones, cfg.vsr2);

  // ================= 2. VSR OVERLAP =================
  if (globalFinalVsrOverlap && cfg.vsrOverlap.enabled) {
    const ovCfg = cfg.vsrOverlap;
    for (const z of globalFinalVsrOverlap.zones) {
      if (z.endIndex < range.from || z.startIndex > range.to) continue;
      let xS = timeScale.logicalToCoordinate(z.startIndex);
      let xE = timeScale.logicalToCoordinate(z.endIndex);
      if (xS === null) xS = -1000;
      if (xE === null) xE = finalCanvas.width + 1000;

      const yUpper = finalCandleSeries.priceToCoordinate(z.upper);
      const yLower = finalCandleSeries.priceToCoordinate(z.lower);
      if (yUpper === null || yLower === null) continue;

      const topY = Math.min(yUpper, yLower);
      const botY = Math.max(yUpper, yLower);
      const h = Math.max(2, botY - topY);
      const w = Math.max(4, xE - xS);

      if (ovCfg.showFill) {
        ctx.fillStyle = finalHexToRgba(ovCfg.fillColor, ovCfg.fillOpacity);
        ctx.fillRect(xS, topY, w, h);

        if (ovCfg.showHatch) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xS, topY, w, h);
          ctx.clip();
          ctx.strokeStyle = finalHexToRgba(ovCfg.fillColor, 0.65);
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
        ctx.setLineDash(finalGetDashArray(ovCfg.upperStyle));
        ctx.beginPath();
        ctx.moveTo(xS, topY);
        ctx.lineTo(xE, topY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (ovCfg.showLower) {
        ctx.strokeStyle = ovCfg.lowerColor;
        ctx.lineWidth = ovCfg.lowerWidth;
        ctx.setLineDash(finalGetDashArray(ovCfg.lowerStyle));
        ctx.beginPath();
        ctx.moveTo(xS, botY);
        ctx.lineTo(xE, botY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (ovCfg.showLabel) {
        const lx = Math.min(finalCanvas.width - 70, Math.max(xS + 8, xE - 70));
        const ly = topY + (h / 2);
        renderPill("⚡ OVERLAP", lx, ly, "rgba(16, 4, 26, 0.9)", ovCfg.upperColor, ovCfg.upperColor, 9);
      }
    }
  }

  // ================= 3. S&D ZONES (FOREXFLOW) =================
  if (globalFinalZones && cfg.zone.enabled && globalFinalZones.zones) {
    const zCfg = cfg.zone;

    for (const z of globalFinalZones.zones) {
      if (z.baseStartIndex > range.to) continue;
      const endIdx = z.endIndex !== null && z.endIndex !== undefined ? z.endIndex : z.invalidatedIndex;

      // Nếu zone kết thúc hoàn toàn trước vùng đang xem thì bỏ qua
      if (endIdx !== null && endIdx < range.from) continue;

      const isDemand = z.type === "demand";
      const color = isDemand ? zCfg.demandColor : zCfg.supplyColor;
      const opacity = endIdx !== null ? ((zCfg.demandOpacity || 0.16) * 0.45) : (isDemand ? (zCfg.demandOpacity || 0.16) : (zCfg.supplyOpacity || 0.16));

      let x1 = timeScale.logicalToCoordinate(z.baseStartIndex);
      if (x1 === null) {
        if (z.baseStartIndex < range.from) x1 = -10;
        else continue;
      }

      let x2;
      if (endIdx !== null) {
        const coord2 = timeScale.logicalToCoordinate(endIdx);
        if (coord2 === null) {
          if (endIdx < range.from) continue;
          x2 = finalCanvas.width + 10;
        } else {
          x2 = coord2;
        }
      } else {
        x2 = finalCanvas.width;
      }

      if (x2 <= x1) x2 = x1 + 6;

      const topP = Math.max(z.proximalLine, z.distalLine);
      const botP = Math.min(z.proximalLine, z.distalLine);
      const yTop = finalCandleSeries.priceToCoordinate(topP);
      const yBot = finalCandleSeries.priceToCoordinate(botP);
      if (yTop === null || yBot === null) continue;

      const topY = Math.min(yTop, yBot);
      const botY = Math.max(yTop, yBot);
      const h = Math.max(2, botY - topY);
      const w = Math.max(4, x2 - x1);

      // Zone Fill Box (chính xác từ x1 đến x2 - dừng lại tại nến đầu tiên chạm)
      ctx.fillStyle = finalHexToRgba(color, opacity);
      ctx.fillRect(x1, topY, w, h);

      // Proximal line (Nét liền / quan trọng)
      ctx.strokeStyle = color;
      ctx.lineWidth = zCfg.proximalWidth || 1.5;
      ctx.setLineDash(finalGetDashArray(zCfg.proximalStyle || "solid"));
      ctx.beginPath();
      ctx.moveTo(x1, topY);
      ctx.lineTo(x2, topY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distal line (Nét đứt / Stoploss)
      ctx.strokeStyle = finalHexToRgba(color, 0.75);
      ctx.lineWidth = zCfg.distalWidth || 1.2;
      ctx.setLineDash(finalGetDashArray(zCfg.distalStyle || "dashed"));
      ctx.beginPath();
      ctx.moveTo(x1, botY);
      ctx.lineTo(x2, botY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Nếu zone đã chạm: vẽ đường chốt kết thúc (End Cap) tại cây nến đầu tiên chạm
      if (endIdx !== null) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x2, topY - 1);
        ctx.lineTo(x2, botY + 1);
        ctx.stroke();
      }

      // Nhãn S&D Zone
      if (zCfg.showLabels && w > 20) {
        const scoreTxt = zCfg.showScores && z.scores ? ` [${z.scores.total.toFixed(1)}/5★]` : "";
        const statusTxt = endIdx !== null ? " (Touched)" : " (Fresh)";
        const labelTxt = `${z.type.toUpperCase()} · ${z.formation}${scoreTxt}${statusTxt}`;
        const ly = topY + (h / 2);
        const lx = Math.min(x2 - 75, Math.max(x1 + 6, x1 + 6));
        renderPill(labelTxt, lx, ly, "rgba(10, 10, 18, 0.92)", color, color, 9);
      }
    }
  }

  // ================= 4. SMC FEATURES (FVG, OB, EQUAL LEVELS, SWEEPS, BOS, CHOCH) =================
  if (globalFinalSMC && cfg.smc.enabled) {
    const smcCfg = cfg.smc;

    // A. Fair Value Gaps (FVG)
    if (smcCfg.showFVG && globalFinalSMC.fvgs) {
      for (const fvg of globalFinalSMC.fvgs) {
        if (fvg.index < range.from - 50 || fvg.index > range.to) continue;
        if (fvg.mitigated && smcCfg.fvgHideMitigated) continue;

        const isBull = fvg.type === "bullish";
        const col = isBull ? smcCfg.fvgBullColor : smcCfg.fvgBearColor;
        const op = fvg.mitigated ? (smcCfg.fvgOpacity * 0.4) : smcCfg.fvgOpacity;

        let x1 = timeScale.logicalToCoordinate(fvg.index);
        let x2 = fvg.mitigatedIndex !== null ? timeScale.logicalToCoordinate(fvg.mitigatedIndex) : finalCanvas.width;
        if (x1 === null) x1 = 0;
        if (x2 === null) x2 = finalCanvas.width;
        if (x2 <= x1) x2 = x1 + 8;

        const yHi = finalCandleSeries.priceToCoordinate(fvg.high);
        const yLo = finalCandleSeries.priceToCoordinate(fvg.low);
        if (yHi === null || yLo === null) continue;

        const topY = Math.min(yHi, yLo);
        const botY = Math.max(yHi, yLo);

        ctx.fillStyle = finalHexToRgba(col, op);
        ctx.fillRect(x1, topY, x2 - x1, botY - topY);

        ctx.strokeStyle = finalHexToRgba(col, fvg.mitigated ? 0.3 : 0.8);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x1, topY, x2 - x1, botY - topY);
        ctx.setLineDash([]);

        if (!fvg.mitigated && x2 - x1 > 25) {
          renderPill(isBull ? "FVG +" : "FVG -", x1 + 3, topY + (botY - topY) / 2, "rgba(10, 10, 18, 0.85)", col, col, 8);
        }
      }
    }

    // B. Order Blocks (OB)
    if (smcCfg.showOrderBlocks && globalFinalSMC.orderBlocks) {
      for (const ob of globalFinalSMC.orderBlocks) {
        if (ob.index < range.from - 50 || ob.index > range.to) continue;
        const isBull = ob.type === "bullish";
        const col = isBull ? smcCfg.obBullColor : smcCfg.obBearColor;

        let x1 = timeScale.logicalToCoordinate(ob.index);
        let x2 = Math.min(finalCanvas.width, (x1 || 0) + 120);
        if (x1 === null) continue;

        const yHi = finalCandleSeries.priceToCoordinate(ob.high);
        const yLo = finalCandleSeries.priceToCoordinate(ob.low);
        if (yHi === null || yLo === null) continue;

        const topY = Math.min(yHi, yLo);
        const botY = Math.max(yHi, yLo);

        ctx.fillStyle = finalHexToRgba(col, smcCfg.obOpacity);
        ctx.fillRect(x1, topY, x2 - x1, botY - topY);

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x1, topY, x2 - x1, botY - topY);

        renderPill(isBull ? "OB Bull" : "OB Bear", x1 + 2, topY + (botY - topY) / 2, "rgba(8, 8, 16, 0.9)", col, col, 8);
      }
    }

    // C. Equal Highs & Equal Lows (EQH / EQL)
    if (smcCfg.showEqualLevels && globalFinalSMC.equalLevels) {
      for (const eq of globalFinalSMC.equalLevels) {
        const y = finalCandleSeries.priceToCoordinate(eq.price);
        if (y === null) continue;

        const firstSw = eq.swings[0];
        const lastSw = eq.swings[eq.swings.length - 1];
        let x1 = timeScale.logicalToCoordinate(firstSw.index);
        let x2 = timeScale.logicalToCoordinate(lastSw.index + 10);
        if (x1 === null) x1 = 0;
        if (x2 === null) x2 = finalCanvas.width;

        ctx.strokeStyle = smcCfg.equalLevelsColor || "#B388FF";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = eq.type === "equal_highs" ? `EQH (x${eq.count})` : `EQL (x${eq.count})`;
        renderPill(label, x2 - 55, y, "rgba(16, 8, 28, 0.9)", smcCfg.equalLevelsColor, smcCfg.equalLevelsColor, 8);
      }
    }

    // D. Liquidity Sweeps
    if (smcCfg.showSweeps && globalFinalSMC.sweeps) {
      for (const sw of globalFinalSMC.sweeps) {
        if (sw.index < range.from || sw.index > range.to) continue;
        const x = timeScale.logicalToCoordinate(sw.index);
        const y = finalCandleSeries.priceToCoordinate(sw.type === "bullish" ? sw.sweepLow : sw.sweepHigh);
        if (x === null || y === null) continue;

        renderPill(sw.type === "bullish" ? "⚡ SWEEP LOW" : "⚡ SWEEP HIGH", x - 30, y + (sw.type === "bullish" ? 14 : -14), "rgba(25, 20, 0, 0.95)", smcCfg.sweepColor, smcCfg.sweepColor, 8);
      }
    }

    // E. Structure Breaks (BOS / CHoCH)
    if (globalFinalSMC.structureEvents) {
      for (const ev of globalFinalSMC.structureEvents) {
        const isBos = ev.type === "bos";
        if (isBos && !smcCfg.showBOS) continue;
        if (!isBos && !smcCfg.showCHoCH) continue;

        const isBull = ev.direction === "bullish";
        const color = isBos
          ? (isBull ? smcCfg.bosBullColor : smcCfg.bosBearColor)
          : (isBull ? smcCfg.chochBullColor : smcCfg.chochBearColor);

        const y = finalCandleSeries.priceToCoordinate(ev.level);
        if (y === null) continue;

        let x1 = timeScale.logicalToCoordinate(ev.swingBroken.index);
        let x2 = timeScale.logicalToCoordinate(ev.breakIndex);
        if (x1 === null) x1 = 0;
        if (x2 === null) x2 = finalCanvas.width;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = `${ev.type.toUpperCase()} ${isBull ? "▲" : "▼"}`;
        renderPill(label, (x1 + x2) / 2 - 20, y, "rgba(8, 12, 20, 0.92)", color, color, 8);
      }
    }
  }

  // ================= 5. ATRBOT 1 & ATRBOT 2 =================
  if (globalFinalBot1 && cfg.atr1.enabled) {
    const c1 = cfg.atr1;
    if (c1.showCloud) drawCloud(globalFinalBot1.cycles, globalFinalBot1.t1Arr, globalFinalBot1.t2Arr, c1.cloudUpColor, c1.cloudUpOpacity, c1.cloudDownColor, c1.cloudDownOpacity);
    if (c1.showT1) drawLineSeg(globalFinalBot1.t1Arr, c1.t1Color, c1.t1Width, c1.t1Style);
    if (c1.showT2) drawLineSeg(globalFinalBot1.t2Arr, c1.t2Color, c1.t2Width, c1.t2Style);
  }

  if (globalFinalBot2 && cfg.atr2.enabled) {
    const c2 = cfg.atr2;
    if (c2.showCloud) drawCloud(globalFinalBot2.cycles, globalFinalBot2.t1Arr, globalFinalBot2.t2Arr, c2.cloudUpColor, c2.cloudUpOpacity, c2.cloudDownColor, c2.cloudDownOpacity);
    if (c2.showT1) drawLineSeg(globalFinalBot2.t1Arr, c2.t1Color, c2.t1Width, c2.t1Style);
    if (c2.showT2) drawLineSeg(globalFinalBot2.t2Arr, c2.t2Color, c2.t2Width, c2.t2Style);
  }

  // ================= 6. TREND & SWINGS (FOREXFLOW) =================
  if (globalFinalTrend && cfg.trend.enabled) {
    const trCfg = cfg.trend;

    // A. Segments (ZigZag lines)
    if (trCfg.showSegments && globalFinalTrend.segments) {
      for (const seg of globalFinalTrend.segments) {
        if (seg.to.index < range.from || seg.from.index > range.to) continue;
        let x1 = timeScale.logicalToCoordinate(seg.from.index);
        let y1 = finalCandleSeries.priceToCoordinate(seg.from.price);
        let x2 = timeScale.logicalToCoordinate(seg.to.index);
        let y2 = finalCandleSeries.priceToCoordinate(seg.to.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

        const segCol = seg.direction === "up" ? trCfg.upColor : trCfg.downColor;
        ctx.strokeStyle = segCol;
        ctx.lineWidth = trCfg.lineWidth || 1.8;
        ctx.setLineDash(finalGetDashArray(trCfg.lineStyle || "solid"));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // B. Swing Point Dots & Labels (HH / HL / LH / LL)
    if (globalFinalTrend.swingPoints) {
      for (const sw of globalFinalTrend.swingPoints) {
        if (sw.index < range.from || sw.index > range.to) continue;
        const x = timeScale.logicalToCoordinate(sw.index);
        const y = finalCandleSeries.priceToCoordinate(sw.price);
        if (x === null || y === null) continue;

        const isHigh = sw.type === "high";
        const dotCol = isHigh ? trCfg.upColor : trCfg.downColor;

        // Swing Dot
        ctx.beginPath();
        ctx.arc(x, y, trCfg.swingPointSize || 4, 0, Math.PI * 2);
        ctx.fillStyle = dotCol;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Swing Label (HH / HL / LH / LL)
        if (trCfg.showLabels && sw.label) {
          const lblY = isHigh ? y - 12 : y + 12;
          renderPill(sw.label, x - 12, lblY, "rgba(10, 14, 24, 0.92)", dotCol, dotCol, 8);
        }
      }
    }

    // C. Controlling Swing
    if (trCfg.showControllingSwing && globalFinalTrend.controllingSwing) {
      const cs = globalFinalTrend.controllingSwing;
      const y = finalCandleSeries.priceToCoordinate(cs.price);
      if (y !== null) {
        let x1 = timeScale.logicalToCoordinate(cs.index);
        if (x1 === null) x1 = 0;
        const x2 = finalCanvas.width;

        ctx.strokeStyle = "#FFD700";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        renderPill(`🛡 CONTROLLING SWING (${cs.label})`, x2 - 145, y, "rgba(20, 16, 0, 0.95)", "#FFD700", "#FFD700", 8);
      }
    }
  }

  // ================= 7. STRUCTURAL CONFIRMATION POINTS =================
  if (cfg.structural.enabled && cfg.structural.showPoints && globalFinalBars.length >= 20) {
    const sLookback = parseInt(cfg.structural.lookback, 10) || 3;
    const stCol = cfg.structural.pointColor || "#00E5FF";

    const first = Math.max(sLookback, Math.floor(range.from));
    const last = Math.min(globalFinalBars.length - 1 - sLookback, Math.ceil(range.to));

    for (let i = first; i <= last; i++) {
      const c = globalFinalBars[i];
      if (!c) continue;
      let isL = true, isH = true;
      for (let j = 1; j <= sLookback; j++) {
        const prev = globalFinalBars[i - j];
        const next = globalFinalBars[i + j];
        if (!prev || !next) { isL = false; isH = false; break; }
        if (prev.low <= c.low || next.low <= c.low) isL = false;
        if (prev.high >= c.high || next.high >= c.high) isH = false;
      }

      if (isL || isH) {
        const x = timeScale.logicalToCoordinate(i);
        const y = finalCandleSeries.priceToCoordinate(isL ? c.low : c.high);
        if (x !== null && y !== null) {
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = stCol;
          ctx.fill();
        }
      }
    }
  }

  // ================= 8. STRATEGY TRADES & MARKERS =================
  if (cfg.strategy.enabled && globalFinalTrades.length) {
    const sCfg = cfg.strategy;

    const renderTag = (txt, x, y, color) => {
      ctx.font = "10px 'Outfit', sans-serif";
      const tw = ctx.measureText(txt).width + 8;
      let bx = x;
      if (bx + tw > finalCanvas.width) bx = finalCanvas.width - tw - 2;
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

    for (const t of globalFinalTrades) {
      if (t.exitIdx < range.from || t.entryIdx > range.to) continue;

      let x1 = timeScale.logicalToCoordinate(t.entryIdx);
      let x2 = timeScale.logicalToCoordinate(t.exitIdx);
      if (x1 === null) x1 = -1000;
      if (x2 === null) x2 = finalCanvas.width + 1000;
      if (x2 <= x1) x2 = x1 + 8;

      const hi = Math.max(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? -Infinity);
      const lo = Math.min(t.sl1Lv, t.tp1Lv, t.tp2Lv ?? Infinity);
      const yHi = finalCandleSeries.priceToCoordinate(hi);
      const yLo = finalCandleSeries.priceToCoordinate(lo);

      // Trade Box
      if (sCfg.showTradeBox && yHi !== null && yLo !== null) {
        const boxColor = t.pnlPct >= 0 ? sCfg.winBoxColor : sCfg.lossBoxColor;
        ctx.fillStyle = finalHexToRgba(boxColor, sCfg.boxOpacity);
        ctx.fillRect(x1, yHi, x2 - x1, yLo - yHi);
      }

      const drawLevel = (price, color, width, style) => {
        const y = finalCandleSeries.priceToCoordinate(price);
        if (y === null) return null;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(finalGetDashArray(style));
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
        return y;
      };

      const yEn = sCfg.showEntryLine ? drawLevel(t.entry, sCfg.entryLineColor, sCfg.entryLineWidth, sCfg.entryLineStyle) : finalCandleSeries.priceToCoordinate(t.entry);
      const ySl = sCfg.showSlLine ? drawLevel(t.sl1Lv, sCfg.slLineColor, sCfg.slLineWidth, sCfg.slLineStyle) : finalCandleSeries.priceToCoordinate(t.sl1Lv);
      const yTp1 = sCfg.showTp1Line ? drawLevel(t.tp1Lv, sCfg.tp1LineColor, sCfg.tp1LineWidth, sCfg.tp1LineStyle) : finalCandleSeries.priceToCoordinate(t.tp1Lv);
      const yTp2 = (sCfg.hasTp2 && sCfg.showTp2Line && t.tp2Lv != null) ? drawLevel(t.tp2Lv, sCfg.tp2LineColor, sCfg.tp2LineWidth, sCfg.tp2LineStyle) : null;

      // Arrow Marker
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

      // Labels
      if (sCfg.showLabels) {
        if (yEn !== null && sCfg.showEntryLine) renderTag("ENTRY " + pf(t.entry), x1 + 4, yEn, sCfg.entryLineColor);
        if (ySl !== null && sCfg.showSlLine) renderTag("SL " + pf(t.sl1Lv), x2 - 80, ySl, sCfg.slLineColor);
        if (yTp1 !== null && sCfg.showTp1Line) renderTag("TP1 " + pf(t.tp1Lv), x2 - 80, yTp1, sCfg.tp1LineColor);
        if (yTp2 !== null && sCfg.showTp2Line) renderTag("TP2 " + pf(t.tp2Lv), x2 - 80, yTp2, sCfg.tp2LineColor);

        const yEx = finalCandleSeries.priceToCoordinate(t.exit);
        if (yEx !== null) {
          const outcomeTxt = `${t.exitType} ${t.pnlR >= 0 ? "+" : ""}${t.pnlR.toFixed(2)}R (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%)`;
          renderTag(outcomeTxt, x2 - 110, yEx, t.pnlR >= 0 ? sCfg.tp1LineColor : sCfg.slLineColor);
        }
      }
    }
  }
}

// Click Hit-Test tìm lệnh
function hitTestFinalTrade(logical, price) {
  if (!FINAL_CFG.strategy.enabled || !globalFinalTrades.length || logical == null || price == null) return null;
  let best = null, minDistance = Infinity;

  for (const t of globalFinalTrades) {
    const nearEntry = Math.abs(logical - t.entryIdx) <= 1.5;
    const nearExit = Math.abs(logical - t.exitIdx) <= 1.5;
    if (!nearEntry && !nearExit) continue;

    const relPriceDist = Math.abs(price - t.entry) / (t.entry || 1);
    if (relPriceDist > 0.02) continue;

    const dist = Math.abs(logical - t.entryIdx) + relPriceDist * 10;
    if (dist < minDistance) {
      minDistance = dist;
      best = t;
    }
  }
  return best;
}

// Click Hit-Test tìm S&D Zone
function hitTestFinalZone(logical, price) {
  if (!FINAL_CFG.zone.enabled || !globalFinalZones || !globalFinalZones.zones || price == null || logical == null) return null;
  for (const z of globalFinalZones.zones) {
    if (logical >= z.baseStartIndex) {
      const endIdx = z.endIndex !== null && z.endIndex !== undefined ? z.endIndex : z.invalidatedIndex;
      if (endIdx !== null && logical > endIdx) continue;
      const topP = Math.max(z.proximalLine, z.distalLine);
      const botP = Math.min(z.proximalLine, z.distalLine);
      if (price >= botP && price <= topP) {
        return z;
      }
    }
  }
  return null;
}

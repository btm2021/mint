function initChart() {
  const container = document.getElementById("chart-container");
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: "solid", color: "#0B0B0E" },
      textColor: "#C3C6CE",
    },
    grid: {
      vertLines: { color: "rgba(42, 46, 57, 0.8)" },
      horzLines: { color: "rgba(42, 46, 57, 0.3)" },
    },
    crosshair: {
      mode: 0,
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
    kinematicScroll: {
      touch: true,
      mouse: true,
    },
  });

  const priceFmt = { type: "price", precision: 2, minMove: 0.01 };

  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: "#00E676",
    downColor: "#FF5252",
    borderVisible: false,
    wickUpColor: "#00E676",
    wickDownColor: "#FF5252",
    priceFormat: priceFmt,
  });

  t1Series = chart.addSeries(LightweightCharts.LineSeries, {
    lineWidth: 2,
    crosshairMarkerVisible: false,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: false,
    priceFormat: priceFmt,
  });

  t2Series = chart.addSeries(LightweightCharts.LineSeries, {
    lineWidth: 2,
    crosshairMarkerVisible: false,
    lastValueVisible: false,
    priceLineVisible: false,
    visible: false,
    priceFormat: priceFmt,
  });

  t1Series2 = chart.addSeries(LightweightCharts.LineSeries, {
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    crosshairMarkerVisible: false,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: priceFmt,
    visible: showATR2,
  });

  t2Series2 = chart.addSeries(LightweightCharts.LineSeries, {
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    crosshairMarkerVisible: false,
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: priceFmt,
    visible: showATR2,
  });

  vwapSeries = chart.addSeries(LightweightCharts.LineSeries, {
    color: "rgba(255, 255, 255, 0.9)",
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    crosshairMarkerVisible: false,
    lastValueVisible: true,
    priceLineVisible: false,
    priceFormat: priceFmt,
    visible: showVWAP,
  });

  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    requestAnimationFrame(drawOverlay);
  });
}

function syncCanvasSize() {
  if (!chart || !candleSeries) return;
  const container = document.getElementById("chart-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  chart.resize(width, height);
  const chartWidth = chart.timeScale().width();
  const chartHeight = height - 26;
  canvas.width = chartWidth;
  canvas.height = chartHeight;
  canvas.style.width = chartWidth + "px";
  canvas.style.height = chartHeight + "px";
  drawOverlay();
}

function initResizeObserver() {
  const container = document.getElementById("chart-wrapper");
  const observer = new ResizeObserver(() => {
    syncCanvasSize();
  });
  observer.observe(container);
}

function ptrToChart(e) {
  const wrapper = document.getElementById("chart-wrapper");
  const b = wrapper.getBoundingClientRect();
  const x = (e.clientX || (e.touches && e.touches[0].clientX)) - b.left;
  const y = (e.clientY || (e.touches && e.touches[0].clientY)) - b.top;
  const logical = chart.timeScale().coordinateToLogical(x);
  const price = candleSeries.coordinateToPrice(y);
  return { x, y, logical, price };
}

function drawOverlay() {
  if (!chart || !candleSeries || !globalCycles.length) return;
  const timeScale = chart.timeScale();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let visibleRange = timeScale.getVisibleLogicalRange();
  if (!visibleRange) return;

  // Pass 0: VSR
  if (showVSR) {
    for (let z of globalVsrZones) {
      if (z.endIndex < visibleRange.from || z.startIndex > visibleRange.to) continue;
      let xStart = timeScale.logicalToCoordinate(z.startIndex);
      let xEnd = timeScale.logicalToCoordinate(z.endIndex);
      if (xStart === null) xStart = -1000;
      if (xEnd === null) xEnd = canvas.width + 1000;
      let cycleW = xEnd - xStart;
      if (cycleW <= 0) continue;
      let y1 = candleSeries.priceToCoordinate(z.upper);
      let y2 = candleSeries.priceToCoordinate(z.lower);
      if (y1 !== null && y2 !== null) {
        let topY = Math.min(y1, y2), botY = Math.max(y1, y2);
        ctx.fillStyle = "rgba(255, 235, 59, 0.2)";
        ctx.fillRect(xStart, topY, cycleW, botY - topY);
        ctx.strokeStyle = "rgba(255, 235, 59, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xStart, topY); ctx.lineTo(xEnd, topY);
        ctx.moveTo(xStart, botY); ctx.lineTo(xEnd, botY);
        ctx.stroke();
      }
    }
  }

  // Pass 1: ATR Cloud
  if (showATR1) {
    for (let cycle of globalCycles) {
      if (cycle.endIndex < visibleRange.from || cycle.startIndex > visibleRange.to) continue;
      ctx.beginPath();
      let hasMoved = false;
      for (let i = 0; i < cycle.bars.length; i++) {
        let b = cycle.bars[i], lIdx = cycle.startIndex + i;
        if (lIdx < Math.floor(visibleRange.from) || lIdx > Math.ceil(visibleRange.to)) continue;
        let x = timeScale.logicalToCoordinate(lIdx), y = candleSeries.priceToCoordinate(b.t1);
        if (x !== null && y !== null) { if (!hasMoved) { ctx.moveTo(x, y); hasMoved = true; } else ctx.lineTo(x, y); }
      }
      if (hasMoved) {
        for (let i = cycle.bars.length - 1; i >= 0; i--) {
          let b = cycle.bars[i], lIdx = cycle.startIndex + i;
          if (lIdx < Math.floor(visibleRange.from) || lIdx > Math.ceil(visibleRange.to)) continue;
          let x = timeScale.logicalToCoordinate(lIdx), y = candleSeries.priceToCoordinate(b.t2);
          if (x !== null && y !== null) ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = cycle.state === 1 ? "rgba(0, 230, 118, 0.2)" : "rgba(255, 82, 82, 0.2)";
        ctx.fill();
      }
    }
  }

  // Pass 2: VPs
  let allVpToDraw = [...drawnVpRects];
  if (vpCreateState.active && vpCreateState.logical1 !== null && vpCreateState.logical2 !== null) {
    allVpToDraw.push({ l1: vpCreateState.logical1, l2: vpCreateState.logical2 });
  }
  for (let i = 0; i < allVpToDraw.length; i++) {
    let v = allVpToDraw[i];
    let idxFrom = Math.min(Math.round(v.l1), Math.round(v.l2));
    let idxTo = Math.max(Math.round(v.l1), Math.round(v.l2));
    if (idxTo < visibleRange.from || idxFrom > visibleRange.to) continue;
    idxFrom = Math.max(0, idxFrom); idxTo = Math.min(globalBars.length - 1, idxTo);
    if (idxTo - idxFrom < 0) continue;
    let barsSlice = globalBars.slice(idxFrom, idxTo + 1);
    if (barsSlice.length === 0) continue;
    let hi = -Infinity, lo = Infinity;
    barsSlice.forEach(b => { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
    v.p2 = hi; v.p1 = lo;
    let xS = timeScale.logicalToCoordinate(v.l1 > v.l2 ? v.l2 : v.l1);
    let xE = timeScale.logicalToCoordinate(v.l1 > v.l2 ? v.l1 : v.l2);
    if (xS === null) xS = -1000; if (xE === null) xE = canvas.width + 1000;
    let cW = xE - xS; if (cW <= 0) continue;
    let hasHover = (i === hoveredVpIndex && !vpCreateState.active) || (rectDragState.active && rectDragState.isVp && rectDragState.index === i);
    let isSel = i === selectedVpIndex && !vpCreateState.active;
    if (hasHover || isSel || vpCreateState.active) {
      let yH = candleSeries.priceToCoordinate(hi), yL = candleSeries.priceToCoordinate(lo);
      if (yH !== null && yL !== null) {
        ctx.fillStyle = isSel ? "rgba(33, 150, 243, 0.15)" : hasHover ? "rgba(33, 150, 243, 0.1)" : "rgba(33, 150, 243, 0.05)";
        ctx.strokeStyle = isSel ? "rgba(33, 150, 243, 0.6)" : "rgba(33, 150, 243, 0.3)";
        ctx.lineWidth = 1; ctx.fillRect(xS, yH, cW, yL - yH); ctx.strokeRect(xS, yH, cW, yL - yH);
        if ((hasHover || isSel) && !vpCreateState.active) {
          ctx.fillStyle = "#C3C6CE"; ctx.strokeStyle = "#0B0B0E"; let hs = 6;
          ctx.fillRect(xS - hs/2, (yH+yL)/2 - hs/2, hs, hs); ctx.strokeRect(xS - hs/2, (yH+yL)/2 - hs/2, hs, hs);
          ctx.fillRect(xE - hs/2, (yH+yL)/2 - hs/2, hs, hs); ctx.strokeRect(xE - hs/2, (yH+yL)/2 - hs/2, hs, hs);
        }
      }
    }
    if (!v.vpCache || vpCreateState.active || rectDragState.active) v.vp = calculateFRVP(barsSlice);
    let cVP = v.vp; if (!cVP) continue;
    let maxBW = Math.min(150, cW * 0.5);
    let yVAH = candleSeries.priceToCoordinate(cVP.vahPrice), yVAL = candleSeries.priceToCoordinate(cVP.valPrice);
    if (yVAH !== null && yVAL !== null) {
      let tY = Math.min(yVAH, yVAL), bY = Math.max(yVAH, yVAL);
      ctx.fillStyle = "rgba(41, 98, 255, 0.05)"; ctx.fillRect(xS, tY, cW, bY - tY);
      ctx.setLineDash([4,4]); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(33, 150, 243, 0.8)";
      ctx.beginPath(); ctx.moveTo(xS, tY); ctx.lineTo(xE, tY); ctx.stroke();
      ctx.strokeStyle = "rgba(255, 193, 7, 0.8)"; ctx.beginPath(); ctx.moveTo(xS, bY); ctx.lineTo(xE, bY); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (showVPVol) {
      for (let r of cVP.rows) {
        let yT = candleSeries.priceToCoordinate(r.priceTop), yB = candleSeries.priceToCoordinate(r.priceBottom);
        if (yT !== null && yB !== null) {
          let tY = Math.min(yT, yB), hA = Math.abs(yB - yT) - (Math.abs(yB - yT) > 2 ? 1 : 0);
          let buyW = (r.buyVol / cVP.maxVol) * maxBW, sellW = (r.sellVol / cVP.maxVol) * maxBW;
          let baseCol = r.buyVol >= r.sellVol ? { bright: r.inVA ? "rgba(22,112,175,0.95)" : "rgba(22,112,175,0.4)", dark: r.inVA ? "rgba(23,72,111,0.95)" : "rgba(23,72,111,0.4)", medium: r.inVA ? "rgba(23,52,79,0.95)" : "rgba(23,52,79,0.4)" } : { bright: r.inVA ? "rgba(183,145,38,0.95)" : "rgba(183,145,38,0.4)", dark: r.inVA ? "rgba(103,89,43,0.95)" : "rgba(103,89,43,0.4)", medium: r.inVA ? "rgba(62,60,45,0.95)" : "rgba(62,60,45,0.4)" };
          let currX = xS; let dW = Math.abs(buyW - sellW), wW = Math.min(buyW, sellW), sW = Math.max(buyW, sellW) - dW;
          if (dW > 0) { ctx.fillStyle = baseCol.bright; ctx.fillRect(currX, tY, dW, hA); currX += dW; }
          if (wW > 0) { ctx.fillStyle = baseCol.dark; ctx.fillRect(currX, tY, wW, hA); currX += wW; }
          if (sW > 0) { ctx.fillStyle = baseCol.medium; ctx.fillRect(currX, tY, sW, hA); }
        }
      }
    }
    let pY = candleSeries.priceToCoordinate(cVP.pocPrice);
    if (pY !== null) { ctx.strokeStyle = cVP.pocDelta >= 0 ? "rgba(76,175,80,0.9)" : "rgba(255,82,82,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xS, pY); ctx.lineTo(xE, pY); ctx.stroke(); }
  }

  // Pass 3: Rects
  let allRectsToDraw = [...drawnRects];
  if (rectCreateState.active && rectCreateState.logical1 !== null && rectCreateState.price1 !== null && rectCreateState.logical2 !== null && rectCreateState.price2 !== null) {
    allRectsToDraw.push({ l1: rectCreateState.logical1, p1: rectCreateState.price1, l2: rectCreateState.logical2, p2: rectCreateState.price2 });
  }
  for (let i = 0; i < allRectsToDraw.length; i++) {
    let r = allRectsToDraw[i], x1 = timeScale.logicalToCoordinate(r.l1), x2 = timeScale.logicalToCoordinate(r.l2), y1 = candleSeries.priceToCoordinate(r.p1), y2 = candleSeries.priceToCoordinate(r.p2);
    if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
      let rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      let isH = i === hoveredRectIndex || (rectDragState.active && rectDragState.index === i), isS = i === selectedRectIndex;
      ctx.fillStyle = isS ? "rgba(156,39,176,0.4)" : isH ? "rgba(156,39,176,0.3)" : "rgba(156,39,176,0.2)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = isS ? "rgba(255,64,129,1)" : isH ? "rgba(216,27,96,0.9)" : "rgba(156,39,176,0.8)";
      ctx.lineWidth = isS || isH ? 2 : 1; ctx.strokeRect(rx, ry, rw, rh);
      if ((isH || isS) && !rectCreateState.active) {
        ctx.fillStyle = "#C3C6CE"; ctx.strokeStyle = "#0B0B0E"; ctx.lineWidth = 1; let hs = 6;
        let corners = [{ cx: rx, cy: ry }, { cx: rx + rw, cy: ry }, { cx: rx, cy: ry + rh }, { cx: rx + rw, cy: ry + rh }];
        for (let c of corners) { ctx.fillRect(c.cx - hs/2, c.cy - hs/2, hs, hs); ctx.strokeRect(c.cx - hs/2, c.cy - hs/2, hs, hs); }
      }
    }
  }

  // Pass 4: Measure
  if (measureState.step > 0 && measureState.startIdx !== null && measureState.endIdx !== null && globalBars && globalBars.length) {
    let csI = Math.max(0, Math.min(globalBars.length-1, Math.min(measureState.startIdx, measureState.endIdx)));
    let ceI = Math.max(0, Math.min(globalBars.length-1, Math.max(measureState.startIdx, measureState.endIdx)));
    let enB = globalBars[csI], exB = globalBars[ceI], side = exB.close >= enB.close ? "LONG" : "SHORT";
    let enP = enB.close, exP = exB.close, margin = 100, leverage = 20, pnl = 0, maxP = 0;
    if (side === "LONG") { pnl = margin * leverage * ((exP - enP)/enP); let h = -Infinity; for (let i=csI; i<=ceI; i++) h = Math.max(h, globalBars[i].high); maxP = margin*leverage*((h-enP)/enP); }
    else { pnl = margin * leverage * ((enP - exP)/enP); let l = Infinity; for (let i=csI; i<=ceI; i++) l = Math.min(l, globalBars[i].low); maxP = margin*leverage*((enP-l)/enP); }
    let bC = ceI - csI, tS = exB.time - enB.time, d = Math.floor(tS/86400), h = Math.floor((tS%86400)/3600), m = Math.floor((tS%3600)/60), tStr = (d > 0 ? d + "d " : "") + (h > 0 ? h + "h " : "") + m + "m";
    let x1 = timeScale.logicalToCoordinate(csI), x2 = timeScale.logicalToCoordinate(ceI), y1 = candleSeries.priceToCoordinate(enP), y2 = candleSeries.priceToCoordinate(exP);
    if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
      ctx.save(); let fC = side === "LONG" ? "rgba(0,230,118,0.2)" : "rgba(255,82,82,0.2)", sC = side === "LONG" ? "rgba(0,230,118,0.8)" : "rgba(255,82,82,0.8)";
      ctx.fillStyle = fC; let rX = Math.min(x1, x2), rW = Math.max(1, Math.abs(x2-x1)), rY = Math.min(y1, y2), rH = Math.abs(y2-y1);
      ctx.fillRect(rX, rY, rW, rH); ctx.strokeStyle = sC; ctx.lineWidth = 1; ctx.strokeRect(rX, rY, rW, rH);
      let bW = 200, bH = 165, bX = Math.max(x1, x2) + 15, bY = y2 - bH/2;
      if (bX + bW > canvas.width) bX = Math.min(x1, x2) - bW - 15; if (bY < 10) bY = 10; if (bY + bH > canvas.height - 10) bY = canvas.height - bH - 10;
      ctx.fillStyle = "rgba(17,17,24,0.95)"; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 8); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = "#1f2933"; ctx.stroke(); }
      else { ctx.fillRect(bX, bY, bW, bH); ctx.shadowBlur = 0; ctx.strokeStyle = "#1f2933"; ctx.strokeRect(bX, bY, bW, bH); }
      ctx.fillStyle = "#C3C6CE"; ctx.font = '13px Outfit, sans-serif'; ctx.textAlign = "left"; ctx.textBaseline = "top";
      let tX = bX + 12, tY = bY + 12, lH = 20;
      ctx.fillStyle = side === "LONG" ? "#00E676" : "#FF5252"; ctx.fillText(`Side: ${side} (100u x20)`, tX, tY); tY += lH;
      ctx.fillStyle = "#C3C6CE"; ctx.fillText(`Entry: ${enP.toFixed(4)}`, tX, tY); tY += lH; ctx.fillText(`Exit:  ${exP.toFixed(4)}`, tX, tY); tY += lH;
      let mR = (maxP/margin)*100, roe = (pnl/margin)*100;
      ctx.fillStyle = maxP >= 0 ? "#00E676" : "#FF5252"; ctx.fillText(`Max PnL: ${maxP > 0 ? "+" : ""}${maxP.toFixed(2)} USDT (${mR > 0 ? "+" : ""}${mR.toFixed(2)}%)`, tX, tY); tY += lH;
      ctx.fillStyle = pnl >= 0 ? "#00E676" : "#FF5252"; ctx.fillText(`PnL: ${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${roe > 0 ? "+" : ""}${roe.toFixed(2)}%)`, tX, tY); tY += lH;
      ctx.fillStyle = "#C3C6CE"; ctx.fillText(`Time: ${tStr}`, tX, tY); tY += lH; ctx.fillText(`Bars: ${bC}`, tX, tY); ctx.restore();
    }
  }
}

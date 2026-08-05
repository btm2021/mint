function setupInteractions() {
  const wrapper = document.getElementById("chart-wrapper");
  const isTouch = () => window.matchMedia("(pointer: coarse)").matches;
  const handleSlop = () => (isTouch() ? 28 : 10);
  let activePointerId = null;

  function hitTestRects(logical, price) {
    const slop = handleSlop();
    const priceSlop = Math.abs(candleSeries.coordinateToPrice(0) - candleSeries.coordinateToPrice(slop)) || 0.0001;

    for (let i = drawnRects.length - 1; i >= 0; i--) {
      const r = drawnRects[i];
      const minL = Math.min(r.l1, r.l2), maxL = Math.max(r.l1, r.l2);
      const minP = Math.min(r.p1, r.p2), maxP = Math.max(r.p1, r.p2);

      if (Math.abs(logical - minL) <= slop / 4 && Math.abs(price - maxP) <= priceSlop) return { type: "rect", idx: i, corner: "nw" };
      if (Math.abs(logical - maxL) <= slop / 4 && Math.abs(price - maxP) <= priceSlop) return { type: "rect", idx: i, corner: "ne" };
      if (Math.abs(logical - minL) <= slop / 4 && Math.abs(price - minP) <= priceSlop) return { type: "rect", idx: i, corner: "sw" };
      if (Math.abs(logical - maxL) <= slop / 4 && Math.abs(price - minP) <= priceSlop) return { type: "rect", idx: i, corner: "se" };
      if (logical >= minL && logical <= maxL && price >= minP && price <= maxP) return { type: "rect", idx: i, corner: "move" };
    }
    for (let i = drawnVpRects.length - 1; i >= 0; i--) {
      const v = drawnVpRects[i];
      const minL = Math.min(v.l1, v.l2), maxL = Math.max(v.l1, v.l2);
      if (Math.abs(logical - minL) <= slop / 4) return { type: "vp", idx: i, corner: "w" };
      if (Math.abs(logical - maxL) <= slop / 4) return { type: "vp", idx: i, corner: "e" };
      if (logical >= minL && logical <= maxL) return { type: "vp", idx: i, corner: "move" };
    }
    return null;
  }

  wrapper.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    activePointerId = e.pointerId;
    wrapper.setPointerCapture(e.pointerId);

    const { logical, price } = ptrToChart(e);
    if (logical === null || price === null) return;

    if (measureState.modeActive) {
      if (measureState.step === 0) {
        measureState.startIdx = Math.round(logical);
        measureState.endIdx = measureState.startIdx;
        measureState.step = 1;
      } else if (measureState.step === 1) {
        measureState.endIdx = Math.round(logical);
        measureState.step = 2;
        wrapper.style.cursor = "default";
      } else if (measureState.step === 2) {
        setDrawMode("cursor");
      }
      requestAnimationFrame(drawOverlay);
      return;
    }

    if (drawingModeActive) {
      rectCreateState.active = true;
      rectCreateState.logical1 = logical;
      rectCreateState.price1 = price;
      rectCreateState.logical2 = logical;
      rectCreateState.price2 = price;
      requestAnimationFrame(drawOverlay);
      return;
    }

    if (drawingVPModeActive) {
      vpCreateState.active = true;
      vpCreateState.logical1 = logical;
      vpCreateState.logical2 = logical;
      requestAnimationFrame(drawOverlay);
      return;
    }

    const hit = hitTestRects(logical, price);
    if (hit) {
      selectedRectIndex = -1;
      selectedVpIndex = -1;
      if (hit.type === "rect") {
        selectedRectIndex = hit.idx;
        const r = drawnRects[hit.idx];
        rectDragState.active = true;
        rectDragState.isVp = false;
        rectDragState.index = hit.idx;
        rectDragState.mode = hit.corner;
        rectDragState.startLogical = logical;
        rectDragState.startPrice = price;
        rectDragState.originalLogical1 = r.l1;
        rectDragState.originalLogical2 = r.l2;
        rectDragState.originalPrice1 = r.p1;
        rectDragState.originalPrice2 = r.p2;
      } else {
        selectedVpIndex = hit.idx;
        const v = drawnVpRects[hit.idx];
        rectDragState.active = true;
        rectDragState.isVp = true;
        rectDragState.index = hit.idx;
        rectDragState.mode = hit.corner;
        rectDragState.startLogical = logical;
        rectDragState.originalLogical1 = v.l1;
        rectDragState.originalLogical2 = v.l2;
      }
      chart.applyOptions({ handleScroll: false });
      requestAnimationFrame(drawOverlay);
    } else {
      selectedRectIndex = -1;
      selectedVpIndex = -1;
      requestAnimationFrame(drawOverlay);
    }
  }, true);

  wrapper.addEventListener("pointermove", (e) => {
    if (!e.isPrimary) return;
    const { logical, price } = ptrToChart(e);
    if (logical === null || price === null) return;

    if (rectCreateState.active) {
      rectCreateState.logical2 = logical;
      rectCreateState.price2 = price;
      requestAnimationFrame(drawOverlay);
      return;
    }
    if (vpCreateState.active) {
      vpCreateState.logical2 = logical;
      requestAnimationFrame(drawOverlay);
      return;
    }
    if (rectDragState.active) {
      const logicalDelta = logical - rectDragState.startLogical;
      const { originalLogical1: ol1, originalLogical2: ol2 } = rectDragState;
      const minL = Math.min(ol1, ol2), maxL = Math.max(ol1, ol2);

      if (rectDragState.isVp) {
        const v = drawnVpRects[rectDragState.index];
        if (rectDragState.mode === "move") { v.l1 = ol1 + logicalDelta; v.l2 = ol2 + logicalDelta; }
        else if (rectDragState.mode === "w") { v.l1 = ol1 === minL ? ol1 + logicalDelta : ol1; v.l2 = ol2 === minL ? ol2 + logicalDelta : ol2; }
        else if (rectDragState.mode === "e") { v.l1 = ol1 === maxL ? ol1 + logicalDelta : ol1; v.l2 = ol2 === maxL ? ol2 + logicalDelta : ol2; }
      } else {
        const priceDelta = price - rectDragState.startPrice;
        const rect = drawnRects[rectDragState.index];
        const { originalPrice1: op1, originalPrice2: op2 } = rectDragState;
        const minP = Math.min(op1, op2), maxP = Math.max(op1, op2);
        if (rectDragState.mode === "move") { rect.l1 = ol1 + logicalDelta; rect.l2 = ol2 + logicalDelta; rect.p1 = op1 + priceDelta; rect.p2 = op2 + priceDelta; }
        else if (rectDragState.mode === "nw") { rect.l1 = ol1 === minL ? ol1 + logicalDelta : ol1; rect.l2 = ol2 === minL ? ol2 + logicalDelta : ol2; rect.p1 = op1 === maxP ? op1 + priceDelta : op1; rect.p2 = op2 === maxP ? op2 + priceDelta : op2; }
        else if (rectDragState.mode === "ne") { rect.l1 = ol1 === maxL ? ol1 + logicalDelta : ol1; rect.l2 = ol2 === maxL ? ol2 + logicalDelta : ol2; rect.p1 = op1 === maxP ? op1 + priceDelta : op1; rect.p2 = op2 === maxP ? op2 + priceDelta : op2; }
        else if (rectDragState.mode === "sw") { rect.l1 = ol1 === minL ? ol1 + logicalDelta : ol1; rect.l2 = ol2 === minL ? ol2 + logicalDelta : ol2; rect.p1 = op1 === minP ? op1 + priceDelta : op1; rect.p2 = op2 === minP ? op2 + priceDelta : op2; }
        else if (rectDragState.mode === "se") { rect.l1 = ol1 === maxL ? ol1 + logicalDelta : ol1; rect.l2 = ol2 === maxL ? ol2 + logicalDelta : ol2; rect.p1 = op1 === minP ? op1 + priceDelta : op1; rect.p2 = op2 === minP ? op2 + priceDelta : op2; }
      }
      requestAnimationFrame(drawOverlay);
      return;
    }

    if (!isTouch() && !drawingModeActive && !drawingVPModeActive && !measureState.modeActive && !analyseModeActive) {
      const hit = hitTestRects(logical, price);
      hoveredRectIndex = -1; hoveredVpIndex = -1; hoveredCorner = "";
      if (hit) {
        if (hit.type === "rect") { hoveredRectIndex = hit.idx; hoveredCorner = hit.corner; }
        else { hoveredVpIndex = hit.idx; hoveredCorner = hit.corner; }
        const cur = hit.corner === "move" ? "move" : (hit.corner === "nw" || hit.corner === "se") ? "nwse-resize" : (hit.corner === "ne" || hit.corner === "sw") ? "nesw-resize" : "ew-resize";
        wrapper.style.cursor = cur;
      } else {
        wrapper.style.cursor = "default";
      }
      requestAnimationFrame(drawOverlay);
    }
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!e.isPrimary) return;
    activePointerId = null;
    if (rectCreateState.active) {
      rectCreateState.active = false;
      if (Math.abs(rectCreateState.logical1 - rectCreateState.logical2) > 0.5 && Math.abs(rectCreateState.price1 - rectCreateState.price2) > 0) {
        drawnRects.push({ l1: rectCreateState.logical1, p1: rectCreateState.price1, l2: rectCreateState.logical2, p2: rectCreateState.price2 });
        localStorage.setItem("stat1_drawnRects", JSON.stringify(drawnRects));
      }
      rectCreateState.logical1 = rectCreateState.price1 = rectCreateState.logical2 = rectCreateState.price2 = null;
      requestAnimationFrame(drawOverlay);
    }
    if (vpCreateState.active) {
      vpCreateState.active = false;
      if (Math.abs(vpCreateState.logical1 - vpCreateState.logical2) > 0.5) {
        drawnVpRects.push({ l1: vpCreateState.logical1, l2: vpCreateState.logical2 });
        localStorage.setItem("stat1_drawnVpRects", JSON.stringify(drawnVpRects));
      }
      vpCreateState.logical1 = vpCreateState.logical2 = null;
      requestAnimationFrame(drawOverlay);
    }
    if (rectDragState.active) {
      rectDragState.active = false;
      if (rectDragState.isVp) localStorage.setItem("stat1_drawnVpRects", JSON.stringify(drawnVpRects));
      else localStorage.setItem("stat1_drawnRects", JSON.stringify(drawnRects));
      chart.applyOptions({ handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true } });
      requestAnimationFrame(drawOverlay);
    }
  }, true);

  wrapper.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (measureState.modeActive || drawingModeActive || drawingVPModeActive || analyseModeActive) { setDrawMode("cursor"); analyseModeActive = false; syncSidebarFromState(); return; }
    const { logical, price } = ptrToChart(e);
    if (logical === null || price === null) return;
    const hit = hitTestRects(logical, price);
    if (hit) {
      if (hit.type === "rect") { drawnRects.splice(hit.idx, 1); if (selectedRectIndex === hit.idx) selectedRectIndex = -1; else if (selectedRectIndex > hit.idx) selectedRectIndex--; localStorage.setItem("stat1_drawnRects", JSON.stringify(drawnRects)); }
      else { drawnVpRects.splice(hit.idx, 1); if (selectedVpIndex === hit.idx) selectedVpIndex = -1; else if (selectedVpIndex > hit.idx) selectedVpIndex--; localStorage.setItem("stat1_drawnVpRects", JSON.stringify(drawnVpRects)); }
      requestAnimationFrame(drawOverlay);
    }
  });

  chart.subscribeCrosshairMove((param) => {
    if (param.logical !== undefined && param.logical !== null) {
      lastCrosshairLogical = param.logical;
      if (measureState.modeActive && measureState.step === 1) {
        measureState.endIdx = Math.round(param.logical);
        requestAnimationFrame(drawOverlay);
      }
    } else {
      lastCrosshairLogical = null;
    }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.key === "Shift" || e.key === "ShiftLeft" || e.key === "ShiftRight") && !measureState.modeActive) setDrawMode("measure");
  });

  (function blockBrowserZoom() {
    const wrapper = document.getElementById("chart-wrapper");
    if (!wrapper) return;
    wrapper.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
    wrapper.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
    wrapper.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });
    wrapper.addEventListener("wheel", (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    wrapper.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    wrapper.addEventListener("touchmove", (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  })();
}

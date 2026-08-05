function setDrawMode(mode) {
  drawingModeActive = false;
  drawingVPModeActive = false;
  measureState.modeActive = false;
  measureState.step = 0;
  measureState.startIdx = null;
  measureState.endIdx = null;

  const tDrawVP = document.getElementById("toggle-draw-vp");
  const tDrawRect = document.getElementById("toggle-draw-rect");
  if (tDrawVP) tDrawVP.checked = false;
  if (tDrawRect) tDrawRect.checked = false;

  const wrapper = document.getElementById("chart-wrapper");
  if (wrapper) wrapper.style.cursor = "default";

  if (mode === "rect") {
    drawingModeActive = true;
    if (tDrawRect) tDrawRect.checked = true;
    chart.applyOptions({ handleScroll: false });
  } else if (mode === "vp") {
    drawingVPModeActive = true;
    if (tDrawVP) tDrawVP.checked = true;
    chart.applyOptions({ handleScroll: false });
  } else if (mode === "measure") {
    measureState.modeActive = true;
    chart.applyOptions({ handleScroll: true });
    if (wrapper) wrapper.style.cursor = "crosshair";
  } else if (mode === "analyse") {
    // Handled by analyseModeActive separately, but we reset others here
    chart.applyOptions({ handleScroll: true });
  } else {
    chart.applyOptions({ handleScroll: true });
  }

  requestAnimationFrame(drawOverlay);
  syncSidebarFromState();
}

function syncSidebarFromState() {
  const sbCursor = document.getElementById("sb-cursor");
  const sbRect = document.getElementById("sb-rect");
  const sbVp = document.getElementById("sb-vp");
  const sbMeasure = document.getElementById("sb-measure");
  const sbAnalyse = document.getElementById("sb-analyse");
  const hintEl = document.getElementById("draw-hint");

  [sbCursor, sbRect, sbVp, sbMeasure, sbAnalyse].forEach((b) => {
    if (b) b.classList.remove("active");
  });

  if (drawingModeActive) {
    if (sbRect) sbRect.classList.add("active");
  } else if (drawingVPModeActive) {
    if (sbVp) sbVp.classList.add("active");
  } else if (measureState.modeActive) {
    if (sbMeasure) sbMeasure.classList.add("active");
  } else if (analyseModeActive) {
    if (sbAnalyse) sbAnalyse.classList.add("active");
  } else {
    if (sbCursor) sbCursor.classList.add("active");
  }

  if (hintEl) {
    const isAnyMode = drawingModeActive || drawingVPModeActive || measureState.modeActive || analyseModeActive;
    hintEl.classList.toggle("visible", isAnyMode);
    if (drawingModeActive || drawingVPModeActive) hintEl.textContent = "Tap and drag to draw";
    else if (measureState.modeActive) hintEl.textContent = "Tap start, then tap end";
  }
}

function setupSidebar() {
  const sbCursor = document.getElementById("sb-cursor");
  const sbRect = document.getElementById("sb-rect");
  const sbVp = document.getElementById("sb-vp");
  const sbMeasure = document.getElementById("sb-measure");
  const sbDelete = document.getElementById("sb-delete");

  sbCursor.addEventListener("click", () => setDrawMode("cursor"));
  sbRect.addEventListener("click", () => {
    if (drawingModeActive) setDrawMode("cursor");
    else setDrawMode("rect");
  });
  sbVp.addEventListener("click", () => {
    if (drawingVPModeActive) setDrawMode("cursor");
    else setDrawMode("vp");
  });
  sbMeasure.addEventListener("click", () => {
    if (measureState.modeActive) setDrawMode("cursor");
    else setDrawMode("measure");
  });
  sbDelete.addEventListener("click", () => {
    if (selectedRectIndex !== -1) {
      drawnRects.splice(selectedRectIndex, 1);
      selectedRectIndex = -1;
      hoveredRectIndex = -1;
      localStorage.setItem("stat1_drawnRects", JSON.stringify(drawnRects));
    } else if (selectedVpIndex !== -1) {
      drawnVpRects.splice(selectedVpIndex, 1);
      selectedVpIndex = -1;
      hoveredVpIndex = -1;
      localStorage.setItem("stat1_drawnVpRects", JSON.stringify(drawnVpRects));
    } else if (hoveredRectIndex !== -1) {
      drawnRects.splice(hoveredRectIndex, 1);
      hoveredRectIndex = -1;
      localStorage.setItem("stat1_drawnRects", JSON.stringify(drawnRects));
    } else if (hoveredVpIndex !== -1) {
      drawnVpRects.splice(hoveredVpIndex, 1);
      hoveredVpIndex = -1;
      localStorage.setItem("stat1_drawnVpRects", JSON.stringify(drawnVpRects));
    }
    requestAnimationFrame(drawOverlay);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.tagName !== "INPUT") {
      setDrawMode("cursor");
      analyseModeActive = false;
      syncSidebarFromState();
    }
  });
}


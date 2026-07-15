/* ==========================================================================
   Neotype Studio customizer, live configurator, price calculator, and an
   image editor (drag / zoom / rotate / fit) for placing uploaded artwork.
   Front-end only: no backend, no real payment.
   ========================================================================== */
(function () {
  "use strict";

  var state = {
    finish: "vinyl-matte",
    shape: "die",
    size: 3,
    qty: 100,
    fileName: null,
    fileURL: null,
    dieCutURL: null,   // canvas-generated die-cut (image + smooth contour)
    dieBorder: 26,     // perimeter offset in px (at processing scale)
    dieBorderColor: "#ffffff", // die-cut contour colour (white or black)
    isVector: false,   // uploaded artwork is an SVG (render die-cut at high res)
    bg: "studio",
    // image placement
    img: { x: 0, y: 0, scale: 1, rot: 0, fill: false },
  };
  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Pricing model ----------------------------------------------------
  var FINISH = {
    "vinyl-matte":  { mult: 1.00, label: "Vinyl · matte" },
    "vinyl-gloss":  { mult: 1.05, label: "Vinyl · gloss" },
    "holographic":  { mult: 1.50, label: "Holographic" },
    "glitter":      { mult: 1.45, label: "Glitter" },
    "chrome":       { mult: 1.60, label: "Chrome" },
    "clear":        { mult: 1.15, label: "Clear" },
  };
  var SHAPE_MULT = { die: 1.00, circle: 0.97, square: 0.95, rect: 0.96, rounded: 0.97, sheet: 1.10 };
  var SHAPE_LABEL = { die: "Die-cut", circle: "Circle", square: "Square", rect: "Rectangle", rounded: "Rounded", sheet: "Sheet" };
  var QTY_MULT = { 15: 1.90, 50: 1.35, 100: 1.00, 200: 0.82, 300: 0.72, 500: 0.60, 1000: 0.46 };

  function unitPrice(size, finish, shape, qty) {
    var area = size * size;
    var base = 0.21 * Math.pow(area, 0.82);
    var u = base * FINISH[finish].mult * SHAPE_MULT[shape] * (QTY_MULT[qty] || 1);
    return Math.max(u, 0.30);
  }
  function compute() {
    var unit = unitPrice(state.size, state.finish, state.shape, state.qty);
    var unitAtMin = unitPrice(state.size, state.finish, state.shape, 15);
    return { unit: unit, total: unit * state.qty, savings: Math.round((1 - unit / unitAtMin) * 100) };
  }

  // ---- Preview visuals --------------------------------------------------
  var SIZE_PX = { 2: 120, 3: 162, 4: 208, 5: 250 };
  var FINISH_BG = {
    "vinyl-matte": "linear-gradient(150deg, #06e4dd, #04a49f 45%, #764cd9)",
    "vinyl-gloss": "linear-gradient(140deg, #3af0ea, #06e4dd 45%, #8f6ce6)",
    "clear":       "repeating-conic-gradient(#2b3a44 0% 25%, #223038 0% 50%)",
    "glitter":     "radial-gradient(circle at 38% 30%, #b895ff, #6a3fd6 68%, #4b2bd4)",
  };

  var els = {};
  function $(id) { return document.getElementById(id); }

  // ---- Die-cut generator: trace silhouette, offset perimeter, smooth ----
  function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // separable max-dilation (grows the mask outward by r)
  function dilateMax(src, W, H, r) {
    if (r < 1) return src;
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H), x, y, xx, yy, m, row;
    for (y = 0; y < H; y++) {
      row = y * W;
      for (x = 0; x < W; x++) {
        m = 0; var x0 = x - r < 0 ? 0 : x - r, x1 = x + r >= W ? W - 1 : x + r;
        for (xx = x0; xx <= x1; xx++) { if (src[row + xx] > m) m = src[row + xx]; }
        tmp[row + x] = m;
      }
    }
    for (x = 0; x < W; x++) {
      for (y = 0; y < H; y++) {
        m = 0; var y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= H ? H - 1 : y + r;
        for (yy = y0; yy <= y1; yy++) { if (tmp[yy * W + x] > m) m = tmp[yy * W + x]; }
        out[y * W + x] = m;
      }
    }
    return out;
  }

  // separable box blur (smooths jagged edges into curves)
  function boxBlur(src, W, H, r) {
    if (r < 1) return src;
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H), win = 2 * r + 1, x, y, k, sum, row;
    for (y = 0; y < H; y++) {
      row = y * W; sum = 0;
      for (k = -r; k <= r; k++) sum += src[row + clampi(k, 0, W - 1)];
      for (x = 0; x < W; x++) { tmp[row + x] = sum / win; sum += src[row + clampi(x + r + 1, 0, W - 1)] - src[row + clampi(x - r, 0, W - 1)]; }
    }
    for (x = 0; x < W; x++) {
      sum = 0;
      for (k = -r; k <= r; k++) sum += tmp[clampi(k, 0, H - 1) * W + x];
      for (y = 0; y < H; y++) { out[y * W + x] = sum / win; sum += tmp[clampi(y + r + 1, 0, H - 1) * W + x] - tmp[clampi(y - r, 0, H - 1) * W + x]; }
    }
    return out;
  }

  function hexRGB(h) {
    h = (h || "#ffffff").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  // Generate a die-cut: compute the smooth contour cheaply at low res, then
  // composite it under a HIGH-res raster of the artwork so zooming stays crisp
  // (vector SVGs are rendered large; rasters are not upscaled past native).
  function makeDieCut(url, border, color, isVector, cb) {
    var rgb = hexRGB(color);
    var im = new Image();
    im.onload = function () {
      var nw = im.naturalWidth || 400, nh = im.naturalHeight || 400, ar = nw / nh;
      // hi-res artwork target (crisp when zoomed)
      var HI = 1300;
      var hiW, hiH;
      if (ar >= 1) { hiW = HI; hiH = Math.round(HI / ar); }
      else { hiH = HI; hiW = Math.round(HI * ar); }
      if (!isVector) { // don't upscale a raster beyond its native pixels
        if (hiW > nw) { hiW = nw; hiH = nh; }
      }
      hiW = Math.max(1, hiW); hiH = Math.max(1, hiH);

      // low-res pass for the (expensive) morphology
      var LO = 340;
      var los = Math.min(1, LO / Math.max(hiW, hiH));
      var lw = Math.max(1, Math.round(hiW * los)), lh = Math.max(1, Math.round(hiH * los));
      var b = clampi(Math.round(Math.max(lw, lh) * border / 440), 0, 70);
      var smooth = Math.max(1, Math.round(b * 0.55) + 1);
      var lpad = b + smooth + 4;
      var LW = lw + lpad * 2, LH = lh + lpad * 2;

      var lc = document.createElement("canvas"); lc.width = LW; lc.height = LH;
      var lctx = lc.getContext("2d");
      lctx.drawImage(im, lpad, lpad, lw, lh);
      var ldata = lctx.getImageData(0, 0, LW, LH).data;

      var a = new Float32Array(LW * LH), i, transparentSeen = false;
      for (i = 0; i < LW * LH; i++) { var al = ldata[i * 4 + 3]; a[i] = al; if (al < 250) transparentSeen = true; }
      if (!transparentSeen) { // opaque image -> use its bounding box
        for (i = 0; i < LW * LH; i++) a[i] = 0;
        for (var yy = lpad; yy < lpad + lh; yy++) for (var xx = lpad; xx < lpad + lw; xx++) a[yy * LW + xx] = 255;
      }

      var m = dilateMax(a, LW, LH, b);
      m = boxBlur(m, LW, LH, smooth);
      m = boxBlur(m, LW, LH, Math.ceil(smooth / 2));

      // low-res coloured border mask (soft edges -> upscales cleanly)
      var mc = document.createElement("canvas"); mc.width = LW; mc.height = LH;
      var mim = mc.getContext("2d").createImageData(LW, LH);
      var t = 128, ramp = 30, v, alpha;
      for (i = 0; i < LW * LH; i++) {
        v = m[i];
        alpha = clampi((v - (t - ramp / 2)) / ramp * 255, 0, 255);
        mim.data[i * 4] = rgb[0]; mim.data[i * 4 + 1] = rgb[1]; mim.data[i * 4 + 2] = rgb[2]; mim.data[i * 4 + 3] = alpha;
      }
      mc.getContext("2d").putImageData(mim, 0, 0);

      // hi-res composite: upscaled border under a crisp artwork raster
      var up = hiW / lw, hpad = Math.round(lpad * up);
      var HW = hiW + hpad * 2, HH = hiH + hpad * 2;
      var hc = document.createElement("canvas"); hc.width = HW; hc.height = HH;
      var hctx = hc.getContext("2d");
      hctx.imageSmoothingEnabled = true; hctx.imageSmoothingQuality = "high";
      hctx.drawImage(mc, 0, 0, LW, LH, 0, 0, HW, HH);
      hctx.drawImage(im, hpad, hpad, hiW, hiH);
      try { cb(hc.toDataURL("image/png")); } catch (e) { cb(null); }
    };
    im.onerror = function () { cb(null); };
    im.src = url;
  }

  var dieTimer = null;
  function regenDieCut(immediate) {
    if (!state.fileURL) { state.dieCutURL = null; return; }
    clearTimeout(dieTimer);
    var run = function () {
      makeDieCut(state.fileURL, state.dieBorder, state.dieBorderColor, state.isVector, function (dataUrl) {
        state.dieCutURL = dataUrl;
        if (state.shape === "die") renderPreview();
      });
    };
    if (immediate) run(); else dieTimer = setTimeout(run, 180);
  }

  function applyImgTransform() {
    var img = els.artwork && els.artwork.querySelector("img.cz-img");
    if (!img) return;
    var i = state.img;
    img.style.objectFit = i.fill ? "cover" : "contain";
    img.style.transform =
      "translate(-50%, -50%) translate(" + i.x + "px, " + i.y + "px) scale(" + i.scale + ") rotate(" + i.rot + "deg)";
  }

  function renderPreview() {
    var art = els.artwork;
    if (!art) return;

    var hasImg = !!state.fileURL;
    var die = state.shape === "die";
    var dieEmpty = die && !hasImg;   // die-cut with no art -> prompt state
    var dieLive = die && hasImg;     // die-cut with art -> cut around the art

    var cls = "cz-artwork shape-" + state.shape;
    if (hasImg) cls += " has-img";
    if (dieEmpty) cls += " die-empty";
    if (dieLive) cls += " die-live";
    art.className = cls;

    var px = SIZE_PX[state.size] || 162;
    var h = px;
    if (state.shape === "sheet") h = Math.round(px * 0.78);
    else if (state.shape === "rect") h = Math.round(px * 0.66);
    art.style.width = px + "px";
    art.style.height = h + "px";

    // finish material: shown for fixed shapes; die-cut carries no fill (it is the art)
    art.classList.remove("cz-holo", "cz-chrome", "cz-glitter");
    if (die) {
      art.style.background = "";
    } else if (state.finish === "holographic") { art.style.background = ""; art.classList.add("cz-holo"); }
    else if (state.finish === "chrome") { art.style.background = ""; art.classList.add("cz-chrome"); }
    else if (state.finish === "glitter") { art.style.background = FINISH_BG.glitter; art.classList.add("cz-glitter"); }
    else { art.style.background = FINISH_BG[state.finish] || FINISH_BG["vinyl-matte"]; }

    var img = art.querySelector("img.cz-img");
    if (hasImg) {
      if (!img) { img = document.createElement("img"); img.className = "cz-img"; img.alt = "Your artwork preview"; art.appendChild(img); }
      img.src = (dieLive && state.dieCutURL) ? state.dieCutURL : state.fileURL;
      applyImgTransform();
      if (els.artLabel) els.artLabel.style.display = "none";
    } else {
      if (img) img.remove();
      if (els.artLabel) {
        els.artLabel.style.display = "";
        els.artLabel.textContent = dieEmpty
          ? "Die-cut preview appears once you drop your file in ↑"
          : (state.shape === "sheet" ? "Drop your designs to preview" : "Drop your art to preview");
        els.artLabel.style.color = state.bg === "white" ? "rgba(10,12,14,.6)" : "rgba(255,255,255,.85)";
      }
    }

    var sizeText = state.size + " in";
    if (els.labelW) els.labelW.textContent = state.shape === "sheet" ? "sheet" : sizeText;
    if (els.labelH) els.labelH.textContent = sizeText;

    if (els.paper) {
      els.paper.classList.remove("pg-white", "pg-black");
      if (state.bg === "white") els.paper.classList.add("pg-white");
      else if (state.bg === "black") els.paper.classList.add("pg-black");
    }

    if (els.borderRow) els.borderRow.hidden = !(die && hasImg);
    if (els.borderColorRow) els.borderColorRow.hidden = !(die && hasImg);
  }

  // ---- Price render -----------------------------------------------------
  function renderPrice() {
    var r = compute();
    if (els.priceTotal) animateNumber(els.priceTotal, Math.round(r.total));
    if (els.pricePer) els.pricePer.textContent = "$" + r.unit.toFixed(2);
    if (els.priceNote) els.priceNote.textContent = state.qty + " × " + state.size + "″ " + SHAPE_LABEL[state.shape].toLowerCase();
    if (els.savings) {
      if (r.savings > 0) { els.savings.style.display = ""; els.savings.textContent = "You save " + r.savings + "% vs. 15-pack"; }
      else { els.savings.style.display = "none"; }
    }
  }
  var numTimers = {};
  function animateNumber(el, target) {
    var id = el.id || "n";
    if (numTimers[id]) cancelAnimationFrame(numTimers[id]);
    var start = parseInt(el.textContent.replace(/[^0-9]/g, ""), 10) || 0;
    if (start === target) { el.textContent = target; return; }
    var t0 = null, dur = 320;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (p < 1) numTimers[id] = requestAnimationFrame(step);
    }
    numTimers[id] = requestAnimationFrame(step);
  }

  function renderLabels() {
    setTxt("czFinishVal", FINISH[state.finish].label);
    setTxt("czShapeVal", SHAPE_LABEL[state.shape]);
    setTxt("czSizeVal", state.size + " × " + state.size + " in");
    setTxt("czQtyVal", state.qty.toLocaleString() + " stickers");
  }
  function setTxt(id, t) { var e = $(id); if (e) e.textContent = t; }
  function renderAll() { renderPreview(); renderPrice(); renderLabels(); }

  // ---- Option groups ----------------------------------------------------
  function wireGroup(containerId, attr, onPick) {
    var el = $(containerId);
    if (!el) return;
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("button[" + attr + "]");
      if (!btn) return;
      el.querySelectorAll("button[" + attr + "]").forEach(function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      onPick(btn.getAttribute(attr));
    });
  }

  // ---- Image editor -----------------------------------------------------
  function showEditor(show) {
    if (els.editor) els.editor.hidden = !show;
  }
  var XY_MAX = 200;
  function syncEditorInputs() {
    if (els.zoom) els.zoom.value = state.img.scale;
    if (els.rot) els.rot.value = state.img.rot;
    if (els.x) els.x.value = Math.round(state.img.x);
    if (els.y) els.y.value = Math.round(state.img.y);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function resetPlacement(mode) {
    var i = state.img;
    if (mode === "center") { i.x = 0; i.y = 0; }
    else if (mode === "fill") { i.fill = true; i.x = 0; i.y = 0; i.scale = 1; i.rot = 0; }
    else if (mode === "fit") { i.fill = false; i.x = 0; i.y = 0; i.scale = 1; i.rot = 0; }
    else { i.fill = false; i.x = 0; i.y = 0; i.scale = 1; i.rot = 0; } // reset
    syncEditorInputs();
    applyImgTransform();
  }

  function wireImageEditor() {
    // drag to move
    var art = els.artwork;
    if (art) {
      var dragging = false, startX = 0, startY = 0, ox = 0, oy = 0;
      art.addEventListener("pointerdown", function (e) {
        if (!art.classList.contains("has-img")) return;
        dragging = true; art.classList.add("dragging");
        startX = e.clientX; startY = e.clientY; ox = state.img.x; oy = state.img.y;
        try { art.setPointerCapture(e.pointerId); } catch (_) {}
      });
      art.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        state.img.x = clamp(ox + (e.clientX - startX), -XY_MAX, XY_MAX);
        state.img.y = clamp(oy + (e.clientY - startY), -XY_MAX, XY_MAX);
        syncEditorInputs();
        applyImgTransform();
      });
      function endDrag(e) {
        if (!dragging) return;
        dragging = false; art.classList.remove("dragging");
        try { art.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      art.addEventListener("pointerup", endDrag);
      art.addEventListener("pointercancel", endDrag);

      // wheel to zoom (only when hovering art with an image)
      art.addEventListener("wheel", function (e) {
        if (!art.classList.contains("has-img")) return;
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.08 : 0.926;
        state.img.scale = clamp(state.img.scale * factor, 0.2, 4);
        syncEditorInputs();
        applyImgTransform();
      }, { passive: false });
    }

    if (els.zoom) els.zoom.addEventListener("input", function () {
      state.img.scale = clamp(parseFloat(els.zoom.value) || 1, 0.2, 4); applyImgTransform();
    });
    if (els.rot) els.rot.addEventListener("input", function () {
      state.img.rot = parseInt(els.rot.value, 10) || 0; applyImgTransform();
    });
    if (els.x) els.x.addEventListener("input", function () {
      state.img.x = clamp(parseInt(els.x.value, 10) || 0, -XY_MAX, XY_MAX); applyImgTransform();
    });
    if (els.y) els.y.addEventListener("input", function () {
      state.img.y = clamp(parseInt(els.y.value, 10) || 0, -XY_MAX, XY_MAX); applyImgTransform();
    });
    if (els.border) els.border.addEventListener("input", function () {
      state.dieBorder = parseInt(els.border.value, 10) || 0; regenDieCut();
    });
    if (els.editor) els.editor.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-fit]");
      if (b) resetPlacement(b.getAttribute("data-fit"));
    });
  }

  // ---- Proof preview (loading -> mockup) --------------------------------
  var proofTimer = null;
  function chip(t) { return '<span class="proof-chip">' + t + '</span>'; }
  function openProof() {
    var m = els.proofModal; if (!m) return;
    m.hidden = false; m.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (els.proofLoading) els.proofLoading.hidden = false;
    if (els.proofResult) els.proofResult.hidden = true;
    clearTimeout(proofTimer);
    proofTimer = setTimeout(buildProofResult, 1700);
  }
  function buildProofResult() {
    if (els.proofStage && els.artwork) {
      els.proofStage.innerHTML = "";
      els.proofStage.classList.remove("pg-white", "pg-black");
      if (state.bg === "white") els.proofStage.classList.add("pg-white");
      else if (state.bg === "black") els.proofStage.classList.add("pg-black");

      var clone = els.artwork.cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.remove("dragging");
      clone.classList.add("proofed");
      if (state.finish === "vinyl-matte" || state.finish === "clear") clone.classList.add("matte");
      clone.style.transform = "";
      var shine = document.createElement("span");
      shine.className = "proof-shine2";
      clone.appendChild(shine);
      els.proofStage.appendChild(clone);
    }
    var r = compute();
    if (els.proofSummary) {
      els.proofSummary.innerHTML =
        chip(FINISH[state.finish].label) +
        chip(SHAPE_LABEL[state.shape]) +
        chip(state.size + "×" + state.size + "″") +
        chip(state.qty.toLocaleString() + " stickers") +
        '<span class="proof-chip price"><b>$' + Math.round(r.total) + "</b> total</span>";
    }
    if (els.proofLoading) els.proofLoading.hidden = true;
    if (els.proofResult) els.proofResult.hidden = false;
  }
  function closeProof() {
    var m = els.proofModal; if (!m) return;
    m.hidden = true; m.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    clearTimeout(proofTimer);
  }
  function wireProofTilt() {
    var st = els.proofStage; if (!st) return;
    st.addEventListener("pointermove", function (e) {
      var c = st.querySelector(".cz-artwork"); if (!c) return;
      var r = st.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      if (!reduceMotion) {
        c.style.setProperty("--pry", ((px - 0.5) * 26).toFixed(2) + "deg");
        c.style.setProperty("--prx", ((0.5 - py) * 26).toFixed(2) + "deg");
      }
      c.style.setProperty("--pmx", (px * 100).toFixed(1) + "%");
      c.style.setProperty("--pmy", (py * 100).toFixed(1) + "%");
    });
    st.addEventListener("pointerleave", function () {
      var c = st.querySelector(".cz-artwork"); if (!c) return;
      c.style.setProperty("--prx", "0deg"); c.style.setProperty("--pry", "0deg");
    });
  }
  function wireProof() {
    var open = $("previewSticker");
    if (open) open.addEventListener("click", openProof);
    wireProofTilt();
    var m = els.proofModal;
    if (m) m.addEventListener("click", function (e) {
      if (e.target.closest("[data-proof-close]")) closeProof();
    });
    var addInProof = $("proofAddCart");
    if (addInProof) addInProof.addEventListener("click", function () {
      var r = compute();
      closeProof();
      window.dispatchEvent(new CustomEvent("neotype:toast", {
        detail: "Added " + state.qty + " × " + state.size + "″ " + FINISH[state.finish].label + ", $" + Math.round(r.total)
      }));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && m && !m.hidden) closeProof();
    });
  }

  // ---- File upload ------------------------------------------------------
  function wireUpload() {
    var dz = $("dropzone"), input = $("fileInput");
    var fileLine = $("dzFile"), fileState = $("czFileState");
    if (!dz || !input) return;

    function accept(file) {
      if (!file) return;
      if (state.fileURL) { try { URL.revokeObjectURL(state.fileURL); } catch (_) {} }
      state.fileName = file.name;
      state.isVector = /svg/i.test(file.type) || /\.svg$/i.test(file.name || "");
      state.fileURL = /^image\//.test(file.type) ? URL.createObjectURL(file) : null;
      if (fileLine) { fileLine.hidden = false; fileLine.textContent = "✓ " + file.name; }
      if (fileState) fileState.textContent = "uploaded";
      // reset placement for the new image
      state.img = { x: 0, y: 0, scale: 1, rot: 0, fill: false };
      state.dieCutURL = null;
      syncEditorInputs();
      renderPreview();
      showEditor(!!state.fileURL);
      if (state.fileURL) regenDieCut(true);
      if (!state.fileURL) {
        // non-image file (PDF/AI): still note it, but no visual editor
        window.dispatchEvent(new CustomEvent("neotype:toast", { detail: "Got " + file.name + ", we'll render a proof from it" }));
      }
    }

    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", function () { accept(input.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); }); });
    dz.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) accept(e.dataTransfer.files[0]); });
  }

  // ---- Cart -------------------------------------------------------------
  function wireActions() {
    var add = $("addCart");
    if (add) add.addEventListener("click", function () {
      var r = compute();
      window.dispatchEvent(new CustomEvent("neotype:toast", {
        detail: "Added " + state.qty + " × " + state.size + "″ " + FINISH[state.finish].label + ", $" + Math.round(r.total)
      }));
    });
  }

  // ---- Init -------------------------------------------------------------
  function init() {
    els = {
      artwork: $("czArtwork"), artLabel: $("czArtLabel"), paper: $("czPaper"),
      labelW: $("czLabelW"), labelH: $("czLabelH"),
      priceTotal: $("priceTotal"), pricePer: $("pricePer"), priceNote: $("priceQtyNote"), savings: $("czSavings"),
      editor: $("czEditor"), zoom: $("ceZoom"), rot: $("ceRot"), x: $("ceX"), y: $("ceY"),
      border: $("ceBorder"), borderRow: $("ceBorderRow"), borderColorRow: $("ceBorderColorRow"),
      proofModal: $("proofModal"), proofLoading: $("proofLoading"), proofResult: $("proofResult"),
      proofStage: $("proofStage"), proofSummary: $("proofSummary"),
    };
    wireGroup("finishOpts", "data-finish", function (v) { state.finish = v; renderAll(); });
    wireGroup("shapeOpts", "data-shape", function (v) {
      state.shape = v;
      if (v === "die" && state.fileURL && !state.dieCutURL) regenDieCut(true);
      renderAll();
    });
    wireGroup("sizeOpts", "data-size", function (v) { state.size = parseInt(v, 10); renderAll(); });
    wireGroup("qtyOpts", "data-qty", function (v) { state.qty = parseInt(v, 10); renderAll(); });
    wireGroup("bgOpts", "data-bg", function (v) { state.bg = v; renderPreview(); });
    wireGroup("borderColorOpts", "data-bcol", function (v) { state.dieBorderColor = v; regenDieCut(true); });
    wireUpload();
    wireImageEditor();
    wireActions();
    wireProof();
    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

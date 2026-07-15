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
      img.src = state.fileURL;
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
      state.fileURL = /^image\//.test(file.type) ? URL.createObjectURL(file) : null;
      if (fileLine) { fileLine.hidden = false; fileLine.textContent = "✓ " + file.name; }
      if (fileState) fileState.textContent = "uploaded";
      // reset placement for the new image
      state.img = { x: 0, y: 0, scale: 1, rot: 0, fill: false };
      syncEditorInputs();
      renderPreview();
      showEditor(!!state.fileURL);
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
      proofModal: $("proofModal"), proofLoading: $("proofLoading"), proofResult: $("proofResult"),
      proofStage: $("proofStage"), proofSummary: $("proofSummary"),
    };
    wireGroup("finishOpts", "data-finish", function (v) { state.finish = v; renderAll(); });
    wireGroup("shapeOpts", "data-shape", function (v) { state.shape = v; renderAll(); });
    wireGroup("sizeOpts", "data-size", function (v) { state.size = parseInt(v, 10); renderAll(); });
    wireGroup("qtyOpts", "data-qty", function (v) { state.qty = parseInt(v, 10); renderAll(); });
    wireGroup("bgOpts", "data-bg", function (v) { state.bg = v; renderPreview(); });
    wireUpload();
    wireImageEditor();
    wireActions();
    wireProof();
    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

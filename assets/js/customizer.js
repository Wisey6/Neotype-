/* ==========================================================================
   Neotype customizer — live sticker configurator + price calculator
   Front-end only: no backend, no real payment. Prices are illustrative but
   follow a consistent, plausible model (area + finish + quantity discount).
   ========================================================================== */
(function () {
  "use strict";

  var state = {
    finish: "vinyl-matte",
    shape: "die",
    size: 3,       // inches (square)
    qty: 100,
    fileName: null,
    fileURL: null,
  };

  // ---- Pricing model ----------------------------------------------------
  var FINISH = {
    "vinyl-matte":  { mult: 1.00, label: "Vinyl · matte" },
    "vinyl-gloss":  { mult: 1.05, label: "Vinyl · gloss" },
    "holographic":  { mult: 1.50, label: "Holographic" },
    "glitter":      { mult: 1.45, label: "Glitter" },
    "chrome":       { mult: 1.60, label: "Chrome" },
    "clear":        { mult: 1.15, label: "Clear" },
  };
  var SHAPE_MULT = { die: 1.00, circle: 0.97, square: 0.95, rounded: 0.97, sheet: 1.10 };
  var SHAPE_LABEL = { die: "Die-cut", circle: "Circle", square: "Square", rounded: "Rounded", sheet: "Sheet" };
  // quantity discount curve (per-unit multiplier vs the 100-unit baseline)
  var QTY_MULT = { 15: 1.90, 50: 1.35, 100: 1.00, 200: 0.82, 300: 0.72, 500: 0.60, 1000: 0.46 };

  function unitPrice(size, finish, shape, qty) {
    var area = size * size;                     // square inches
    var areaFactor = Math.pow(area, 0.82);      // soften large sizes
    var base = 0.21 * areaFactor;
    var u = base * FINISH[finish].mult * SHAPE_MULT[shape] * (QTY_MULT[qty] || 1);
    return Math.max(u, 0.30);                    // per-sticker floor
  }

  function compute() {
    var unit = unitPrice(state.size, state.finish, state.shape, state.qty);
    var total = unit * state.qty;
    // savings vs the smallest-quantity (most expensive) per-unit price
    var unitAtMin = unitPrice(state.size, state.finish, state.shape, 15);
    var savings = Math.round((1 - unit / unitAtMin) * 100);
    return { unit: unit, total: total, savings: savings };
  }

  // ---- Preview visuals --------------------------------------------------
  var SIZE_PX = { 2: 120, 3: 162, 4: 208, 5: 250 };
  var FINISH_BG = {
    "vinyl-matte": "radial-gradient(circle at 32% 28%, #4b49ff, #2e2bf5 60%, #1a18b0)",
    "vinyl-gloss": "linear-gradient(140deg, #6d6bff, #2e2bf5 55%, #1a18b0)",
    "clear":       "linear-gradient(135deg, rgba(46,43,245,.55), rgba(236,0,140,.5))",
    "glitter":     "radial-gradient(#ff8ad4, #d63aa0)",
  };

  function renderPreview() {
    var art = document.getElementById("czArtwork");
    var paper = document.getElementById("czPaper");
    var labelW = document.getElementById("czLabelW");
    var labelH = document.getElementById("czLabelH");
    var artLabel = document.getElementById("czArtLabel");
    if (!art) return;

    // shape class
    art.className = "cz-artwork shape-" + state.shape;

    // size
    var px = SIZE_PX[state.size] || 162;
    art.style.width = px + "px";
    art.style.height = (state.shape === "sheet" ? Math.round(px * 0.78) : px) + "px";

    // finish background (animated finishes get a helper class)
    art.classList.remove("fin-holo", "fin-chrome", "fin-glitter");
    if (state.finish === "holographic") {
      art.style.background = ""; art.classList.add("fin-holo");
    } else if (state.finish === "chrome") {
      art.style.background = ""; art.classList.add("fin-chrome");
    } else if (state.finish === "glitter") {
      art.style.background = FINISH_BG.glitter; art.classList.add("fin-glitter");
    } else {
      art.style.background = FINISH_BG[state.finish] || FINISH_BG["vinyl-matte"];
    }

    // uploaded artwork
    var existing = art.querySelector("img");
    if (state.fileURL) {
      if (!existing) {
        existing = document.createElement("img");
        art.appendChild(existing);
      }
      existing.src = state.fileURL;
      existing.alt = "Your uploaded artwork preview";
      if (artLabel) artLabel.style.display = "none";
    } else {
      if (existing) existing.remove();
      if (artLabel) {
        artLabel.style.display = "";
        artLabel.textContent = state.shape === "sheet" ? "Your designs here" : "Your design here";
        artLabel.style.color = (state.finish === "chrome") ? "#26232e" : "#fff";
      }
    }

    // scale labels
    var sizeText = state.size + " in";
    if (labelW) labelW.textContent = state.shape === "sheet" ? "sheet" : sizeText;
    if (labelH) labelH.textContent = sizeText;
  }

  // ---- Price render -----------------------------------------------------
  function renderPrice() {
    var r = compute();
    var total = document.getElementById("priceTotal");
    var per = document.getElementById("pricePer");
    var note = document.getElementById("priceQtyNote");
    var savings = document.getElementById("czSavings");

    if (total) animateNumber(total, Math.round(r.total));
    if (per) per.textContent = "$" + r.unit.toFixed(2);
    if (note) note.textContent = state.qty + " × " + state.size + "″ " + SHAPE_LABEL[state.shape].toLowerCase();
    if (savings) {
      if (r.savings > 0) {
        savings.style.display = "";
        savings.textContent = "You save " + r.savings + "% vs. 15-pack";
      } else {
        savings.style.display = "none";
      }
    }
  }

  var numTimers = {};
  function animateNumber(el, target) {
    var id = el.id;
    if (numTimers[id]) cancelAnimationFrame(numTimers[id]);
    var start = parseInt(el.textContent.replace(/[^0-9]/g, ""), 10) || 0;
    if (start === target) { el.textContent = target; return; }
    var t0 = null, dur = 320;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (p < 1) numTimers[id] = requestAnimationFrame(step);
    }
    numTimers[id] = requestAnimationFrame(step);
  }

  // ---- Labels in control headers ---------------------------------------
  function renderLabels() {
    set("czFinishVal", FINISH[state.finish].label);
    set("czShapeVal", SHAPE_LABEL[state.shape]);
    set("czSizeVal", state.size + " × " + state.size + " in");
    set("czQtyVal", state.qty.toLocaleString() + " stickers");
  }
  function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }

  function renderAll() { renderPreview(); renderPrice(); renderLabels(); }

  // ---- Option group wiring ---------------------------------------------
  function wireGroup(containerId, attr, onPick) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("button[" + attr + "]");
      if (!btn) return;
      var buttons = el.querySelectorAll("button[" + attr + "]");
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      onPick(btn.getAttribute(attr));
    });
  }

  // ---- File upload ------------------------------------------------------
  function wireUpload() {
    var dz = document.getElementById("dropzone");
    var input = document.getElementById("fileInput");
    var fileLine = document.getElementById("dzFile");
    var fileState = document.getElementById("czFileState");
    if (!dz || !input) return;

    function accept(file) {
      if (!file) return;
      if (state.fileURL) { try { URL.revokeObjectURL(state.fileURL); } catch (_) {} }
      state.fileName = file.name;
      // preview only image types; other formats show a filename chip
      state.fileURL = /^image\//.test(file.type) ? URL.createObjectURL(file) : null;
      if (fileLine) { fileLine.hidden = false; fileLine.textContent = "✓ " + file.name; }
      if (fileState) fileState.textContent = "uploaded";
      renderPreview();
    }

    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { accept(input.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) accept(e.dataTransfer.files[0]);
    });
  }

  // ---- Cart / proof actions --------------------------------------------
  function wireActions() {
    var add = document.getElementById("addCart");
    var proof = document.getElementById("getProof");
    if (add) add.addEventListener("click", function () {
      var r = compute();
      window.dispatchEvent(new CustomEvent("neotype:toast", {
        detail: "Added " + state.qty + " × " + state.size + "″ " + FINISH[state.finish].label + " — $" + Math.round(r.total)
      }));
    });
    if (proof) proof.addEventListener("click", function () {
      var msg = state.fileName
        ? "Proof requested for " + state.fileName + " — check your email within a day"
        : "Upload artwork above and we'll send a free proof within a day";
      window.dispatchEvent(new CustomEvent("neotype:toast", { detail: msg }));
    });
  }

  // ---- Init -------------------------------------------------------------
  function init() {
    wireGroup("finishOpts", "data-finish", function (v) { state.finish = v; renderAll(); });
    wireGroup("shapeOpts", "data-shape", function (v) { state.shape = v; renderAll(); });
    wireGroup("sizeOpts", "data-size", function (v) { state.size = parseInt(v, 10); renderAll(); });
    wireGroup("qtyOpts", "data-qty", function (v) { state.qty = parseInt(v, 10); renderAll(); });
    wireUpload();
    wireActions();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();

/* ==========================================================================
   Neotype large-format builder (banners, corflute). One module, driven by
   window.LF_PRODUCT set on each page. Renders a live preview + options + price
   and checks out through the same Stripe Worker as the sticker customizer.
   Pricing here MUST match worker/src/index.js (LF table). See PRICING.md.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.LF_PRODUCT;
  var root = document.getElementById("lfRoot");
  if (!CFG || !root) return;

  var state = {
    w: CFG.defaultW, h: CFG.defaultH, qty: CFG.qtys[0],
    choices: {}, file: null, fileName: null, fileURL: null,
    img: { x: 0, y: 0, scale: 1, rot: 0, fill: false }
  };
  Object.keys(CFG.choices).forEach(function (k) { state.choices[k] = Object.keys(CFG.choices[k].opts)[0]; });

  function fmt(n) { return "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // bulk discount: per-unit price falls as quantity rises (matches the trade
  // quantity breaks). qty 1 -> 1.00, 10 -> ~0.85, 25 -> ~0.72, 50 -> ~0.63.
  function qtyMult(q) { return 0.6 + 0.4 * Math.exp(-(q - 1) / 20); }
  function price() {
    var mult = 1;
    Object.keys(CFG.choices).forEach(function (k) {
      var o = CFG.choices[k].opts[state.choices[k]];
      if (o) mult *= o.mult;
    });
    var area = state.w * state.h;
    return Math.max(CFG.min, area * CFG.rate * mult * state.qty * qtyMult(state.qty));
  }

  // ---- markup -----------------------------------------------------------
  function optRow(id, opts, current, attr) {
    var html = '<div class="opt-row" id="' + id + '">';
    opts.forEach(function (o) {
      html += '<button class="opt" ' + attr + '="' + o.v + '" aria-pressed="' + (o.v === current ? "true" : "false") + '">' + o.label + "</button>";
    });
    return html + "</div>";
  }

  function build() {
    var presetOpts = (CFG.presets || []).map(function (p, i) { return { v: String(i), label: p.label }; });
    var qtyOpts = CFG.qtys.map(function (q) { return { v: String(q), label: String(q) }; });

    var choicesHtml = "";
    Object.keys(CFG.choices).forEach(function (k) {
      var c = CFG.choices[k];
      var opts = Object.keys(c.opts).map(function (v) { return { v: v, label: c.opts[v].label }; });
      choicesHtml += '<div class="field"><label>' + c.label + ' <b id="lfval-' + k + '"></b></label>' +
        optRow("lfchoice-" + k, opts, state.choices[k], "data-lfc-" + k) + "</div>";
    });

    root.className = "customizer";
    root.innerHTML =
      '<div class="cz-preview">' +
        '<div class="cz-paper" id="lfPaper">' +
          '<div class="lf-rect" id="lfRect"><span class="up-hint" id="lfHint">Drop your artwork to preview</span></div>' +
          '<div class="lf-size-cap" id="lfSizeCap"></div>' +
        '</div>' +
        '<div class="dropzone" id="lfDrop" tabindex="0" role="button" aria-label="Upload your artwork" style="margin-top:16px">' +
          '<span class="dz-ic" aria-hidden="true">↑</span>' +
          '<span class="dz-txt"><strong>Drop your file or browse</strong><br>' +
          '<small>PNG, JPG, PDF, SVG or AI · print-ready at final size</small>' +
          '<div class="dz-file" id="lfFile" hidden></div></span>' +
          '<input type="file" id="lfInput" accept=".png,.jpg,.jpeg,.pdf,.svg,.ai" hidden></div>' +
        '<div class="cz-editor" id="lfEditor" hidden>' +
          '<div class="ce-hint">✥ Drag the art, use the sliders, or scroll to zoom</div>' +
          '<div class="ce-row"><label for="lfZoom">Zoom</label><input type="range" id="lfZoom" min="0.2" max="4" step="0.01" value="1"></div>' +
          '<div class="ce-row"><label for="lfRotr">Rotate</label><input type="range" id="lfRotr" min="-180" max="180" step="1" value="0"></div>' +
          '<div class="ce-row"><label for="lfMx">Move ↔</label><input type="range" id="lfMx" min="-220" max="220" step="1" value="0"></div>' +
          '<div class="ce-row"><label for="lfMy">Move ↕</label><input type="range" id="lfMy" min="-220" max="220" step="1" value="0"></div>' +
          '<div class="ce-btns"><button class="ce-mini" data-lffit="fit">Fit</button><button class="ce-mini" data-lffit="fill">Fill</button><button class="ce-mini" data-lffit="center">Center</button><button class="ce-mini" data-lffit="reset">Reset</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="cz-controls">' +
        '<h3>' + CFG.title + '</h3><p class="cz-sub">' + CFG.blurb + '</p>' +
        (presetOpts.length ? '<div class="field"><label>Common sizes</label>' + optRow("lfPresets", presetOpts, "", "data-lfpreset") + "</div>" : "") +
        '<div class="field"><label>Custom size <b id="lfSizeVal"></b></label>' +
          '<div class="lf-dims">' +
            '<span><input type="number" id="lfW" step="0.05" min="' + CFG.wRange[0] + '" max="' + CFG.wRange[1] + '" value="' + state.w + '"> m wide</span>' +
            '<span><input type="number" id="lfH" step="0.05" min="' + CFG.hRange[0] + '" max="' + CFG.hRange[1] + '" value="' + state.h + '"> m tall</span>' +
          '</div>' +
          '<p class="opt-help">Between ' + CFG.wRange[0] + '–' + CFG.wRange[1] + ' m wide and ' + CFG.hRange[0] + '–' + CFG.hRange[1] + ' m tall.</p>' +
        "</div>" +
        choicesHtml +
        '<div class="field"><label>Quantity <b id="lfQtyVal"></b></label>' + optRow("lfQtys", qtyOpts, String(state.qty), "data-lfqty") + "</div>" +
        '<div class="cz-price"><div class="price-row">' +
          '<div class="price-total"><sup>$</sup><span id="lfTotal">0</span> <span style="font-family:var(--font-round);font-size:.9rem;color:var(--muted)">AUD</span></div>' +
          '<div class="price-per"><div><b id="lfPer">$0</b> / unit</div><div id="lfNote"></div></div>' +
        "</div></div>" +
        '<div class="cz-actions"><button class="btn btn--accent" id="lfCheckout">Add &amp; check out <span class="arrow">→</span></button></div>' +
        '<p class="opt-help" style="text-align:center">Free digital proof before print · ships in ~4 business days</p>' +
      "</div>";
  }

  // ---- render -----------------------------------------------------------
  function render() {
    // preview rectangle sized to aspect, capped
    var rect = document.getElementById("lfRect");
    var maxW = 320, maxH = 300;
    var ar = state.w / state.h;
    var pw = maxW, ph = maxW / ar;
    if (ph > maxH) { ph = maxH; pw = maxH * ar; }
    rect.style.width = Math.round(pw) + "px";
    rect.style.height = Math.round(ph) + "px";
    document.getElementById("lfSizeCap").textContent = state.w.toFixed(2) + " × " + state.h.toFixed(2) + " m";
    setTxt("lfSizeVal", state.w.toFixed(2) + " × " + state.h.toFixed(2) + " m");
    setTxt("lfQtyVal", state.qty + (state.qty === 1 ? " unit" : " units"));
    Object.keys(CFG.choices).forEach(function (k) { setTxt("lfval-" + k, CFG.choices[k].opts[state.choices[k]].label); });

    var total = price(), per = total / state.qty;
    setTxt("lfTotal", Math.round(total).toLocaleString());
    setTxt("lfPer", fmt(per));
    setTxt("lfNote", state.qty + " × " + state.w.toFixed(2) + "×" + state.h.toFixed(2) + " m");
  }
  function setTxt(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

  function showArt() {
    var rect = document.getElementById("lfRect");
    var img = rect.querySelector("img.lf-img");
    var hint = document.getElementById("lfHint");
    if (state.fileURL) {
      if (!img) { img = document.createElement("img"); img.className = "lf-img"; img.alt = "Your artwork"; rect.appendChild(img); }
      img.src = state.fileURL;
      if (hint) hint.style.display = "none";
      applyImgTransform();
    } else {
      if (img) img.remove();
      if (hint) hint.style.display = "";
    }
    showEditor(!!state.fileURL);
  }

  function applyImgTransform() {
    var img = document.querySelector("#lfRect img.lf-img");
    if (!img) return;
    var i = state.img;
    img.style.objectFit = i.fill ? "cover" : "contain";
    img.style.transform = "translate(-50%, -50%) translate(" + i.x + "px, " + i.y + "px) scale(" + i.scale + ") rotate(" + i.rot + "deg)";
  }
  function showEditor(on) { var e = document.getElementById("lfEditor"); if (e) e.hidden = !on; }
  function syncEditor() {
    var z = document.getElementById("lfZoom"), r = document.getElementById("lfRotr"),
        x = document.getElementById("lfMx"), y = document.getElementById("lfMy");
    if (z) z.value = state.img.scale; if (r) r.value = state.img.rot;
    if (x) x.value = state.img.x; if (y) y.value = state.img.y;
  }

  // ---- wiring -----------------------------------------------------------
  function pressGroup(containerId, attr, val) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.querySelectorAll("button[" + attr + "]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute(attr) === val ? "true" : "false");
    });
  }

  function wire() {
    var wIn = document.getElementById("lfW"), hIn = document.getElementById("lfH");
    function syncDims() {
      state.w = clamp(parseFloat(wIn.value) || CFG.wRange[0], CFG.wRange[0], CFG.wRange[1]);
      state.h = clamp(parseFloat(hIn.value) || CFG.hRange[0], CFG.hRange[0], CFG.hRange[1]);
      pressGroup("lfPresets", "data-lfpreset", "-1"); // clear preset highlight
      render();
    }
    wIn.addEventListener("input", syncDims);
    hIn.addEventListener("input", syncDims);
    wIn.addEventListener("blur", function () { wIn.value = state.w; });
    hIn.addEventListener("blur", function () { hIn.value = state.h; });

    root.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-lfpreset]");
      if (b) {
        var p = CFG.presets[parseInt(b.getAttribute("data-lfpreset"), 10)];
        state.w = p.w; state.h = p.h; wIn.value = p.w; hIn.value = p.h;
        pressGroup("lfPresets", "data-lfpreset", b.getAttribute("data-lfpreset"));
        render(); return;
      }
      var q = e.target.closest("button[data-lfqty]");
      if (q) { state.qty = parseInt(q.getAttribute("data-lfqty"), 10); pressGroup("lfQtys", "data-lfqty", q.getAttribute("data-lfqty")); render(); return; }
      Object.keys(CFG.choices).forEach(function (k) {
        var c = e.target.closest("button[data-lfc-" + k + "]");
        if (c) { state.choices[k] = c.getAttribute("data-lfc-" + k); pressGroup("lfchoice-" + k, "data-lfc-" + k, state.choices[k]); render(); }
      });
    });

    // upload
    var dz = document.getElementById("lfDrop"), input = document.getElementById("lfInput");
    var fileLine = document.getElementById("lfFile");
    function accept(file) {
      if (!file) return;
      if (state.fileURL) { try { URL.revokeObjectURL(state.fileURL); } catch (_) {} }
      state.file = file; state.fileName = file.name;
      state.fileURL = /^image\//.test(file.type) ? URL.createObjectURL(file) : null;
      state.img = { x: 0, y: 0, scale: 1, rot: 0, fill: false };
      if (fileLine) { fileLine.hidden = false; fileLine.textContent = "✓ " + file.name; }
      syncEditor();
      showArt();
      if (!state.fileURL) window.dispatchEvent(new CustomEvent("neotype:toast", { detail: "Got " + file.name + ", we'll proof it for you" }));
    }
    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", function () { accept(input.files[0]); });
    ["dragenter", "dragover"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); }); });
    dz.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) accept(e.dataTransfer.files[0]); });

    // image editor: sliders
    function onSlider(id, apply) { var el = document.getElementById(id); if (el) el.addEventListener("input", function () { apply(parseFloat(el.value)); applyImgTransform(); }); }
    onSlider("lfZoom", function (v) { state.img.scale = v; });
    onSlider("lfRotr", function (v) { state.img.rot = v; });
    onSlider("lfMx", function (v) { state.img.x = v; });
    onSlider("lfMy", function (v) { state.img.y = v; });

    // fit / fill / center / reset
    root.addEventListener("click", function (e) {
      var f = e.target.closest("button[data-lffit]");
      if (!f) return;
      var mode = f.getAttribute("data-lffit");
      if (mode === "fit") state.img.fill = false;
      else if (mode === "fill") state.img.fill = true;
      else if (mode === "center") { state.img.x = 0; state.img.y = 0; }
      else if (mode === "reset") state.img = { x: 0, y: 0, scale: 1, rot: 0, fill: false };
      syncEditor(); applyImgTransform();
    });

    // drag to move + scroll to zoom, on the preview rectangle
    var rect = document.getElementById("lfRect");
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    rect.addEventListener("pointerdown", function (e) {
      if (!state.fileURL) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = state.img.x; oy = state.img.y;
      rect.setPointerCapture && rect.setPointerCapture(e.pointerId); rect.classList.add("dragging");
    });
    rect.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      state.img.x = ox + (e.clientX - sx); state.img.y = oy + (e.clientY - sy);
      syncEditor(); applyImgTransform();
    });
    function endDrag() { dragging = false; rect.classList.remove("dragging"); }
    rect.addEventListener("pointerup", endDrag);
    rect.addEventListener("pointercancel", endDrag);
    rect.addEventListener("wheel", function (e) {
      if (!state.fileURL) return;
      e.preventDefault();
      state.img.scale = clamp(state.img.scale * (e.deltaY < 0 ? 1.06 : 0.94), 0.2, 4);
      syncEditor(); applyImgTransform();
    }, { passive: false });

    // checkout
    document.getElementById("lfCheckout").addEventListener("click", function () {
      var payload = { product: CFG.key, w: state.w, h: state.h, qty: state.qty };
      Object.keys(state.choices).forEach(function (k) { payload[k] = state.choices[k]; });
      var order = { file: state.file, fileName: state.fileName, payload: payload };
      var nc = window.NeotypeCheckout;
      if (nc && nc.enabled) { nc.checkout(order); return; }
      window.dispatchEvent(new CustomEvent("neotype:toast", { detail: "Added: " + CFG.label + " " + state.w.toFixed(2) + "×" + state.h.toFixed(2) + "m ×" + state.qty + ", $" + Math.round(price()) + " AUD" }));
    });
  }

  build();
  render();
  showArt();
  wire();
  // highlight the preset that matches the default size, if any
  (CFG.presets || []).some(function (p, i) {
    if (Math.abs(p.w - state.w) < 1e-6 && Math.abs(p.h - state.h) < 1e-6) { pressGroup("lfPresets", "data-lfpreset", String(i)); return true; }
    return false;
  });
})();

/* ==========================================================================
   Neotype large-format builder (banners, corflute). One module, driven by
   window.LF_PRODUCT for page presentation (title, blurb, size presets) and by
   assets/js/pricing-core.js for everything that affects price: the option
   groups, the quantity list, the size limits and the maths. The checkout
   function imports the same core, so what is shown here is what is charged.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.LF_PRODUCT;
  var CORE = window.NeotypePricing;
  var root = document.getElementById("lfRoot");
  if (!CFG || !CORE || !root) return;

  var META = CORE.LF_META[CFG.key];
  if (!META) return;
  var PRICES = CORE.DEFAULT_PRICING;      // replaced by the live table from /api/pricing

  var state = {
    w: CFG.defaultW, h: CFG.defaultH, qty: META.qtys[0],
    choices: {}, file: null, fileName: null, fileURL: null,
    img: { x: 0, y: 0, scale: 1, rot: 0, fill: false }
  };
  Object.keys(META.groups).forEach(function (g) { state.choices[g] = Object.keys(META.groups[g])[0]; });

  function fmt(n) { return "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function quote() {
    var o = { w: state.w, h: state.h, qty: state.qty };
    Object.keys(state.choices).forEach(function (g) { o[g] = state.choices[g]; });
    return CORE.priceLargeFormat(CFG.key, o, PRICES);
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
    var qtyOpts = META.qtys.map(function (q) { return { v: String(q), label: String(q) }; });

    var GROUP_TITLE = {
      material: "Material", finishing: "Finishing", eyelets: "Eyelets", rope: "Rope",
      thickness: "Thickness", sides: "Print sides", turnaround: "Turnaround"
    };
    var choicesHtml = "";
    Object.keys(META.groups).forEach(function (g) {
      // Options Ian has switched off in /admin never render. pricing-core refuses
      // to price them anyway, so this only stops the shop offering something that
      // would fail at checkout with nothing to explain it.
      var opts = Object.keys(META.groups[g])
        .filter(function (v) { return !CORE.isOff(PRICES, CFG.key, g, v); })
        .map(function (v) { return { v: v, label: META.groups[g][v] }; });
      if (opts.length && !opts.some(function (o) { return o.v === state.choices[g]; })) state.choices[g] = opts[0].v;
      choicesHtml += '<div class="field"><label>' + (GROUP_TITLE[g] || g) + ' <b id="lfval-' + g + '"></b></label>' +
        optRow("lfchoice-" + g, opts, state.choices[g], "data-lfc-" + g) + "</div>";
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
            '<span><input type="number" id="lfW" step="0.05" min="' + META.wRange[0] + '" max="' + META.wRange[1] + '" value="' + state.w + '"> m wide</span>' +
            '<span><input type="number" id="lfH" step="0.05" min="' + META.hRange[0] + '" max="' + META.hRange[1] + '" value="' + state.h + '"> m tall</span>' +
          '</div>' +
          '<p class="opt-help">Between ' + META.wRange[0] + '–' + META.wRange[1] + ' m wide and ' + META.hRange[0] + '–' + META.hRange[1] + ' m tall.</p>' +
        "</div>" +
        choicesHtml +
        '<div class="field"><label>Quantity <b id="lfQtyVal"></b></label>' + optRow("lfQtys", qtyOpts, String(state.qty), "data-lfqty") + "</div>" +
        '<div class="cz-price"><div class="price-row">' +
          '<div class="price-total"><sup>$</sup><span id="lfTotal">0</span> <span style="font-family:var(--font-round);font-size:.9rem;color:var(--muted)">AUD</span></div>' +
          '<div class="price-per"><div><b id="lfPer">$0</b> / unit</div></div>' +
        "</div>" +
        '<div class="quote-lines" id="lfQuoteLines"></div>' +
        "</div>" +
        '<div class="cz-actions"><button class="btn btn--accent" id="lfCheckout">Add &amp; check out <span class="arrow">→</span></button></div>' +
        '<p class="opt-help" style="text-align:center">Free digital proof before print · ships in ~4 business days</p>' +
      "</div>";
  }

  // ---- render -----------------------------------------------------------
  function render() {
    // preview rectangle sized to aspect, fit to the space the panel can give
    var rect = document.getElementById("lfRect");
    var prev = document.querySelector(".cz-preview");
    // subtract the preview padding (34*2) and the panel padding (26*2)
    var avail = prev ? prev.clientWidth - 68 - 52 : 300;
    var maxW = Math.max(180, Math.min(300, avail)), maxH = 220;
    var ar = state.w / state.h;
    var pw = maxW, ph = maxW / ar;
    if (ph > maxH) { ph = maxH; pw = maxH * ar; }
    rect.style.width = Math.round(pw) + "px";
    rect.style.height = Math.round(ph) + "px";
    document.getElementById("lfSizeCap").textContent = state.w.toFixed(2) + " × " + state.h.toFixed(2) + " m";
    setTxt("lfSizeVal", state.w.toFixed(2) + " × " + state.h.toFixed(2) + " m");
    setTxt("lfQtyVal", state.qty + (state.qty === 1 ? " unit" : " units"));
    Object.keys(META.groups).forEach(function (g) { setTxt("lfval-" + g, META.groups[g][state.choices[g]]); });

    var r = quote();
    if (!r) return;
    setTxt("lfTotal", r.total.toLocaleString());
    setTxt("lfPer", fmt(r.unit));
    var ql = document.getElementById("lfQuoteLines");
    if (ql) ql.innerHTML = r.lines.map(function (l) {
      var amt = (l.signed && l.amount > 0 ? "+" : "") + "$" + Math.abs(l.amount).toLocaleString();
      return '<div class="ql-row' + (l.note ? " ql-note" : "") + '"><span>' + l.label + '</span><b>' +
             (l.amount < 0 ? "\u2212" : "") + amt + '</b></div>';
    }).join("");
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
      state.w = clamp(parseFloat(wIn.value) || META.wRange[0], META.wRange[0], META.wRange[1]);
      state.h = clamp(parseFloat(hIn.value) || META.hRange[0], META.hRange[0], META.hRange[1]);
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
      Object.keys(META.groups).forEach(function (g) {
        var c = e.target.closest("button[data-lfc-" + g + "]");
        if (c) { state.choices[g] = c.getAttribute("data-lfc-" + g); pressGroup("lfchoice-" + g, "data-lfc-" + g, state.choices[g]); render(); }
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
      // default to Fill so the art covers the whole area with no gaps
      state.img = { x: 0, y: 0, scale: 1, rot: 0, fill: true };
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
      Object.keys(state.choices).forEach(function (g) { payload[g] = state.choices[g]; });
      var order = { file: state.file, fileName: state.fileName, payload: payload };
      var nc = window.NeotypeCheckout;
      if (nc && nc.enabled) { nc.checkout(order); return; }
      window.dispatchEvent(new CustomEvent("neotype:toast", { detail: "Added: " + CFG.label + " " + state.w.toFixed(2) + "×" + state.h.toFixed(2) + "m ×" + state.qty + ", $" + (quote() || { total: 0 }).total + " AUD" }));
    });
  }

  // Live price list from the admin. Falls back to the core defaults when the
  // API isn't reachable (viewing the files locally, or before deploy).
  function fetchLivePricing() {
    if (location.protocol === "file:") return;
    var cfg = window.NEOTYPE_CHECKOUT || {};
    var api = (cfg.apiBase || "/api").replace(/\/$/, "");
    fetch(api + "/pricing").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d[CFG.key]) return;
        PRICES = d;
        // rebuild rather than re-render: the live table may have switched an
        // option off, and the buttons were built from the defaults
        build();
        render();
      })
      .catch(function () {});
  }

  build();
  render();
  showArt();
  wire();
  fetchLivePricing();
  // highlight the preset that matches the default size, if any
  (CFG.presets || []).some(function (p, i) {
    if (Math.abs(p.w - state.w) < 1e-6 && Math.abs(p.h - state.h) < 1e-6) { pressGroup("lfPresets", "data-lfpreset", String(i)); return true; }
    return false;
  });
})();

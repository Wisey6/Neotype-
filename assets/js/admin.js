/* ==========================================================================
   Neotype pricing admin — plain-English editor for the owner.
   Prices are shown as dollars and % uplift, with a LIVE example price next to
   everything so the effect of a change is obvious. Loads/saves the price list
   through the checkout Worker (guarded by a password). No developer needed.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_ADMIN || {};
  var root = document.getElementById("admRoot");
  if (!root) return;

  // ---- product definitions (labels, example anchors) --------------------
  var PROD = {
    stickers: {
      title: "Stickers", unitNote: "priced by area × quantity",
      money: [{ path: "min", label: "Minimum order" }],
      advanced: [
        { path: "rate.base", label: "Base rate (per m², large runs)" },
        { path: "rate.extra", label: "Small-run premium (per m²)" },
        { path: "rate.decay", label: "How fast the bulk discount kicks in", pct: false }
      ],
      groups: [
        { key: "finish", title: "Finish", anchor: { size: 3, qty: 100, shape: "die" },
          opts: { "vinyl-matte": "Vinyl · matte", "vinyl-gloss": "Vinyl · gloss", "holographic": "Holographic", "glitter": "Glitter", "chrome": "Chrome", "clear": "Clear" } },
        { key: "shape", title: "Shape / cut", anchor: { size: 3, qty: 100, finish: "vinyl-matte" },
          opts: { die: "Die-cut", kiss: "Kiss-cut", circle: "Circle", square: "Square", rect: "Rectangle", rounded: "Rounded", sheet: "Sheet" } }
      ],
      examples: [
        { label: "100 × 3″ matte, die-cut", size: 3, qty: 100, finish: "vinyl-matte", shape: "die" },
        { label: "100 × 3″ holographic", size: 3, qty: 100, finish: "holographic", shape: "die" },
        { label: "500 × 3″ matte, die-cut", size: 3, qty: 500, finish: "vinyl-matte", shape: "die" }
      ]
    },
    banner: {
      title: "Banners", unitNote: "priced per square metre",
      money: [{ path: "rate", label: "Price per square metre" }, { path: "min", label: "Minimum order" }],
      advanced: [],
      groups: [
        { key: "material", title: "Material", anchor: { w: 2, h: 1, qty: 1 }, opts: { "vinyl-440": "440gsm PVC", "mesh": "Mesh (windy sites)" } },
        { key: "finishing", title: "Finishing", anchor: { w: 2, h: 1, qty: 1 }, opts: { "hem-eyelets": "Hemmed + eyelets", "trim-eyelets": "Trimmed + eyelets", "trim": "Trimmed to size", "pole": "Pole pockets" } }
      ],
      examples: [
        { label: "Small · 1.6 × 0.6 m", w: 1.6, h: 0.6, qty: 1 },
        { label: "Medium · 2 × 0.85 m", w: 2, h: 0.85, qty: 1 },
        { label: "Large · 3 × 1 m", w: 3, h: 1, qty: 1 }
      ]
    },
    corflute: {
      title: "Corflute signs", unitNote: "priced per square metre",
      money: [{ path: "rate", label: "Price per square metre" }, { path: "min", label: "Minimum order" }],
      advanced: [],
      groups: [
        { key: "thickness", title: "Thickness", anchor: { w: 0.9, h: 0.6, qty: 1 }, opts: { "3mm": "3 mm", "5mm": "5 mm" } },
        { key: "sides", title: "Print sides", anchor: { w: 0.9, h: 0.6, qty: 1 }, opts: { single: "Single-sided", double: "Double-sided" } },
        { key: "eyelets", title: "Eyelets", anchor: { w: 0.9, h: 0.6, qty: 1 }, opts: { none: "None", corners: "4 corner eyelets" } }
      ],
      examples: [
        { label: "600 × 900 mm, 3 mm single", w: 0.6, h: 0.9, qty: 1 },
        { label: "900 × 600 mm, 3 mm single", w: 0.9, h: 0.6, qty: 1 },
        { label: "1200 × 900 mm, 5 mm double", w: 1.2, h: 0.9, qty: 1, thickness: "5mm", sides: "double" }
      ]
    }
  };
  var ORDER = ["stickers", "banner", "corflute"];

  var D = null; // working price list (multipliers), edited in place
  var password = "";

  function toast(m) { window.dispatchEvent(new CustomEvent("neotype:toast", { detail: m })); }
  function get(path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, D); }
  function set(path, v) { var ks = path.split("."), c = D; for (var i = 0; i < ks.length - 1; i++) c = c[ks[i]]; c[ks[ks.length - 1]] = v; }
  function money(n) { return "$" + Math.round(n).toLocaleString(); }

  // ---- price maths (mirrors the site & Worker) --------------------------
  function stickerPrice(size, qty, finish, shape) {
    var a = Math.pow(size * 0.0254, 2) * qty;
    var r = D.stickers.rate.base + D.stickers.rate.extra * Math.exp(-a / D.stickers.rate.decay);
    return Math.max(D.stickers.min, a * r * D.stickers.finish[finish] * D.stickers.shape[shape]);
  }
  function lfPrice(prod, ex) {
    var q = 0.6 + 0.4 * Math.exp(-(ex.qty - 1) / 20), m = 1;
    PROD[prod].groups.forEach(function (g) {
      var opt = ex[g.key] || Object.keys(D[prod][g.key])[0];
      m *= D[prod][g.key][opt];
    });
    return Math.max(D[prod].min, ex.w * ex.h * D[prod].rate * m * ex.qty * q);
  }
  function exPrice(prod, ex) { return prod === "stickers" ? stickerPrice(ex.size, ex.qty, ex.finish, ex.shape) : lfPrice(prod, ex); }
  // price for one option within a group, using the group's anchor
  function optPrice(prod, group, opt, anchor) {
    var ex = {}; for (var k in anchor) ex[k] = anchor[k];
    ex[group] = opt;
    return exPrice(prod, ex);
  }

  // ---- rendering --------------------------------------------------------
  function moneyInput(path) {
    return '<span class="adm-money"><span>$</span><input type="number" step="0.01" min="0" data-path="' + path + '" value="' + get(path) + '"></span>';
  }
  function pctInput(prod, group, opt, isBase) {
    var mult = D[prod][group][opt];
    var pct = Math.round((mult - 1) * 100);
    return '<span class="adm-pct"><input type="number" step="1" data-mult="' + prod + "." + group + "." + opt + '" value="' + pct + '"><span>%</span></span>' +
      (isBase ? '<em class="adm-std">standard</em>' : "");
  }
  function exSpan(prod, ex) { return '<b data-ex=\'' + JSON.stringify(Object.assign({ p: prod }, ex)) + "'>" + money(exPrice(prod, ex)) + "</b>"; }
  function optExSpan(prod, group, opt, anchor) {
    var ex = {}; for (var k in anchor) ex[k] = anchor[k]; ex[group] = opt;
    return '<b data-ex=\'' + JSON.stringify(Object.assign({ p: prod }, ex)) + "'>" + money(optPrice(prod, group, opt, anchor)) + "</b>";
  }

  function buildForm(pricing) {
    D = pricing;
    var html = '<div class="section-head"><span class="eyebrow">Live prices</span><h1 class="display-lg">Pricing</h1>' +
      '<p class="lead">Change a dollar amount or a percentage and hit <b>Save prices</b>. The example prices update as you type, so you can see exactly what customers will pay. Then it goes live straight away.</p></div>';

    ORDER.forEach(function (prod) {
      var C = PROD[prod];
      html += '<section class="adm-card"><div class="adm-card-h"><h2>' + C.title + '</h2><span class="adm-note">' + C.unitNote + "</span></div>";

      // live example prices
      html += '<div class="adm-ex-box"><span class="adm-ex-title">Example prices</span><div class="adm-ex-rows">';
      C.examples.forEach(function (ex) { html += '<div class="adm-ex-row"><span>' + ex.label + "</span>" + exSpan(prod, ex) + "</div>"; });
      html += "</div></div>";

      // money fields
      html += '<div class="adm-money-row">';
      C.money.forEach(function (m) { html += '<label class="adm-field"><span>' + m.label + "</span>" + moneyInput(prod + "." + m.path) + "</label>"; });
      html += "</div>";

      // option tables
      C.groups.forEach(function (g) {
        html += '<h3 class="adm-sub">' + g.title + '</h3><div class="adm-table">' +
          '<div class="adm-tr adm-th"><span>Option</span><span>Price change</span><span>Example</span></div>';
        var keys = Object.keys(g.opts), first = keys[0];
        keys.forEach(function (opt) {
          html += '<div class="adm-tr"><span class="adm-opt">' + g.opts[opt] + "</span>" +
            "<span>" + pctInput(prod, g.key, opt, opt === first) + "</span>" +
            '<span class="adm-opt-ex">' + optExSpan(prod, g.key, opt, g.anchor) + "</span></div>";
        });
        html += "</div>";
      });

      // advanced (rarely touched)
      if (C.advanced.length) {
        html += '<details class="adm-adv"><summary>Advanced settings (usually set once)</summary><div class="adm-money-row" style="margin-top:12px">';
        C.advanced.forEach(function (a) { html += '<label class="adm-field"><span>' + a.label + "</span>" + moneyInput(prod + "." + a.path) + "</label>"; });
        html += "</div></details>";
      }
      html += "</section>";
    });

    html += '<div class="adm-savebar"><button class="btn btn--accent" id="admSave">Save prices</button>' +
      '<button class="btn btn--ghost" id="admReload">Undo changes</button>' +
      '<span class="adm-hint">Signed in · changes go live the moment you save</span></div>';

    root.innerHTML = html;
    document.getElementById("admSave").addEventListener("click", save);
    document.getElementById("admReload").addEventListener("click", load);
    root.addEventListener("input", onEdit);
  }

  function onEdit(e) {
    var t = e.target;
    if (t.dataset.path) { var v = parseFloat(t.value); if (isFinite(v)) set(t.dataset.path, v); }
    else if (t.dataset.mult) { var p = parseFloat(t.value); if (isFinite(p)) { var ks = t.dataset.mult.split("."); D[ks[0]][ks[1]][ks[2]] = 1 + p / 100; } }
    else return;
    refreshPrices();
  }
  function refreshPrices() {
    root.querySelectorAll("[data-ex]").forEach(function (el) {
      try { var ex = JSON.parse(el.getAttribute("data-ex")); el.textContent = money(exPrice(ex.p, ex)); } catch (_) {}
    });
  }

  // ---- load / save ------------------------------------------------------
  function load() {
    if (!CFG.workerUrl) { lockScreen("No Worker URL configured in admin.html yet."); return; }
    root.innerHTML = '<p class="lead">Loading current prices…</p>';
    fetch(CFG.workerUrl.replace(/\/$/, "") + "/pricing").then(function (r) { return r.json(); })
      .then(function (d) { buildForm(d || {}); })
      .catch(function () { lockScreen("Couldn't reach the pricing service. Check the Worker URL."); });
  }
  function save() {
    var btn = document.getElementById("admSave");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    fetch(CFG.workerUrl.replace(/\/$/, "") + "/pricing", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Password": password }, body: JSON.stringify(D)
    }).then(function (r) { if (r.status === 401) { toast("Incorrect password — nothing was saved"); return null; } return r.json(); })
      .then(function (d) { if (d && d.ok) { toast("Saved — new prices are live"); } else if (d) { toast(d.error || "Couldn't save"); } })
      .catch(function () { toast("Couldn't save — please try again"); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = "Save prices"; } });
  }

  function lockScreen(msg) {
    root.innerHTML =
      '<div class="section-head"><span class="eyebrow">Owner access</span><h1 class="display-lg">Pricing</h1>' +
      '<p class="lead">Enter the admin password to view and change your prices.</p></div>' +
      (CFG.workerUrl ? "" : '<p class="opt-help" style="color:#ff8a5b">⚠ Set <code>workerUrl</code> in admin.html once the checkout Worker is deployed.</p>') +
      '<div class="adm-lock"><input type="password" id="admPass" placeholder="Admin password" aria-label="Admin password"><button class="btn btn--accent" id="admUnlock">Unlock</button></div>' +
      (msg ? '<p class="opt-help" style="color:#ff8a5b">' + msg + "</p>" : "");
    var pass = document.getElementById("admPass");
    function go() {
      password = pass.value || "";
      if (!password) { toast("Enter the password"); return; }
      if (!CFG.workerUrl) { lockScreen("No Worker URL configured in admin.html yet."); return; }
      var btn = document.getElementById("admUnlock");
      if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
      // real login: verify the password before showing anything
      fetch(CFG.workerUrl.replace(/\/$/, "") + "/verify", { method: "POST", headers: { "X-Admin-Password": password } })
        .then(function (r) { if (r.status === 401) { lockScreen("Incorrect password — please try again."); return null; } return r.json(); })
        .then(function (d) { if (d && d.ok) load(); })
        .catch(function () { lockScreen("Couldn't reach the admin service. Check the Worker URL."); });
    }
    document.getElementById("admUnlock").addEventListener("click", go);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  lockScreen();
})();

/* ==========================================================================
   Neotype pricing admin — plain-English editor for the owner.
   Prices are shown as dollars and % uplift, with a LIVE example price next to
   everything so the effect of a change is obvious. Loads/saves the price list
   through the site's /api function (guarded by a password). No developer needed.

   Every example price here comes from assets/js/pricing-core.js — the same code
   the shop and the card charge use — so what Ian previews is what customers pay.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_ADMIN || {};
  var API = (CFG.apiBase || "/api").replace(/\/$/, "");
  var root = document.getElementById("admRoot");
  if (!root) return;
  var CORE = window.NeotypePricing;

  // Banner/corflute option tables are generated straight from the core, so a
  // new option only ever has to be added in one place to appear here.
  var GROUP_TITLE = {
    material: "Material", finishing: "Finishing", eyelets: "Eyelets",
    rope: "Rope", thickness: "Thickness", sides: "Print sides",
    turnaround: "Turnaround"
  };
  function lfGroups(prod, anchor) {
    var groups = CORE.LF_META[prod].groups;
    return Object.keys(groups).map(function (key) {
      return { key: key, title: GROUP_TITLE[key] || key, anchor: anchor, opts: groups[key] };
    });
  }

  // ---- product definitions (labels, example anchors) --------------------
  var PROD = {
    stickers: {
      title: "Stickers", unitNote: "priced by area × quantity",
      money: [{ path: "min", label: "Minimum order" }],
      advanced: [
        { path: "rate.base", label: "Base rate (per m², large runs)" },
        { path: "rate.extra", label: "Small-run premium (per m²)" },
        { path: "rate.decay", label: "How fast the bulk discount kicks in", plain: true }
      ],
      groups: [
        { key: "finish", title: "Finish / laminate", anchor: { size: 3, qty: 100, shape: "die" },
          opts: CORE.FINISH_LABEL },
        { key: "shape", title: "Shape / cut", anchor: { size: 3, qty: 100, finish: "vinyl-matte" },
          opts: CORE.SHAPE_LABEL },
        { key: "turnaround", title: "Turnaround", anchor: { size: 3, qty: 100, finish: "vinyl-matte", shape: "die" },
          opts: CORE.TURNAROUND_LABEL }
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
      groups: lfGroups("banner", { w: 2, h: 1, qty: 1 }),
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
      groups: lfGroups("corflute", { w: 0.9, h: 0.6, qty: 1 }),
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

  // ---- example prices: the shop's own maths, on the numbers being edited --
  function exPrice(prod, ex) {
    var q = prod === "stickers" ? CORE.priceStickers(ex, D) : CORE.priceLargeFormat(prod, ex, D);
    return q ? q.total : 0;
  }
  // price for one option within a group, using the group's anchor
  function optPrice(prod, group, opt, anchor) {
    var ex = {}; for (var k in anchor) ex[k] = anchor[k];
    ex[group] = opt;
    return exPrice(prod, ex);
  }

  // ---- rendering --------------------------------------------------------
  // `plain` drops the $ sign for settings that aren't money (the decay figure).
  function moneyInput(path, plain) {
    return '<span class="adm-money">' + (plain ? "" : "<span>$</span>") +
      '<input type="number" step="0.01" min="0" data-path="' + path + '" value="' + get(path) + '"></span>';
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
        C.advanced.forEach(function (a) { html += '<label class="adm-field"><span>' + a.label + "</span>" + moneyInput(prod + "." + a.path, a.plain) + "</label>"; });
        html += "</div></details>";
      }
      html += "</section>";
    });

    html += '<div class="adm-savebar"><button class="btn btn--accent" id="admSave">Save prices</button>' +
      '<button class="btn btn--ghost" id="admReload">Undo changes</button>' +
      '<span class="adm-hint">Signed in · changes go live the moment you save</span></div>';

    // enquiry inbox, filled in once it loads
    html += '<section class="adm-card" id="admEnq"><div class="adm-card-h"><h2>Enquiries</h2>' +
      '<span class="adm-note">from the contact form on the website</span></div>' +
      '<p class="lead" id="admEnqBody">Loading…</p></section>';

    root.innerHTML = html;
    document.getElementById("admSave").addEventListener("click", save);
    document.getElementById("admReload").addEventListener("click", load);
    root.addEventListener("input", onEdit);
    loadEnquiries();
  }

  // ---- enquiry inbox ------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function whenLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " · " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function loadEnquiries() {
    var box = document.getElementById("admEnqBody");
    if (!box) return;
    fetch(API + "/enquiries", { headers: { "X-Admin-Password": password } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { box.textContent = "Couldn't load enquiries."; return; }
        var list = d.enquiries || [];
        if (!list.length) { box.textContent = "No enquiries yet. They'll appear here as soon as someone uses the contact form."; return; }
        var html = '<div class="adm-enq-list">';
        list.forEach(function (e) {
          html += '<div class="adm-enq">' +
            '<div class="adm-enq-top"><b>' + esc(e.name) + "</b>" +
            '<span class="adm-enq-topic">' + esc(e.topic || "General") + "</span>" +
            '<span class="adm-enq-when">' + esc(whenLabel(e.when)) + "</span></div>" +
            '<a class="adm-enq-mail" href="mailto:' + esc(e.email) +
              "?subject=" + encodeURIComponent("Re: your Neotype enquiry") + '">' + esc(e.email) + "</a>" +
            '<p class="adm-enq-msg">' + esc(e.message) + "</p></div>";
        });
        box.outerHTML = html + "</div>";
      })
      .catch(function () { box.textContent = "Couldn't load enquiries."; });
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
    root.innerHTML = '<p class="lead">Loading current prices…</p>';
    fetch(API + "/pricing").then(function (r) { return r.json(); })
      .then(function (d) { buildForm(d || {}); })
      .catch(function () { lockScreen("Couldn't reach the pricing service — is the site deployed?"); });
  }
  function save() {
    var btn = document.getElementById("admSave");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    fetch(API + "/pricing", {
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
      '<div class="adm-lock"><input type="password" id="admPass" placeholder="Admin password" aria-label="Admin password"><button class="btn btn--accent" id="admUnlock">Unlock</button></div>' +
      (msg ? '<p class="opt-help" style="color:#ff8a5b">' + msg + "</p>" : "");
    var pass = document.getElementById("admPass");
    function go() {
      password = pass.value || "";
      if (!password) { toast("Enter the password"); return; }
      var btn = document.getElementById("admUnlock");
      if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
      // real login: verify the password before showing anything
      fetch(API + "/verify", { method: "POST", headers: { "X-Admin-Password": password } })
        .then(function (r) { if (r.status === 401) { lockScreen("Incorrect password — please try again."); return null; } return r.json(); })
        .then(function (d) { if (d && d.ok) load(); })
        .catch(function () { lockScreen("Couldn't reach the admin service — is the site deployed?"); });
    }
    document.getElementById("admUnlock").addEventListener("click", go);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  lockScreen();
})();

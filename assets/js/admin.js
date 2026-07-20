/* ==========================================================================
   Neotype pricing admin. Loads the current price list from the checkout Worker,
   lets the client edit every number, and saves it back (guarded by a password).
   No developer or redeploy needed — saved prices go live immediately.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_ADMIN || {};
  var root = document.getElementById("admRoot");
  if (!root) return;

  var LABELS = {
    stickers: { title: "Stickers",
      scalars: [["min", "Minimum order (A$)"], ["rate.base", "Base rate (A$/m²)"], ["rate.extra", "Small-order premium"], ["rate.decay", "Discount speed (smaller = faster)"]],
      groups: [
        ["finish", "Finish price multipliers", { "vinyl-matte": "Vinyl · matte", "vinyl-gloss": "Vinyl · gloss", "holographic": "Holographic", "glitter": "Glitter", "chrome": "Chrome", "clear": "Clear" }],
        ["shape", "Shape price multipliers", { die: "Die-cut", kiss: "Kiss-cut", circle: "Circle", square: "Square", rect: "Rectangle", rounded: "Rounded", sheet: "Sheet" }]
      ] },
    banner: { title: "Banners",
      scalars: [["rate", "Rate (A$/m²)"], ["min", "Minimum (A$)"]],
      groups: [
        ["material", "Material multipliers", { "vinyl-440": "440gsm PVC", "mesh": "Mesh" }],
        ["finishing", "Finishing multipliers", { "hem-eyelets": "Hemmed + eyelets", "trim-eyelets": "Trimmed + eyelets", "trim": "Trimmed to size", "pole": "Pole pockets" }]
      ] },
    corflute: { title: "Corflute signs",
      scalars: [["rate", "Rate (A$/m²)"], ["min", "Minimum (A$)"]],
      groups: [
        ["thickness", "Thickness multipliers", { "3mm": "3 mm", "5mm": "5 mm" }],
        ["sides", "Print sides multipliers", { single: "Single-sided", double: "Double-sided" }],
        ["eyelets", "Eyelets multipliers", { none: "None", corners: "4 corner eyelets" }]
      ] }
  };
  var ORDER = ["stickers", "banner", "corflute"];

  function toast(m) { window.dispatchEvent(new CustomEvent("neotype:toast", { detail: m })); }
  function getByPath(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setByPath(o, path, v) {
    var ks = path.split("."), cur = o;
    for (var i = 0; i < ks.length - 1; i++) { if (typeof cur[ks[i]] !== "object" || cur[ks[i]] == null) cur[ks[i]] = {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }

  var password = "";

  function lockScreen(msg) {
    root.innerHTML =
      '<div class="section-head"><span class="eyebrow">Restricted</span><h1 class="display-lg">Pricing admin</h1>' +
      '<p class="lead">Enter the admin password to view and edit live prices.</p></div>' +
      (CFG.workerUrl ? "" : '<p class="opt-help" style="color:#ff8a5b">⚠ No Worker URL configured yet. Set <code>workerUrl</code> in admin.html once the checkout Worker is deployed.</p>') +
      '<div class="adm-lock"><input type="password" id="admPass" placeholder="Admin password" aria-label="Admin password" />' +
      '<button class="btn btn--accent" id="admUnlock">Unlock</button></div>' +
      (msg ? '<p class="opt-help" style="color:#ff8a5b">' + msg + "</p>" : "");
    var pass = document.getElementById("admPass");
    function go() { password = pass.value || ""; if (!password) { toast("Enter the password"); return; } load(); }
    document.getElementById("admUnlock").addEventListener("click", go);
    pass.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  function field(path, label, val) {
    return '<label class="adm-field"><span>' + label + '</span>' +
      '<input type="number" step="0.01" min="0" data-path="' + path + '" value="' + (val == null ? "" : val) + '"></label>';
  }

  function buildForm(pricing) {
    var html = '<div class="section-head"><span class="eyebrow">Live prices</span><h1 class="display-lg">Adjust pricing</h1>' +
      '<p class="lead">Change any number and hit Save. Prices update on the site immediately, no developer needed. Multipliers are ×: 1.00 = normal, 1.50 = +50%, 0.90 = 10% off.</p></div>';
    ORDER.forEach(function (prod) {
      var L = LABELS[prod], P = pricing[prod] || {};
      html += '<section class="adm-card"><h2>' + L.title + "</h2>";
      html += '<div class="adm-grid">';
      L.scalars.forEach(function (sc) { html += field(prod + "." + sc[0], sc[1], getByPath(P, sc[0])); });
      html += "</div>";
      L.groups.forEach(function (g) {
        html += '<h3 class="adm-sub">' + g[1] + "</h3><div class=\"adm-grid\">";
        Object.keys(g[2]).forEach(function (key) { html += field(prod + "." + g[0] + "." + key, g[2][key], (P[g[0]] || {})[key]); });
        html += "</div>";
      });
      html += "</section>";
    });
    html += '<div class="cz-actions" style="max-width:360px"><button class="btn btn--accent" id="admSave">Save prices</button>' +
      '<button class="btn btn--ghost" id="admReload">Reload</button></div>' +
      '<p class="opt-help">Signed in. Changes are validated (numbers only) and take effect the moment you save.</p>';
    root.innerHTML = html;
    document.getElementById("admSave").addEventListener("click", save);
    document.getElementById("admReload").addEventListener("click", load);
  }

  function load() {
    if (!CFG.workerUrl) { lockScreen("No Worker URL configured."); return; }
    root.innerHTML = '<p class="lead">Loading current prices…</p>';
    fetch(CFG.workerUrl.replace(/\/$/, "") + "/pricing")
      .then(function (r) { return r.json(); })
      .then(function (d) { buildForm(d || {}); })
      .catch(function () { lockScreen("Couldn't reach the pricing service. Check the Worker URL."); });
  }

  function save() {
    var out = {};
    root.querySelectorAll("input[data-path]").forEach(function (inp) {
      var v = parseFloat(inp.value);
      if (isFinite(v) && v >= 0) setByPath(out, inp.getAttribute("data-path"), v);
    });
    var btn = document.getElementById("admSave");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    fetch(CFG.workerUrl.replace(/\/$/, "") + "/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": password },
      body: JSON.stringify(out)
    }).then(function (r) {
      if (r.status === 401) { toast("Incorrect password — not saved"); return null; }
      return r.json();
    }).then(function (d) {
      if (d && d.ok) { toast("Saved — prices are live"); buildForm(d.pricing); }
      else if (d) { toast(d.error || "Couldn't save"); }
    }).catch(function () { toast("Couldn't save — try again"); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = "Save prices"; } });
  }

  lockScreen();
})();

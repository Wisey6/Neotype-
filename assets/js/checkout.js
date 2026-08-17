/* ==========================================================================
   Neotype checkout — Stripe payments via the site's own /api function.

   No configuration needed: the API lives on the same domain, so there are no
   URLs or keys to paste in. If the API isn't reachable (e.g. viewing the files
   locally, or before the site is deployed) the builders fall back to their demo
   "added to cart" message instead of erroring.

   Artwork is uploaded to our own storage first, so the order Ian receives always
   carries a link to the customer's actual print file. Nothing to configure.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_CHECKOUT || {};
  var API = (CFG.apiBase || "/api").replace(/\/$/, "");
  var api = { enabled: true, checkout: checkout, uploadArtwork: uploadArtwork };
  window.NeotypeCheckout = api;

  // opening the files directly from disk can't reach an API
  if (location.protocol === "file:") api.enabled = false;

  function toast(msg) { window.dispatchEvent(new CustomEvent("neotype:toast", { detail: msg })); }

  // ---- artwork file hosting (our own /api/upload → R2) -------------------
  // Returns the stored file's URL, or null if it couldn't be stored. Checkout
  // still proceeds on null — a lost file is recoverable, a lost sale isn't —
  // and the order then carries the filename so Ian knows to chase it.
  function uploadArtwork(file) {
    if (!file) return Promise.resolve(null);
    var fd = new FormData();
    fd.append("file", file, file.name || "artwork");
    return fetch(API + "/upload", { method: "POST", body: fd })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.url ? d.url : null; })
      .catch(function () { return null; });
  }

  // ---- checkout ---------------------------------------------------------
  // order = { file, fileName, payload, demoLabel }
  function checkout(order) {
    if (!api.enabled) { demo(order); return; }
    toast("Preparing secure checkout…");
    uploadArtwork(order.file).then(function (url) {
      var payload = Object.assign({}, order.payload, {
        artwork: url || "",
        artworkName: order.fileName || ""
      });
      return fetch(API + "/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (r) {
      if (r.status === 404) { demo(order); return null; }   // API not deployed yet
      return r.json();
    }).then(function (d) {
      if (!d) return;
      if (d.url) { window.location.href = d.url; return; }
      toast(d.error || "Checkout unavailable — please try again");
    }).catch(function () { demo(order); });
  }

  function demo(order) {
    toast(order && order.demoLabel ? order.demoLabel : "Added to your order");
  }
})();

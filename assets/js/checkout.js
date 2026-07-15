/* ==========================================================================
   Neotype checkout — Stripe-direct via a Cloudflare Worker.

   Inert until configured in customizer.html:
     window.NEOTYPE_CHECKOUT = { workerUrl: "...", uploadcareKey: "...", currency: "aud" }
   With no workerUrl, window.NeotypeCheckout.enabled === false and the customizer
   keeps its demo "added to cart" toast — the live site is untouched.

   When configured it:
     1. uploads the customer's artwork to a file host and gets a shareable link,
     2. sends the chosen options to the Worker (which recomputes the price
        server-side and creates a Stripe Checkout Session),
     3. redirects the customer to Stripe's secure payment page.
   Only Stripe's card fee applies — no platform markup. See CHECKOUT-SETUP.md.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_CHECKOUT || {};
  var api = { enabled: false, checkout: function () {}, uploadArtwork: function () { return Promise.resolve(null); } };
  window.NeotypeCheckout = api;

  if (!CFG.workerUrl) return; // not configured yet — stay inert
  api.enabled = true;

  function toast(msg) { window.dispatchEvent(new CustomEvent("neotype:toast", { detail: msg })); }

  // ---- artwork file hosting (Uploadcare) --------------------------------
  api.uploadArtwork = function (file) {
    if (!CFG.uploadcareKey || !file) return Promise.resolve(null);
    var fd = new FormData();
    fd.append("UPLOADCARE_PUB_KEY", CFG.uploadcareKey);
    fd.append("UPLOADCARE_STORE", "auto");
    fd.append("file", file);
    return fetch("https://upload.uploadcare.com/base/", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.file ? "https://ucarecdn.com/" + d.file + "/" + encodeURIComponent(file.name || "artwork") : null; })
      .catch(function () { return null; });
  };

  // ---- checkout ---------------------------------------------------------
  api.checkout = function (order) {
    toast("Preparing secure checkout…");
    api.uploadArtwork(order.file).then(function (url) {
      var payload = {
        finish: order.raw.finish,
        shape: order.raw.shape,
        size: order.raw.size,
        qty: order.raw.qty,
        background: order.raw.background,
        cutColour: order.raw.cutColour,
        artwork: url || "",
        artworkName: order.fileName || ""
      };
      return fetch(CFG.workerUrl.replace(/\/$/, "") + "/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) { window.location.href = d.url; }
        else { toast(d && d.error ? d.error : "Checkout unavailable — please try again"); }
      })
      .catch(function (e) {
        console.error("Neotype checkout failed", e);
        toast("Couldn't reach checkout — please try again");
      });
  };
})();

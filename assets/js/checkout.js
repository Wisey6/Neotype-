/* ==========================================================================
   Neotype checkout — Snipcart cart + payment, with artwork file hosting.

   This layer is INERT until real keys are supplied in customizer.html:
     window.NEOTYPE_CHECKOUT = { snipcartKey: "...", uploadcareKey: "...", currency: "aud" }
   With no snipcartKey, window.NeotypeCheckout.enabled === false and the
   customizer keeps its demo "added to cart" toast — the live site is untouched.

   When keys are present it:
     1. boots Snipcart (connects to Ian's Stripe/PayPal, order dashboard + emails),
     2. uploads the customer's artwork to a file host and gets a shareable URL,
     3. adds a cart item carrying the full spec + artwork link, then opens the cart.
   See CHECKOUT-SETUP.md for the exact activation steps.
   ========================================================================== */
(function () {
  "use strict";
  var CFG = window.NEOTYPE_CHECKOUT || {};
  var SNIPCART_VERSION = "3.7.1";
  var api = { enabled: false, checkout: function () {}, uploadArtwork: function () { return Promise.resolve(null); } };
  window.NeotypeCheckout = api;

  if (!CFG.snipcartKey) return; // not configured yet — stay inert

  api.enabled = true;
  var ready = false, queued = null;

  // ---- boot Snipcart ----------------------------------------------------
  function boot() {
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdn.snipcart.com/themes/v" + SNIPCART_VERSION + "/default/snipcart.css";
    document.head.appendChild(css);

    var mount = document.createElement("div");
    mount.id = "snipcart";
    mount.hidden = true;
    mount.setAttribute("data-api-key", CFG.snipcartKey);
    mount.setAttribute("data-config-modal-style", "side");
    if (CFG.currency) mount.setAttribute("data-currency", CFG.currency);
    document.body.appendChild(mount);

    var js = document.createElement("script");
    js.async = true;
    js.src = "https://cdn.snipcart.com/themes/v" + SNIPCART_VERSION + "/default/snipcart.js";
    document.body.appendChild(js);

    document.addEventListener("snipcart.ready", function () {
      ready = true;
      if (queued) { var o = queued; queued = null; doCheckout(o); }
    });
  }

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

  // ---- add to cart ------------------------------------------------------
  function doCheckout(order) {
    api.uploadArtwork(order.file).then(function (url) {
      var cf = [];
      Object.keys(order.fields).forEach(function (k) { cf.push({ name: k, value: String(order.fields[k]) }); });
      cf.push({ name: "Artwork", value: url || (order.fileName ? order.fileName + " (customer to email)" : "none supplied") });

      window.Snipcart.api.cart.items.add({
        id: order.id,
        name: order.name + " × " + order.qty,
        price: order.price,
        url: location.href.split("#")[0].split("?")[0],
        quantity: 1,
        customFields: cf
      }).then(function () {
        if (window.Snipcart.api.theme && window.Snipcart.api.theme.cart) window.Snipcart.api.theme.cart.open();
      }).catch(function (e) {
        console.error("Neotype checkout: add-to-cart failed", e);
        window.dispatchEvent(new CustomEvent("neotype:toast", { detail: "Couldn't reach checkout — please try again" }));
      });
    });
  }

  api.checkout = function (order) {
    if (!ready) { queued = order; return; }
    doCheckout(order);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

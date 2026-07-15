/* ==========================================================================
   Neotype — site interactions: mobile nav, scroll reveals, FAQ, toast,
   newsletter, and a light hero peel micro-interaction.
   ========================================================================== */
(function () {
  "use strict";

  // ---- Mobile nav -------------------------------------------------------
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ---- Scroll reveal ----------------------------------------------------
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  // ---- FAQ accordion ----------------------------------------------------
  document.querySelectorAll(".faq button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".faq");
      var ans = item.querySelector(".faq-a");
      var open = item.getAttribute("data-open") === "true";
      item.setAttribute("data-open", open ? "false" : "true");
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      ans.style.maxHeight = open ? "0px" : ans.scrollHeight + "px";
    });
  });

  // ---- Toast ------------------------------------------------------------
  var toast = document.getElementById("toast");
  var toastMsg = document.getElementById("toastMsg");
  var toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    if (toastMsg) toastMsg.textContent = msg;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 3600);
  }
  window.addEventListener("neotype:toast", function (e) { showToast(e.detail); });

  // ---- Newsletter -------------------------------------------------------
  var form = document.getElementById("newsForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("newsEmail");
      var val = (email && email.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        showToast("Enter a valid email to grab your 15% off");
        if (email) email.focus();
        return;
      }
      showToast("You're in — 15% off is on its way to " + val);
      form.reset();
    });
  }

  // ---- Logo glitch: burst on load, replay on hover ---------------------
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function glitch(el) {
    if (!el || reduce) return;
    el.classList.remove("glitching");
    // force reflow so the animation can restart
    void el.offsetWidth;
    el.classList.add("glitching");
  }

  document.querySelectorAll("[data-glitch]").forEach(function (host) {
    var target = host.classList.contains("glitch") ? host : host.querySelector(".glitch");
    if (!target) return;
    target.addEventListener("animationend", function () { target.classList.remove("glitching"); });
    // hover replay
    var hoverEl = host.hasAttribute("data-glitch-hover") ? host : target;
    hoverEl.addEventListener("mouseenter", function () { glitch(target); });
    // one burst shortly after load
    if (!reduce) setTimeout(function () { glitch(target); }, 550);
  });

  // ---- Finish cards: 3D tilt + shine tracking the pointer --------------
  document.querySelectorAll("[data-tilt]").forEach(function (card) {
    var sample = card.querySelector(".fin-sample");
    function onMove(e) {
      var r = card.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      if (!reduce && sample) {
        card.style.setProperty("--ry", ((px - 0.5) * 18).toFixed(2) + "deg");
        card.style.setProperty("--rx", ((0.5 - py) * 18).toFixed(2) + "deg");
      }
    }
    function reset() {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    }
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", reset);
  });
})();

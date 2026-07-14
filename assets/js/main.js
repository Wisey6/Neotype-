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

  // ---- Hero sticker peel wobble on load --------------------------------
  var main = document.querySelector(".hero-sticker-main");
  if (main && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    main.addEventListener("mousemove", function (e) {
      var r = main.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      main.style.transform = "rotate(-7deg) rotateY(" + (dx * 10) + "deg) rotateX(" + (-dy * 10) + "deg)";
    });
    main.addEventListener("mouseleave", function () {
      main.style.transform = "rotate(-7deg)";
    });
  }
})();

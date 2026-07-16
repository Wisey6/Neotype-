/* ==========================================================================
   Neotype, site interactions: mobile nav, scroll reveals, FAQ, toast,
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
      showToast("You're in, 15% off is on its way to " + val);
      form.reset();
    });
  }

  // ---- Enquiry form -----------------------------------------------------
  var contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (document.getElementById("cfName") || {}).value || "";
      var email = (document.getElementById("cfEmail") || {}).value || "";
      var topic = (document.getElementById("cfTopic") || {}).value || "";
      var msg = (document.getElementById("cfMsg") || {}).value || "";
      if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !msg.trim()) {
        showToast("Please add your name, a valid email and a message");
        return;
      }
      var cfg = window.NEOTYPE_CONTACT || {};
      var btn = contactForm.querySelector("button[type=submit]");
      if (!cfg.web3formsKey) {
        // demo mode: no delivery wired yet
        showToast("Thanks " + name.trim().split(" ")[0] + ", we'll be in touch soon");
        contactForm.reset();
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          access_key: cfg.web3formsKey,
          subject: "Neotype enquiry: " + topic,
          from_name: "Neotype website",
          name: name, email: email, topic: topic, message: msg
        })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.success) { showToast("Thanks " + name.trim().split(" ")[0] + ", your enquiry is on its way"); contactForm.reset(); }
        else { showToast("Couldn't send just now, please email us directly"); }
      }).catch(function () { showToast("Couldn't send just now, please email us directly"); })
        .then(function () { if (btn) { btn.disabled = false; btn.innerHTML = "Send enquiry <span class=\"arrow\">→</span>"; } });
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

/* ==========================================================================
   Specimen marquee: build a rolling wall of realistic die-cut stickers.
   Each chip is a white "cut" face hugging the shape with a coloured fill,
   gloss and drop shadow, so it reads as a physical peeled sticker.
   ========================================================================== */
(function () {
  "use strict";
  var top = document.getElementById("mqTop");
  var bot = document.getElementById("mqBot");
  if (!top || !bot) return;

  // shape, fill, and content (emoji chips or short text) — mixed for variety
  var STICKERS = [
    { s: "star",     f: "holo",    e: "⭐" },
    { s: "blobA",    f: "teal",    t: "stay|weird" },
    { s: "circle",   f: "purple",  e: "👾" },
    { s: "pill",     f: "green",   t: "good vibes", w: 236 },
    { s: "squircle", f: "pink",    t: "band|merch" },
    { s: "hex",      f: "blue",    e: "🎮" },
    { s: "blobB",    f: "glitter", t: "glitter" },
    { s: "round",    f: "chrome",  t: "chrome" },
    { s: "diamond",  f: "sun",     e: "⚡" },
    { s: "circle",   f: "coral",   e: "🌈" },
    { s: "burst",    f: "lime",    t: "new|drop" },
    { s: "shield",   f: "dark",    e: "🛸" },
    { s: "blobA",    f: "holo",    e: "🍄" },
    { s: "square",   f: "teal",    t: "ship|it" },
    { s: "pentagon", f: "purple",  e: "👽" },
    { s: "circle",   f: "green",   t: "hello!" },
    { s: "banner",   f: "pink",    t: "off grid", w: 214 },
    { s: "blobB",    f: "blue",    e: "🚀" },
    { s: "star",     f: "sun",     e: "🌟" },
    { s: "squircle", f: "glitter", t: "indie" },
    { s: "hex",      f: "coral",   e: "🔥" },
    { s: "circle",   f: "chrome",  e: "💿" },
    { s: "round",    f: "lime",    t: "game|on" },
    { s: "blobA",    f: "dark",    e: "🌌" },
    { s: "pill",     f: "holo",    t: "keep going", w: 244 },
    { s: "diamond",  f: "teal",    e: "🔺" },
    { s: "burst",    f: "purple",  e: "✨" },
    { s: "squircle", f: "blue",    t: "good|coffee" },
    { s: "blobB",    f: "pink",    e: "💀" },
    { s: "circle",   f: "sun",     t: "no rules" },
  ];

  var ROT = [-6, -3, 4, -5, 2, 6, -4, 3, -2, 5];

  function chip(item, i) {
    var st = document.createElement("div");
    st.className = "mk-st shp-" + item.s + " fill-" + item.f;
    st.style.setProperty("--rot", ROT[i % ROT.length] + "deg");
    if (item.w) st.style.setProperty("--w", item.w + "px");
    var face = document.createElement("div");
    face.className = "mk-face";
    var fill = document.createElement("div");
    fill.className = "mk-fill";
    if (item.e) {
      var em = document.createElement("span");
      em.className = "mk-emoji";
      em.textContent = item.e;
      fill.appendChild(em);
    } else {
      fill.innerHTML = item.t.split("|").join("<br>");
    }
    face.appendChild(fill);
    st.appendChild(face);
    return st;
  }

  // split into two rows, then duplicate each row's content for a seamless loop
  function fillRow(track, items) {
    var pass, i, el;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < items.length; i++) {
        el = chip(items[i], i);
        if (pass === 1) el.setAttribute("aria-hidden", "true");
        track.appendChild(el);
      }
    }
  }

  var half = Math.ceil(STICKERS.length / 2);
  fillRow(top, STICKERS.slice(0, half));
  fillRow(bot, STICKERS.slice(half));
})();

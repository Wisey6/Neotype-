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

  /* ======================================================================
     THE SHELL
     One page, a left rail, and five panels. Nothing navigates away, so the
     loaded orders survive every switch and the whole tool feels instant.
     Order matters: Ian opens this to answer "what do I have to make today",
     so Dashboard is first and Pricing — set once, touched rarely — is last.
     ====================================================================== */
  var NAV = [
    { key: "dash",      label: "Dashboard", icon: "◧" },
    { key: "orders",    label: "Orders",    icon: "▤" },
    { key: "analytics", label: "Analytics", icon: "◔" },
    { key: "receipts",  label: "Receipts",  icon: "⎘" },
    { key: "pricing",   label: "Pricing",   icon: "◈" }
  ];
  var view = "dash";

  function showView(key) {
    view = key;
    NAV.forEach(function (n) {
      var btn = document.querySelector('[data-view="' + n.key + '"]');
      var panel = document.getElementById("panel-" + n.key);
      if (btn) btn.setAttribute("aria-current", n.key === key ? "page" : "false");
      if (panel) panel.hidden = n.key !== key;
    });
    // re-render the panels whose contents depend on the loaded orders
    if (key === "analytics") renderAnalytics();
    if (key === "receipts") renderReceipts();
    var main = document.querySelector(".adm-main");
    if (main) main.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" in document.body.style ? "instant" : "auto" });
  }

  function navHtml() {
    return '<nav class="adm-rail" aria-label="Admin sections">' +
      '<span class="adm-rail-h">Neotype</span>' +
      NAV.map(function (n) {
        return '<button class="adm-navbtn" data-view="' + n.key + '" aria-current="' +
          (n.key === view ? "page" : "false") + '"><span class="adm-navic" aria-hidden="true">' +
          n.icon + "</span>" + n.label + "</button>";
      }).join("") +
      '<a class="adm-navbtn adm-navbtn--out" href="index.html"><span class="adm-navic" aria-hidden="true">↗</span>View site</a>' +
      "</nav>";
  }

  function buildForm(pricing) {
    D = pricing;
    var html = navHtml() + '<div class="adm-main">' +
      // ---- Dashboard
      '<section class="adm-panel" id="panel-dash">' +
      '<div class="section-head"><span class="eyebrow">Neotype workshop</span>' +
      '<h1 class="display-lg">Today</h1>' +
      '<p class="lead" id="admToday">Loading your orders…</p></div>' +
      '<div id="admDash"></div>' +
      '<section class="adm-card" id="admEnq"><div class="adm-card-h"><h2>Enquiries</h2>' +
      '<span class="adm-note">from the contact form on the website</span></div>' +
      '<p class="lead" id="admEnqBody">Loading…</p></section>' +
      "</section>" +
      // ---- Orders (full table + manual entry)
      '<section class="adm-panel" id="panel-orders" hidden>' +
      '<div class="section-head"><span class="eyebrow">Every order</span>' +
      '<h1 class="display-lg">Orders</h1>' +
      '<p class="lead">Everything that has come through, newest first — website and phone orders together.</p></div>' +
      '<div id="admOrdersFull"></div>' + manualForm() +
      "</section>" +
      // ---- Analytics
      '<section class="adm-panel" id="panel-analytics" hidden>' +
      '<div class="section-head"><span class="eyebrow">The numbers</span>' +
      '<h1 class="display-lg">Analytics</h1>' +
      '<p class="lead">Where the money actually comes from. Paid orders only — pending and failed are excluded so nothing is counted before it clears.</p></div>' +
      '<div id="admAnalytics"></div>' +
      "</section>" +
      // ---- Receipts
      '<section class="adm-panel" id="panel-receipts" hidden>' +
      '<div class="section-head"><span class="eyebrow">Money in</span>' +
      '<h1 class="display-lg">Receipts</h1>' +
      '<p class="lead">Every payment, with a link straight to it in Stripe. Stripe is the record for tax and refunds — this is the index into it.</p></div>' +
      '<div id="admReceipts"></div>' +
      "</section>" +
      // ---- Pricing
      '<section class="adm-panel" id="panel-pricing" hidden>' +
      '<div class="section-head"><span class="eyebrow">Set once, change anytime</span>' +
      '<h1 class="display-lg">Pricing</h1>' +
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
      '<span class="adm-hint">Signed in · changes go live the moment you save</span></div>' +
      "</section></div>";

    root.className = "adm-shell";
    root.innerHTML = html;
    document.getElementById("admSave").addEventListener("click", save);
    document.getElementById("admReload").addEventListener("click", load);
    root.addEventListener("input", onEdit);
    // One delegated listener for the whole shell: the pipeline and tables
    // re-render on every change, so per-button handlers would be lost.
    root.addEventListener("click", function (e) {
      var t = e.target;
      var nav = t.closest && t.closest("[data-view]");
      if (nav) { showView(nav.getAttribute("data-view")); return; }
      var adv = t.closest && t.closest(".pipe-adv");
      if (adv) { advance(adv.getAttribute("data-key"), adv.getAttribute("data-stage"), adv); return; }
      if (t.closest && t.closest("#admManualSave")) { saveManual(t.closest("#admManualSave")); return; }
      var jump = t.closest && t.closest("[data-goto]");
      if (jump) showView(jump.getAttribute("data-goto"));
    });
    showView(view);
    loadOrders();
    loadEnquiries();
  }

  /* ======================================================================
     THE DASHBOARD
     Built for one person running a print shop. The question it answers first
     is "what do I have to do today, and what's late" — not "how is revenue
     trending". So: counts, then a pipeline, then one chart.
     ====================================================================== */

  var STAGES = [
    { key: "new",      label: "New",        next: "proof",    cta: "Send proof" },
    { key: "proof",    label: "Proof sent", next: "approved", cta: "Mark approved" },
    { key: "approved", label: "Approved",   next: "shipped",  cta: "Mark shipped" },
    { key: "shipped",  label: "Shipped",    next: null,       cta: null }
  ];
  var STAGE_LABEL = {};
  STAGES.forEach(function (s) { STAGE_LABEL[s.key] = s.label; });

  var ORDERS = [];   // the loaded list, kept so the pipeline can re-render

  // ---- due dates ----------------------------------------------------------
  // Derived, not stored: the turnaround the customer paid for sets the promise.
  // Business days only — a Friday next-day order is due Monday, not Saturday.
  function turnaroundDays(t) {
    t = String(t || "");
    if (/next\s*day/i.test(t)) return 1;
    if (/^2\s*day/i.test(t)) return 2;
    return 4;                                  // Standard (~4 days)
  }
  function addBusinessDays(from, n) {
    var d = new Date(from.getTime());
    while (n > 0) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) n--;
    }
    return d;
  }
  function startOfDay(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
  function dueInfo(o) {
    var placed = new Date(o.when);
    if (isNaN(placed)) return null;
    var due = addBusinessDays(placed, turnaroundDays(o.turnaround));
    var days = Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);
    // A shipped job is finished: it must never be labelled late, however long
    // ago it was due. Showing "38 days late" on completed work is alarming and
    // wrong, and it buries the jobs that genuinely need attention.
    if (o.stage === "shipped") return { due: due, days: days, urgency: "done", label: "Shipped" };
    return {
      due: due, days: days,
      urgency: days < 0 ? "late" : days === 0 ? "today" : days === 1 ? "soon" : "ok",
      label: days < 0 ? Math.abs(days) + (Math.abs(days) === 1 ? " day late" : " days late")
        : days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : "Due in " + days + " days"
    };
  }
  function money0(cents) { return "$" + Math.round(cents / 100).toLocaleString(); }

  // ---- the top row of numbers --------------------------------------------
  function tiles(list) {
    var paid = list.filter(function (o) { return (o.status || "paid") === "paid"; });
    var open = paid.filter(function (o) { return (o.stage || "new") !== "shipped"; });
    var late = 0, today = 0;
    open.forEach(function (o) {
      var d = dueInfo(o); if (!d) return;
      if (d.urgency === "late") late++; else if (d.urgency === "today") today++;
    });
    var now = new Date(), monthCents = 0;
    paid.forEach(function (o) {
      var w = new Date(o.when);
      if (!isNaN(w) && w.getMonth() === now.getMonth() && w.getFullYear() === now.getFullYear()) monthCents += o.amount || 0;
    });
    var awaiting = list.filter(function (o) { return o.status === "pending"; }).length;

    var t = [
      { n: open.length, label: "To make", note: open.length ? "paid and not shipped" : "all caught up", tone: "" },
      { n: late, label: "Late", note: late ? "past the promised date" : "nothing overdue", tone: late ? "bad" : "good" },
      { n: today, label: "Due today", note: today ? "get these out" : "nothing due today", tone: today ? "warn" : "" },
      { n: money0(monthCents), label: "This month", note: "paid orders", tone: "accent" }
    ];
    if (awaiting) t.push({ n: awaiting, label: "Awaiting payment", note: "don't print yet", tone: "warn" });

    return '<div class="dash-tiles">' + t.map(function (x) {
      return '<div class="dash-tile' + (x.tone ? " is-" + x.tone : "") + '">' +
        '<span class="dash-n">' + esc(x.n) + "</span>" +
        '<span class="dash-l">' + esc(x.label) + "</span>" +
        '<span class="dash-note">' + esc(x.note) + "</span></div>";
    }).join("") + "</div>";
  }

  // ---- the pipeline -------------------------------------------------------
  function pipeline(list) {
    var paid = list.filter(function (o) { return (o.status || "paid") === "paid"; });
    var cols = STAGES.map(function (st) {
      var inStage = paid.filter(function (o) { return (o.stage || "new") === st.key; });
      // most urgent first, so the next thing to do is always at the top
      inStage.sort(function (a, b) {
        // live columns: most urgent first. Shipped: most recent first.
        if (st.key === "shipped") return new Date(b.when) - new Date(a.when);
        var da = dueInfo(a), db = dueInfo(b);
        return (da ? da.days : 9e9) - (db ? db.days : 9e9);
      });
      // Shipped is history, not a worklist — show the last few and count the
      // rest, so finished jobs never push live ones off the screen.
      var shown = st.key === "shipped" ? inStage.slice(0, 3) : inStage;
      var more = inStage.length - shown.length;
      var body = inStage.length
        ? shown.map(function (o) { return pipeCard(o, st); }).join("") +
          (more > 0 ? '<p class="pipe-empty">+ ' + more + " more shipped</p>" : "")
        : '<p class="pipe-empty">' + (st.key === "shipped" ? "Nothing shipped yet" : "Nothing here") + "</p>";
      return '<div class="pipe-col" data-stage="' + st.key + '">' +
        '<div class="pipe-head"><span>' + esc(st.label) + "</span>" +
        '<b class="pipe-count">' + inStage.length + "</b></div>" + body + "</div>";
    }).join("");
    return '<div class="dash-card"><div class="dash-card-h"><h2>Pipeline</h2>' +
      '<span class="adm-note">tap a button to move a job along</span></div>' +
      '<div class="pipe">' + cols + "</div></div>";
  }

  function pipeCard(o, st) {
    var d = dueInfo(o);
    var item = [o.quantity, o.size, o.finish, o.shape].filter(Boolean).join(" · ") || o.product || "Order";
    return '<div class="pipe-job' + (d && d.urgency !== "ok" && d.urgency !== "done" ? " is-" + d.urgency : "") + '">' +
      '<div class="pipe-job-top"><b>' + esc(item) + "</b>" +
      '<span class="pipe-amt">' + esc(money0(o.amount || 0)) + "</span></div>" +
      '<div class="pipe-job-meta">' + esc(o.name || o.email || "") +
      (d ? ' · <span class="pipe-due is-' + d.urgency + '">' + esc(d.label) + "</span>" : "") + "</div>" +
      '<div class="pipe-job-act">' +
      (/^https?:\/\//.test(o.artwork || "")
        ? '<a class="pipe-mini" href="' + esc(o.artwork) + '" title="Download the print file">⬇ Art</a>'
        : '<span class="pipe-mini is-off" title="The customer did not attach a file">no art</span>') +
      (o.email ? '<a class="pipe-mini" href="mailto:' + esc(o.email) +
        "?subject=" + encodeURIComponent("Your Neotype order " + (o.ref || "")) + '">✉ Email</a>' : "") +
      (st.next ? '<button class="pipe-adv" data-key="' + esc(o.key || "") + '" data-stage="' + st.next + '">' +
        esc(st.cta) + " →</button>" : "") +
      "</div></div>";
  }

  // ---- revenue, last 8 weeks ---------------------------------------------
  // Single series, so no legend is needed — the heading names it. Bars use
  // #04a49f: the brand's own teal step that passes the dark-surface contrast
  // and lightness checks (the brighter #06e4dd does not).
  function revenue(list) {
    var weeks = [], now = startOfDay(new Date());
    for (var i = 7; i >= 0; i--) {
      var end = new Date(now.getTime() - i * 7 * 86400000);
      var start = new Date(end.getTime() - 6 * 86400000);
      weeks.push({ start: start, end: end, cents: 0 });
    }
    list.filter(function (o) { return (o.status || "paid") === "paid"; }).forEach(function (o) {
      var w = startOfDay(new Date(o.when));
      weeks.forEach(function (b) { if (w >= b.start && w <= b.end) b.cents += o.amount || 0; });
    });
    var max = Math.max.apply(null, weeks.map(function (b) { return b.cents; }));
    var withMoney = weeks.filter(function (b) { return b.cents > 0; }).length;

    if (withMoney < 2) {
      return '<div class="dash-card"><div class="dash-card-h"><h2>Revenue</h2>' +
        '<span class="adm-note">last 8 weeks</span></div>' +
        '<p class="dash-thin">Not enough history yet — this chart fills itself in as ' +
        "orders come through. Nothing to fix.</p></div>";
    }
    var fmt = function (d) { return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
    var bars = weeks.map(function (b, i) {
      // A week with no money must render NO bar. Giving zero a small stub reads
      // as "a little came in", which is a different and wrong answer.
      var pct = b.cents && max ? Math.max(2, Math.round((b.cents / max) * 100)) : 0;
      var last = i === weeks.length - 1;
      return '<div class="rev-col" title="' + esc(fmt(b.start) + " – " + fmt(b.end) + ": " + money0(b.cents)) + '">' +
        '<span class="rev-val">' + (b.cents ? esc(money0(b.cents)) : "") + "</span>" +
        (pct ? '<span class="rev-bar' + (last ? " is-now" : "") + '" style="height:' + pct + '%"></span>'
             : '<span class="rev-zero" aria-hidden="true"></span>') +
        '<span class="rev-x">' + esc(last ? "This wk" : fmt(b.start)) + "</span></div>";
    }).join("");
    var total = weeks.reduce(function (a, b) { return a + b.cents; }, 0);
    return '<div class="dash-card"><div class="dash-card-h"><h2>Revenue</h2>' +
      '<span class="adm-note">' + esc(money0(total)) + " over the last 8 weeks</span></div>" +
      '<div class="rev-chart">' + bars + "</div></div>";
  }

  function renderDash() {
    var host = document.getElementById("admDash");
    if (!host) return;
    var paid = ORDERS.filter(function (o) { return (o.status || "paid") === "paid"; });
    var open = paid.filter(function (o) { return (o.stage || "new") !== "shipped"; });
    var late = open.filter(function (o) { var d = dueInfo(o); return d && d.urgency === "late"; }).length;
    var head = document.getElementById("admToday");
    if (head) {
      head.innerHTML = !ORDERS.length
        ? "No orders yet. When one comes in it lands here, with the customer's artwork attached."
        : late
          ? "<b class=\"tint-warn\">" + late + (late === 1 ? " order is" : " orders are") + " past the promised date.</b> " +
            open.length + " to make in total."
          : open.length
            ? "<b>" + open.length + (open.length === 1 ? " order" : " orders") + " to make</b>, all on schedule."
            : "Everything's shipped. Nothing waiting on you.";
    }
    host.innerHTML = tiles(ORDERS) + pipeline(ORDERS) + revenue(ORDERS);
  }

  /* ======================================================================
     ANALYTICS
     Product mix is the one question a print shop actually acts on: it decides
     what stock to hold. Three categories, so a bar chart with the value read
     directly off each bar — not a pie, which makes three similar shares
     impossible to compare.

     Palette: #04a49f (teal-2) / #8f6ce6 (purple-2) / #c1861f. Two are brand
     tokens. It was validated with the dataviz validator against the real card
     surface #1c242c across ALL pairs — the obvious brand green failed the
     normal-vision floor against the teal (ΔE 11.9, needs ≥15), so amber
     replaced it. Every bar is also directly labelled, so identity never rests
     on colour alone.
     ====================================================================== */
  var MIX = {
    stickers: { label: "Stickers", color: "#04a49f" },
    banner:   { label: "Banners",  color: "#8f6ce6" },
    corflute: { label: "Corflute", color: "#c1861f" },
    other:    { label: "Other",    color: "#6c7f86" }
  };

  function analyticsStat(label, value, sub) {
    return '<div class="an-stat"><span class="an-stat-l">' + esc(label) + "</span>" +
      '<b class="an-stat-v">' + esc(value) + "</b>" +
      (sub ? '<span class="an-stat-s">' + esc(sub) + "</span>" : "") + "</div>";
  }

  function renderAnalytics() {
    var host = document.getElementById("admAnalytics");
    if (!host) return;
    var paid = ORDERS.filter(function (o) { return (o.status || "paid") === "paid"; });

    if (!paid.length) {
      host.innerHTML = '<div class="dash-card"><p class="dash-thin">No paid orders yet. ' +
        "These charts build themselves as orders come in — there's nothing to set up.</p></div>";
      return;
    }

    var total = paid.reduce(function (a, o) { return a + (o.amount || 0); }, 0);
    var avg = Math.round(total / paid.length);
    var online = paid.filter(function (o) { return (o.source || "stripe") === "stripe"; }).length;

    // 30-day window, for a figure Ian can compare month to month
    var cut = new Date().getTime() - 30 * 86400000;
    var last30 = paid.filter(function (o) { return new Date(o.when).getTime() >= cut; });
    var cents30 = last30.reduce(function (a, o) { return a + (o.amount || 0); }, 0);

    // ---- product mix
    var by = {};
    Object.keys(MIX).forEach(function (k) { by[k] = { cents: 0, n: 0 }; });
    paid.forEach(function (o) {
      var k = MIX[o.product] ? o.product : "other";
      by[k].cents += o.amount || 0; by[k].n++;
    });
    var rows = Object.keys(MIX).filter(function (k) { return by[k].n > 0; })
      .sort(function (a, b) { return by[b].cents - by[a].cents; });
    var max = Math.max.apply(null, rows.map(function (k) { return by[k].cents; }));

    var mix = rows.map(function (k) {
      var pct = max ? Math.max(1.5, (by[k].cents / max) * 100) : 1.5;
      var share = total ? Math.round((by[k].cents / total) * 100) : 0;
      return '<div class="mix-row">' +
        '<span class="mix-label"><i class="mix-dot" style="background:' + MIX[k].color + '"></i>' +
        esc(MIX[k].label) + "</span>" +
        '<span class="mix-track"><span class="mix-bar" style="width:' + pct.toFixed(1) +
          "%;background:" + MIX[k].color + '"></span></span>' +
        '<b class="mix-val">' + esc(money0(by[k].cents)) + "</b>" +
        '<span class="mix-share">' + share + "%</span></div>";
    }).join("");

    // A table view of the same numbers, so the chart is never the only way in.
    var table = '<table class="an-table"><caption class="adm-note">Product mix in full</caption>' +
      "<thead><tr><th>Product</th><th>Orders</th><th>Revenue</th><th>Share</th><th>Average</th></tr></thead><tbody>" +
      rows.map(function (k) {
        return "<tr><td>" + esc(MIX[k].label) + "</td><td>" + by[k].n + "</td><td>" +
          esc(money0(by[k].cents)) + "</td><td>" + (total ? Math.round((by[k].cents / total) * 100) : 0) +
          "%</td><td>" + esc(money0(by[k].cents / by[k].n)) + "</td></tr>";
      }).join("") + "</tbody></table>";

    host.innerHTML =
      '<div class="an-stats">' +
        analyticsStat("Revenue, last 30 days", money0(cents30), last30.length + (last30.length === 1 ? " order" : " orders")) +
        analyticsStat("Average order", money0(avg), "across " + paid.length + " paid") +
        analyticsStat("All time", money0(total), "since the shop opened") +
        analyticsStat("From the website", online + " of " + paid.length,
          paid.length - online === 0 ? "none typed in by hand" : (paid.length - online) + " added manually") +
      "</div>" +
      '<div class="dash-card"><div class="dash-card-h"><h2>What sells</h2>' +
      '<span class="adm-note">revenue by product, all paid orders</span></div>' +
      '<div class="mix-chart">' + mix + "</div>" +
      '<details class="an-details"><summary>See the numbers</summary>' + table + "</details></div>" +
      revenue(ORDERS);
  }

  /* ======================================================================
     RECEIPTS — an index into Stripe, not a replacement for it.
     ====================================================================== */
  function renderReceipts() {
    var host = document.getElementById("admReceipts");
    if (!host) return;
    var paid = ORDERS.filter(function (o) { return (o.status || "paid") === "paid"; });
    if (!paid.length) {
      host.innerHTML = '<div class="dash-card"><p class="dash-thin">No payments yet.</p></div>';
      return;
    }
    var total = paid.reduce(function (a, o) { return a + (o.amount || 0); }, 0);
    host.innerHTML = '<div class="dash-card"><div class="dash-card-h"><h2>' + paid.length +
      " payment" + (paid.length === 1 ? "" : "s") + "</h2>" +
      '<span class="adm-note">' + esc(money0(total)) + " received</span></div>" +
      '<div class="rec-list">' + paid.map(function (o) {
        var manual = (o.source || "stripe") === "manual";
        return '<div class="rec-row">' +
          '<span class="rec-when">' + esc(whenLabel(o.when)) + "</span>" +
          '<span class="rec-who">' + esc(o.name || o.email || "—") + "</span>" +
          '<span class="rec-ref">' + esc(o.ref || "") + "</span>" +
          '<b class="rec-amt">' + esc(money0(o.amount || 0)) + "</b>" +
          (manual
            ? '<span class="rec-src">Added by hand</span>'
            : '<a class="rec-link" href="https://dashboard.stripe.com/payments/' +
              encodeURIComponent(o.session || "") + '" target="_blank" rel="noopener">Open in Stripe ↗</a>') +
          "</div>";
      }).join("") + "</div>" +
      '<p class="dash-thin">Stripe holds the tax record and handles refunds. ' +
      "Orders added by hand have no Stripe payment to open.</p></div>";
  }

  /* ======================================================================
     MANUAL ORDERS — phone, walk-in, an invoice Ian raised himself. Without
     this the dashboard only ever shows the online slice of the business, and
     the pipeline stops being the real to-do list.
     ====================================================================== */
  function manualForm() {
    var f = function (id, label, attrs, hint) {
      return '<label class="mf-field"><span>' + label + "</span><input id=\"" + id + "\" " +
        (attrs || "") + " />" + (hint ? '<em class="mf-hint">' + hint + "</em>" : "") + "</label>";
    };
    return '<details class="adm-card mf-card"><summary><b>+ Add an order that didn\'t come from the website</b>' +
      '<span class="adm-note">phone, walk-in, or one you invoiced yourself</span></summary>' +
      '<div class="mf-grid">' +
      f("mfName", "Customer name", 'type="text" autocomplete="off"') +
      f("mfAmount", "Amount paid (AUD)", 'type="number" step="0.01" min="0" placeholder="250.00"') +
      '<label class="mf-field"><span>Product</span><select id="mfProduct">' +
        '<option value="stickers">Stickers</option><option value="banner">Banners</option>' +
        '<option value="corflute">Corflute signs</option><option value="other">Other</option>' +
      "</select></label>" +
      '<label class="mf-field"><span>Turnaround</span><select id="mfTurn">' +
        '<option value="Standard (~4 days)">Standard (~4 days)</option>' +
        '<option value="2 days">2 days</option><option value="Next day">Next day</option>' +
      "</select></label>" +
      f("mfQty", "Quantity", 'type="text" placeholder="20"') +
      f("mfSize", "Size", 'type="text" placeholder="600 × 900 mm"') +
      f("mfEmail", "Email", 'type="email" autocomplete="off"') +
      f("mfPhone", "Phone", 'type="tel" autocomplete="off"') +
      f("mfWhen", "Date ordered", 'type="date"', "Leave blank for today — this sets the due date") +
      f("mfArtwork", "Artwork link", 'type="url" placeholder="https://…"', "Optional, if the file is somewhere online") +
      '<label class="mf-field mf-wide"><span>Note</span><textarea id="mfNote" rows="2" placeholder="Paid by bank transfer, wants them by Friday"></textarea></label>' +
      "</div>" +
      '<div class="mf-actions"><button class="btn btn--accent" id="admManualSave">Add order</button>' +
      '<span class="adm-hint">It lands in the pipeline at <b>New</b>, counted as paid.</span></div>' +
      "</details>";
  }

  function saveManual(btn) {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    var payload = {
      name: v("mfName"), amount: v("mfAmount"), product: v("mfProduct"),
      turnaround: v("mfTurn"), quantity: v("mfQty"), size: v("mfSize"),
      email: v("mfEmail"), phone: v("mfPhone"), note: v("mfNote"), artwork: v("mfArtwork")
    };
    if (v("mfWhen")) payload.when = new Date(v("mfWhen") + "T09:00:00").toISOString();
    if (!payload.name) { toast("Add the customer's name"); return; }
    if (!payload.amount) { toast("Add the amount they paid"); return; }

    btn.disabled = true; btn.textContent = "Adding…";
    fetch(API + "/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": password },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) { toast(res.d.error || "Couldn't add that order"); return; }
        toast("Added — it's in the pipeline as " + res.d.order.ref);
        ["mfName", "mfAmount", "mfQty", "mfSize", "mfEmail", "mfPhone", "mfNote", "mfArtwork", "mfWhen"]
          .forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
        loadOrders();
      })
      .catch(function () { toast("Couldn't add that order"); })
      .then(function () { btn.disabled = false; btn.textContent = "Add order"; });
  }

  // Every panel reads the same ORDERS array, so one load refreshes all of them
  // and switching views never shows a stale number next to a fresh one.
  function renderAll() {
    renderDash();
    var full = document.getElementById("admOrdersFull");
    if (full) full.innerHTML = ordersTable(ORDERS);
    if (view === "analytics") renderAnalytics();
    if (view === "receipts") renderReceipts();
  }

  // ---- advance a job ------------------------------------------------------
  function advance(key, stage, btn) {
    if (!key) { toast("That order is missing its reference — reload the page"); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    fetch(API + "/order-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Password": password },
      body: JSON.stringify({ key: key, stage: stage })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) { toast(res.d.error || "Couldn't move that order"); if (btn) btn.disabled = false; return; }
        ORDERS.forEach(function (o) { if (o.key === key) o.stage = stage; });
        toast("Moved to " + (STAGE_LABEL[stage] || stage));
        renderAll();
      })
      .catch(function () { toast("Couldn't move that order"); if (btn) btn.disabled = false; });
  }

  // ---- orders -------------------------------------------------------------
  function loadOrders() {
    fetch(API + "/orders", { headers: { "X-Admin-Password": password } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        ORDERS = (d && d.orders) || [];
        renderAll();
      })
      .catch(function () {
        var h = document.getElementById("admToday");
        if (h) h.textContent = "Couldn't load your orders — check your connection and reload.";
      });
  }

  /* The full list, under the pipeline: every order including unpaid ones, with
     the detail the pipeline card leaves out. Newest first. */
  function ordersTable(list) {
    if (!list.length) {
      return '<div class="dash-card"><div class="dash-card-h"><h2>All orders</h2></div>' +
        '<p class="dash-thin">Nothing yet. Paid orders appear here automatically with the ' +
        "customer's artwork attached. Stripe stays the record for the money itself.</p></div>";
    }
    var rows = list.map(function (o) {
      var item = [o.quantity, o.size, o.finish, o.shape].filter(Boolean).join(" · ") || o.product || "Order";
      // Orders recorded before payment states existed have no `status`, and only
      // paid orders were ever stored back then — so treat it as paid.
      var st = o.status || "paid";
      var paid = st === "paid";
      var d = paid ? dueInfo(o) : null;
      var pill = paid ? "" : st === "pending"
        ? '<span class="adm-ord-pill is-pending">Awaiting payment</span>'
        : '<span class="adm-ord-pill is-failed">Payment failed</span>';
      return '<div class="adm-enq adm-ord' + (paid ? "" : " adm-ord--" + esc(st)) + '">' +
        '<div class="adm-enq-top"><b>' + esc(item) + "</b>" + pill +
        '<span class="adm-ord-amt">$' + (o.amount / 100).toFixed(2) + " " + esc(o.currency || "AUD") + "</span>" +
        '<span class="adm-enq-when">' + esc(whenLabel(o.when)) + "</span></div>" +
        '<div class="adm-ord-meta"><span>Ref <b>' + esc(o.ref) + "</b></span>" +
        (paid ? "<span>" + esc(STAGE_LABEL[o.stage || "new"]) + "</span>" : "") +
        (d ? '<span class="pipe-due is-' + d.urgency + '">' + esc(d.label) + "</span>" : "") +
        (o.turnaround ? "<span>" + esc(o.turnaround) + "</span>" : "") +
        (o.name ? "<span>" + esc(o.name) + "</span>" : "") + "</div>" +
        (o.email ? '<a class="adm-enq-mail" href="mailto:' + esc(o.email) +
          "?subject=" + encodeURIComponent("Your Neotype order " + (o.ref || "")) + '">' + esc(o.email) + "</a>" : "") +
        // The artwork button is deliberately withheld unless the money has
        // cleared, so an unpaid job can't be sent to print by habit.
        (!paid
          ? '<p class="adm-ord-art adm-ord-hold">' + (st === "pending"
              ? "⏳ Money not cleared yet — <b>do not print</b>. This updates itself when the bank confirms."
              : "✕ Payment failed — <b>do not print</b>. Kept here so you know it happened.") + "</p>"
          : /^https?:\/\//.test(o.artwork || "")
            ? '<p class="adm-ord-art"><a class="btn btn--ghost btn--sm" href="' + esc(o.artwork) + '">⬇ Download artwork</a></p>'
            : '<p class="adm-ord-art adm-ord-noart">⚠ No artwork file — chase the customer for it</p>') +
        "</div>";
    }).join("");
    return '<div class="dash-card"><div class="dash-card-h"><h2>All orders</h2>' +
      '<span class="adm-note">' + list.length + " total, newest first</span></div>" +
      '<div class="adm-enq-list">' + rows + "</div></div>";
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

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
    // The workshop comes first: what's due, what's late, what's in flight.
    // Prices are set once and rarely touched, so they live at the bottom.
    var html =
      '<div class="section-head"><span class="eyebrow">Neotype workshop</span>' +
      '<h1 class="display-lg">Today</h1>' +
      '<p class="lead" id="admToday">Loading your orders…</p></div>' +
      '<div id="admDash"></div>' +
      '<section class="adm-card" id="admEnq"><div class="adm-card-h"><h2>Enquiries</h2>' +
      '<span class="adm-note">from the contact form on the website</span></div>' +
      '<p class="lead" id="admEnqBody">Loading…</p></section>' +
      '<div class="section-head" style="margin-top:56px"><span class="eyebrow">Set once, change anytime</span>' +
      '<h2 class="display-lg">Pricing</h2>' +
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

    root.innerHTML = html;
    document.getElementById("admSave").addEventListener("click", save);
    document.getElementById("admReload").addEventListener("click", load);
    root.addEventListener("input", onEdit);
    // one delegated listener: the pipeline re-renders, so per-button handlers
    // would be lost on every move
    root.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".pipe-adv");
      if (b) advance(b.getAttribute("data-key"), b.getAttribute("data-stage"), b);
    });
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
      var pct = max ? Math.max(2, Math.round((b.cents / max) * 100)) : 2;
      var last = i === weeks.length - 1;
      return '<div class="rev-col" title="' + esc(fmt(b.start) + " – " + fmt(b.end) + ": " + money0(b.cents)) + '">' +
        '<span class="rev-val">' + (b.cents ? esc(money0(b.cents)) : "") + "</span>" +
        '<span class="rev-bar' + (last ? " is-now" : "") + '" style="height:' + pct + '%"></span>' +
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
    host.innerHTML = tiles(ORDERS) + pipeline(ORDERS) + revenue(ORDERS) + ordersTable(ORDERS);
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
        renderDash();
      })
      .catch(function () { toast("Couldn't move that order"); if (btn) btn.disabled = false; });
  }

  // ---- orders -------------------------------------------------------------
  function loadOrders() {
    fetch(API + "/orders", { headers: { "X-Admin-Password": password } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        ORDERS = (d && d.orders) || [];
        renderDash();
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

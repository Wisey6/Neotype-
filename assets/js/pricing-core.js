/* ==========================================================================
   Neotype pricing core — THE single source of truth for prices.

   Loaded three ways, all from this one file so they can never disagree:
     • browser  <script src="assets/js/pricing-core.js">  → window.NeotypePricing
     • function import pricing from "../../assets/js/pricing-core.js"
     • node     require("./assets/js/pricing-core.js")

   The customer's browser shows a price; the Netlify Function charges the card.
   Both call the functions below, so what is displayed is what is charged.

   ---------------------------------------------------------------------------
   How the numbers were set (do not "fix" these from eprintonline's page):

   eprintonline's calculators expose `prod_baseprice` — 36.40 for stickers, 57
   for banners. These are SETUP figures, not per-square-metre rates. Proof: at
   $57/m² a 3×1 m banner would cost $171, but their own page quotes $86.88 for
   one. Our banner rate of $29/m² returns $87.00 for that banner, matching their
   real quote to 0.1%. Applying 36.40 as a sticker rate would cut sticker prices
   57–70% (100×3″ from $71 to $21), almost certainly below cost.
   ---------------------------------------------------------------------------
   ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NeotypePricing = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // ---- the editable price table (admin overrides these numbers) -----------
  var DEFAULT_PRICING = {
    stickers: {
      min: 18,
      rate: { base: 85, extra: 120, decay: 0.5 },
      finish: {
        "vinyl-matte": 1.00, "vinyl-gloss": 1.05, "satin": 1.03,
        "holographic": 1.50, "glitter": 1.45, "chrome": 1.60, "clear": 1.15
      },
      shape: { die: 1.00, kiss: 1.02, circle: 0.97, square: 0.95, rect: 0.96, rounded: 0.97, sheet: 1.10 },
      turnaround: { standard: 1.00, "2day": 1.25, nextday: 1.50 }
    },
    banner: {
      rate: 29, min: 35,
      material: { "vinyl-440": 1.00, "mesh": 1.12 },
      finishing: { "hem-eyelets": 1.00, "trim-eyelets": 0.95, "trim": 0.90, "pole": 1.06 },
      eyelets: { standard: 1.00, "extra-even": 1.06, "extra-custom": 1.08 },
      rope: { none: 1.00, "with-rope": 1.05 },
      turnaround: { standard: 1.00, "2day": 1.25, nextday: 1.50 }
    },
    corflute: {
      rate: 58, min: 30,
      thickness: { "3mm": 1.00, "5mm": 1.18 },
      sides: { single: 1.00, double: 1.65 },
      eyelets: { none: 1.00, corners: 1.05 },
      turnaround: { standard: 1.00, "2day": 1.25, nextday: 1.50 }
    }
  };

  // ---- labels + allowed values (NOT admin-editable) ----------------------
  var FINISH_LABEL = {
    "vinyl-matte": "Matte", "vinyl-gloss": "Gloss", "satin": "Satin",
    "holographic": "Holographic", "glitter": "Glitter", "chrome": "Chrome", "clear": "Clear"
  };
  var SHAPE_LABEL = {
    die: "Die-cut", kiss: "Kiss-cut", circle: "Circle", square: "Square",
    rect: "Rectangle", rounded: "Rounded", sheet: "Sheet"
  };
  var TURNAROUND_LABEL = { standard: "Standard (~4 days)", "2day": "2 days", nextday: "Next day" };

  var SIZES = [2, 3, 4, 5];
  var QTYS = [15, 50, 100, 200, 300, 500, 1000];

  // Large-format metadata. `qtys` is the list the UI renders AND the server
  // validates against, so a hand-crafted request can't buy a quantity the
  // shop never offered (and claim its bulk discount).
  var LF_META = {
    banner: {
      label: "Banner", wRange: [0.3, 6], hRange: [0.3, 3],
      qtys: [1, 2, 3, 5, 10, 25],
      groups: {
        material: { "vinyl-440": "440gsm PVC", "mesh": "Mesh (windy sites)" },
        finishing: { "hem-eyelets": "Hemmed + eyelets", "trim-eyelets": "Trimmed + eyelets", "trim": "Trimmed to size", "pole": "Pole pockets" },
        eyelets: { standard: "Standard (1 per metre)", "extra-even": "Extra, evenly spaced", "extra-custom": "Extra, custom spacing" },
        rope: { none: "No rope", "with-rope": "Rope included" },
        turnaround: TURNAROUND_LABEL
      }
    },
    corflute: {
      label: "Corflute sign", wRange: [0.3, 2.4], hRange: [0.3, 1.2],
      qtys: [1, 2, 5, 10, 25, 50, 100],
      groups: {
        thickness: { "3mm": "3 mm", "5mm": "5 mm" },
        sides: { single: "Single-sided", double: "Double-sided" },
        eyelets: { none: "None", corners: "4 corner eyelets" },
        turnaround: TURNAROUND_LABEL
      }
    }
  };

  // ---- maths -------------------------------------------------------------
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function areaM2(sizeIn) { var m = sizeIn * 0.0254; return m * m; }   // per sticker
  function ratePerM2(totalArea, r) {
    return num(r && r.base, 85) + num(r && r.extra, 120) * Math.exp(-totalArea / num(r && r.decay, 0.5));
  }
  function lfQtyMult(q) { return 0.6 + 0.4 * Math.exp(-(q - 1) / 20); }

  // The displayed total and the charged total must be the same number, so
  // both come from here. Whole dollars: the big figure on screen is exact.
  function money(total) { return Math.round(total); }
  function cents(total) { return money(total) * 100; }

  function mult(table, product, group, key) {
    var t = table[product] && table[product][group];
    var d = DEFAULT_PRICING[product][group];
    if (t && typeof t[key] === "number") return t[key];
    return d && typeof d[key] === "number" ? d[key] : 1;
  }

  /* ---- stickers ---------------------------------------------------------
     Returns null when the options aren't ones the shop offers. */
  function priceStickers(opt, table) {
    table = table || DEFAULT_PRICING;
    var finish = String(opt.finish || ""), shape = String(opt.shape || "");
    var turn = String(opt.turnaround || "standard");
    var size = parseInt(opt.size, 10), qty = parseInt(opt.qty, 10);
    if (!FINISH_LABEL[finish] || !SHAPE_LABEL[shape] || !TURNAROUND_LABEL[turn]) return null;
    if (SIZES.indexOf(size) === -1 || QTYS.indexOf(qty) === -1) return null;

    var S = table.stickers || DEFAULT_PRICING.stickers;
    var area = areaM2(size) * qty;
    var rate = ratePerM2(area, S.rate);
    var fM = mult(table, "stickers", "finish", finish);
    var sM = mult(table, "stickers", "shape", shape);
    var tM = mult(table, "stickers", "turnaround", turn);
    var min = num(S.min, 18);

    var base = area * rate * sM;           // material + cut, before finish/rush
    var raw = base * fM * tM;
    var total = Math.max(min, raw);

    return {
      total: money(total), amount: cents(total),
      unit: total / qty, area: area, minApplied: raw < min,
      lines: quoteLines([
        [qty + " × " + size + "″ " + SHAPE_LABEL[shape].toLowerCase(), base],
        [FINISH_LABEL[finish] + " finish", base * (fM - 1)],
        [TURNAROUND_LABEL[turn] + " turnaround", base * fM * (tM - 1)]
      ], total, min),
      labels: {
        finish: FINISH_LABEL[finish], shape: SHAPE_LABEL[shape],
        turnaround: TURNAROUND_LABEL[turn], size: size + " in", quantity: String(qty)
      }
    };
  }

  /* ---- banners & corflute ---------------------------------------------- */
  function priceLargeFormat(product, opt, table) {
    table = table || DEFAULT_PRICING;
    var meta = LF_META[product];
    if (!meta) return null;
    var w = parseFloat(opt.w), h = parseFloat(opt.h), qty = parseInt(opt.qty, 10);
    if (!(w >= meta.wRange[0] && w <= meta.wRange[1])) return null;
    if (!(h >= meta.hRange[0] && h <= meta.hRange[1])) return null;
    if (meta.qtys.indexOf(qty) === -1) return null;

    var P = table[product] || DEFAULT_PRICING[product];
    var area = w * h;
    var qM = lfQtyMult(qty);
    var base = area * num(P.rate, DEFAULT_PRICING[product].rate) * qty * qM;
    var min = num(P.min, DEFAULT_PRICING[product].min);

    var running = base, lines = [], picked = {};
    var dims = w.toFixed(2) + " × " + h.toFixed(2) + " m";
    lines.push([qty + " × " + dims, base]);

    for (var g in meta.groups) {
      var key = String(opt[g] || Object.keys(meta.groups[g])[0]);
      if (!meta.groups[g][key]) return null;
      picked[g] = meta.groups[g][key];
      var m = mult(table, product, g, key);
      if (m !== 1) lines.push([meta.groups[g][key], running * (m - 1)]);
      running *= m;
    }

    var total = Math.max(min, running);
    return {
      total: money(total), amount: cents(total),
      unit: total / qty, area: area, dims: dims, minApplied: running < min,
      lines: quoteLines(lines, total, min),
      labels: Object.assign({ size: dims, quantity: String(qty) }, picked)
    };
  }

  /* ---- quote breakdown -------------------------------------------------
     Plain labelled lines for the customer: what makes up this price. Tiny
     rounding artefacts are dropped so the list always reads cleanly. */
  function quoteLines(raw, total, min) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var label = raw[i][0], amt = raw[i][1];
      if (i > 0 && Math.abs(amt) < 0.5) continue;      // no-cost option
      out.push({ label: label, amount: Math.round(amt), signed: i > 0 });
    }
    if (min && total <= min) out.push({ label: "Minimum order", amount: Math.round(min), signed: false, note: true });
    return out;
  }

  /* ---- discount vs the smallest run, for the "you save" badge ---------- */
  function stickerSavings(opt, table) {
    var here = priceStickers(opt, table);
    var least = priceStickers(Object.assign({}, opt, { qty: QTYS[0] }), table);
    if (!here || !least) return 0;
    var u1 = least.total / QTYS[0];
    if (!u1) return 0;
    return Math.round((1 - (here.total / parseInt(opt.qty, 10)) / u1) * 100);
  }

  return {
    DEFAULT_PRICING: DEFAULT_PRICING,
    FINISH_LABEL: FINISH_LABEL, SHAPE_LABEL: SHAPE_LABEL, TURNAROUND_LABEL: TURNAROUND_LABEL,
    SIZES: SIZES, QTYS: QTYS, LF_META: LF_META,
    areaM2: areaM2, ratePerM2: ratePerM2, lfQtyMult: lfQtyMult,
    priceStickers: priceStickers, priceLargeFormat: priceLargeFormat,
    stickerSavings: stickerSavings, money: money, cents: cents
  };
});

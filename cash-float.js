/* ============================================================================
 * cash-float.js — one definition of the store cash float and the Fresha match.
 *
 * MIRRORED FILE. The portal and the kiosk deploy as separate Netlify sites
 * whose publish roots are the repo root and kiosk/, so a page cannot load a
 * script from above its own root. This file is copied byte-identically into
 * kiosk/cash-float.js and drift is a build failure — see
 * scripts/check-cash-float.js. Edit one copy, copy it over the other.
 *
 * WHY THIS EXISTS
 * Stores are not supposed to take cash, but some clients can only pay cash.
 * Cash declared on a daily cash-up used to vanish into a gap: nobody could say
 * whether it was still in the store, already banked, or collected by the ops
 * manager. This module turns those events into one running "cash on hand"
 * balance per store with a ceiling, so the gap is visible the day it opens.
 *
 * THE ONE RULE THAT KEEPS IT HONEST
 * Cash IN (cashups.cash) and "banked with the cash-up" (cashups.amount_banked
 * when cash_banked is true) are DERIVED from the cashups rows every time the
 * ledger is computed. They are never copied into cash_movements. Cash-ups get
 * reopened, hard-deleted, entered manually and backdated through five separate
 * write paths; a mirrored copy would drift out of step with every one of them.
 * cash_movements only holds what has no other home: standalone deposits,
 * collections, and signed adjustments.
 *
 * Exposes window.BOA_CASH_FLOAT (browser) / module.exports (node tests).
 * ========================================================================== */
(function (root) {
  "use strict";

  /* ── Money helpers ──────────────────────────────────────────────────────
     Everything is rounded to cents before it is compared or summed. Floating
     point sums of many two-decimal figures drift (0.1 + 0.2), and a ledger
     that is out by a third of a cent looks broken to the person reading it. */
  function cents(n) { return Math.round((Number(n) || 0) * 100); }
  function money(c) { return c / 100; }
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null) return 0;
    // Strips "R", thousands separators and stray spaces; keeps a leading minus
    // and handles "(123.45)" as negative, which some exports use for refunds.
    var s = String(v).trim();
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, "").replace(/[^\d.,\-]/g, "");
    // "1 234,56" / "1,234.56" — the last separator is the decimal one.
    var lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var f = parseFloat(s);
    if (!isFinite(f)) return 0;
    return neg ? -f : f;
  }

  /* ── Config ─────────────────────────────────────────────────────────────
     boa_cash_float_cfg_v1. Opening balances live here rather than as a
     synthetic first ledger row so there is exactly one per store and no
     "which opening wins" question when someone corrects it. */
  var DEFAULT_CEILING = 10000;
  var DEFAULT_TOLERANCE = 1;

  function normalizeCfg(cfg) {
    var c = cfg && typeof cfg === "object" ? cfg : {};
    var ceiling = Number(c.ceiling);
    var tol = Number(c.matchTolerance);
    return {
      ceiling: isFinite(ceiling) && ceiling > 0 ? ceiling : DEFAULT_CEILING,
      matchTolerance: isFinite(tol) && tol >= 0 ? tol : DEFAULT_TOLERANCE,
      stores: (c.stores && typeof c.stores === "object") ? c.stores : {},
      freshaAliases: (c.freshaAliases && typeof c.freshaAliases === "object") ? c.freshaAliases : {},
      // Fresha locations that are deliberately not cash-up stores (other
      // regions, non-salon locations). Remembered so a bulk import stops
      // asking about the same seven places every week.
      freshaIgnore: Array.isArray(c.freshaIgnore) ? c.freshaIgnore : []
    };
  }

  function storeCfg(cfg, branch) {
    var c = normalizeCfg(cfg);
    var s = c.stores[branch];
    if (!s || typeof s !== "object") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.startDate || ""))) return null;
    return {
      startDate: s.startDate,
      openingBalance: num(s.openingBalance),
      setBy: s.setBy || "",
      setAt: s.setAt || ""
    };
  }

  /* ── Ledger ─────────────────────────────────────────────────────────────
     Row kinds, in the order they are shown within a single day. Cash arrives
     before it can be banked, and a manual adjustment is always the last word
     on a day. */
  var KIND_RANK = { cash_in: 0, cashup_deposit: 1, deposit: 2, collection: 3, adjustment: 4 };
  var KIND_LABEL = {
    cash_in: "Cash taken",
    cashup_deposit: "Banked (with cash-up)",
    deposit: "Banked",
    collection: "Collected",
    adjustment: "Adjustment"
  };

  function blankBranch(branch, cfg) {
    return {
      branch: branch, configured: false, startDate: null, openingBalance: 0,
      cashIn: 0, deposits: 0, collections: 0, adjustments: 0,
      onHand: 0, ceiling: cfg.ceiling, headroom: cfg.ceiling, over: false,
      unreviewed: 0, rows: [], lastActivity: null, ignoredBeforeStart: 0
    };
  }

  /**
   * computeCashFloat(cfg, cashups, movements, branchNames) -> { branch: summary }
   *
   * cashups   rows from public.cashups (slim columns are enough:
   *           branch, date, cash, cash_banked, amount_banked, banking_ref,
   *           banked_by, signed_by, archived_at, reviewed_at, reviewed_by,
   *           created_at, id)
   * movements rows from public.cash_movements
   * branchNames the stores in scope. A store with no entry here is not
   *           reported at all, which is how store-scoped users are kept to
   *           their own branches.
   */
  function computeCashFloat(cfg, cashups, movements, branchNames) {
    var c = normalizeCfg(cfg);
    var out = {};
    var names = Array.isArray(branchNames) ? branchNames : [];
    names.forEach(function (n) { if (n) out[n] = blankBranch(n, c); });

    var events = {};
    function push(branch, ev) {
      if (!out[branch]) return;            // out of scope — ignore entirely
      (events[branch] = events[branch] || []).push(ev);
    }

    names.forEach(function (n) {
      var sc = storeCfg(c, n);
      if (!sc) return;
      out[n].configured = true;
      out[n].startDate = sc.startDate;
      out[n].openingBalance = sc.openingBalance;
    });

    (cashups || []).forEach(function (r) {
      if (!r || !r.branch || r.archived_at) return;   // reopened/deleted: superseded
      var b = out[r.branch];
      if (!b || !b.configured) return;
      if (String(r.date) < b.startDate) { b.ignoredBeforeStart++; return; }
      var cashC = cents(r.cash);
      if (cashC !== 0) {
        push(r.branch, {
          id: "cu:" + r.id, kind: "cash_in", date: String(r.date), created: r.created_at || "",
          inC: cashC, outC: 0, source: "cashup", cashupId: r.id,
          detail: r.signed_by ? "Signed by " + r.signed_by : "Daily cash-up",
          reviewed: !!r.reviewed_at, reviewedBy: r.reviewed_by || "", reviewedAt: r.reviewed_at || "",
          signOff: "cashup"
        });
      }
      // Only a "yes, we banked it" cash-up moves money out. cash_banked === false
      // (an explicit "no") and null (never answered) both leave the cash in store.
      if (r.cash_banked === true && cents(r.amount_banked) !== 0) {
        push(r.branch, {
          id: "cud:" + r.id, kind: "cashup_deposit", date: String(r.date), created: r.created_at || "",
          inC: 0, outC: cents(r.amount_banked), source: "cashup", cashupId: r.id,
          ref: r.banking_ref || "",
          detail: (r.banked_by ? "Banked by " + r.banked_by : "Banked with the cash-up")
            + (r.banking_ref ? " · ref " + r.banking_ref : ""),
          hasSlip: !!(r.has_banking_slip || r.banking_slip),
          reviewed: !!r.reviewed_at, reviewedBy: r.reviewed_by || "", reviewedAt: r.reviewed_at || "",
          signOff: "cashup"
        });
      }
    });

    (movements || []).forEach(function (m) {
      if (!m || !m.branch || m.archived_at) return;
      var b = out[m.branch];
      if (!b || !b.configured) return;
      if (String(m.date) < b.startDate) { b.ignoredBeforeStart++; return; }
      var amtC = cents(m.amount);
      if (!amtC) return;
      var ev = {
        id: "mv:" + m.id, movementId: m.id, kind: m.kind, date: String(m.date),
        created: m.created_at || "", source: m.source || "portal", ref: m.ref || "",
        note: m.note || "", recordedBy: m.recorded_by || "",
        hasSlip: !!(m.has_slip || m.slip),
        reviewed: !!m.reviewed_at, reviewedBy: m.reviewed_by || "", reviewedAt: m.reviewed_at || "",
        signOff: "movement", inC: 0, outC: 0
      };
      if (m.kind === "adjustment") {
        // Signed: a positive adjustment says there is MORE cash on hand than
        // the events account for, a negative one says less.
        if (amtC > 0) ev.inC = amtC; else ev.outC = -amtC;
      } else {
        // deposit / collection are recorded positive and always reduce on-hand.
        ev.outC = Math.abs(amtC);
      }
      ev.detail = [
        m.kind === "collection" ? ("Collected by " + (m.recorded_by || "ops")) : (m.recorded_by ? "By " + m.recorded_by : ""),
        m.ref ? "ref " + m.ref : "",
        m.note || ""
      ].filter(Boolean).join(" · ");
      push(m.branch, ev);
    });

    Object.keys(out).forEach(function (n) {
      var b = out[n];
      if (!b.configured) return;
      var list = (events[n] || []).sort(function (x, y) {
        if (x.date !== y.date) return x.date < y.date ? -1 : 1;
        var rx = KIND_RANK[x.kind], ry = KIND_RANK[y.kind];
        if (rx !== ry) return (rx == null ? 9 : rx) - (ry == null ? 9 : ry);
        return String(x.created).localeCompare(String(y.created));
      });
      var balC = cents(b.openingBalance);
      var cashInC = 0, depC = 0, colC = 0, adjC = 0, unreviewed = 0, last = null;
      list.forEach(function (ev) {
        balC += ev.inC - ev.outC;
        ev.balance = money(balC);
        ev.inAmt = money(ev.inC);
        ev.outAmt = money(ev.outC);
        ev.label = KIND_LABEL[ev.kind] || ev.kind;
        if (ev.kind === "cash_in") cashInC += ev.inC;
        else if (ev.kind === "cashup_deposit" || ev.kind === "deposit") depC += ev.outC;
        else if (ev.kind === "collection") colC += ev.outC;
        else if (ev.kind === "adjustment") adjC += ev.inC - ev.outC;
        if (!ev.reviewed && ev.kind !== "cash_in") unreviewed++;
        if (!last || ev.date > last) last = ev.date;
      });
      b.rows = list;
      b.cashIn = money(cashInC);
      b.deposits = money(depC);
      b.collections = money(colC);
      b.adjustments = money(adjC);
      b.onHand = money(balC);
      b.headroom = money(cents(c.ceiling) - balC);
      b.over = balC > cents(c.ceiling);
      b.unreviewed = unreviewed;
      b.lastActivity = last;
    });

    return out;
  }

  /* ── Fresha exports ─────────────────────────────────────────────────────
     Two Fresha reports can feed the reconciliation. Both are parsed by COLUMN
     or ROW NAME, never by position, because the payment lines Fresha includes
     depend on which payment types the store actually used — the 23 real
     exports in hand come in seven different column layouts.

     1. FINANCE SUMMARY (preferred). One file per store covering a DATE RANGE,
        one row per day, and the dates are inside the file:

          "Date","Gross sales","Discounts",...,"Card","Cash","SHOPIFY","Total payments",...
          "05 Sep 2026","23629.43","-1852.15",...,"26046.25","0","0","26046.25",...

        The payment-type columns sit between "Unpaid sales in period" and
        "Total payments", which is how an unfamiliar one is spotted rather
        than silently dropped.

     2. SALES SUMMARY (older). One file per store per DAY, two stacked
        sections, and no date anywhere inside it — the stamp in the filename
        is when the export was taken, so the trading day has to be supplied.

     Money-in is stated the same way by both, so everything downstream sees
     one shape:
       finance: "Total sales + other sales" = Total payments + Total redemptions
       sales:   "Payments collected"
     Tips are included in both, and in the payment lines they were paid on. */

  // Minimal RFC4180 reader. The portal has one of these too, but the check
  // script runs this file under node with no DOM, so it carries its own.
  function parseCsvRows(text) {
    var rows = [], row = [], field = "", inQ = false;
    var s = String(text || "").replace(/^﻿/, "");
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function normLabel(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* Payment lines we understand map onto a cash-up field. Anything else is
     summed into "other" and kept verbatim in the breakdown, so an unfamiliar
     Fresha payment type shows up in the import preview instead of vanishing. */
  var PAYMENT_MAP = {
    "card": "card",
    "yoco payment link": "yoco_link",
    "yoco link": "yoco_link",
    "payment link": "yoco_link",
    "cash": "cash",
    "eft": "eft",
    "shopify": "shopify",
    "gift card redemptions": "gift_card",
    "gift card redemption": "gift_card",
    "voucher redemptions": "gift_card"
  };

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* "05 Sep 2026" -> "2026-09-05". Also accepts an ISO date. Never routed
     through Date/toISOString, which would shift the day across a timezone. */
  function freshaYmd(s) {
    var t = String(s == null ? "" : s).trim();
    var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    var m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
    if (m) {
      var mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mon) return m[3] + "-" + String(mon).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
    }
    return "";
  }

  function blankFresha() {
    return {
      gross_sales: 0, discounts: 0, refund_amount: 0, net_sales: 0, taxes: 0,
      total_sales: 0, gift_cards_sold: 0, service_charges: 0, tips: 0,
      net_other_sales: 0, total_other_sales: 0, total: 0,
      sales_paid: 0, unpaid_sales: 0,
      card: 0, cash: 0, yoco_link: 0, eft: 0, shopify: 0, other: 0,
      total_payments: 0, prepayments: 0, prepayment_redemption: 0,
      gift_card: 0, total_redemptions: 0,
      services: 0, products: 0, refunds_paid: 0, sales_qty: 0, refund_qty: 0
    };
  }

  // Finance-summary column name -> stored field.
  var FINANCE_MAP = {
    "gross sales": "gross_sales",
    "discounts": "discounts",
    "refunds returns": "refund_amount",
    "net sales": "net_sales",
    "taxes": "taxes",
    "total sales": "total_sales",
    "gift card sales": "gift_cards_sold",
    "service charges": "service_charges",
    "tips": "tips",
    "net other sales": "net_other_sales",
    "total other sales": "total_other_sales",
    "total sales other sales": "total",
    "sales paid in period": "sales_paid",
    "unpaid sales in period": "unpaid_sales",
    "total payments": "total_payments",
    "prepayments": "prepayments",
    "prepayment redemption": "prepayment_redemption",
    "gift card redemption": "gift_card",
    "total redemptions": "total_redemptions"
  };
  // Columns we read but do not store as their own field.
  var FINANCE_IGNORE = {
    "payments for sales in period": 1,
    "payments for sales in previous periods": 1,
    "redemptions for sales in period": 1,
    "redemptions for sales in previous periods": 1,
    "tax on other sales": 1
  };

  /**
   * parseFreshaFinance(text) -> { ok, kind:"finance", rows:[…], warnings }
   * Each row carries its own `date`, so nothing has to be supplied.
   */
  function parseFreshaFinance(text) {
    var raw = parseCsvRows(text).filter(function (r) { return r && r.length > 1; });
    if (!raw.length) return { ok: false, error: "The file is empty." };
    var head = raw[0].map(function (c) { return String(c || "").trim(); });
    var norm = head.map(normLabel);
    if (norm[0] !== "date") {
      return { ok: false, error: "This does not look like a Fresha finance summary — the first column should be “Date”." };
    }
    var iUnpaid = norm.indexOf("unpaid sales in period");
    var iTotalPay = norm.indexOf("total payments");
    if (iTotalPay < 0) {
      return { ok: false, error: "No “Total payments” column — export the Finance summary rather than another report." };
    }

    var warnings = [], unknownPay = {}, unknownCol = {};
    var rows = [];
    raw.slice(1).forEach(function (r) {
      var ymd = freshaYmd(r[0]);
      if (!ymd) { if (String(r[0] || "").trim()) warnings.push("Skipped a row with an unreadable date: “" + r[0] + "”."); return; }
      var out = blankFresha();
      out.date = ymd;
      out.breakdown = { payments: {}, columns: {} };
      head.forEach(function (name, i) {
        if (i === 0) return;
        var key = norm[i], v = num(r[i]);
        out.breakdown.columns[name] = v;
        // The payment block is everything between "Unpaid sales in period"
        // and "Total payments" — that is what makes a new payment type
        // visible instead of silently missing from the totals.
        var isPayment = iUnpaid >= 0 && i > iUnpaid && i < iTotalPay;
        if (isPayment) {
          out.breakdown.payments[name] = v;
          var f = PAYMENT_MAP[key];
          if (f) { out[f] += v; return; }
          out.other += v;
          if (v) unknownPay[name] = true;
          return;
        }
        var field = FINANCE_MAP[key];
        if (field) { out[field] = field === "discounts" ? Math.abs(v) : v; return; }
        if (!FINANCE_IGNORE[key] && v) unknownCol[name] = true;
      });
      // Fresha's own arithmetic. If this fails the file was edited or the
      // report changed shape, and reconciling against a number we cannot
      // explain would be worse than saying so.
      var lhs = cents(out.total_payments) + cents(out.total_redemptions);
      if (Math.abs(lhs - cents(out.total)) > 1) {
        warnings.push(ymd + ": payments " + out.total_payments.toFixed(2) + " + redemptions "
          + out.total_redemptions.toFixed(2) + " should equal the " + out.total.toFixed(2) + " taken.");
      }
      var paySum = cents(out.card) + cents(out.cash) + cents(out.yoco_link)
        + cents(out.eft) + cents(out.shopify) + cents(out.other);
      if (Math.abs(paySum - cents(out.total_payments)) > 1) {
        warnings.push(ymd + ": the payment columns add up to " + money(paySum).toFixed(2)
          + " but Fresha reports " + out.total_payments.toFixed(2) + " collected.");
      }
      out.net_collected = money(cents(out.total) - cents(out.tips));
      rows.push(out);
    });

    if (!rows.length) return { ok: false, error: "No dated rows were found in the file." };
    Object.keys(unknownPay).forEach(function (n) {
      warnings.push("Unrecognised payment type “" + n + "” — counted under “Other”.");
    });
    Object.keys(unknownCol).forEach(function (n) {
      warnings.push("Unrecognised column “" + n + "” — kept for reference but not reconciled.");
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { ok: true, kind: "finance", rows: rows, warnings: warnings };
  }

  /* ── Sales summary (older Fresha report) ────────────────────────────────
     Two stacked sections and no date. Kept so an older export still imports;
     the trading day has to come from the person doing the import. */
  var PAYMENT_TOTAL = "payments collected";
  var PAYMENT_TIPS = "of which tips";
  var ITEM_MAP = {
    "services": "services",
    "products": "products",
    "gift cards": "gift_cards_sold",
    "refund amount": "refund_amount"
  };
  var ITEM_TOTAL = "total sales";

  function parseFreshaSalesSummary(text) {
    var rows = parseCsvRows(text);
    var section = null, items = {}, payments = {}, sawPayments = false;

    rows.forEach(function (r) {
      var first = normLabel(r && r[0]);
      if (!first) { section = null; return; }              // blank line ends a section
      if (first === "item type") { section = "items"; return; }
      if (first === "payment type") { section = "payments"; sawPayments = true; return; }
      if (section === "items") {
        items[first] = { qty: num(r[1]), refundQty: num(r[2]), gross: num(r[3]), raw: r[0] };
      } else if (section === "payments") {
        payments[first] = { collected: num(r[1]), refunds: num(r[2]), raw: r[0] };
      }
    });

    if (!sawPayments) {
      return {
        ok: false,
        error: "This does not look like a Fresha export — no “Date” column and no "
             + "“Payment Type” section. Export the Finance summary from Reports → Finance."
      };
    }

    var out = blankFresha();
    out.breakdown = { items: {}, payments: {} };
    var warnings = [], otherLabels = [];

    Object.keys(payments).forEach(function (k) {
      var v = payments[k];
      out.breakdown.payments[v.raw] = v.collected;
      // This report folds redemptions into "Payments collected", so its total
      // is the same money-in figure the finance summary calls
      // "Total sales + other sales".
      if (k === PAYMENT_TOTAL) { out.total = v.collected; out.total_payments = v.collected; out.refunds_paid = v.refunds; return; }
      if (k === PAYMENT_TIPS) { out.tips = v.collected; return; }
      var field = PAYMENT_MAP[k];
      if (field) { out[field] += v.collected; return; }
      if (v.collected) otherLabels.push(v.raw);
      out.other += v.collected;
    });

    Object.keys(items).forEach(function (k) {
      var v = items[k];
      out.breakdown.items[v.raw] = v.gross;
      if (k === ITEM_TOTAL) { out.total_sales = v.gross; out.sales_qty = v.qty; out.refund_qty = v.refundQty; return; }
      var field = ITEM_MAP[k];
      if (field) out[field] += v.gross;
    });

    if (otherLabels.length) {
      warnings.push("Unrecognised payment type" + (otherLabels.length > 1 ? "s" : "") + ": "
        + otherLabels.join(", ") + " — counted under “Other”.");
    }
    var sumC = cents(out.card) + cents(out.yoco_link) + cents(out.cash)
             + cents(out.gift_card) + cents(out.eft) + cents(out.shopify) + cents(out.other);
    if (cents(out.total) && Math.abs(sumC - cents(out.total)) > 1) {
      warnings.push("The payment lines add up to " + money(sumC).toFixed(2)
        + " but Fresha reports " + out.total.toFixed(2) + " collected.");
    }
    out.net_collected = money(cents(out.total) - cents(out.tips));
    return { ok: true, kind: "sales", rows: [out], warnings: warnings, needsDate: true };
  }

  /**
   * parseFreshaFile(text) -> { ok, kind, needsDate, rows, warnings } | { ok:false, error }
   * Works out which Fresha report it is and parses it. `needsDate` is true
   * only for the older per-day sales summary, whose rows carry no date.
   */
  function parseFreshaFile(text) {
    var firstCell = "";
    var rows = parseCsvRows(text);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i][0] || "").trim()) { firstCell = normLabel(rows[i][0]); break; }
    }
    if (firstCell === "date") return parseFreshaFinance(text);
    return parseFreshaSalesSummary(text);
  }

  // Back-compat name used by earlier callers.
  function parseFreshaSummary(text) { return parseFreshaSalesSummary(text); }

  /* Fresha names its exports "<Store>_2026-09-06.csv" (finance) or
     "<Store>_2026-09-04-3-37-49-pm.csv" (sales). Either way the store is the
     part before the stamp, and the stamp is when the export was taken. */
  function freshaBranchFromFilename(name) {
    var base = String(name || "").replace(/\.[a-z0-9]+$/i, "");
    var m = base.match(/^(.*?)[_\-\s]+\d{4}-\d{2}-\d{2}/);
    if (m && m[1]) return m[1].trim();
    var us = base.indexOf("_");
    return (us > 0 ? base.slice(0, us) : base).trim();
  }

  function freshaExportStamp(name) {
    var m = String(name || "").match(/(\d{4})-(\d{2})-(\d{2})-(\d{1,2})-(\d{2})-(\d{2})-(am|pm)/i);
    if (m) {
      var h = parseInt(m[4], 10) % 12;
      if (/pm/i.test(m[7])) h += 12;
      return { ymd: m[1] + "-" + m[2] + "-" + m[3], hh: String(h).padStart(2, "0"), mm: m[5] };
    }
    var d = String(name || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return d ? { ymd: d[1] + "-" + d[2] + "-" + d[3], hh: "", mm: "" } : null;
  }

  /* "BOA Beauty Bar Cobble Walk (Durbanville)" -> "cobble walk durbanville",
     which is what both the store names and the saved alias map are keyed on. */
  function normalizeFreshaLocation(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/boa\s*beauty\s*bar/g, " ")
      .replace(/\bboa\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isFreshaIgnored(rawName, cfg) {
    var n = normalizeFreshaLocation(rawName);
    return !!n && normalizeCfg(cfg).freshaIgnore.indexOf(n) >= 0;
  }

  /**
   * resolveFreshaBranch(rawName, salonNames, aliases) -> matched name or ""
   * Exact normalised match first, then the saved alias map, then a unique
   * "one contains the other" match (which is what turns "Bree Street" into
   * "Bree" and "RIverlands Mall" into "Riverlands" without being told).
   * Anything still ambiguous comes back empty and is put to the user in the
   * import preview rather than guessed at.
   */
  function resolveFreshaBranch(rawName, salonNames, aliases) {
    var want = normalizeFreshaLocation(rawName);
    if (!want) return "";
    var names = Array.isArray(salonNames) ? salonNames : [];
    var exact = names.filter(function (n) { return normalizeFreshaLocation(n) === want; });
    if (exact.length === 1) return exact[0];
    var a = (aliases && aliases[want]) || "";
    if (a && names.indexOf(a) >= 0) return a;
    // Fresha and the portal disagree about spaces in a few names
    // ("East Gate" vs "Eastgate"). Comparing with the spaces squashed out
    // settles those without a per-store alias.
    var squash = function (x) { return normalizeFreshaLocation(x).replace(/ /g, ""); };
    var wantSq = squash(rawName);
    var squashed = names.filter(function (n) { return squash(n) === wantSq; });
    if (squashed.length === 1) return squashed[0];
    var loose = names.filter(function (n) {
      var nn = normalizeFreshaLocation(n);
      return nn && (nn.indexOf(want) >= 0 || want.indexOf(nn) >= 0);
    });
    return loose.length === 1 ? loose[0] : "";
  }

  /* ── Cash-up vs Fresha ──────────────────────────────────────────────────
     Compared line by line rather than on one grand total, because the two
     systems disagree by design on what a "total" is: Fresha counts a gift
     card once, when it is sold, while the cash-up counts both the card
     payment that bought it and the voucher itself.

     The card line is the one genuine unknown: Fresha's "Card" includes tips
     ("of which tips" is a subset), but whether a store reads its Yoco figure
     gross or net of tips is a habit, not a setting. So both readings are
     accepted and the matching one is named in the result — self-calibrating
     instead of hard-coding a convention that would be wrong half the time. */
  function matchFreshaToCashup(cashup, fresha, cfg) {
    var c = normalizeCfg(cfg);
    var tolC = cents(c.matchTolerance);
    if (!fresha) return { status: "none", label: "No Fresha data", lines: [], cashDelta: 0 };
    if (!cashup) return { status: "nocashup", label: "No cash-up", lines: [], cashDelta: 0 };

    var lines = [];
    function line(key, label, declared, freshaVal, opts) {
      var o = opts || {};
      var d = cents(declared), f = cents(freshaVal);
      var delta = d - f;
      lines.push({
        key: key, label: label, declared: money(d), fresha: money(f),
        delta: money(delta), ok: Math.abs(delta) <= tolC,
        critical: !!o.critical, note: o.note || ""
      });
      return lines[lines.length - 1];
    }

    // Cash is the reason this feature exists — it is the only line that can
    // walk out of the building, so it is graded on its own.
    var cashLine = line("cash", "Cash", cashup.cash, fresha.cash, { critical: true });

    // Card: accept gross or net of tips, and say which one reconciled.
    var declaredCardC = cents(cashup.yoco);
    var grossC = cents(fresha.card);
    var netC = grossC - cents(fresha.tips);
    var okGross = Math.abs(declaredCardC - grossC) <= tolC;
    var okNet = Math.abs(declaredCardC - netC) <= tolC;
    lines.push({
      key: "card", label: "Yoco (card)", declared: money(declaredCardC),
      fresha: money(okNet && !okGross ? netC : grossC),
      delta: money(declaredCardC - (okNet && !okGross ? netC : grossC)),
      ok: okGross || okNet, critical: false,
      note: okGross && okNet ? ""
        : okNet ? "matches Fresha card net of tips"
        : okGross ? "matches Fresha card including tips"
        : "Fresha card is " + money(grossC).toFixed(2) + " including tips, "
          + money(netC).toFixed(2) + " without"
    });

    line("yoco_link", "Yoco payment link", cashup.yoco_link, fresha.yoco_link);
    line("gift_card", "Gift card redeemed", cashup.gift_card, fresha.gift_card);
    line("vouchers", "Vouchers / gift cards sold", cashup.vouchers, fresha.gift_cards_sold);
    line("tips", "Card tips", cashup.card_tips, fresha.tips);

    // Fresha-only money with nowhere to go on the cash-up form.
    var extraC = cents(fresha.eft) + cents(fresha.shopify) + cents(fresha.other);
    if (extraC) {
      lines.push({
        key: "extra", label: "EFT / Shopify / other", declared: 0, fresha: money(extraC),
        delta: money(-extraC), ok: false, critical: false,
        note: "Fresha collected this outside the cash-up's payment fields"
      });
    }

    // Headline totals, both stated the same way: money actually collected.
    var declaredCollectedC = cents(cashup.yoco) + cents(cashup.yoco_link)
      + cents(cashup.cash) + cents(cashup.gift_card);
    var freshaCollectedC = cents(fresha.total);
    var okTotalGross = Math.abs(declaredCollectedC - freshaCollectedC) <= tolC;
    var okTotalNet = Math.abs(declaredCollectedC - (freshaCollectedC - cents(fresha.tips))) <= tolC;
    var totalLine = {
      key: "collected", label: "Total collected", declared: money(declaredCollectedC),
      fresha: money(okTotalNet && !okTotalGross ? freshaCollectedC - cents(fresha.tips) : freshaCollectedC),
      delta: money(declaredCollectedC - (okTotalNet && !okTotalGross ? freshaCollectedC - cents(fresha.tips) : freshaCollectedC)),
      ok: okTotalGross || okTotalNet, critical: false, note: "", total: true
    };
    lines.push(totalLine);

    var status, label;
    if (!cashLine.ok) { status = "cash"; label = "Cash off"; }
    else if (lines.some(function (l) { return !l.ok; })) { status = "check"; label = "Check"; }
    else { status = "match"; label = "Match"; }

    return {
      status: status, label: label, lines: lines,
      cashDelta: cashLine.delta, totalDelta: totalLine.delta,
      declaredCollected: money(declaredCollectedC), freshaCollected: money(freshaCollectedC)
    };
  }

  var API = {
    DEFAULT_CEILING: DEFAULT_CEILING,
    DEFAULT_TOLERANCE: DEFAULT_TOLERANCE,
    KIND_LABEL: KIND_LABEL,
    num: num,
    normalizeCfg: normalizeCfg,
    storeCfg: storeCfg,
    computeCashFloat: computeCashFloat,
    parseCsvRows: parseCsvRows,
    parseFreshaFile: parseFreshaFile,
    parseFreshaFinance: parseFreshaFinance,
    parseFreshaSalesSummary: parseFreshaSalesSummary,
    parseFreshaSummary: parseFreshaSummary,
    freshaYmd: freshaYmd,
    freshaBranchFromFilename: freshaBranchFromFilename,
    freshaExportStamp: freshaExportStamp,
    normalizeFreshaLocation: normalizeFreshaLocation,
    isFreshaIgnored: isFreshaIgnored,
    resolveFreshaBranch: resolveFreshaBranch,
    matchFreshaToCashup: matchFreshaToCashup
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.BOA_CASH_FLOAT = API;
})(typeof window !== "undefined" ? window : globalThis);

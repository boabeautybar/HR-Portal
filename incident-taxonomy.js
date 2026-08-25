/* Incident taxonomy — the ONE definition of how an incident is classified.
 *
 * Every incident belongs to exactly one DOMAIN:
 *   hr  — people, conduct and employment matters   → HR Incidents inbox
 *   hs  — safety, health, premises and hygiene     → H&S Incidents inbox
 *
 * Each domain has CATEGORIES, and most categories have optional SUBCATEGORIES.
 * The subcategory is deliberately never required: a staff member reporting
 * something urgent from the salon floor must never be blocked by a taxonomy
 * they don't recognise. Categories are required, subcategories are a bonus that
 * sharpens the reporting when the reporter knows the answer.
 *
 * MIRRORED FILE. The portal and My BOA deploy as separate Netlify sites whose
 * publish roots are the repo root and myboa/, and a page cannot load a script
 * from above its own site root. Keep incident-taxonomy.js and
 * myboa/incident-taxonomy.js byte-identical; `node scripts/check-mirrors.js`
 * fails the moment they drift.
 *
 * ADDING A CATEGORY: append it — never repurpose an existing key. Keys are
 * written into incident_reports.category and live in the database forever, so a
 * reused key silently rewrites the history of every report already filed under
 * it. The same rule the settings-tab keys follow.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BOA_INCIDENT_TAX = api;
})(this, function () {
  "use strict";

  var DOMAINS = [
    { k: "hr", label: "HR", tabLabel: "People & conduct",
      formTitle: "People or conduct",
      formBlurb: "Someone's behaviour, treatment at work, money or dishonesty.",
      icon: "🧑" },
    { k: "hs", label: "H&S", tabLabel: "Safety, health & premises",
      formTitle: "Safety, health or the premises",
      formBlurb: "Someone hurt or unwell, or something broken, dirty or unsafe.",
      icon: "🦺" }
  ];

  // subs: shown as an optional "anything more specific?" select once a category
  // is picked. Order is the order staff see them.
  var CATEGORIES = [
    /* ── HR ────────────────────────────────────────────────────────────── */
    { k: "Harassment", domain: "hr", label: "Harassment / bullying",
      formLabel: "Harassment, bullying or discrimination",
      subs: ["Bullying or intimidation", "Sexual harassment", "Discrimination",
             "Verbal abuse or shouting", "Threats or violence"] },
    { k: "Management", domain: "hr", label: "Management conduct",
      formLabel: "A manager / management conduct",
      subs: ["Unfair treatment or favouritism", "Schedule, shift or leave handling",
             "Not following procedure", "Pay or hours dispute", "Conduct towards staff"] },
    { k: "StaffConduct", domain: "hr", label: "Staff member's conduct",
      formLabel: "A staff member's conduct",
      subs: ["Did not arrive / no-show", "Left the shift early", "Refusing instructions",
             "Conflict with a colleague", "Conduct towards clients", "Dishonesty"] },
    { k: "Customer", domain: "hr", label: "Customer / client",
      formLabel: "A customer or client incident",
      subs: ["Complaint about service", "Abusive or aggressive customer",
             "Refused to pay or disputed a charge", "Damage caused by a customer"] },
    { k: "Theft", domain: "hr", label: "Theft / money / till",
      formLabel: "Theft, money or the till",
      subs: ["Till shortage", "Stock going missing", "Personal belongings taken",
             "Cash handling or procedure breach", "Voucher or payment fraud"] },
    { k: "OtherHR", domain: "hr", label: "Other (people)",
      formLabel: "Something else about people or conduct", subs: [] },

    /* ── H&S ───────────────────────────────────────────────────────────── */
    { k: "Injury", domain: "hs", label: "Injury / accident",
      formLabel: "Someone was hurt",
      subs: ["Cut or laceration", "Burn", "Slip, trip or fall", "Chemical splash or contact",
             "Eye injury", "Tool or equipment injury"] },
    { k: "Health", domain: "hs", label: "Health episode",
      formLabel: "Someone became unwell",
      subs: ["Fainting or dizziness", "Allergic reaction", "Breathing difficulty or fumes",
             "Became ill on shift", "Pregnancy-related"] },
    { k: "Facilities", domain: "hs", label: "Facilities / equipment",
      formLabel: "Something is broken or not working",
      subs: ["Pedicure station or chair", "Plumbing or blockage", "Water or geyser",
             "Electrical or lighting", "Air-conditioning or ventilation",
             "Furniture or fittings", "Doors, windows or structure", "Equipment or tools"] },
    { k: "Hygiene", domain: "hs", label: "Hygiene",
      formLabel: "Hygiene or cleanliness",
      subs: ["Tool sterilisation", "Station cleanliness", "Waste disposal",
             "Pest sighting", "Bad odour", "Linen or towels"] },
    { k: "Emergency", domain: "hs", label: "Fire / power / security",
      formLabel: "Fire, power failure or security",
      subs: ["Fire or smoke", "Evacuation", "Power failure", "Break-in or security",
             "Gas or chemical leak"] },
    { k: "OtherHS", domain: "hs", label: "Other (safety)",
      formLabel: "Something else about safety or the premises", subs: [] },

    /* ── Legacy keys ────────────────────────────────────────────────────
       Filed under the old nine-category form. Never offered to a reporter
       again (offered:false), but kept here so historical rows still render a
       real label instead of their raw key. `Safety` and `Stock` straddle the
       new split, so their domain is decided per-record in domainOf(). */
    { k: "Safety", domain: "hs", label: "Safety / injury (legacy)",
      formLabel: "", subs: [], offered: false },
    { k: "Stock", domain: "hs", label: "Stock / equipment (legacy)",
      formLabel: "", subs: [], offered: false },
    { k: "Other", domain: "hr", label: "Other (legacy)",
      formLabel: "", subs: [], offered: false }
  ];

  var BY_KEY = {};
  CATEGORIES.forEach(function (c) { BY_KEY[c.k] = c; });

  function offered(domainKey) {
    return CATEGORIES.filter(function (c) {
      return c.offered !== false && (!domainKey || c.domain === domainKey);
    });
  }
  function get(key) { return BY_KEY[key] || null; }
  function label(key) {
    var c = BY_KEY[key];
    return c ? c.label : (key || "Uncategorised");
  }
  function subsFor(key) {
    var c = BY_KEY[key];
    return (c && c.subs) ? c.subs : [];
  }

  /* Legacy routing. A row filed before the split has no `domain`, and two of
     the old categories genuinely straddle it: a "Safety" report is H&S, but
     "Stock" could be a broken chair (H&S) or stock walking out the door (HR).
     Only those ambiguous cases read the wording; everything else is decided by
     the category alone. */
  var RE_THEFT = /(stolen|steal|theft|missing|went missing|disappear|short|pilfer)/i;
  var RE_HS = /(injur|hurt|faint|burn|cut\b|bleed|blood|slip|trip|fell|fall|ill\b|sick|dizz|ambulance|first aid|broken|leak|blocked|plumb|tap\b|geyser|electric|aircon|air-con|smell|odour|odor|hygien|dirty|pest|fire|smoke|evacuat|power)/i;

  function domainOf(rec) {
    if (!rec) return "hr";
    var d = String(rec.domain || "").toLowerCase();
    if (d === "hr" || d === "hs") return d;              // stored value always wins
    var cat = rec.category, txt = String(rec.description || "");
    if (cat === "Stock") return RE_THEFT.test(txt) ? "hr" : "hs";
    if (cat === "Other") return RE_HS.test(txt) ? "hs" : "hr";
    var c = BY_KEY[cat];
    return c ? c.domain : "hr";
  }

  /* Which H&S family a record belongs to, for the H&S reports. Post-split this
     is just the category; legacy rows fall back to the wording. Returns null
     for anything that is not an H&S matter at all. */
  var RE_HEALTH = /(faint|injur|burn|cut\b|bleed|blood|\bill\b|collapse|ambulance|first aid|dizz|allerg|splash|eye|hurt|slip|trip|fell)/i;
  var RE_FACIL = /(broken|break|leak|blocked|block|plumb|\btap\b|pedi ?station|chair|smell|odour|odor|electric|aircon|air-con|geyser|water|toilet|basin|drain|light|door)/i;
  var RE_HYG = /(dirty|mould|mold|pest|cockroach|rat\b|sanit|hygien|towel|unclean|contamin)/i;

  function hsTypeOf(rec) {
    if (!rec || domainOf(rec) !== "hs") return null;
    switch (rec.category) {
      case "Injury": case "Health": return "Health";
      case "Facilities": return "Facilities";
      case "Hygiene": return "Hygiene";
      case "Emergency": case "OtherHS": return "Other";
      default: break;                                    // legacy — read the wording
    }
    var txt = String(rec.description || "");
    if (rec.category === "Hygiene") return "Hygiene";
    if (RE_HEALTH.test(txt)) return "Health";
    if (RE_FACIL.test(txt)) return "Facilities";
    if (RE_HYG.test(txt)) return "Hygiene";
    return "Other";                                      // never silently dropped
  }

  // The old form set about_management from a single category. Keep that meaning
  // exactly: it drives the "% about management" figure on the store report.
  function isAboutManagement(category) { return category === "Management"; }

  return {
    DOMAINS: DOMAINS, CATEGORIES: CATEGORIES,
    offered: offered, get: get, label: label, subsFor: subsFor,
    domainOf: domainOf, hsTypeOf: hsTypeOf, isAboutManagement: isAboutManagement
  };
});

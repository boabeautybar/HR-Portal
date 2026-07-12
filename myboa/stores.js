// ── My BOA store registry (single source of truth) ──────────────────────────
// Every My BOA page (schedule / leave / extra / report / absence) used to carry
// its OWN byte-identical copy of this list, so opening a store meant hand-editing
// 5 arrays and any miss made the store invisible in that one flow. This file is
// now the ONE place that list lives; each page reads window.BOA_STORES.
//
// Load order matters: <script src="stores.js"> MUST come BEFORE the page's
// feature script in the HTML, because the feature IIFE reads window.BOA_STORES
// at parse time.
//
// COMPANION LISTS to update when a store opens (they can't just read this —
// they carry per-store config this list intentionally doesn't):
//   • kiosk/config.js  → BRANCHES  (needs a unique PIN + geo per store)
//   • app.jsx          → SALONS    (WC seed only; carries capacity/region — the
//                                    portal auto-detects the rest from the DB)
// Run `node scripts/check-store-lists.js` after any change to flag drift between
// these hardcoded lists.
//
// Order = display order in the pickers (WC → Gauteng → KZN → Head Office).
window.BOA_STORES = [
  "Sea Point", "Bree", "Kloof", "Claremont", "Rondebosch", "Durbanville", "Cobble Walk",
  "Table Bay", "Somerset West", "Riverlands", "Kuils River", "Westlake",
  "Green Point", "Plumstead", "Sandown", "Cape Gate", "Winelands", "Betty",
  "Fourways", "Eastgate", "Mall of the South", "Mushroom Farm", "Verdi", "Ballito",
  "Head Office"
];

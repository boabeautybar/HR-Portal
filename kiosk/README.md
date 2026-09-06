# BOA Manager Kiosk

This folder contains the **Manager Kiosk** check-in app — the tablet-facing app
managers use to record attendance, sick / FRL proofs, "Left work early",
and store openings. It writes to the same Supabase `app_state` table the HR
portal reads from, so the two are tightly coupled.

## Source of truth

Previously this lived in its own repo: <https://github.com/boabeautybar/Manager-Kiosk>.
This folder is a snapshot of `Manager-Kiosk@main` as of the commit that
introduced it here — see the commit message of the initial `kiosk/` commit
in this repo's log for the exact upstream SHA if needed.

From this point on, edits to the kiosk should be made here and pushed via
HR-Portal's normal PR flow. The standalone `Manager-Kiosk` repo can be
archived once this folder is the live source.

## Files

| File | Purpose |
|---|---|
| `index.html`     | Mount point; loads scripts in order. |
| `config.js`      | Supabase URL / anon key + branch config used by the kiosk. |
| `data.js`        | Data layer — Supabase reads/writes for attendance, kiosk audit log, early-leave sidecar, store openings, proofs. |
| `pin-gate.js`    | Manager PIN gate before any tagging is allowed. |
| `manager-app.js` | Manager Clock-in screen (PIN + selfie + GPS). |
| `staff-app.js`   | Daily attendance grid the manager taps to mark each tech (sick / FRL / left early / extra day / etc.). |
| `styles.css`     | All kiosk-specific styles. |
| `diag.html`      | Diagnostics page for debugging Supabase + branch config from inside the kiosk. |
| `shift-rules.js` | **Mirror** of `/shift-rules.js`. Must stay byte-identical — `node scripts/check-shift-rules.js`. |
| `cash-float.js`  | **Mirror** of `/cash-float.js` — the cash-on-hand maths shared with the HR portal, so a tablet and the portal can never show different balances. It also carries the portal's Fresha parsing and payment-mismatch logic, which the kiosk never calls; the copy is byte-identical rather than trimmed, because a mirror you are allowed to edit is a mirror that drifts. Must stay byte-identical — `node scripts/check-cash-float.js`. |

Both mirrors exist because this site's publish root is `kiosk/`, so a page here
cannot load a script from above it. Edit one copy, copy it over the other, and
run the matching check script before deploying.

## Cash float

The **Bank Cash** tile records a deposit that isn't part of a daily cash-up —
including one deposit covering several days, which is what used to make a
lump-sum banking run impossible to match against the small daily amounts. It
writes a `cash_movements` row (`sql/cash_float.sql`) that head office signs off
against the slip photo.

The cash-up screen and the home screen also show what the store is currently
holding, and warn when it goes over the ceiling. If head office hasn't set the
store's opening balance yet, none of that is shown at all — silent beats
confidently wrong.

## Deploy

The kiosk deploys to its own Netlify site, separate from the HR portal.
Netlify is pointed at this folder (`kiosk/`) as the publish directory; the
HR portal is published from the repo root. Both share this repo's `main`
branch — pushing here updates both deploys.

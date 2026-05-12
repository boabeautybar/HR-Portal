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

## Deploy

The kiosk deploys to its own Netlify site, separate from the HR portal.
Netlify is pointed at this folder (`kiosk/`) as the publish directory; the
HR portal is published from the repo root. Both share this repo's `main`
branch — pushing here updates both deploys.

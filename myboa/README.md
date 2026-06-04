# My BOA — staff self-service site

The team-member–facing site (separate from the HR portal). Staff scan the
printed QR and land on this site's hub, where they can:

- **My schedule** — view their roster (techs & managers)
- **Report an incident** — confidential, anonymous-capable
- **Request leave**

It's a standalone static site that only talks to Supabase (no build step).

## Files

| File | Purpose |
|---|---|
| `index.html`   | The hub (the QR points here). |
| `schedule.html` / `schedule.js` | Schedule viewer. |
| `report.html` / `report.js`     | Incident report form. |
| `leave.html` / `leave.js`       | Annual (holiday) leave request form (capped at 21 days). |
| `absence.html` / `absence.js`   | Call in sick / mark absent — today or tomorrow only, description + optional proof (sick note etc.). |
| `extra.html` / `extra.js`       | Offer an extra day — reads the schedule, lets staff offer an OFF day; RM approves in the portal. |
| `boa-logo.png`, `BOA.png`       | Brand wordmark + favicon. |

Both forms submit through the same `submit_leave_request` RPC and land in the
portal's **Leave Requests** tab, tagged `Annual` or `Absent`, where HR reviews
(approve / decline) them. Absences for today/tomorrow also surface on the
**Called in Sick** tab (Operations).

**Attachments:** the absence proof / sick note uploads to a public Supabase
Storage bucket — run `sql/staff_uploads.sql` once to create it. The file link is
saved on the request and is clickable in the portal.

## Deploy (separate Netlify site)

1. In Netlify: **Add new site → Import from GitHub** → pick this repo.
2. Set **Publish directory** to `myboa` (leave build command empty).
3. Deploy. Netlify gives a URL like `https://<name>.netlify.app`.
   - Optionally rename the site to `myboa` (→ `https://myboa.netlify.app`)
     or add a custom domain (e.g. `my.boabeautybar.co.za`).
4. Put that final address into the HR portal's `index.html`
   (`window.BOA_STAFF_URL`) so the in-portal QR points here.

The portal and this site share the same Supabase project, so reports and leave
requests still land in the portal's tabs, and schedules read live.

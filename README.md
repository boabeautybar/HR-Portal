# BOA HR Portal v2 — Phase 1

A clean rebuild of the HR portal from your original React source code,
adapted to read and write to Supabase. Runs as a single static HTML file
with React, Babel, and Supabase loaded from CDN — no build step.

## What's in Phase 1

✓ Staff list (search, filter, edit, transfer)
✓ Manager list (add/edit/delete, recruitment + planner views)
✓ Maternity records (CRUD)
✓ Salon capacity stats / Locations
✓ Alerts tab
✓ All data flows through Supabase — same project as the rest of BOA.
  Adding staff in this app shows up in the check-in app too, and vice
  versa.

## What's not yet in Phase 1

✗ Schedule editor (techs + managers grids)  — Phase 2
✗ Attendance overview / daily totals view   — Phase 3
✗ Leave Planner calendar view               — Phase 3

For those features, keep using the existing `boahr.netlify.app` site for
now. This v2 lives at a separate URL.

## Setup (one time)

1. **Run the schema migration** in Supabase: SQL Editor → New query → paste
   contents of [`supabase/hr_portal_v2_schema.sql`](../supabase/hr_portal_v2_schema.sql) → Run.
   This adds new columns (`role`, `role_type`, `contract`, `permit`, etc.)
   to your existing `staff` table, and creates a new `maternity` table.

2. **Run the data backfill**: SQL Editor → New query → paste
   [`supabase/hr_portal_v2_data.sql`](../supabase/hr_portal_v2_data.sql) → Run.
   This reads the staff / managers / maternity records from your original
   App.jsx and upserts them into Supabase. Idempotent — re-running is safe.

3. **Deploy this folder** to a new Netlify site:
   - Open [app.netlify.com/drop](https://app.netlify.com/drop)
   - Drag the `hr-portal-v2-deploy/` folder onto the page
   - You'll get a fresh URL like `xxxx.netlify.app`

4. Open the URL. The page should show "BOA HR · Loading data…", then
   show the dashboard with your staff list pulled from Supabase.

## Files

```
hr-portal-v2/
├── index.html      ← entry HTML, loads CDN libs and app.jsx
├── data.js         ← Supabase wrapper exposed as window.BOA_DB
└── app.jsx         ← the React app (compiled at runtime by Babel)
```

## How it works without a build step

The `<script type="text/babel">` element in `index.html` tells the
in-browser Babel runtime to compile `app.jsx` (with all its JSX
syntax) at page load. The first load takes ~1–2 seconds; subsequent
loads are cached.

If you ever want to switch to a real Vite build for speed, run
`npm install && npm run build` against the original `App.jsx` source
and replace this folder with the `dist/` output — same Supabase config,
no other changes needed.

# SM Trial & Reclassification — plan and build notes

Status: **implemented** (all phases landed). This doc is the spec plus what
shipped, so the next person can see why each piece is shaped the way it is.

## Why this changed

The old SM trial was a countdown with two unscored checkpoints: an AM was
tagged from a Manager card, and someone clicked "✓ Mark done" and typed a note
into a `prompt()`. Outcome was two buttons. Nothing about warnings or incident
reports fed into it, and there was no way for an AM to put themselves forward.

Three things drove the rebuild, the last two from a conversation with HR
(transcript: `SM trial period.md`):

1. **The trial is supposed to be three monthly evaluations by the RM/ROM**, not
   two tick-boxes. Whether someone should run a store is a judgement made from
   evidence, and there was no evidence being captured.
2. **Single-evaluator bias.** HR's words: "certain people like certain AMs and
   they don't want anything to come against them." One ROM's opinion, in a
   region they are still new to, was the whole picture. So a second ROM who has
   been in the store can now submit their own evaluation for the same month,
   and every evaluation is attributed.
3. **IRs arriving in a batch.** In the case discussed, ~9–10 incident reports
   landed at the same moment as the third evaluation. That could be genuine —
   staff finally speaking up after being suppressed — or it could be timed. HR
   couldn't tell from the system, because IRs weren't linked to a person at all.
   The trial now shows *when each report was filed vs when the incident
   happened*, so the shape of the batch is visible and HR can judge it.

Plus the new requirement: an AM should be able to **apply** for reclassification
(≥9 months' service and meeting the SM classification criteria), not only wait
to be nominated — and national ops/HR must own those criteria themselves.

## Decisions taken

| Question | Decision |
|---|---|
| Where does an AM apply? | **Portal-recorded only.** AMs have no portal login; HR/national ops records the application from the Manager card. No My BOA/kiosk changes. |
| Evaluation form | **New SM-specific, configurable** blob, seeded from the existing AM Manager Evaluation Form (27 criteria / 5 sections / 135 marks / pass 95 / key min 4). |
| IR ↔ employee link | **New `tagged_ecs` column** on `incident_reports` + a tagging step in the HR incidents review. Name-matching free text was rejected — a promotion decision shouldn't rest on a fuzzy match. |
| Warnings | **Trial-scoped log** on the trial record. No company-wide disciplinary module (none exists today; that's a bigger piece of work). |
| Who decides | **Humans.** The system summarises evidence and computes nothing. Per HR: "that decision comes from both HR and Ops team." |

## What shipped

### 1. `sql/incident_tagged_employees.sql` (run this in Supabase first)
- `incident_reports.tagged_ecs jsonb` (nullable — untagged means "not triaged",
  not "nobody involved") + GIN index.
- `set_incident_tags(p_key, p_id, p_ecs, p_actor)` — SECURITY DEFINER, gated on
  the same HR key as the other portal RPCs, validates the array, and appends an
  audit note to `internal_notes` on every change.
- `list_incident_reports` is `select *`, so the column flows through untouched.
- `data.js`: `setIncidentTags()` wrapper, with a friendly error when the RPC is
  missing ("run the SQL file").

### 2. Config blob `boa_sm_criteria_v1` (`data.js` load/save + `SM_CRITERIA_DEFAULT`)
One blob, three concerns: `evalForm` (sections/pass/keyMin), `classification`
(minTenureMonths + criteria checklist), `trial` (length, checkpoints,
cooldownMonths). `smCriteriaMerged()` merges stored over defaults so a partial
or older blob still yields a complete config.

### 3. Record v2 + read-side normalisation
`boa_sm_trial_v1` records gain `checkpoints[]` (each with **many** attributed
`evals`), `warnings[]`, `application`, `decision` (incl. `feedbackReport`),
`cooldown`, and statuses `applied` / `withdrawn`.

`normalizeSmTrialRec()` upgrades legacy records in memory on load — old
`evaluations[{key,dueOffset,doneAt}]` (both the `mid/final` @45/90 and
`m1/m2/final` @30/60/90 vintages) become checkpoints, with a completed legacy
checkpoint preserved as one eval flagged `legacy: true` (no score, no
submitter). **No bulk rewrite on load** — records persist in the new shape the
next time they're saved, so two open HR tabs can't race each other. Closed
records are left with the checkpoint set they were actually judged under.

**Load-bearing invariant:** top-level `status`, `ec` and `startDate` are never
renamed. Every `effectiveRole` consumer (portal ×5, `kiosk/data.js`,
`kiosk/manager-app.js`, `myboa/schedule.js`) flips AM→SM on exactly
`status === "active" && ec`, so the new statuses are inert by construction.

### 4. Manager card — `SmTrialPanel`
Replaces the `prompt()`. Two doors:
- **Nominate** (ops) — shows the tenure read-out but doesn't block; ops may have
  their reasons.
- **Record application** (the AM asked) — hard-requires ≥ `minTenureMonths` and
  every classification criterion ticked. Creates a `status: "applied"` record;
  HR starts the trial later from the SM Trials tab.

A missing/garbage `start_date` is reported as **"can't be verified"**, never as
"0 months" — plenty of older records have no start date and HR must see that
rather than a silent fail. A failed trial's cooldown blocks both doors with the
re-eligible date.

### 5. SM Trials tab — rebuilt
Rails: Applications / Active / Promoted / Did not pass / Withdrawn.

A reopened legacy trial keeps the checkpoints it was originally judged under
(e.g. Mid-Trial Check-in + Final Evaluation) rather than being retro-fitted to
the monthly cadence — it is a historical record being corrected, not a trial
being re-run.

Per trial: three monthly checkpoint cards, each listing every submitted
evaluation with score, pass/held-for-HR chip, and submitter name + role
(clickable → read-only breakdown scored against the form snapshot it was
submitted under). Below-pass **never auto-fails** — it's flagged and carried to
the decision, mirroring the AM pipeline's held-for-HR pattern. Then the
warnings log, then the IR panel with the timeline, then "Review & decide".

`submitSmEval` re-reads the blob before appending, because two ROMs may submit
minutes apart into a single JSON array.

**The IR timeline** is the direct answer to HR's pain point: a 90-day strip with
a solid dot at the incident date and a hollow marker at the filing date when
filing lagged by 3+ days, plus checkpoint ticks. A batch filed in one week is
visible as a cluster. If ≥2 were filed in the final 14 days, an explicit note
says so — worded to prompt understanding, not suspicion.

**The decision modal** shows evidence and asks a human. Passing flips the
manager record AM→SM (stamping `priorRole` first). Failing **requires a feedback
report** (per-section textareas seeded from the form's sections, plus a
mandatory overall summary, with copy-to-clipboard) and stamps `cooldown` at that
moment — so changing the policy later never moves an existing candidate's date.
Withdraw now archives instead of hard-deleting; permanent delete is behind a
second confirm.

**Outcomes are reversible.** A closed trial carries **↩ Undo promotion**
(passed) or **↩ Reopen trial** (failed/withdrawn). Undoing a promotion puts the
manager record back to `priorRole` and reopens the trial as active, so HR can
then record the real outcome through the normal decide flow. Reopening a fail
also clears the `cooldown` — that one matters, because a mis-clicked fail
otherwise locks someone out for months. The previous outcome is preserved in a
`reversals[]` array and shown on the card: a correction is part of the record,
not something to quietly overwrite. Reopening is blocked if the person already
has another open trial or application.

### 6. Incidents tab — employee tagging
Tag chips + searchable multi-select over staff and managers (defaults to the
report's store). When a report moves to "reviewing" with no tags, a hint
explains why tagging matters. Every change is audited server-side.

### 7. Settings → SM Trial & Classification
Three editors: classification criteria (+ minimum service), the evaluation form
(sections/criteria/key indicators/pass mark/key minimum, live max), and trial
policy (length, checkpoint due days, 3–6 month cooldown). Currently inside the
owner-only Settings screen; giving HR/national ops direct access would follow
the existing `AccessPanel`/`roleOpts` pattern.

## Verification

No test suite — verify in the running portal (`index.html`; `app.jsx` is
Babel-compiled in the browser, so a syntax error blanks the whole app; check the
console first). A syntax check can be run offline with `@babel/standalone` +
the react preset.

1. **Legacy normalisation** — seed `boa_sm_trial_v1` with one `mid/final` and
   one `m1/m2/final` record; both render, active ones top up to three
   checkpoints, closed ones don't; saving one doesn't corrupt the other.
2. **effectiveRole regression** — put an AM on trial, confirm the SM badge/flip
   on Locations, dashboard, schedule, attendance, kiosk and My BOA; fail the
   trial and confirm it reverts.
3. **Multi-ROM** — two ROM logins each submit Month 1; both listed with locked
   attribution; a same-submitter repeat prompts before adding.
4. **Held for HR** — a below-pass evaluation flags but never fails the trial.
5. **Cooldown** — fail with a feedback report; the Manager card blocks until the
   eligible date; changing the cooldown in Settings affects only new failures.
6. **Tenure** — a manager with no/garbage `start_date` shows "can't be verified"
   and blocks the application path; ≥ minimum passes.
6b. **Reversal** — promote someone, confirm the Locations tile shows SM, then
   Undo promotion: the tile goes back to AM-on-trial, the trial returns to the
   active rail, and Review & decide works again. Fail one, reopen it, and check
   the re-application block is gone from their Manager card.
7. **IRs** — run the SQL, tag a report, check window filtering, dot placement
   (incident vs filed) and that non-`canSeeIncidents` users never see the panel.
8. **Config** — edit the form and pass mark; new evaluations use them while old
   breakdowns still render from their own snapshot.

## Known gaps / follow-ups

- Settings remains owner-only; HR/national ops access needs an access-config
  panel if they're to edit criteria themselves without the owner.
- Warnings live on the trial record. If a real disciplinary register is ever
  built, the trial should read from it and this log becomes a view.
- Starting a trial from an application still uses a `prompt()` for the date.
- Checkpoints are assumed to be three; the config allows editing labels and due
  days but the UI is not built for adding or removing them.

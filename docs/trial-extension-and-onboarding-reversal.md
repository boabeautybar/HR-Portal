# Trial extension & onboarding reversal

Status: **implemented**. Applies to both nail-tech and AM trials on the Trial
Period board.

## Why

Two gaps, found together when a nail tech was promoted to onboarding and it was
then decided she needed more time in trial.

**There was no "not yet".** The final review offered pass or fail and nothing
else. A borderline candidate therefore got passed — and passing is not a note in
a file, it mints an employee code, creates a staff row, closes the trial as
hired, copies trial days into attendance and can drop them onto a roster. The
decision "give her another week" had no way to be expressed, so it came out as a
hire.

**There was no way back.** The only control on an onboarding card was `delOb`,
which deletes the history row and nothing else. Pressing it on a mistaken hire
leaves a live employee in the `staff` table with no onboarding record, and a
trial record still reading `hired`. That is worse than doing nothing.

## Extension

At the final review the options are now **Pass / ⏭ Extend 1 week / Fail**.

An extension adds seven days and **requires a fresh evaluation** — the same form
as the final review, because the bar does not drop just because someone was
given more time. Once that review is in, the decision comes round again: pass,
extend again, or fail. There is no cap; each extension is one week and must be
justified in writing when granted.

Where the button appears:
- a final evaluation that came in below the pass mark and is held for HR
- a candidate sitting at `passed` who has not been onboarded yet
- the end of a previous extension whose review was below pass

Record shape on `boa_trial_period_v1`:

```
status: "extended"
extensions: [
  { n, grantedAt, grantedBy, reason, startsOn, endsOn,
    eval: { ...same shape as midEval/finalEval... } | null,
    outcome: "pass" | "fail", decidedAt, decidedBy }
]
```

`status: "extended"` is a new in-progress state. It is not "gone"
(`trialIsGone` is unchanged), it sorts to the top of the in-progress bucket as
the furthest-along stage, and the pathway shows it sitting on the final-review
node. A passing extension review moves straight to `passed`; a below-pass one
holds for HR exactly like the mid/final reviews — it is never an automatic fail.

## Reversal

Onboarding cards now carry **↩ Reverse** alongside Remove. The two are different
acts and the tooltips say so: Remove hides a history row, Reverse undoes a hire.

Reverse unwinds, in order, stopping if the staff delete fails so a half-undone
state can't be created:

1. **Deletes the staff record** — via `deleteManager` for manager positions,
   `deleteStaff` otherwise. They stop being an employee, which is the point;
   soft-deactivating would make them read as a leaver, which they aren't.
2. **Retires the employee code** into `boa_retired_ecs_v1`.
3. **Removes the onboarding record.**
4. **Puts the trial back to `passed`**, clearing `promotedToOnboarding` /
   `promotedAt`, and appends to `onboardingReversals[]` so the correction stays
   on the record. HR can then extend or fail it properly.
5. **Clears rostered shifts** — the draft grid and the published snapshot, over
   the current cycle and its neighbour. The snapshot matters: My BOA and the
   kiosk read only that, so a row left there keeps the person rostered for staff
   even with a clean draft.

**Attendance is deliberately left alone.** Trial days are worked days and are
paid; deleting them to tidy up would be a payroll error.

The onboarding record now stores `fromTrialId` so the reversal restores the
right trial. Records created before that fall back to a name match against a
trial marked `hired`/`promotedToOnboarding`.

## Why codes are retired rather than freed

The next employee code is `max(existing B-number) + 1`, scanned across staff,
managers, pending onboards and Head Office. Deleting a staff row removes its
code from that scan, so the very next hire would be handed it. Meanwhile
attendance grids, Fresha and published schedules can still carry the old code —
so the new person would silently inherit a stranger's history.

`boa_retired_ecs_v1` closes that. Retired codes are included in the max scan and
blocked by the onboarding duplicate guard with an explanation of who held the
code and when it was reversed. This upholds the standing policy that an
employee_code is globally unique and never reused.

## Verification

Covered by logic tests (27 assertions, run against the real helpers sliced out
of app.jsx): the 7-day window across month/year/leap boundaries, the EC
generator with and without the retired list, case/whitespace handling in the
retired guard, and the full decision-gating matrix for extensions.

Manual, in the running portal:

1. Take a candidate with a below-pass final review → **Extend 1 week** with a
   reason → card shows the extension banner and demands its review → submit a
   below-pass review → Pass / Extend again / Fail all appear → extend again and
   confirm week 2 is listed.
2. Submit a passing extension review → the candidate goes straight to `passed`
   with no HR step.
3. Promote someone to onboarding, then **↩ Reverse**: their staff row
   disappears from Salon Staff, the trial returns to the board as `passed`, and
   registering a new employee under that same code is refused with the retired
   message.
4. Reverse someone who was rostered and confirm they're gone from both the
   Scheduling tab and My BOA, while their trial days remain on attendance.

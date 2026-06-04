-- ============================================================================
-- Cash-up review / sign-off — adds a "tick off" per cash-up so a reviewer
-- (e.g. the portfolio / regional ops manager) can confirm a store's daily
-- cash-up has been checked and matches, optionally leaving a comment.
-- Run once in the Supabase SQL editor (idempotent; safe to re-run).
--
-- Who is allowed to review is configured in the HR portal under
-- Settings → "Cash-up review — who can review" and stored in app_state
-- under key boa_cashup_review_access_v1 (no schema change for that part).
-- ============================================================================

alter table public.cashups
  add column if not exists reviewed_at     timestamptz,
  add column if not exists reviewed_by     text,
  add column if not exists review_comment  text;

-- Optional: speed up "show me everything still awaiting review".
create index if not exists cashups_reviewed_at_idx
  on public.cashups (reviewed_at);

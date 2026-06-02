-- ============================================================================
-- Kiosk device lock (Tier 3A) — server-validated "one enrolled device" gate
-- Run once in the Supabase SQL editor (idempotent; safe to re-run).
--
-- The kiosk app refuses to boot unless this device presents a token that
-- matches the branch's single active row in kiosk_devices. Enrolment is via a
-- short-lived code minted from the HR portal. Secrets live only behind
-- security-definer RPCs — the tables themselves are unreadable via the anon API.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_bytes / gen_random_uuid

-- ---- Tables ----------------------------------------------------------------
create table if not exists kiosk_devices (
  id           uuid primary key default gen_random_uuid(),
  branch       text not null,
  device_token text not null unique,        -- long random secret, held only by the iPad
  label        text,
  active       boolean not null default true,
  enrolled_at  timestamptz default now(),
  last_seen    timestamptz
);
-- At most ONE active device per branch.
create unique index if not exists kiosk_devices_one_active_per_branch
  on kiosk_devices (branch) where active;

create table if not exists kiosk_enrollments (
  code       text primary key,              -- short 6-digit code
  branch     text not null,
  expires_at timestamptz not null,          -- ~5 min TTL
  used       boolean not null default false,
  created_at timestamptz default now()
);

-- RLS ON with NO policies → not readable/writable through the anon REST API.
-- The security-definer functions below are the only access path.
alter table kiosk_devices     enable row level security;
alter table kiosk_enrollments enable row level security;

-- ---- RPCs (security definer; granted to anon) ------------------------------

-- Portal: mint a 6-digit enrolment code for a branch (5-minute TTL).
create or replace function create_kiosk_enrollment(p_branch text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_branch is null or length(trim(p_branch)) = 0 then
    raise exception 'branch required';
  end if;
  -- 6 digits, retry on the rare collision with a live code.
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into kiosk_enrollments (code, branch, expires_at)
      values (v_code, p_branch, now() + interval '5 minutes');
      exit;
    exception when unique_violation then
      -- code already exists; only retry if it's stale/used, else loop for a new one
      delete from kiosk_enrollments where code = v_code and (used or expires_at < now());
    end;
  end loop;
  return v_code;
end;
$$;

-- iPad: redeem a code → mint a device token, retire any existing active device
-- for that branch, return the new token.
create or replace function claim_kiosk_enrollment(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_token  text;
begin
  select branch into v_branch
  from kiosk_enrollments
  where code = p_code and not used and expires_at > now();

  if v_branch is null then
    raise exception 'invalid_or_expired_code';
  end if;

  -- 64 hex chars of randomness from two core gen_random_uuid() calls (avoids a
  -- pgcrypto/search_path dependency — gen_random_bytes lives in the extensions schema).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update kiosk_devices set active = false where branch = v_branch and active;
  insert into kiosk_devices (branch, device_token, active, enrolled_at, last_seen)
  values (v_branch, v_token, true, now(), now());

  update kiosk_enrollments set used = true where code = p_code;
  return v_token;
end;
$$;

-- iPad (every load): is this token the branch's active device?
create or replace function verify_kiosk_device(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text;
begin
  if p_token is null or length(p_token) = 0 then
    return jsonb_build_object('ok', false);
  end if;
  update kiosk_devices
    set last_seen = now()
    where device_token = p_token and active
    returning branch into v_branch;
  if v_branch is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'branch', v_branch);
end;
$$;

-- iPad fallback (0864 admin path): self-enrol the current device for a branch.
create or replace function admin_self_enroll(p_branch text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if p_branch is null or length(trim(p_branch)) = 0 then
    raise exception 'branch required';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update kiosk_devices set active = false where branch = p_branch and active;
  insert into kiosk_devices (branch, device_token, label, active, enrolled_at, last_seen)
  values (p_branch, v_token, 'admin-self-enrol', true, now(), now());
  return v_token;
end;
$$;

-- Portal: list active devices (NO token returned).
create or replace function list_kiosk_devices()
returns table (id uuid, branch text, label text, active boolean, enrolled_at timestamptz, last_seen timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, branch, label, active, enrolled_at, last_seen
  from kiosk_devices
  order by branch, active desc, last_seen desc nulls last;
$$;

-- Portal: revoke a device (forces re-enrolment on next load).
create or replace function revoke_kiosk_device(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update kiosk_devices set active = false where id = p_id;
$$;

-- ---- Grants ----------------------------------------------------------------
grant execute on function create_kiosk_enrollment(text) to anon, authenticated;
grant execute on function claim_kiosk_enrollment(text)  to anon, authenticated;
grant execute on function verify_kiosk_device(text)     to anon, authenticated;
grant execute on function admin_self_enroll(text)       to anon, authenticated;
grant execute on function list_kiosk_devices()          to anon, authenticated;
grant execute on function revoke_kiosk_device(uuid)     to anon, authenticated;

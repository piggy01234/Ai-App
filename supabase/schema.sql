-- =====================================================================
-- Free daily tokens: run this ONCE in Supabase -> SQL Editor -> New query
-- =====================================================================

-- Global settings (one row). Edit these numbers in Table Editor any time.
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  daily_tokens bigint not null default 50000,        -- free tokens per user per day
  requests_per_minute int not null default 10        -- spam guard per user
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- One row per account. Set daily_tokens_override to give one person a different amount.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  daily_tokens_override bigint,                      -- NULL = use the global default
  created_at timestamptz not null default now()
);

-- Tokens used per user per UTC day (the daily reset is simply "a new day = a new row").
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  tokens_used bigint not null default 0,
  requests int not null default 0,
  primary key (user_id, day)
);

-- Tiny per-minute request counter.
create table if not exists public.rate_window (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  window_count int not null default 0
);

-- Row level security: users may only READ their own rows. Nobody can write from the browser.
alter table public.app_settings enable row level security;
alter table public.profiles     enable row level security;
alter table public.usage_daily  enable row level security;
alter table public.rate_window  enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "read own usage" on public.usage_daily;
create policy "read own usage" on public.usage_daily for select using (auth.uid() = user_id);
-- (app_settings and rate_window have no policies, so the browser cannot touch them.)

-- Create a profile row automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email)
  select id, email from auth.users on conflict (id) do nothing;   -- backfill existing users

-- How many free tokens a user gets per day.
create or replace function public.daily_limit_for(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select daily_tokens_override from public.profiles where id = p_user),
    (select daily_tokens from public.app_settings where id = 1)
  )
$$;

-- The browser calls this to show "X tokens left today".
create or replace function public.get_quota()
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim bigint;
  used bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  lim := public.daily_limit_for(uid);
  select tokens_used into used from public.usage_daily
    where user_id = uid and day = (now() at time zone 'utc')::date;
  used := coalesce(used, 0);
  return json_build_object(
    'limit', lim,
    'used', used,
    'remaining', greatest(lim - used, 0),
    'resets_at', (((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc')
  );
end $$;

-- The Edge Function calls this BEFORE contacting Gemini: checks quota + rate limit.
create or replace function public.begin_request(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  lim bigint;
  used bigint;
  rpm int;
  w public.rate_window%rowtype;
  today date := (now() at time zone 'utc')::date;
begin
  lim := public.daily_limit_for(p_user);
  select tokens_used into used from public.usage_daily where user_id = p_user and day = today;
  used := coalesce(used, 0);
  if used >= lim then
    return json_build_object('allowed', false, 'reason', 'quota', 'remaining', 0, 'limit', lim);
  end if;

  select requests_per_minute into rpm from public.app_settings where id = 1;
  insert into public.rate_window as r (user_id, window_start, window_count)
    values (p_user, now(), 1)
  on conflict (user_id) do update set
    window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end,
    window_count = case when r.window_start < now() - interval '1 minute' then 1 else r.window_count + 1 end
  returning * into w;
  if w.window_count > rpm then
    return json_build_object('allowed', false, 'reason', 'rate', 'remaining', lim - used, 'limit', lim);
  end if;

  insert into public.usage_daily as u (user_id, day, requests) values (p_user, today, 1)
  on conflict (user_id, day) do update set requests = u.requests + 1;

  return json_build_object('allowed', true, 'remaining', lim - used, 'limit', lim);
end $$;

-- The Edge Function calls this AFTER the reply to charge the tokens Gemini reported.
create or replace function public.add_usage(p_user uuid, p_tokens bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.usage_daily as u (user_id, day, tokens_used)
  values (p_user, (now() at time zone 'utc')::date, greatest(p_tokens, 0))
  on conflict (user_id, day) do update set tokens_used = u.tokens_used + greatest(p_tokens, 0)
$$;

-- Lock the functions down: browser may only call get_quota; the rest are server-only.
revoke all on function public.get_quota()                  from public, anon;
grant  execute on function public.get_quota()              to authenticated;
revoke all on function public.begin_request(uuid)          from public, anon, authenticated;
grant  execute on function public.begin_request(uuid)      to service_role;
revoke all on function public.add_usage(uuid, bigint)      from public, anon, authenticated;
grant  execute on function public.add_usage(uuid, bigint)  to service_role;
revoke all on function public.daily_limit_for(uuid)        from public, anon, authenticated;
grant  execute on function public.daily_limit_for(uuid)    to service_role;

-- DAC NEW MTG Arena Weekly Tournament: database schema
-- Tables are locked down (RLS on, no policies, no grants). The website only
-- talks to the database through the functions below, which check a player's
-- PIN or the organizer passphrase before changing anything.
--
-- Slots: availability and match times are stored as integers.
--   slot = day_index * 24 + hour, where day_index 0 is the tournament's
--   week_start date and hour is 0-23 in Pacific Time.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------

create table public.settings (
  id int primary key default 1 check (id = 1),
  admin_hash text not null
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 40),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pin_failures (
  player_id uuid not null references public.players(id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index pin_failures_player_idx on public.pin_failures (player_id, failed_at);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  week_start date not null,
  num_rounds int not null default 3 check (num_rounds between 1 and 8),
  status text not null default 'open' check (status in ('open', 'complete')),
  group_day int check (group_day between 0 and 6),
  group_start_hour int check (group_start_hour between 0 and 23),
  group_end_hour int check (group_end_hour between 1 and 24),
  created_at timestamptz not null default now()
);

create table public.entries (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  dropped boolean not null default false,
  availability int[] not null default '{}',
  availability_updated_at timestamptz,
  primary key (tournament_id, player_id)
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  number int not null check (number between 1 and 8),
  deadline_slot int check (deadline_slot between 0 and 191),
  created_at timestamptz not null default now(),
  unique (tournament_id, number)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  table_no int not null,
  player1_id uuid not null references public.players(id),
  player2_id uuid references public.players(id),          -- null = bye
  proposed_slot int check (proposed_slot between 0 and 167),
  proposed_by uuid references public.players(id),
  scheduled_slot int check (scheduled_slot between 0 and 167),
  p1_wins int check (p1_wins between 0 and 2),
  p2_wins int check (p2_wins between 0 and 2),
  draws int not null default 0 check (draws between 0 and 3),
  reported_by uuid references public.players(id),
  reported_at timestamptz
);
create index matches_tournament_idx on public.matches (tournament_id);
create index matches_round_idx on public.matches (round_id);

alter table public.settings enable row level security;
alter table public.players enable row level security;
alter table public.pin_failures enable row level security;
alter table public.tournaments enable row level security;
alter table public.entries enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- ---------- private helpers (not callable from the website) ----------

create or replace function public._admin_ok(p_pass text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.settings s
    where s.admin_hash = extensions.crypt(coalesce(p_pass, ''), s.admin_hash)
  );
$$;

-- Returns null when the PIN is right, otherwise an error message.
-- Wrong PINs are logged; 8 misses in 15 minutes locks that player briefly.
create or replace function public._pin_error(p_player uuid, p_pin text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash text;
  v_fails int;
begin
  select pin_hash into v_hash from public.players where id = p_player and active;
  if v_hash is null then
    return 'Player not found.';
  end if;
  select count(*) into v_fails from public.pin_failures
    where player_id = p_player and failed_at > now() - interval '15 minutes';
  if v_fails >= 8 then
    return 'Too many wrong PINs. Wait 15 minutes and try again.';
  end if;
  if p_pin is null or v_hash <> extensions.crypt(p_pin, v_hash) then
    insert into public.pin_failures (player_id) values (p_player);
    return 'That PIN doesn''t match. Check with the organizer if you forgot it.';
  end if;
  delete from public.pin_failures where player_id = p_player;
  return null;
end $$;

create or replace function public._valid_pin(p_pin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_pin ~ '^[0-9]{4}$';
$$;

-- ---------- public reads ----------

create or replace function public.list_tournaments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t order by t.week_start desc, t.created_at desc), '[]'::jsonb)
  from (
    select id, name, week_start, num_rounds, status, created_at
    from public.tournaments
    order by week_start desc, created_at desc
    limit 30
  ) t;
$$;

-- Everything needed to show pairings, schedules and standings.
-- Availability itself is NOT included (only whether it was submitted).
create or replace function public.get_tournament(p_tid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tournament', (select to_jsonb(t) from public.tournaments t where t.id = p_tid),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', e.player_id, 'name', p.name, 'dropped', e.dropped,
        'has_availability', e.availability_updated_at is not null
      ) order by p.name)
      from public.entries e join public.players p on p.id = e.player_id
      where e.tournament_id = p_tid), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number,
        'deadline_slot', r.deadline_slot) order by r.number)
      from public.rounds r where r.tournament_id = p_tid), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'round_id', m.round_id, 'table_no', m.table_no,
        'player1_id', m.player1_id, 'player2_id', m.player2_id,
        'proposed_slot', m.proposed_slot, 'proposed_by', m.proposed_by,
        'scheduled_slot', m.scheduled_slot,
        'p1_wins', m.p1_wins, 'p2_wins', m.p2_wins, 'draws', m.draws,
        'reported_by', m.reported_by
      ) order by m.table_no)
      from public.matches m where m.tournament_id = p_tid), '[]'::jsonb)
  );
$$;

-- ---------- player actions (need name + PIN) ----------

-- Sign in: returns your availability and your opponents' availability
-- for this tournament so the site can suggest times.
create or replace function public.player_login(p_tid uuid, p_player uuid, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  if not exists (select 1 from public.entries where tournament_id = p_tid and player_id = p_player) then
    return jsonb_build_object('error', 'You aren''t signed up for this week''s tournament yet. Contact the organizer.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'availability', (select availability from public.entries
                     where tournament_id = p_tid and player_id = p_player),
    'opponents', coalesce((
      select jsonb_object_agg(e.player_id, e.availability)
      from public.entries e
      where e.tournament_id = p_tid and e.player_id in (
        select case when m.player1_id = p_player then m.player2_id else m.player1_id end
        from public.matches m
        where m.tournament_id = p_tid and p_player in (m.player1_id, m.player2_id)
          and m.player2_id is not null)
    ), '{}'::jsonb)
  );
end $$;

create or replace function public.save_availability(p_tid uuid, p_player uuid, p_pin text, p_slots int[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  if exists (select 1 from unnest(coalesce(p_slots, '{}')) s where s < 0 or s > 167) then
    return jsonb_build_object('error', 'Invalid time slot.');
  end if;
  update public.entries
     set availability = (select coalesce(array_agg(distinct s order by s), '{}')
                         from unnest(coalesce(p_slots, '{}')) s),
         availability_updated_at = now()
   where tournament_id = p_tid and player_id = p_player;
  if not found then
    return jsonb_build_object('error', 'You aren''t signed up for this tournament.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.propose_time(p_match uuid, p_player uuid, p_pin text, p_slot int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text; m public.matches;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or p_player not in (m.player1_id, coalesce(m.player2_id, m.player1_id)) or m.player2_id is null then
    return jsonb_build_object('error', 'That isn''t your match.');
  end if;
  if p_slot is null or p_slot < 0 or p_slot > 167 then
    return jsonb_build_object('error', 'Invalid time.');
  end if;
  -- If the opponent already proposed this exact time, it's agreed.
  if m.proposed_slot = p_slot and m.proposed_by <> p_player then
    update public.matches set scheduled_slot = p_slot where id = p_match;
    return jsonb_build_object('ok', true, 'scheduled', true);
  end if;
  update public.matches
     set proposed_slot = p_slot, proposed_by = p_player, scheduled_slot = null
   where id = p_match;
  return jsonb_build_object('ok', true, 'scheduled', false);
end $$;

create or replace function public.accept_time(p_match uuid, p_player uuid, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text; m public.matches;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or m.player2_id is null or p_player not in (m.player1_id, m.player2_id) then
    return jsonb_build_object('error', 'That isn''t your match.');
  end if;
  if m.proposed_slot is null or m.proposed_by = p_player then
    return jsonb_build_object('error', 'There''s no time from your opponent to accept.');
  end if;
  update public.matches set scheduled_slot = proposed_slot where id = p_match;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public._valid_result(p1 int, p2 int, d int)
returns boolean language sql immutable set search_path = '' as $$
  select p1 between 0 and 2 and p2 between 0 and 2 and d between 0 and 3
     and p1 + p2 + d between 1 and 3
     and not (p1 = 2 and p2 = 2);
$$;

create or replace function public.report_result(p_match uuid, p_player uuid, p_pin text,
                                                p_p1_wins int, p_p2_wins int, p_draws int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text; m public.matches; t_status text;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  select * into m from public.matches where id = p_match;
  if m.id is null or m.player2_id is null or p_player not in (m.player1_id, m.player2_id) then
    return jsonb_build_object('error', 'That isn''t your match.');
  end if;
  select status into t_status from public.tournaments where id = m.tournament_id;
  if t_status = 'complete' then
    return jsonb_build_object('error', 'This tournament is finished. Ask the organizer to change a result.');
  end if;
  if not public._valid_result(p_p1_wins, p_p2_wins, coalesce(p_draws, 0)) then
    return jsonb_build_object('error', 'That score isn''t possible in a best of three.');
  end if;
  update public.matches
     set p1_wins = p_p1_wins, p2_wins = p_p2_wins, draws = coalesce(p_draws, 0),
         reported_by = p_player, reported_at = now()
   where id = p_match;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- organizer actions (need the organizer passphrase) ----------

create or replace function public.admin_login(p_pass text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then
    perform pg_sleep(1);
    return jsonb_build_object('error', 'Wrong organizer passphrase.');
  end if;
  return jsonb_build_object('ok', true, 'players', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active) order by name)
    from public.players), '[]'::jsonb));
end $$;

create or replace function public.admin_add_player(p_pass text, p_name text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if not public._valid_pin(p_pin) then return jsonb_build_object('error', 'PIN must be exactly 4 digits.'); end if;
  if exists (select 1 from public.players where lower(name) = lower(btrim(p_name))) then
    return jsonb_build_object('error', 'A player with that name already exists.');
  end if;
  insert into public.players (name, pin_hash)
    values (btrim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_update_player(p_pass text, p_player uuid, p_name text, p_pin text, p_active boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if p_pin is not null and p_pin <> '' and not public._valid_pin(p_pin) then
    return jsonb_build_object('error', 'PIN must be exactly 4 digits.');
  end if;
  if p_name is not null and exists (select 1 from public.players
       where lower(name) = lower(btrim(p_name)) and id <> p_player) then
    return jsonb_build_object('error', 'A player with that name already exists.');
  end if;
  update public.players set
    name = coalesce(nullif(btrim(p_name), ''), name),
    pin_hash = case when coalesce(p_pin, '') = '' then pin_hash
                    else extensions.crypt(p_pin, extensions.gen_salt('bf')) end,
    active = coalesce(p_active, active)
  where id = p_player;
  delete from public.pin_failures where player_id = p_player;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_create_tournament(
  p_pass text, p_name text, p_week_start date, p_num_rounds int,
  p_group_day int, p_group_start_hour int, p_group_end_hour int, p_player_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  insert into public.tournaments (name, week_start, num_rounds, group_day, group_start_hour, group_end_hour)
    values (btrim(p_name), p_week_start, p_num_rounds, p_group_day, p_group_start_hour, p_group_end_hour)
    returning id into v_id;
  insert into public.entries (tournament_id, player_id)
    select v_id, pid from unnest(coalesce(p_player_ids, '{}')) pid
    where exists (select 1 from public.players where id = pid)
    on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_update_tournament(
  p_pass text, p_tid uuid, p_name text, p_num_rounds int, p_status text,
  p_group_day int, p_group_start_hour int, p_group_end_hour int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  update public.tournaments set
    name = coalesce(nullif(btrim(p_name), ''), name),
    num_rounds = coalesce(p_num_rounds, num_rounds),
    status = coalesce(p_status, status),
    group_day = p_group_day, group_start_hour = p_group_start_hour, group_end_hour = p_group_end_hour
  where id = p_tid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_entry(p_pass text, p_tid uuid, p_player uuid, p_in boolean, p_dropped boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if p_in then
    insert into public.entries (tournament_id, player_id, dropped)
      values (p_tid, p_player, coalesce(p_dropped, false))
      on conflict (tournament_id, player_id) do update set dropped = coalesce(p_dropped, false);
  else
    if exists (select 1 from public.matches where tournament_id = p_tid
               and p_player in (player1_id, coalesce(player2_id, player1_id))) then
      return jsonb_build_object('error', 'This player already has matches. Mark them as dropped instead.');
    end if;
    delete from public.entries where tournament_id = p_tid and player_id = p_player;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_get_availability(p_pass text, p_tid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  return jsonb_build_object('ok', true, 'availability', coalesce((
    select jsonb_object_agg(player_id, availability)
    from public.entries where tournament_id = p_tid), '{}'::jsonb));
end $$;

-- p_pairings: [{"p1": uuid, "p2": uuid or null}, ...]
create or replace function public.admin_create_round(p_pass text, p_tid uuid, p_number int,
                                                     p_deadline_slot int, p_pairings jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_round uuid; v_i int := 0; v_pair jsonb; v_p1 uuid; v_p2 uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if exists (select 1 from public.rounds where tournament_id = p_tid and number = p_number) then
    return jsonb_build_object('error', 'That round already exists.');
  end if;
  insert into public.rounds (tournament_id, number, deadline_slot)
    values (p_tid, p_number, p_deadline_slot) returning id into v_round;
  for v_pair in select * from jsonb_array_elements(p_pairings) loop
    v_i := v_i + 1;
    v_p1 := (v_pair->>'p1')::uuid;
    v_p2 := nullif(v_pair->>'p2', '')::uuid;
    if not exists (select 1 from public.entries where tournament_id = p_tid and player_id = v_p1)
       or (v_p2 is not null and not exists (select 1 from public.entries where tournament_id = p_tid and player_id = v_p2)) then
      raise exception 'Pairing includes a player who is not in this tournament.';
    end if;
    insert into public.matches (round_id, tournament_id, table_no, player1_id, player2_id, p1_wins, p2_wins)
      values (v_round, p_tid, v_i, v_p1, v_p2,
              case when v_p2 is null then 2 end, case when v_p2 is null then 0 end);
  end loop;
  return jsonb_build_object('ok', true, 'round_id', v_round);
end $$;

create or replace function public.admin_delete_round(p_pass text, p_round uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.rounds;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  select * into r from public.rounds where id = p_round;
  if r.id is null then return jsonb_build_object('error', 'Round not found.'); end if;
  if exists (select 1 from public.rounds where tournament_id = r.tournament_id and number > r.number) then
    return jsonb_build_object('error', 'Delete later rounds first.');
  end if;
  delete from public.rounds where id = p_round;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_round_deadline(p_pass text, p_round uuid, p_deadline_slot int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  update public.rounds set deadline_slot = p_deadline_slot where id = p_round;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_result(p_pass text, p_match uuid, p_p1_wins int, p_p2_wins int, p_draws int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if p_p1_wins is null then
    update public.matches set p1_wins = null, p2_wins = null, draws = 0, reported_by = null, reported_at = null
      where id = p_match and player2_id is not null;
    return jsonb_build_object('ok', true);
  end if;
  if not public._valid_result(p_p1_wins, p_p2_wins, coalesce(p_draws, 0)) then
    return jsonb_build_object('error', 'That score isn''t possible in a best of three.');
  end if;
  update public.matches set p1_wins = p_p1_wins, p2_wins = p_p2_wins, draws = coalesce(p_draws, 0),
         reported_by = null, reported_at = now()
   where id = p_match and player2_id is not null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_schedule(p_pass text, p_match uuid, p_slot int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if p_slot is not null and (p_slot < 0 or p_slot > 167) then
    return jsonb_build_object('error', 'Invalid time.');
  end if;
  update public.matches set scheduled_slot = p_slot, proposed_slot = p_slot, proposed_by = null where id = p_match;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_change_passphrase(p_pass text, p_new text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if length(coalesce(p_new, '')) < 10 then
    return jsonb_build_object('error', 'Use at least 10 characters.');
  end if;
  update public.settings set admin_hash = extensions.crypt(p_new, extensions.gen_salt('bf'));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- permissions ----------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.list_tournaments(),
  public.get_tournament(uuid),
  public.player_login(uuid, uuid, text),
  public.save_availability(uuid, uuid, text, int[]),
  public.propose_time(uuid, uuid, text, int),
  public.accept_time(uuid, uuid, text),
  public.report_result(uuid, uuid, text, int, int, int),
  public.admin_login(text),
  public.admin_add_player(text, text, text),
  public.admin_update_player(text, uuid, text, text, boolean),
  public.admin_create_tournament(text, text, date, int, int, int, int, uuid[]),
  public.admin_update_tournament(text, uuid, text, int, text, int, int, int),
  public.admin_set_entry(text, uuid, uuid, boolean, boolean),
  public.admin_get_availability(text, uuid),
  public.admin_create_round(text, uuid, int, int, jsonb),
  public.admin_delete_round(text, uuid),
  public.admin_set_round_deadline(text, uuid, int),
  public.admin_set_result(text, uuid, int, int, int),
  public.admin_set_schedule(text, uuid, int),
  public.admin_change_passphrase(text, text)
to anon;

-- Set the first organizer passphrase once, in the Supabase SQL editor:
-- insert into public.settings (admin_hash)
--   values (extensions.crypt('YOUR-PASSPHRASE-HERE', extensions.gen_salt('bf')));

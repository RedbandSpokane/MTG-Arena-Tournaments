-- Adds MTG Arena usernames so opponents can find each other for a Direct Challenge.

alter table public.players add column arena_name text check (arena_name is null or length(arena_name) <= 40);

create or replace function public.get_tournament(p_tid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tournament', (select to_jsonb(t) from public.tournaments t where t.id = p_tid),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', e.player_id, 'name', p.name, 'arena_name', p.arena_name, 'dropped', e.dropped,
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

create or replace function public.set_arena_name(p_player uuid, p_pin text, p_arena_name text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_err text;
begin
  v_err := public._pin_error(p_player, p_pin);
  if v_err is not null then return jsonb_build_object('error', v_err); end if;
  if length(coalesce(p_arena_name, '')) > 40 then
    return jsonb_build_object('error', 'Arena name is too long.');
  end if;
  update public.players set arena_name = nullif(btrim(p_arena_name), '') where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_login(p_pass text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then
    perform pg_sleep(1);
    return jsonb_build_object('error', 'Wrong organizer passphrase.');
  end if;
  return jsonb_build_object('ok', true, 'players', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'arena_name', arena_name, 'active', active) order by name)
    from public.players), '[]'::jsonb));
end $$;

create or replace function public.admin_set_arena_name(p_pass text, p_player uuid, p_arena_name text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if length(coalesce(p_arena_name, '')) > 40 then
    return jsonb_build_object('error', 'Arena name is too long.');
  end if;
  update public.players set arena_name = nullif(btrim(p_arena_name), '') where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.set_arena_name(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_set_arena_name(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_arena_name(uuid, text, text) to anon;
grant execute on function public.admin_set_arena_name(text, uuid, text) to anon;

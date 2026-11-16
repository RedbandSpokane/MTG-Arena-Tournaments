-- Lets each week be either Swiss or round robin.

alter table public.tournaments add column format text not null default 'swiss'
  check (format in ('swiss', 'round_robin'));

-- Round robin with many players needs more than 8 rounds.
alter table public.tournaments drop constraint tournaments_num_rounds_check;
alter table public.tournaments add constraint tournaments_num_rounds_check check (num_rounds between 1 and 20);
alter table public.rounds drop constraint rounds_number_check;
alter table public.rounds add constraint rounds_number_check check (number between 1 and 20);

create or replace function public.list_tournaments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t order by t.week_start desc, t.created_at desc), '[]'::jsonb)
  from (
    select id, name, week_start, num_rounds, status, format, created_at
    from public.tournaments
    order by week_start desc, created_at desc
    limit 30
  ) t;
$$;

drop function public.admin_create_tournament(text, text, date, int, int, int, int, uuid[]);
create function public.admin_create_tournament(
  p_pass text, p_name text, p_week_start date, p_num_rounds int,
  p_group_day int, p_group_start_hour int, p_group_end_hour int, p_player_ids uuid[], p_format text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if coalesce(p_format, 'swiss') not in ('swiss', 'round_robin') then
    return jsonb_build_object('error', 'Unknown tournament format.');
  end if;
  insert into public.tournaments (name, week_start, num_rounds, group_day, group_start_hour, group_end_hour, format)
    values (btrim(p_name), p_week_start, p_num_rounds, p_group_day, p_group_start_hour, p_group_end_hour,
            coalesce(p_format, 'swiss'))
    returning id into v_id;
  insert into public.entries (tournament_id, player_id)
    select v_id, pid from unnest(coalesce(p_player_ids, '{}')) pid
    where exists (select 1 from public.players where id = pid)
    on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

drop function public.admin_update_tournament(text, uuid, text, int, text, int, int, int);
create function public.admin_update_tournament(
  p_pass text, p_tid uuid, p_name text, p_num_rounds int, p_status text,
  p_group_day int, p_group_start_hour int, p_group_end_hour int, p_format text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_has_rounds boolean;
begin
  if not public._admin_ok(p_pass) then return jsonb_build_object('error', 'Wrong organizer passphrase.'); end if;
  if p_format is not null and p_format not in ('swiss', 'round_robin') then
    return jsonb_build_object('error', 'Unknown tournament format.');
  end if;
  select exists (select 1 from public.rounds where tournament_id = p_tid) into v_has_rounds;
  if p_format is not null and v_has_rounds
     and p_format <> (select format from public.tournaments where id = p_tid) then
    return jsonb_build_object('error', 'Delete the posted rounds before changing the format.');
  end if;
  update public.tournaments set
    name = coalesce(nullif(btrim(p_name), ''), name),
    num_rounds = coalesce(p_num_rounds, num_rounds),
    status = coalesce(p_status, status),
    format = coalesce(p_format, format),
    group_day = p_group_day, group_start_hour = p_group_start_hour, group_end_hour = p_group_end_hour
  where id = p_tid;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.admin_create_tournament(text, text, date, int, int, int, int, uuid[], text) from public, anon, authenticated;
revoke execute on function public.admin_update_tournament(text, uuid, text, int, text, int, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_create_tournament(text, text, date, int, int, int, int, uuid[], text) to anon;
grant execute on function public.admin_update_tournament(text, uuid, text, int, text, int, int, int, text) to anon;

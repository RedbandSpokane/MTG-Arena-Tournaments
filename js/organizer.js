import { rpc } from './api.js?v=20261116c';
import { h, clear, say, busy } from './dom.js?v=20261116c';
import {
  DAYS, HOURS, slotOf, dayLabel, dayName, hourLabel, slotLabel, nextMondayIso, weekRangeLabel,
} from './slots.js?v=20261116c';
import {
  setupTabs, weekOptionLabel, namesById, renderPairings, renderStandings, isRoundRobin,
} from './common.js?v=20261116c';
import { computeStandings } from './standings.js?v=20261116c';
import { pairRound, overlapHours, suggestedRounds } from './swiss.js?v=20261116c';
import { roundRobinSchedule, roundRobinRoundCount } from './roundrobin.js?v=20261116c';

const KEY = 'mtg-organizer';
const $ = (id) => document.getElementById(id);

const state = {
  pass: null,
  players: [],
  tournaments: [],
  tid: null,
  data: null,
  preview: null,   // { number, pairs, bye, rematches, availability }
};

const pWeek = $('p-week');
const pPlayers = $('p-players');
const pSettings = $('p-settings');

const statusEl = () => h('p', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });

// ---------- sign in ----------

function renderSignIn(msg) {
  const box = clear($('signin'));
  const status = statusEl();
  const pass = h('input', { id: 'pass', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { type: 'submit', text: 'Sign in' });
  const form = h('form', { class: 'card' },
    h('h2', { text: 'Organizer sign in' }),
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'organizer', hidden: true, 'aria-hidden': 'true', tabindex: '-1' }),
    h('label', { for: 'pass', text: 'Organizer passphrase' }), pass,
    h('p', {}, btn), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await busy(btn, status, () => signIn(pass.value));
      $('main').focus();
    } catch { pass.select(); }
  });
  box.append(form);
  if (msg) say(status, msg, 'error');
  pass.focus();
}

async function signIn(pass) {
  const res = await rpc('admin_login', { p_pass: pass });
  state.pass = pass;
  state.players = res.players;
  try { sessionStorage.setItem(KEY, pass); } catch { /* ignore */ }
  $('signin').hidden = true;
  $('app').hidden = false;
  await loadTournaments();
  renderAll();
}

async function reloadPlayers() {
  const res = await rpc('admin_login', { p_pass: state.pass });
  state.players = res.players;
}

async function loadTournaments(selectId) {
  state.tournaments = await rpc('list_tournaments');
  if (selectId) state.tid = selectId;
  if (!state.tid || !state.tournaments.some((t) => t.id === state.tid)) {
    const open = state.tournaments.find((t) => t.status === 'open');
    state.tid = (open || state.tournaments[0])?.id ?? null;
  }
  state.data = state.tid ? await rpc('get_tournament', { p_tid: state.tid }) : null;
}

async function reload() {
  state.data = state.tid ? await rpc('get_tournament', { p_tid: state.tid }) : null;
  renderAll();
}

const A = (fn, args = {}) => rpc(fn, { p_pass: state.pass, ...args });

// ---------- this week ----------

function renderAll() {
  renderWeek();
  renderPlayers();
  renderSettings();
}

function renderWeek() {
  clear(pWeek);

  // Pick a week
  const pick = h('div', { class: 'card' });
  if (state.tournaments.length) {
    const sel = h('select', { id: 'org-week' },
      state.tournaments.map((t) => h('option', { value: t.id, text: weekOptionLabel(t) })));
    sel.value = state.tid;
    sel.addEventListener('change', async () => {
      state.tid = sel.value; state.preview = null;
      await reload();
      $('org-week')?.focus();
    });
    pick.append(h('label', { for: 'org-week', text: 'Tournament' }), sel);
  } else {
    pick.append(h('p', { text: 'No tournaments yet. Add your players on the Players tab, then create the first week below.' }));
  }
  pick.append(newWeekForm());
  pWeek.append(pick);

  if (!state.data?.tournament) return;
  pWeek.append(entriesCard(), isRoundRobin(state.data) ? roundRobinCard() : roundsCard());
  const pairings = h('div', {});
  renderPairings(pairings, state.data, { adminControls });
  pWeek.append(pairings);
  const standings = h('div', {});
  renderStandings(standings, state.data);
  pWeek.append(standings, tournamentSettingsCard());
}

function newWeekForm() {
  const status = statusEl();
  const active = state.players.filter((p) => p.active);
  const monday = nextMondayIso();
  const name = h('input', { id: 'nw-name', type: 'text', value: `Week of ${weekRangeLabel(monday).split(' to ')[0]}` });
  const start = h('input', { id: 'nw-start', type: 'date', value: monday });
  start.addEventListener('change', () => {
    if (start.value) name.value = `Week of ${weekRangeLabel(start.value).split(' to ')[0]}`;
    fillDays();
  });
  const lastFormat = state.tournaments[0]?.format || 'round_robin';
  const format = h('select', { id: 'nw-format' },
    h('option', { value: 'round_robin', text: 'Round robin: everyone plays everyone' }),
    h('option', { value: 'swiss', text: 'Swiss: play people with the same record' }));
  format.value = lastFormat;
  const rounds = h('input', { id: 'nw-rounds', type: 'number', min: '1', max: '20', 'aria-describedby': 'nw-rounds-note' });
  const roundsNote = h('p', { id: 'nw-rounds-note', class: 'small muted', style: 'margin:4px 0 0' });
  const gDay = h('select', { id: 'nw-gday' });
  const fillDays = () => {
    const keep = gDay.value;
    clear(gDay).append(h('option', { value: '', text: 'No group session' }),
      ...Array.from({ length: DAYS }, (_, d) => h('option', { value: String(d), text: dayName(start.value || monday, d) })));
    const sat = Array.from({ length: DAYS }, (_, d) => d).find((d) => dayName(start.value || monday, d) === 'Saturday');
    gDay.value = keep !== '' && keep != null && gDay.querySelector(`option[value="${keep}"]`) ? keep : String(sat ?? '');
  };
  fillDays();
  const hourSel = (id, def, from, to) => {
    const s = h('select', { id }, Array.from({ length: to - from + 1 }, (_, i) => from + i)
      .map((hr) => h('option', { value: String(hr), text: hourLabel(hr) })));
    s.value = String(def);
    return s;
  };
  const gStart = hourSel('nw-gstart', 13, 8, 22);
  const gEnd = hourSel('nw-gend', 17, 9, 23);
  const boxes = active.map((p) => h('label', { style: 'font-weight:400;display:flex;gap:10px;align-items:center;min-height:44px;margin:0' },
    h('input', { type: 'checkbox', value: p.id, checked: true, style: 'width:22px;height:22px' }), p.name));
  const checkedCount = () => boxes.filter((l) => l.querySelector('input').checked).length;
  const updateRounds = () => {
    const n = checkedCount();
    if (format.value === 'round_robin') {
      rounds.value = String(Math.max(1, roundRobinRoundCount(n)));
      rounds.disabled = true;
      roundsNote.textContent = `Round robin sets this for you: ${n} player${n === 1 ? '' : 's'} means ${roundRobinRoundCount(n)} round${roundRobinRoundCount(n) === 1 ? '' : 's'}${n % 2 && n > 1 ? ', and each player sits out once' : ''}. Round robin works best for up to about 6 players.`;
    } else {
      rounds.disabled = false;
      rounds.value = String(Math.max(1, suggestedRounds(n || 8)));
      roundsNote.textContent = '3 rounds works for up to 8 players, 4 rounds for up to 16.';
    }
  };
  format.addEventListener('change', updateRounds);
  boxes.forEach((l) => l.querySelector('input').addEventListener('change', updateRounds));
  updateRounds();
  const btn = h('button', { type: 'submit', text: 'Create this week' });
  const form = h('form', {},
    h('label', { for: 'nw-name', text: 'Name' }), name,
    h('label', { for: 'nw-start', text: 'First day of the week' }), start,
    h('label', { for: 'nw-format', text: 'Tournament style' }), format,
    h('label', { for: 'nw-rounds', text: 'Number of rounds' }), rounds, roundsNote,
    h('label', { for: 'nw-gday', text: 'Group session day (Pacific Time)' }), gDay,
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', { for: 'nw-gstart', text: 'Starts' }), gStart),
      h('div', { class: 'grow' }, h('label', { for: 'nw-gend', text: 'Ends' }), gEnd)),
    h('fieldset', { style: 'border:1.5px solid var(--gold-soft);border-radius:10px;margin:16px 0;padding:12px' },
      h('legend', { style: 'font-weight:700', text: 'Players this week' }),
      boxes.length ? boxes : h('p', { class: 'small', text: 'Add players on the Players tab first.' })),
    btn, status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = boxes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (!start.value) { say(status, 'Pick the first day of the week.', 'error'); return; }
    if (gDay.value !== '' && Number(gEnd.value) <= Number(gStart.value)) {
      say(status, 'The group session has to end after it starts.', 'error'); return;
    }
    try {
      const res = await busy(btn, status, () => A('admin_create_tournament', {
        p_name: name.value, p_week_start: start.value, p_num_rounds: Number(rounds.value) || 3,
        p_format: format.value,
        p_group_day: gDay.value === '' ? null : Number(gDay.value),
        p_group_start_hour: gDay.value === '' ? null : Number(gStart.value),
        p_group_end_hour: gDay.value === '' ? null : Number(gEnd.value),
        p_player_ids: ids,
      }));
      state.preview = null;
      await loadTournaments(res.id);
      renderAll();
      $('org-week')?.focus();
    } catch { /* shown */ }
  });
  return h('details', { style: 'margin-top:12px' }, h('summary', { text: 'Create a new week' }), form);
}

function entriesCard() {
  const data = state.data;
  const card = h('div', { class: 'card' }, h('h2', { text: 'Players this week' }));
  const status = statusEl();
  const hasMatches = (id) => data.matches.some((m) => m.player1_id === id || m.player2_id === id);
  const active = data.entries.filter((e) => !e.dropped);
  const ready = active.filter((e) => e.has_availability).length;
  card.append(h('p', {}, h('strong', { text: `${ready} of ${active.length}` }), ' have entered availability.'));

  const rows = data.entries.map((e) => {
    const drop = h('button', { type: 'button', class: 'secondary', text: e.dropped ? 'Bring back' : 'Drop' });
    drop.addEventListener('click', () => entryAction(drop, { p_player: e.player_id, p_in: true, p_dropped: !e.dropped }));
    const remove = hasMatches(e.player_id) ? null : h('button', { type: 'button', class: 'danger', text: 'Remove' });
    remove?.addEventListener('click', () => entryAction(remove, { p_player: e.player_id, p_in: false, p_dropped: false }));
    return h('tr', {},
      h('th', { scope: 'row', style: 'font-family:inherit;font-size:1rem' }, e.name, e.dropped ? ' (dropped)' : ''),
      h('td', { text: e.has_availability ? 'Entered' : 'Not yet' }),
      h('td', {}, h('div', { class: 'row' }, drop, remove)));
  });
  card.append(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Player' }), h('th', { scope: 'col', text: 'Availability' }), h('th', { scope: 'col', text: 'Actions' }))),
    h('tbody', {}, rows))));

  const inIds = new Set(data.entries.map((e) => e.player_id));
  const others = state.players.filter((p) => p.active && !inIds.has(p.id));
  if (others.length) {
    const sel = h('select', { id: 'add-entry' }, h('option', { value: '', text: 'Choose a player' }),
      others.map((p) => h('option', { value: p.id, text: p.name })));
    const add = h('button', { type: 'button', class: 'secondary', text: 'Add to this week' });
    add.addEventListener('click', () => {
      if (!sel.value) { say(status, 'Choose a player first.', 'error'); return; }
      entryAction(add, { p_player: sel.value, p_in: true, p_dropped: false });
    });
    card.append(h('label', { for: 'add-entry', text: 'Add a player to this week' }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, sel), add));
  }
  card.append(status);
  return card;

  async function entryAction(btn, args) {
    try {
      await busy(btn, status, () => A('admin_set_entry', { p_tid: state.tid, ...args }));
      state.preview = null;
      await reload();
    } catch { /* shown */ }
  }
}

function defaultDeadline(number, total) {
  const day = Math.min(6, Math.max(1, Math.round((number * 5) / total)));
  return slotOf(day, 23);
}

function roundsCard() {
  const data = state.data;
  const t = data.tournament;
  const ws = t.week_start;
  const card = h('div', { class: 'card' }, h('h2', { text: 'Rounds' }));
  const status = statusEl();
  status.id = 'rounds-status';
  const nextNumber = data.rounds.length + 1;
  const lastRound = data.rounds[data.rounds.length - 1];
  const unreported = lastRound
    ? data.matches.filter((m) => m.round_id === lastRound.id && m.p1_wins == null).length : 0;
  const active = data.entries.filter((e) => !e.dropped);
  const missingAvail = active.filter((e) => !e.has_availability);

  card.append(h('p', {}, `${data.rounds.length} of ${t.num_rounds} rounds posted.`));

  if (nextNumber <= t.num_rounds && t.status === 'open') {
    if (unreported) {
      card.append(h('p', { class: 'status', 'data-kind': 'info', text: `${unreported} match${unreported === 1 ? '' : 'es'} in round ${lastRound.number} still need results. Pairing now would treat them as not played.` }));
    }
    if (nextNumber === 1 && missingAvail.length) {
      card.append(h('p', { class: 'status', 'data-kind': 'info', text: `Still waiting on availability from: ${missingAvail.map((e) => e.name).join(', ')}.` }));
    }
    if (active.length < 2) {
      card.append(h('p', { text: 'You need at least 2 players to pair a round.' }));
    } else {
      const pairBtn = h('button', { type: 'button', text: state.preview ? `Pair round ${nextNumber} again` : `Pair round ${nextNumber}` });
      pairBtn.addEventListener('click', () => makePreview(pairBtn, status, nextNumber));
      card.append(h('div', { class: 'row' }, pairBtn));
    }
  } else if (t.status === 'open') {
    card.append(h('p', { text: 'All rounds are posted. Once every result is in, mark the tournament finished in the settings at the bottom of this page.' }));
  }

  if (state.preview && state.preview.number === nextNumber) card.append(previewBlock(status));

  if (lastRound) {
    const del = h('button', { type: 'button', class: 'danger', text: `Delete round ${lastRound.number}` });
    del.addEventListener('click', async () => {
      if (!confirm(`Delete round ${lastRound.number}? Its pairings, scheduled times and results will be erased.`)) return;
      try {
        await busy(del, status, () => A('admin_delete_round', { p_round: lastRound.id }));
        state.preview = null;
        await reload();
      } catch { /* shown */ }
    });
    const dl = deadlineSelect(`dl-${lastRound.id}`, lastRound.deadline_slot, ws);
    const saveDl = h('button', { type: 'button', class: 'secondary', text: 'Save deadline' });
    saveDl.addEventListener('click', async () => {
      try {
        await busy(saveDl, status, () => A('admin_set_round_deadline', {
          p_round: lastRound.id, p_deadline_slot: dl.value === '' ? null : Number(dl.value),
        }));
        await reload();
        say($('rounds-status'), 'Deadline saved.', 'ok');
      } catch { /* shown */ }
    });
    card.append(h('details', { style: 'margin-top:12px' },
      h('summary', { text: `Fix round ${lastRound.number}` }),
      h('label', { for: `dl-${lastRound.id}`, text: `Round ${lastRound.number} deadline` }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, dl), saveDl),
      h('p', { class: 'small muted', text: 'Deleting a round lets you pair it again. Only the latest round can be deleted.' }),
      del));
  }
  card.append(status);
  return card;
}

// ----- round robin -----

function roundRobinCard() {
  const data = state.data;
  const t = data.tournament;
  const ws = t.week_start;
  const card = h('div', { class: 'card' }, h('h2', { text: 'Matches (round robin)' }));
  const status = statusEl();
  status.id = 'rounds-status';
  const active = data.entries.filter((e) => !e.dropped);
  const missing = active.filter((e) => !e.has_availability);
  const n = active.length;

  if (!data.rounds.length) {
    const rc = roundRobinRoundCount(n);
    card.append(h('p', {}, `${n} players means ${rc} round${rc === 1 ? '' : 's'} and ${(n * (n - 1)) / 2} matches. `,
      'The whole schedule is posted at once, so players can play their matches in any order during the week.'));
    if (n > 6) {
      card.append(h('p', { class: 'status', 'data-kind': 'info', text: `With ${n} players, each person has ${n - 1} matches this week. If that’s too many, switch this week to Swiss in the settings below.` }));
    }
    if (missing.length) {
      card.append(h('p', { class: 'status', 'data-kind': 'info', text: `Still waiting on availability from: ${missing.map((e) => e.name).join(', ')}.` }));
    }
    if (t.status !== 'open') {
      card.append(h('p', { text: 'This tournament is finished.' }));
    } else if (n < 2) {
      card.append(h('p', { text: 'You need at least 2 players to make a schedule.' }));
    } else {
      const make = h('button', { type: 'button', text: state.preview?.rr ? 'Shuffle the schedule again' : 'Make the schedule' });
      make.addEventListener('click', async () => {
        try {
          await busy(make, status, async () => {
            const av = await A('admin_get_availability', { p_tid: state.tid });
            state.preview = { rr: true, rounds: roundRobinSchedule(active.map((e) => e.player_id)), availability: av.availability };
          });
          renderWeek();
          $('preview-heading')?.focus();
        } catch { /* shown */ }
      });
      card.append(h('div', { class: 'row', style: 'margin-top:12px' }, make));
      if (state.preview?.rr) card.append(rrPreviewBlock(status));
    }
  } else {
    const done = data.matches.filter((m) => m.player2_id && m.p1_wins != null).length;
    const total = data.matches.filter((m) => m.player2_id).length;
    card.append(h('p', {}, h('strong', { text: `${done} of ${total}` }), ' matches finished.'));
    if (done === total && t.status === 'open') {
      card.append(h('p', { text: 'Every match is in. Mark the tournament finished in the settings below.' }));
    }
    const first = data.rounds[0];
    const dl = deadlineSelect('rr-deadline', first.deadline_slot, ws);
    const saveDl = h('button', { type: 'button', class: 'secondary', text: 'Save deadline' });
    saveDl.addEventListener('click', async () => {
      try {
        await busy(saveDl, status, async () => {
          for (const r of data.rounds) {
            await A('admin_set_round_deadline', { p_round: r.id, p_deadline_slot: dl.value === '' ? null : Number(dl.value) });
          }
        });
        await reload();
        say($('rounds-status'), 'Deadline saved for every match.', 'ok');
      } catch { /* shown */ }
    });
    const del = h('button', { type: 'button', class: 'danger', text: 'Delete the whole schedule' });
    del.addEventListener('click', async () => {
      if (!confirm('Delete every match this week? Scheduled times and results will be erased.')) return;
      try {
        await busy(del, status, async () => {
          for (const r of [...data.rounds].sort((a, b) => b.number - a.number)) {
            await A('admin_delete_round', { p_round: r.id });
          }
        });
        state.preview = null;
        await reload();
        say($('rounds-status'), 'Schedule deleted. You can make a new one.', 'ok');
      } catch { /* shown */ }
    });
    card.append(h('details', { style: 'margin-top:12px' },
      h('summary', { text: 'Change the schedule' }),
      h('label', { for: 'rr-deadline', text: 'Play all matches by (Pacific Time)' }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, dl), saveDl),
      h('p', { class: 'small muted', text: 'Adding or dropping a player after the schedule is posted means deleting it and making a new one. Results already entered would be lost, so do it early.' }),
      del));
  }
  card.append(status);
  return card;
}

function rrPreviewBlock(status) {
  const p = state.preview;
  const names = namesById(state.data);
  const ws = state.data.tournament.week_start;
  const name = (id) => names.get(id)?.name ?? 'Unknown';
  const wrap = h('div', { style: 'margin-top:16px' },
    h('h3', { id: 'preview-heading', tabindex: '-1', text: 'Proposed schedule' }),
    h('p', { class: 'small muted', text: 'Hours in common is how many free hours the two players share this week. Nothing is posted until you tap Post.' }));
  p.rounds.forEach((r, i) => {
    const list = h('ul', { style: 'margin:4px 0 12px' });
    for (const pair of r.pairs) {
      const o = overlapHours(p.availability, pair.p1, pair.p2);
      list.append(h('li', {}, h('strong', { text: `${name(pair.p1)} vs ${name(pair.p2)}` }), ' ',
        h('span', { class: 'small', style: o ? '' : 'color:var(--err);font-weight:700', text: o ? `(${o} hours in common)` : '(no hours in common)' })));
    }
    if (r.bye) list.append(h('li', { text: `${name(r.bye)} sits out` }));
    wrap.append(h('p', { style: 'margin:8px 0 0;font-weight:700', text: `Round ${i + 1}` }), list);
  });
  const dl = deadlineSelect('new-deadline', slotOf(6, 23), ws);
  const post = h('button', { type: 'button', text: 'Post the schedule' });
  const cancel = h('button', { type: 'button', class: 'secondary', text: 'Cancel' });
  cancel.addEventListener('click', () => { state.preview = null; renderWeek(); });
  post.addEventListener('click', async () => {
    const t = state.data.tournament;
    try {
      await busy(post, status, async () => {
        for (const [i, r] of p.rounds.entries()) {
          await A('admin_create_round', {
            p_tid: state.tid, p_number: i + 1,
            p_deadline_slot: dl.value === '' ? null : Number(dl.value),
            p_pairings: [...r.pairs, ...(r.bye ? [{ p1: r.bye, p2: null }] : [])],
          });
        }
        await A('admin_update_tournament', {
          p_tid: t.id, p_name: t.name, p_num_rounds: p.rounds.length, p_status: t.status,
          p_group_day: t.group_day, p_group_start_hour: t.group_start_hour, p_group_end_hour: t.group_end_hour,
          p_format: t.format,
        });
      });
      state.preview = null;
      await loadTournaments(state.tid);
      renderAll();
      say($('rounds-status'), 'The schedule is posted. Players can now see all their opponents and pick times.', 'ok');
    } catch {
      try { await reload(); } catch { /* ignore */ }
    }
  });
  wrap.append(h('label', { for: 'new-deadline', text: 'Play all matches by (Pacific Time)' }), dl,
    h('div', { class: 'row', style: 'margin-top:12px' }, post, cancel));
  return wrap;
}

function deadlineSelect(id, value, ws) {
  const sel = h('select', { id }, h('option', { value: '', text: 'No deadline' }));
  for (let d = 0; d < DAYS; d++) {
    for (const hr of [12, 17, 20, 23]) {
      const s = slotOf(d, hr);
      sel.append(h('option', { value: String(s), text: `${dayLabel(ws, d)} at ${hourLabel(hr)}` }));
    }
  }
  if (value != null && !sel.querySelector(`option[value="${value}"]`)) {
    sel.append(h('option', { value: String(value), text: slotLabel(ws, value) }));
  }
  sel.value = value == null ? '' : String(value);
  return sel;
}

async function makePreview(btn, status, number) {
  try {
    await busy(btn, status, async () => {
      const av = await A('admin_get_availability', { p_tid: state.tid });
      const players = state.data.entries.filter((e) => !e.dropped).map((e) => e.player_id);
      const standings = computeStandings(state.data.entries, state.data.matches);
      // Every earlier pairing counts for avoiding rematches; only reported results count for points.
      const res = pairRound({ players, standings, matches: state.data.matches, availability: av.availability });
      state.preview = { number, ...res, availability: av.availability };
    });
    renderWeek();
    $('preview-heading')?.focus();
  } catch { /* shown */ }
}

function previewBlock(status) {
  const p = state.preview;
  const names = namesById(state.data);
  const ws = state.data.tournament.week_start;
  const name = (id) => names.get(id)?.name ?? 'Unknown';
  const standings = computeStandings(state.data.entries, state.data.matches);
  const pts = new Map(standings.map((s) => [s.id, s.points]));
  const wrap = h('div', { style: 'margin-top:16px' },
    h('h3', { id: 'preview-heading', tabindex: '-1', text: `Proposed pairings for round ${p.number}` }),
    h('p', { class: 'small muted', text: 'Hours in common is how many free hours the two players share this week. Nothing is posted until you tap Post.' }));
  if (p.rematches) {
    wrap.append(h('p', { class: 'status', 'data-kind': 'info', text: `Heads up: ${p.rematches} pairing${p.rematches === 1 ? ' is a rematch' : 's are rematches'}. With this few players it couldn’t be avoided.` }));
  }
  const list = h('ol', {});
  for (const pair of p.pairs) {
    const o = overlapHours(p.availability, pair.p1, pair.p2);
    list.append(h('li', { style: 'margin:0 0 8px' },
      h('strong', {}, `${name(pair.p1)} vs ${name(pair.p2)}`),
      p.number > 1 ? ` (${pts.get(pair.p1) ?? 0} pts vs ${pts.get(pair.p2) ?? 0} pts)` : '',
      h('br'),
      h('span', { class: o ? 'small' : 'small', style: o ? '' : 'color:var(--err);font-weight:700' },
        o ? `${o} hours in common` : 'No hours in common. They’ll need to add more availability.')));
  }
  if (p.bye) list.append(h('li', {}, h('strong', {}, `${name(p.bye)}: bye`), h('br'), h('span', { class: 'small', text: 'Counts as a 2-0 win.' })));
  wrap.append(list);

  const dl = deadlineSelect('new-deadline', defaultDeadline(p.number, state.data.tournament.num_rounds), ws);
  const post = h('button', { type: 'button', text: `Post round ${p.number}` });
  const cancel = h('button', { type: 'button', class: 'secondary', text: 'Cancel' });
  cancel.addEventListener('click', () => { state.preview = null; renderWeek(); });
  post.addEventListener('click', async () => {
    const pairings = [...p.pairs.map((x) => ({ p1: x.p1, p2: x.p2 })), ...(p.bye ? [{ p1: p.bye, p2: null }] : [])];
    try {
      await busy(post, status, () => A('admin_create_round', {
        p_tid: state.tid, p_number: p.number,
        p_deadline_slot: dl.value === '' ? null : Number(dl.value),
        p_pairings: pairings,
      }));
      state.preview = null;
      await reload();
      say($('rounds-status'), `Round ${p.number} is posted. Players can now see their opponent and pick a time.`, 'ok');
    } catch { /* shown */ }
  });
  wrap.append(h('label', { for: 'new-deadline', text: 'Play by (Pacific Time)' }), dl,
    h('div', { class: 'row', style: 'margin-top:12px' }, post, cancel));
  return wrap;
}

function adminControls(m) {
  if (!m.player2_id) return null;
  const names = namesById(state.data);
  const ws = state.data.tournament.week_start;
  const n1 = names.get(m.player1_id)?.name ?? 'Player 1';
  const n2 = names.get(m.player2_id)?.name ?? 'Player 2';
  const status = statusEl();
  const sel = (id, label, max, v) => h('div', {},
    h('label', { for: id, text: label }),
    h('select', { id }, h('option', { value: '', text: '–' }),
      Array.from({ length: max + 1 }, (_, i) => h('option', { value: String(i), text: String(i), selected: v === i }))));
  const ids = { a: `a-${m.id}`, b: `b-${m.id}`, d: `d-${m.id}`, t: `t-${m.id}` };
  const save = h('button', { type: 'button', class: 'secondary', text: 'Save result' });
  const clearBtn = h('button', { type: 'button', class: 'danger', text: 'Clear result' });
  const timeSel = h('select', { id: ids.t }, h('option', { value: '', text: 'Not scheduled' }));
  for (let d = 0; d < DAYS; d++) for (const hr of HOURS) {
    const s = slotOf(d, hr);
    timeSel.append(h('option', { value: String(s), text: slotLabel(ws, s), selected: m.scheduled_slot === s }));
  }
  const saveTime = h('button', { type: 'button', class: 'secondary', text: 'Save time' });
  const box = h('details', { style: 'margin-top:8px' }, h('summary', { text: 'Edit this match' }),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, sel(ids.a, `${n1} games`, 2, m.p1_wins)),
      h('div', { class: 'grow' }, sel(ids.b, `${n2} games`, 2, m.p2_wins)),
      h('div', { class: 'grow' }, sel(ids.d, 'Draws', 1, m.p1_wins == null ? null : m.draws))),
    h('div', { class: 'row', style: 'margin-top:8px' }, save, clearBtn),
    h('label', { for: ids.t, text: 'Match time (Pacific Time)' }),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, timeSel), saveTime),
    status);
  const val = (id) => box.querySelector(`#${CSS.escape(id)}`).value;
  save.addEventListener('click', async () => {
    if (val(ids.a) === '' || val(ids.b) === '') { say(status, 'Choose games won for both players.', 'error'); return; }
    try {
      await busy(save, status, () => A('admin_set_result', {
        p_match: m.id, p_p1_wins: Number(val(ids.a)), p_p2_wins: Number(val(ids.b)), p_draws: Number(val(ids.d) || 0),
      }));
      await reload();
    } catch { /* shown */ }
  });
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear this result?')) return;
    try {
      await busy(clearBtn, status, () => A('admin_set_result', { p_match: m.id, p_p1_wins: null, p_p2_wins: null, p_draws: 0 }));
      await reload();
    } catch { /* shown */ }
  });
  saveTime.addEventListener('click', async () => {
    try {
      await busy(saveTime, status, () => A('admin_set_schedule', {
        p_match: m.id, p_slot: timeSel.value === '' ? null : Number(timeSel.value),
      }));
      await reload();
    } catch { /* shown */ }
  });
  return box;
}

function tournamentSettingsCard() {
  const t = state.data.tournament;
  const status = statusEl();
  const name = h('input', { id: 'ts-name', type: 'text', value: t.name });
  const hasRounds = state.data.rounds.length > 0;
  const format = h('select', { id: 'ts-format', disabled: hasRounds, 'aria-describedby': 'ts-format-note' },
    h('option', { value: 'round_robin', text: 'Round robin: everyone plays everyone' }),
    h('option', { value: 'swiss', text: 'Swiss: play people with the same record' }));
  format.value = t.format || 'swiss';
  const formatNote = h('p', { id: 'ts-format-note', class: 'small muted', style: 'margin:4px 0 0',
    text: hasRounds ? 'To change the style, delete the posted rounds first.' : 'You can switch styles until matches are posted.' });
  const rounds = h('input', { id: 'ts-rounds', type: 'number', min: String(Math.max(1, state.data.rounds.length)), max: '20', value: String(t.num_rounds) });
  const syncRounds = () => {
    const n = state.data.entries.filter((e) => !e.dropped).length;
    if (format.value === 'round_robin') {
      rounds.disabled = true;
      if (!hasRounds) rounds.value = String(Math.max(1, roundRobinRoundCount(n)));
    } else {
      rounds.disabled = false;
      if (!hasRounds && t.format !== 'swiss') rounds.value = String(Math.max(1, suggestedRounds(n)));
    }
  };
  format.addEventListener('change', syncRounds);
  syncRounds();
  const gDay = h('select', { id: 'ts-gday' }, h('option', { value: '', text: 'No group session' }),
    Array.from({ length: DAYS }, (_, d) => h('option', { value: String(d), text: dayLabel(t.week_start, d) })));
  gDay.value = t.group_day == null ? '' : String(t.group_day);
  const hourSel = (id, v, from, to) => {
    const s = h('select', { id }, Array.from({ length: to - from + 1 }, (_, i) => from + i)
      .map((hr) => h('option', { value: String(hr), text: hourLabel(hr) })));
    s.value = String(v);
    return s;
  };
  const gStart = hourSel('ts-gstart', t.group_start_hour ?? 13, 8, 22);
  const gEnd = hourSel('ts-gend', t.group_end_hour ?? 17, 9, 23);
  const save = h('button', { type: 'submit', class: 'secondary', text: 'Save settings' });
  const finish = h('button', { type: 'button', text: t.status === 'complete' ? 'Reopen tournament' : 'Mark tournament finished' });
  const send = (extra = {}) => A('admin_update_tournament', {
    p_tid: t.id, p_name: name.value, p_num_rounds: Number(rounds.value) || t.num_rounds, p_status: t.status,
    p_format: format.value,
    p_group_day: gDay.value === '' ? null : Number(gDay.value),
    p_group_start_hour: gDay.value === '' ? null : Number(gStart.value),
    p_group_end_hour: gDay.value === '' ? null : Number(gEnd.value),
    ...extra,
  });
  const form = h('form', { class: 'card' },
    h('h2', { text: 'Tournament settings' }),
    h('label', { for: 'ts-name', text: 'Name' }), name,
    h('label', { for: 'ts-format', text: 'Tournament style' }), format, formatNote,
    h('label', { for: 'ts-rounds', text: 'Number of rounds' }), rounds,
    h('label', { for: 'ts-gday', text: 'Group session day (Pacific Time)' }), gDay,
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', { for: 'ts-gstart', text: 'Starts' }), gStart),
      h('div', { class: 'grow' }, h('label', { for: 'ts-gend', text: 'Ends' }), gEnd)),
    h('div', { class: 'row', style: 'margin-top:12px' }, save, finish),
    h('p', { class: 'small muted', text: 'Finishing locks player result reporting. You can still edit results here.' }),
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (gDay.value !== '' && Number(gEnd.value) <= Number(gStart.value)) {
      say(status, 'The group session has to end after it starts.', 'error'); return;
    }
    try {
      await busy(save, status, () => send(), { done: 'Saved.' });
      state.preview = null;
      await loadTournaments(state.tid); renderAll();
    } catch { /* shown */ }
  });
  finish.addEventListener('click', async () => {
    const to = t.status === 'complete' ? 'open' : 'complete';
    if (to === 'complete' && state.data.matches.some((m) => m.p1_wins == null)
      && !confirm('Some matches don’t have results yet. Mark the tournament finished anyway?')) return;
    try {
      await busy(finish, status, () => send({ p_status: to }));
      await loadTournaments(state.tid); renderAll();
    } catch { /* shown */ }
  });
  return form;
}

// ---------- players ----------

const randomPin = () => String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');

function renderPlayers() {
  clear(pPlayers);
  const status = statusEl();
  const name = h('input', { id: 'np-name', type: 'text', maxlength: '40', autocomplete: 'off', required: true });
  const pin = h('input', { id: 'np-pin', type: 'text', inputmode: 'numeric', maxlength: '4', pattern: '[0-9]{4}', value: randomPin(), autocomplete: 'off' });
  const arena = h('input', { id: 'np-arena', type: 'text', maxlength: '40', autocomplete: 'off' });
  const addToWeek = state.data?.tournament?.status === 'open'
    ? h('input', { id: 'np-week', type: 'checkbox', checked: true, style: 'width:22px;height:22px' }) : null;
  const btn = h('button', { type: 'submit', text: 'Add player' });
  const form = h('form', { class: 'card' },
    h('h2', { text: 'Add a player' }),
    h('label', { for: 'np-name', text: 'Name (as players will see it)' }), name,
    h('label', { for: 'np-pin', text: '4-digit PIN' }), pin,
    h('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'A random PIN is filled in. Write it down and give it to the player: it can’t be looked up later, only reset.' }),
    h('label', { for: 'np-arena', text: 'MTG Arena username (optional)' }), arena,
    addToWeek ? h('label', { style: 'font-weight:400;display:flex;gap:10px;align-items:center;min-height:44px' }, addToWeek, `Also add to ${state.data.tournament.name}`) : null,
    h('p', {}, btn), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { say(status, 'Enter a name.', 'error'); name.focus(); return; }
    if (!/^[0-9]{4}$/.test(pin.value)) { say(status, 'The PIN has to be exactly 4 numbers.', 'error'); pin.focus(); return; }
    const who = name.value.trim();
    const thePin = pin.value;
    try {
      await busy(btn, status, async () => {
        const res = await A('admin_add_player', { p_name: who, p_pin: thePin });
        if (arena.value.trim()) await A('admin_set_arena_name', { p_player: res.id, p_arena_name: arena.value });
        if (addToWeek?.checked) await A('admin_set_entry', { p_tid: state.tid, p_player: res.id, p_in: true, p_dropped: false });
      });
      await reloadPlayers();
      if (state.tid) state.data = await rpc('get_tournament', { p_tid: state.tid });
      renderAll();
      const s = pPlayers.querySelector('.status');
      say(s, `Added ${who}. Their PIN is ${thePin}.`, 'ok');
      $('np-name')?.focus();
    } catch { /* shown */ }
  });
  pPlayers.append(form);

  const list = h('div', { class: 'card' }, h('h2', { text: `All players (${state.players.length})` }));
  if (!state.players.length) list.append(h('p', { text: 'No players yet.' }));
  for (const p of state.players) list.append(playerRow(p));
  pPlayers.append(list);
}

function playerRow(p) {
  const status = statusEl();
  const id = p.id;
  const name = h('input', { id: `pn-${id}`, type: 'text', value: p.name, maxlength: '40' });
  const arena = h('input', { id: `pa-${id}`, type: 'text', value: p.arena_name || '', maxlength: '40' });
  const pin = h('input', { id: `pp-${id}`, type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Leave blank to keep', autocomplete: 'off' });
  const gen = h('button', { type: 'button', class: 'secondary', text: 'Random PIN' });
  gen.addEventListener('click', () => { pin.value = randomPin(); pin.focus(); });
  const active = h('input', { id: `pact-${id}`, type: 'checkbox', checked: p.active, style: 'width:22px;height:22px' });
  const save = h('button', { type: 'submit', class: 'secondary', text: 'Save' });
  const form = h('form', {},
    h('label', { for: `pn-${id}`, text: 'Name' }), name,
    h('label', { for: `pa-${id}`, text: 'MTG Arena username' }), arena,
    h('label', { for: `pp-${id}`, text: 'New PIN' }),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, pin), gen),
    h('label', { style: 'font-weight:400;display:flex;gap:10px;align-items:center;min-height:44px' }, active, 'Active (shows up when creating new weeks)'),
    save, status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pin.value && !/^[0-9]{4}$/.test(pin.value)) { say(status, 'The PIN has to be exactly 4 numbers.', 'error'); return; }
    const newPin = pin.value;
    try {
      await busy(save, status, async () => {
        await A('admin_update_player', { p_player: id, p_name: name.value, p_pin: newPin || null, p_active: active.checked });
        await A('admin_set_arena_name', { p_player: id, p_arena_name: arena.value });
        await reloadPlayers();
        if (state.tid) state.data = await rpc('get_tournament', { p_tid: state.tid });
      }, { done: newPin ? `Saved. New PIN is ${newPin}.` : 'Saved.' });
      pin.value = '';
      renderWeek();
    } catch { /* shown */ }
  });
  return h('details', { style: 'border-bottom:1px solid var(--gold-soft);padding:4px 0' },
    h('summary', {}, p.name, p.active ? '' : ' (inactive)', p.arena_name ? h('span', { class: 'muted', style: 'font-weight:400', text: ` · ${p.arena_name}` }) : null),
    form);
}

// ---------- settings ----------

function renderSettings() {
  clear(pSettings);
  const status = statusEl();
  const cur = h('input', { id: 'cp-cur', type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { id: 'cp-new', type: 'password', autocomplete: 'new-password', minlength: '10' });
  const btn = h('button', { type: 'submit', class: 'secondary', text: 'Change passphrase' });
  const form = h('form', { class: 'card' },
    h('h2', { text: 'Organizer passphrase' }),
    h('label', { for: 'cp-cur', text: 'Current passphrase' }), cur,
    h('label', { for: 'cp-new', text: 'New passphrase (at least 10 characters)' }), nw,
    h('p', {}, btn), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await busy(btn, status, () => rpc('admin_change_passphrase', { p_pass: cur.value, p_new: nw.value }), { done: 'Passphrase changed.' });
      state.pass = nw.value;
      try { sessionStorage.setItem(KEY, nw.value); } catch { /* ignore */ }
      cur.value = ''; nw.value = '';
    } catch { /* shown */ }
  });
  const out = h('button', { type: 'button', class: 'secondary', text: 'Sign out' });
  out.addEventListener('click', () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    location.reload();
  });
  pSettings.append(form, h('div', { class: 'card' },
    h('h2', { text: 'Sign out' }),
    h('p', { text: 'Signs you out of the organizer page on this device.' }), out));
}

// ---------- start ----------

setupTabs();
(async () => {
  let saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch { /* ignore */ }
  if (saved) {
    try { await signIn(saved); return; } catch { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
  }
  renderSignIn();
})();

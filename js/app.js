import { rpc } from './api.js';
import { h, clear, say, busy } from './dom.js';
import {
  DAYS, HOURS, slotOf, dayLabel, hourLabel, hourRangeLabel, slotLabel, nowSlot,
} from './slots.js';
import { suggestTimes, sharedSlots, inGroupSession, groupSessionSlots } from './schedule.js';
import {
  setupTabs, weekOptionLabel, namesById, resultText, renderPairings, renderStandings,
} from './common.js';

const SESSION_KEY = 'mtg-player';

const state = {
  tournaments: [],
  tid: null,
  data: null,
  me: null,            // { id, pin }
  myAvail: new Set(),
  savedAvail: new Set(),
  oppAvail: {},
  arenaName: '',
};

const $ = (id) => document.getElementById(id);
const panelMe = $('p-me');
const panelPairings = $('p-pairings');
const panelStandings = $('p-standings');

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function saveSession(me) {
  try {
    if (me) sessionStorage.setItem(SESSION_KEY, JSON.stringify(me));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked */ }
}

const isDirty = () =>
  state.myAvail.size !== state.savedAvail.size || [...state.myAvail].some((s) => !state.savedAvail.has(s));

window.addEventListener('beforeunload', (e) => {
  if (state.me && isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- data ----------

async function loadTournaments() {
  state.tournaments = await rpc('list_tournaments');
  const sel = $('week');
  clear(sel);
  if (!state.tournaments.length) {
    sel.append(h('option', { text: 'No tournaments yet' }));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const t of state.tournaments) sel.append(h('option', { value: t.id, text: weekOptionLabel(t) }));
  const open = state.tournaments.find((t) => t.status === 'open');
  state.tid = (open || state.tournaments[0]).id;
  sel.value = state.tid;
}

async function loadTournament() {
  state.data = await rpc('get_tournament', { p_tid: state.tid });
}

async function signInWith(me) {
  const res = await rpc('player_login', { p_tid: state.tid, p_player: me.id, p_pin: me.pin });
  state.me = me;
  state.myAvail = new Set(res.availability || []);
  state.savedAvail = new Set(state.myAvail);
  state.oppAvail = res.opponents || {};
  state.arenaName = namesById(state.data).get(me.id)?.arena_name || '';
  saveSession(me);
}

async function refresh() {
  await loadTournament();
  if (state.me) {
    const res = await rpc('player_login', { p_tid: state.tid, p_player: state.me.id, p_pin: state.me.pin });
    state.oppAvail = res.opponents || {};
  }
  renderAll();
}

// ---------- rendering ----------

function renderAll() {
  renderMe();
  if (state.data?.tournament) {
    renderPairings(panelPairings, state.data);
    renderStandings(panelStandings, state.data);
  }
}

function renderMe() {
  clear(panelMe);
  if (!state.data?.tournament) {
    panelMe.append(h('div', { class: 'card' },
      h('h2', { text: 'No tournament yet' }),
      h('p', { text: 'The organizer hasn’t set up this week’s tournament yet. Check back soon.' })));
    return;
  }
  if (!state.me) { renderSignIn(); return; }
  renderWelcome();
  renderMatches();
  renderAvailability();
}

function renderSignIn() {
  const players = state.data.entries.filter((e) => !e.dropped);
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });
  const nameSel = h('select', { id: 'who', required: true },
    h('option', { value: '', text: 'Choose your name' }),
    players.map((p) => h('option', { value: p.player_id, text: p.name })));
  const pin = h('input', {
    id: 'pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]{4}', maxlength: '4',
    autocomplete: 'off', required: true, 'aria-describedby': 'pin-help',
  });
  const btn = h('button', { type: 'submit', text: 'Sign in' });
  const form = h('form', { class: 'card', novalidate: true },
    h('h2', { text: 'Sign in' }),
    players.length === 0
      ? h('p', { text: 'Nobody is signed up for this week yet. Contact the organizer to join.' })
      : null,
    h('label', { for: 'who', text: 'Your name' }), nameSel,
    h('label', { for: 'pin', text: 'Your 4-digit PIN' }), pin,
    h('p', { id: 'pin-help', class: 'small muted', style: 'margin:6px 0 12px', text: 'The organizer gives you this PIN when you sign up. Not on the list? Contact Nathan to join.' }),
    btn, status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameSel.value) { say(status, 'Choose your name first.', 'error'); nameSel.focus(); return; }
    if (!/^[0-9]{4}$/.test(pin.value)) { say(status, 'Your PIN is 4 numbers.', 'error'); pin.focus(); return; }
    try {
      await busy(btn, status, () => signInWith({ id: nameSel.value, pin: pin.value }));
      renderAll();
      $('me-heading')?.focus();
    } catch { pin.select(); }
  });
  panelMe.append(form);
}

function renderWelcome() {
  const meEntry = namesById(state.data).get(state.me.id);
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });
  const arena = h('input', {
    id: 'arena', type: 'text', value: state.arenaName, maxlength: '40', autocomplete: 'off',
    'aria-describedby': 'arena-help',
  });
  const save = h('button', { type: 'submit', class: 'secondary', text: 'Save username' });
  const out = h('button', { type: 'button', class: 'secondary', text: 'Sign out' });
  out.addEventListener('click', () => {
    if (isDirty() && !confirm('You have availability changes that aren’t saved. Sign out anyway?')) return;
    state.me = null; saveSession(null); renderAll(); $('who')?.focus();
  });
  const fields = [
    h('label', { for: 'arena', text: 'Your MTG Arena username' }),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, arena), save),
    h('p', { id: 'arena-help', class: 'small muted', style: 'margin:6px 0 0', text: 'Your opponents use this to find and challenge you in Arena. Include the # and numbers, like Nate#12345.' }),
  ];
  const form = h('form', { class: 'card' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h2', { id: 'me-heading', tabindex: '-1', style: 'margin:0' }, `Hi, ${meEntry?.name ?? 'player'}`),
      out),
    state.arenaName
      ? h('details', { style: 'margin-top:8px' },
        h('summary', {}, 'Arena username: ', h('span', { style: 'font-weight:400;margin-left:6px', text: state.arenaName })),
        ...fields)
      : fields,
    status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(save, status, async () => {
      await rpc('set_arena_name', { p_player: state.me.id, p_pin: state.me.pin, p_arena_name: arena.value });
      state.arenaName = arena.value.trim();
      await loadTournament();
    }, { done: 'Saved.' }).catch(() => {});
  });
  panelMe.append(form);
}

// ----- availability -----

function renderAvailability() {
  const t = state.data.tournament;
  const ws = t.week_start;
  const now = nowSlot(ws);
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });
  const card = h('div', { class: 'card', id: 'availability' });
  const hasGroup = groupSessionSlots(t).length > 0;

  card.append(
    h('h2', { text: 'When can you play this week?' }),
    h('p', { text: 'Tap every hour you could start a match. Each match takes about an hour. Mark as many hours as you can so it’s easier to find a time with your opponent.' }),
    h('div', { class: 'legend small', 'aria-hidden': 'true' },
      h('span', {}, h('span', { class: 'swatch on' }), 'Free'),
      h('span', {}, h('span', { class: 'swatch' }), 'Not free'),
      hasGroup ? h('span', {}, h('span', { class: 'swatch grp' }), 'Saturday group session') : null),
  );
  if (hasGroup) {
    card.append(h('p', { class: 'small' },
      h('strong', { text: 'Group session: ' }),
      `${dayLabel(ws, t.group_day)}, ${hourRangeLabel(t.group_start_hour, t.group_end_hour - t.group_start_hour)}. Mark these hours if you can join.`));
  }

  for (let d = 0; d < DAYS; d++) {
    const daySlots = HOURS.map((hr) => slotOf(d, hr));
    const past = daySlots.every((s) => s <= now);
    const buttons = [];
    const fs = h('fieldset', { class: 'day' }, h('legend', {}, dayLabel(ws, d), past ? ' (past)' : ''));
    const setAll = (pred) => {
      for (const s of daySlots) {
        if (s <= now) continue; // past hours stay as they are
        if (pred(s % 24)) state.myAvail.add(s); else state.myAvail.delete(s);
      }
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(state.myAvail.has(Number(b.dataset.slot)))));
      updateSaveHint();
    };
    fs.append(h('div', { class: 'row quick' },
      h('button', { type: 'button', class: 'secondary', onclick: () => setAll(() => true) }, 'All day', h('span', { class: 'visually-hidden', text: ` ${dayLabel(ws, d)}` })),
      h('button', { type: 'button', class: 'secondary', onclick: () => setAll((hr) => hr >= 17) }, 'Evenings', h('span', { class: 'visually-hidden', text: ` ${dayLabel(ws, d)}` })),
      h('button', { type: 'button', class: 'secondary', onclick: () => setAll(() => false) }, 'Clear', h('span', { class: 'visually-hidden', text: ` ${dayLabel(ws, d)}` })),
    ));
    const grid = h('div', { class: 'hours' });
    for (const s of daySlots) {
      const isPast = s <= now;
      const b = h('button', {
        type: 'button',
        class: `hour${inGroupSession(s, t) ? ' group' : ''}`,
        'aria-pressed': String(state.myAvail.has(s)),
        'data-slot': String(s),
        'aria-label': `${hourLabel(s % 24)}${inGroupSession(s, t) ? ', group session' : ''}${isPast ? ', already passed' : ''}`,
        disabled: isPast,
        text: hourLabel(s % 24),
      });
      b.addEventListener('click', () => {
        if (state.myAvail.has(s)) state.myAvail.delete(s); else state.myAvail.add(s);
        b.setAttribute('aria-pressed', String(state.myAvail.has(s)));
        updateSaveHint();
      });
      buttons.push(b);
      grid.append(b);
    }
    fs.append(grid);
    card.append(fs);
  }

  const saveBtn = h('button', { type: 'button', id: 'save-avail', text: 'Save my availability' });
  const hint = h('span', { id: 'save-hint', class: 'small muted' });
  function updateSaveHint() {
    hint.textContent = isDirty() ? 'You have unsaved changes.' : (state.savedAvail.size ? 'All changes saved.' : '');
  }
  saveBtn.addEventListener('click', async () => {
    await busy(saveBtn, status, async () => {
      await rpc('save_availability', {
        p_tid: state.tid, p_player: state.me.id, p_pin: state.me.pin, p_slots: [...state.myAvail],
      });
      state.savedAvail = new Set(state.myAvail);
      await loadTournament();
      updateSaveHint();
    }, { done: `Saved ${state.myAvail.size} free hour${state.myAvail.size === 1 ? '' : 's'}.` }).catch(() => {});
  });
  card.append(h('div', { class: 'sticky-save' }, h('div', { class: 'row' }, saveBtn, hint), status));
  updateSaveHint();
  panelMe.append(card);
}

// ----- my matches -----

function renderMatches() {
  const data = state.data;
  const names = namesById(data);
  const card = h('div', { class: 'card' }, h('h2', { text: 'Your matches' }));
  const mine = data.matches.filter((m) => m.player1_id === state.me.id || m.player2_id === state.me.id);
  if (!data.rounds.length) {
    card.append(h('p', { text: 'Pairings aren’t posted yet. Enter your availability below. Once the organizer pairs round 1, your opponent and suggested match times will show up here.' }));
  } else if (!mine.length) {
    card.append(h('p', { text: 'You aren’t in a posted round yet. If you think that’s a mistake, contact the organizer.' }));
  }
  const rounds = [...data.rounds].sort((a, b) => b.number - a.number);
  for (const r of rounds) {
    const m = mine.find((x) => x.round_id === r.id);
    if (m) card.append(renderMyMatch(m, r, names));
  }
  panelMe.append(card);
}

function renderMyMatch(m, round, names) {
  const t = state.data.tournament;
  const ws = t.week_start;
  const iAmP1 = m.player1_id === state.me.id;
  const oppId = iAmP1 ? m.player2_id : m.player1_id;
  const opp = oppId ? names.get(oppId) : null;
  const box = h('div', { class: `match${m.p1_wins != null ? ' done' : ''}`, 'data-match': m.id });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', hidden: true });

  box.append(h('h3', {}, `Round ${round.number}: `, opp ? `vs ${opp.name}` : 'Bye'));

  if (!oppId) {
    box.append(h('p', { text: 'You have a bye this round. It counts as a 2-0 win, so there’s nothing to play. Enjoy the break!' }));
    return box;
  }

  box.append(h('p', { style: 'margin:0 0 8px' },
    'Their Arena username: ',
    opp?.arena_name ? h('strong', { text: opp.arena_name }) : h('span', { class: 'muted', text: 'not added yet' })));
  if (round.deadline_slot != null) {
    box.append(h('p', { class: 'small', style: 'margin:0 0 8px' }, h('strong', { text: 'Play by: ' }), slotLabel(ws, round.deadline_slot)));
  }

  // Result already in?
  if (m.p1_wins != null) {
    const mine = iAmP1 ? m.p1_wins : m.p2_wins;
    const theirs = iAmP1 ? m.p2_wins : m.p1_wins;
    const outcome = mine > theirs ? 'You won' : mine < theirs ? 'You lost' : 'Draw';
    const by = m.reported_by ? names.get(m.reported_by)?.name : 'the organizer';
    box.append(h('p', {}, h('span', { class: 'pill ok', text: `${outcome} ${mine}-${theirs}${m.draws ? `-${m.draws}` : ''}` }),
      h('span', { class: 'small muted', text: ` Reported by ${by}.` })));
    if (t.status !== 'complete') {
      box.append(h('details', {}, h('summary', { text: 'Fix the result' }), resultForm(m, iAmP1, opp, status)));
    }
    box.append(status);
    return box;
  }

  const now = nowSlot(ws);
  const deadline = round.deadline_slot ?? 168;
  const oppSlots = state.oppAvail[oppId] || [];
  const oppHasAvail = names.get(oppId)?.has_availability;

  // Time status
  const timeArea = h('div', {});
  if (m.scheduled_slot != null) {
    timeArea.append(
      h('p', {}, h('span', { class: 'pill ok', text: `Scheduled: ${slotLabel(ws, m.scheduled_slot)}` })),
      h('details', {}, h('summary', { text: 'Change the time' }), suggestionsBlock()),
    );
  } else if (m.proposed_slot != null && m.proposed_by !== state.me.id) {
    const accept = h('button', { type: 'button', text: `Accept ${slotLabel(ws, m.proposed_slot)}` });
    accept.addEventListener('click', () => act(accept, () =>
      rpc('accept_time', { p_match: m.id, p_player: state.me.id, p_pin: state.me.pin }), 'Accepted. It’s on the schedule.'));
    timeArea.append(
      h('p', {}, h('span', { class: 'pill warn', text: `${opp.name} suggested ${slotLabel(ws, m.proposed_slot)}` })),
      h('div', { class: 'row' }, accept),
      h('details', {}, h('summary', { text: 'Suggest a different time' }), suggestionsBlock()),
    );
  } else if (m.proposed_slot != null) {
    timeArea.append(
      h('p', {}, h('span', { class: 'pill info', text: `Waiting for ${opp.name} to accept ${slotLabel(ws, m.proposed_slot)}` })),
      h('details', {}, h('summary', { text: 'Suggest a different time' }), suggestionsBlock()),
    );
  } else {
    timeArea.append(suggestionsBlock());
  }
  box.append(timeArea);

  box.append(h('details', {}, h('summary', { text: 'Report the result' }), resultForm(m, iAmP1, opp, status)));
  box.append(status);
  return box;

  function suggestionsBlock() {
    const wrap = h('div', {});
    if (!state.savedAvail.size) {
      wrap.append(h('p', { class: 'small', text: 'Save your availability below and suggested times will show up here.' }));
    }
    if (!oppHasAvail) {
      wrap.append(h('p', { class: 'small muted', text: `${opp.name} hasn’t entered their availability yet, so there are no shared times to suggest. You can still pick a time below.` }));
    }
    const sugg = suggestTimes([...state.savedAvail], oppSlots, { now, deadline, tournament: t });
    if (sugg.length) {
      wrap.append(h('p', { style: 'margin:8px 0 4px;font-weight:700', text: 'Times you’re both free:' }));
      const list = h('div', { class: 'suggest' });
      sugg.forEach((s, i) => {
        const tags = [
          i === 0 ? 'Best fit' : null,
          `${s.hours} hour${s.hours === 1 ? '' : 's'} free`,
          s.group ? 'group session' : null,
        ].filter(Boolean).join(' · ');
        const b = h('button', { type: 'button' },
          h('span', {}, 'Suggest ', h('strong', { text: slotLabel(ws, s.slot) })),
          h('span', { class: 'tag', text: tags }));
        b.addEventListener('click', () => propose(b, s.slot));
        list.append(b);
      });
      wrap.append(list);
    } else if (oppHasAvail && state.savedAvail.size) {
      wrap.append(h('p', { class: 'small', text: `You and ${opp.name} don’t have any free hours in common before the deadline. Try adding more hours to your availability, or pick a time below and message them.` }));
    }

    // Any time: shared hours first, then the rest of the week.
    const shared = new Set(sharedSlots([...state.savedAvail], oppSlots, { now, deadline }));
    const options = [];
    for (let d = 0; d < DAYS; d++) {
      for (const hr of HOURS) {
        const s = slotOf(d, hr);
        if (s > now && s < Math.min(deadline, 168)) options.push(s);
      }
    }
    if (options.length) {
      const id = `other-${m.id}`;
      const sel = h('select', { id },
        h('option', { value: '', text: 'Choose a time' }),
        options.map((s) => h('option', { value: String(s) },
          slotLabel(ws, s),
          shared.has(s) ? ' (you’re both free)' : '',
          inGroupSession(s, t) ? ' (group session)' : '')));
      const go = h('button', { type: 'button', class: 'secondary', text: 'Suggest this time' });
      go.addEventListener('click', () => {
        if (!sel.value) { say(status, 'Choose a time first.', 'error'); sel.focus(); return; }
        propose(go, Number(sel.value));
      });
      wrap.append(h('label', { for: id, text: 'Or pick any time' }), h('div', { class: 'row' }, h('div', { class: 'grow' }, sel), go));
    } else {
      wrap.append(h('p', { class: 'small', text: 'There are no hours left before this round’s deadline. Contact the organizer.' }));
    }
    return wrap;
  }

  function propose(btn, slot) {
    return act(btn,
      () => rpc('propose_time', { p_match: m.id, p_player: state.me.id, p_pin: state.me.pin, p_slot: slot }),
      (res) => (res && res.scheduled
        ? `That matches ${opp.name}\u2019s suggestion, so it\u2019s on the schedule.`
        : `Suggested ${slotLabel(ws, slot)}. ${opp.name} will see it when they sign in. It\u2019s a good idea to message them too.`));
  }

  async function act(btn, fn, doneMsg) {
    let out;
    try { out = await busy(btn, status, fn); } catch { return; }
    try { await refresh(); } catch { /* keep going */ }
    const msg = typeof doneMsg === 'function' ? doneMsg(out) : doneMsg;
    // Re-rendering replaced this box; announce on the new one.
    const again = document.querySelector(`[data-match="${m.id}"] .status`);
    if (again && msg) { say(again, msg, 'ok'); again.focus?.(); }
  }
}

function resultForm(m, iAmP1, opp, status) {
  const mk = (id, label, max) => [
    h('label', { for: id, text: label }),
    h('select', { id }, Array.from({ length: max + 1 }, (_, i) => h('option', { value: String(i), text: String(i) }))),
  ];
  const ids = { mine: `mine-${m.id}`, theirs: `theirs-${m.id}`, draws: `draws-${m.id}` };
  const btn = h('button', { type: 'submit', text: 'Submit result' });
  const form = h('form', { class: 'stack' },
    h('div', {}, ...mk(ids.mine, 'Games you won', 2)),
    h('div', {}, ...mk(ids.theirs, `Games ${opp.name} won`, 2)),
    h('div', {}, ...mk(ids.draws, 'Drawn games (rare)', 1)),
    btn);
  if (m.p1_wins != null) {
    form.querySelector(`#${CSS.escape(ids.mine)}`).value = String(iAmP1 ? m.p1_wins : m.p2_wins);
    form.querySelector(`#${CSS.escape(ids.theirs)}`).value = String(iAmP1 ? m.p2_wins : m.p1_wins);
    form.querySelector(`#${CSS.escape(ids.draws)}`).value = String(m.draws || 0);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mine = Number(form.querySelector(`#${CSS.escape(ids.mine)}`).value);
    const theirs = Number(form.querySelector(`#${CSS.escape(ids.theirs)}`).value);
    const draws = Number(form.querySelector(`#${CSS.escape(ids.draws)}`).value);
    if (mine + theirs + draws === 0) { say(status, 'Enter the games each of you won.', 'error'); return; }
    if (mine === 2 && theirs === 2) { say(status, 'Only one player can win 2 games.', 'error'); return; }
    const outcome = mine > theirs ? 'you won' : mine < theirs ? `${opp.name} won` : 'it was a draw';
    if (!confirm(`Submit ${mine}-${theirs}${draws ? `-${draws}` : ''}, ${outcome}?`)) return;
    try {
      await busy(btn, status, () => rpc('report_result', {
        p_match: m.id, p_player: state.me.id, p_pin: state.me.pin,
        p_p1_wins: iAmP1 ? mine : theirs, p_p2_wins: iAmP1 ? theirs : mine, p_draws: draws,
      }));
    } catch { return; /* message shown */ }
    try { await refresh(); } catch { /* keep going */ }
    const again = document.querySelector(`[data-match="${m.id}"] .status`);
    if (again) say(again, 'Result saved. Thanks!', 'ok');
  });
  return form;
}

// ---------- start ----------

const showTab = setupTabs((id) => {
  if (id !== 't-me' && state.data?.tournament) renderAll();
});

$('week').addEventListener('change', async (e) => {
  if (state.me && isDirty() && !confirm('You have availability changes that aren’t saved. Switch weeks anyway?')) {
    e.target.value = state.tid; return;
  }
  state.tid = e.target.value;
  await start(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.tid && !isDirty()) refresh().catch(() => {});
});

async function start(first = true) {
  try {
    if (first) await loadTournaments();
    if (!state.tid) { renderMe(); return; }
    await loadTournament();
    const saved = loadSession();
    const keep = state.me || saved;
    state.me = null;
    if (keep) {
      try { await signInWith(keep); } catch { saveSession(null); }
    }
    renderAll();
  } catch (err) {
    clear(panelMe).append(h('div', { class: 'card' },
      h('h2', { text: 'Couldn’t load the tournament' }),
      h('p', { class: 'status', 'data-kind': 'error', text: err.message }),
      h('button', { type: 'button', onclick: () => start(true), text: 'Try again' })));
  }
}

start();
void showTab;

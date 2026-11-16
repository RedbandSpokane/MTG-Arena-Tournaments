import { h, clear } from './dom.js';
import { computeStandings, pct } from './standings.js';
import { slotLabel, weekRangeLabel } from './slots.js';

// Accessible tabs: arrow keys move between tabs, Enter/Space or click selects.
export function setupTabs(onChange) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    onChange?.(tab.id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j != null) { e.preventDefault(); select(tabs[j], true); }
    });
  });
  return (id) => select(document.getElementById(id), false);
}

export function weekOptionLabel(t) {
  return `${t.name} (${weekRangeLabel(t.week_start)})${t.status === 'complete' ? ', finished' : ''}`;
}

export function namesById(data) {
  return new Map(data.entries.map((e) => [e.player_id, e]));
}

export function resultText(m, names) {
  const n1 = names.get(m.player1_id)?.name ?? 'Unknown';
  if (!m.player2_id) return `${n1} has a bye (counts as a 2-0 win)`;
  const n2 = names.get(m.player2_id)?.name ?? 'Unknown';
  if (m.p1_wins == null) return null;
  const d = m.draws ? `-${m.draws}` : '';
  if (m.p1_wins > m.p2_wins) return `${n1} won ${m.p1_wins}-${m.p2_wins}${d}`;
  if (m.p2_wins > m.p1_wins) return `${n2} won ${m.p2_wins}-${m.p1_wins}${d}`;
  return `Draw ${m.p1_wins}-${m.p2_wins}${d}`;
}

export function scheduleText(m, data, names) {
  const ws = data.tournament.week_start;
  if (m.scheduled_slot != null) return { text: `Scheduled: ${slotLabel(ws, m.scheduled_slot)}`, kind: 'ok' };
  if (m.proposed_slot != null) {
    const who = names.get(m.proposed_by)?.name ?? 'A player';
    return { text: `${who} suggested ${slotLabel(ws, m.proposed_slot)}`, kind: 'warn' };
  }
  return { text: 'No time set yet', kind: 'info' };
}

export function renderPairings(container, data, { adminControls } = {}) {
  clear(container);
  const names = namesById(data);
  const ws = data.tournament.week_start;
  const card = h('div', { class: 'card' });
  container.append(card);
  card.append(h('h2', { text: 'Pairings and schedule' }));

  if (data.rounds.length === 0) {
    const active = data.entries.filter((e) => !e.dropped);
    const ready = active.filter((e) => e.has_availability);
    const missing = active.filter((e) => !e.has_availability);
    card.append(
      h('p', { text: 'Round 1 hasn’t been paired yet. The organizer pairs it once everyone has entered their availability.' }),
      h('p', {}, h('strong', { text: `${ready.length} of ${active.length}` }), ' players have entered their times.'),
      missing.length ? h('p', { class: 'muted', text: `Still waiting on: ${missing.map((e) => e.name).join(', ')}` }) : null,
    );
    return;
  }

  for (const r of [...data.rounds].sort((a, b) => b.number - a.number)) {
    const ms = data.matches.filter((m) => m.round_id === r.id);
    const done = ms.filter((m) => m.p1_wins != null).length;
    card.append(h('h3', { text: `Round ${r.number}` }));
    card.append(h('p', { class: 'small muted' },
      r.deadline_slot != null ? `Play by ${slotLabel(ws, r.deadline_slot)}. ` : '',
      `${done} of ${ms.length} matches finished.`));
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const m of ms) {
      const n1 = names.get(m.player1_id)?.name ?? 'Unknown';
      const n2 = m.player2_id ? (names.get(m.player2_id)?.name ?? 'Unknown') : null;
      const res = resultText(m, names);
      const sched = scheduleText(m, data, names);
      const li = h('li', { class: `match${res ? ' done' : ''}` },
        h('div', { style: 'font-weight:700' }, n2 ? `${n1} vs ${n2}` : `${n1}: bye`),
        res ? h('div', { text: res })
          : h('div', {}, h('span', { class: `pill ${sched.kind}`, text: sched.text })),
        adminControls ? adminControls(m, r) : null,
      );
      list.append(li);
    }
    card.append(list);
  }
}

export function renderStandings(container, data) {
  clear(container);
  const rows = computeStandings(data.entries, data.matches);
  const card = h('div', { class: 'card' });
  container.append(card);
  card.append(h('h2', { text: 'Standings' }));
  if (!data.matches.some((m) => m.p1_wins != null)) {
    card.append(h('p', { text: 'No results yet. Standings appear after the first match is reported.' }));
    return rows;
  }
  const table = h('table', {},
    h('caption', { class: 'small muted', text: 'Points: win 3, draw 1. Ties broken by opponents’ match-win % (OMW), then game-win % (GW).' }),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'num', text: '#' }),
      h('th', { scope: 'col', text: 'Player' }),
      h('th', { scope: 'col', class: 'num', text: 'Points' }),
      h('th', { scope: 'col', class: 'num' }, h('abbr', { title: 'Wins-Losses-Draws', text: 'W-L-D' })),
      h('th', { scope: 'col', class: 'num' }, h('abbr', { title: 'Opponents’ match-win percentage', text: 'OMW' })),
      h('th', { scope: 'col', class: 'num' }, h('abbr', { title: 'Game-win percentage', text: 'GW' })),
    )),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', { class: 'num', text: r.rank }),
      h('th', { scope: 'row', style: 'font-family:inherit;font-size:1rem' }, r.name, r.dropped ? ' (dropped)' : ''),
      h('td', { class: 'num', text: r.points }),
      h('td', { class: 'num', text: `${r.wins}-${r.losses}-${r.draws}` }),
      h('td', { class: 'num', text: r.opponents.length ? pct(r.omw) : '–' }),
      h('td', { class: 'num', text: r.matches ? pct(r.gw) : '–' }),
    ))),
  );
  card.append(h('div', { class: 'table-wrap' }, table));
  return rows;
}

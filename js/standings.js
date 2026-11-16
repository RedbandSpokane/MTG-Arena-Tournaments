// Standings with the standard Magic tiebreakers:
// match points (win 3, draw 1), then opponents' match-win % (OMW),
// then game-win % (GW), then opponents' game-win % (OGW).
// Percentages have a 33% floor. In Swiss, a bye counts as a 2-0 win but is
// ignored when working out opponents' percentages. In round robin everyone
// sits out the same number of rounds, so byes don't count at all.

const FLOOR = 1 / 3;

export function computeStandings(entries, matches, { byeIsWin = true } = {}) {
  const st = new Map();
  for (const e of entries) {
    st.set(e.player_id, {
      id: e.player_id, name: e.name, dropped: !!e.dropped,
      points: 0, matches: 0, wins: 0, losses: 0, draws: 0,
      gamePoints: 0, games: 0, opponents: [], byes: 0,
    });
  }

  for (const m of matches) {
    if (m.p1_wins == null) continue; // not reported yet
    const a = st.get(m.player1_id);
    if (!a) continue;
    if (!m.player2_id) {
      if (!byeIsWin) continue;
      a.points += 3; a.matches += 1; a.wins += 1; a.byes += 1;
      a.gamePoints += 6; a.games += 2;
      continue;
    }
    const b = st.get(m.player2_id);
    if (!b) continue;
    const g1 = m.p1_wins, g2 = m.p2_wins, d = m.draws || 0;
    const games = g1 + g2 + d;
    a.matches += 1; b.matches += 1;
    a.opponents.push(b.id); b.opponents.push(a.id);
    if (g1 > g2) { a.points += 3; a.wins += 1; b.losses += 1; }
    else if (g2 > g1) { b.points += 3; b.wins += 1; a.losses += 1; }
    else { a.points += 1; b.points += 1; a.draws += 1; b.draws += 1; }
    a.gamePoints += 3 * g1 + d; b.gamePoints += 3 * g2 + d;
    a.games += games; b.games += games;
  }

  const mw = (p) => (p.matches ? Math.max(FLOOR, p.points / (3 * p.matches)) : FLOOR);
  const gw = (p) => (p.games ? Math.max(FLOOR, p.gamePoints / (3 * p.games)) : FLOOR);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  const rows = [...st.values()].map((p) => ({
    ...p,
    mw: mw(p),
    gw: gw(p),
    omw: avg(p.opponents.map((id) => mw(st.get(id)))),
    ogw: avg(p.opponents.map((id) => gw(st.get(id)))),
  }));

  rows.sort((x, y) =>
    y.points - x.points || y.omw - x.omw || y.gw - x.gw || y.ogw - x.ogw ||
    x.name.localeCompare(y.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export const pct = (x) => `${(x * 100).toFixed(1)}%`;

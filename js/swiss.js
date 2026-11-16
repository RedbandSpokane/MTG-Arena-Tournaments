// Swiss pairing, aware of availability.
//
// Round 1: random pairings, picking the shuffle where paired players share
// the most free hours that week.
// Later rounds: players are paired with someone on the same (or nearest)
// number of points, never a repeat opponent if it can be avoided. Among
// equally good choices, the opponent with more shared free hours wins.
// With an odd number of players, the lowest-ranked player who hasn't had a
// bye yet gets one.

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function overlapHours(availability, a, b) {
  const A = new Set(availability[a] || []);
  return (availability[b] || []).reduce((n, s) => n + (A.has(s) ? 1 : 0), 0);
}

function history(matches) {
  const played = new Map();
  const byes = new Set();
  const add = (x, y) => {
    if (!played.has(x)) played.set(x, new Set());
    played.get(x).add(y);
  };
  for (const m of matches) {
    if (!m.player2_id) { byes.add(m.player1_id); continue; }
    add(m.player1_id, m.player2_id);
    add(m.player2_id, m.player1_id);
  }
  return { played, byes };
}

function pairScore(o) {
  return o === 0 ? -20 : Math.min(o, 8);
}

// players: array of player ids taking part this round (not dropped)
// standings: output of computeStandings (sorted best first)
// matches: every earlier match in this tournament
// availability: { playerId: [slots] }
// Returns { pairs: [{ p1, p2 }], bye: playerId | null, rematches: n }
export function pairRound({ players, standings, matches, availability = {}, rng = Math.random }) {
  const { played, byes } = history(matches);
  const firstRound = matches.length === 0;
  const hasPlayed = (a, b) => played.get(a)?.has(b) ?? false;

  if (firstRound) {
    let best = null;
    for (let trial = 0; trial < 500; trial++) {
      const order = shuffle(players, rng);
      const bye = order.length % 2 ? order.pop() : null;
      const pairs = [];
      let score = 0;
      for (let i = 0; i < order.length; i += 2) {
        pairs.push({ p1: order[i], p2: order[i + 1] });
        score += pairScore(overlapHours(availability, order[i], order[i + 1]));
      }
      if (!best || score > best.score) best = { pairs, bye, score };
    }
    return { pairs: best.pairs, bye: best.bye, rematches: 0 };
  }

  const rank = new Map(standings.map((s, i) => [s.id, i]));
  const points = new Map(standings.map((s) => [s.id, s.points]));
  // Best first; ties in points broken by the standings order.
  const ordered = players.slice().sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));

  const pairUp = (list, allowRematch) => {
    if (list.length === 0) return [];
    const [p, ...rest] = list;
    const candidates = rest
      .filter((q) => allowRematch || !hasPlayed(p, q))
      .sort((a, b) =>
        Math.abs((points.get(p) ?? 0) - (points.get(a) ?? 0)) -
          Math.abs((points.get(p) ?? 0) - (points.get(b) ?? 0)) ||
        (allowRematch ? hasPlayed(p, a) - hasPlayed(p, b) : 0) ||
        pairScore(overlapHours(availability, p, b)) - pairScore(overlapHours(availability, p, a)) ||
        (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
    for (const q of candidates) {
      const sub = pairUp(rest.filter((x) => x !== q), allowRematch);
      if (sub) return [{ p1: p, p2: q }, ...sub];
    }
    return null;
  };

  const tryWithBye = (allowRematch) => {
    if (ordered.length % 2 === 0) {
      const pairs = pairUp(ordered, allowRematch);
      return pairs ? { pairs, bye: null } : null;
    }
    // Lowest-ranked player without a bye first; anyone as a last resort.
    const byeOrder = [
      ...ordered.slice().reverse().filter((p) => !byes.has(p)),
      ...ordered.slice().reverse().filter((p) => byes.has(p)),
    ];
    for (const b of byeOrder) {
      const pairs = pairUp(ordered.filter((p) => p !== b), allowRematch);
      if (pairs) return { pairs, bye: b };
    }
    return null;
  };

  const clean = tryWithBye(false);
  if (clean) return { ...clean, rematches: 0 };
  const fallback = tryWithBye(true);
  const rematches = fallback.pairs.filter((x) => hasPlayed(x.p1, x.p2)).length;
  return { ...fallback, rematches };
}

// Rounds needed so one undefeated player remains (3 for up to 8 players).
export function suggestedRounds(n) {
  if (n <= 2) return 1;
  return Math.ceil(Math.log2(n));
}

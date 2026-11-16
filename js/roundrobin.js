// Round robin: everyone plays everyone once, using the circle method.
// With an odd number of players, one player sits out each round.

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function roundRobinRoundCount(n) {
  if (n < 2) return 0;
  return n % 2 ? n : n - 1;
}

// Returns [{ pairs: [{ p1, p2 }], bye: playerId | null }, ...] one per round.
export function roundRobinSchedule(players, rng = Math.random) {
  const arr = shuffle(players, rng);
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds = [];
  let order = arr;
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    let bye = null;
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a == null) bye = b;
      else if (b == null) bye = a;
      // Alternate who is listed first so nobody is always "player 1".
      else pairs.push(r % 2 ? { p1: b, p2: a } : { p1: a, p2: b });
    }
    rounds.push({ pairs, bye });
    order = [order[0], order[n - 1], ...order.slice(1, n - 1)];
  }
  return rounds;
}

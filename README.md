# DAC NEW MTG Arena Weekly Tournament

A free website for the Disability Action Center Northeast Washington's weekly
Magic: The Gathering Arena tournament. Players enter when they're free, the
organizer posts the matches, and the site suggests match times both players
can make.

Each week can be one of two styles, picked when the week is created (and
changeable until matches are posted):

- **Round robin:** everyone plays everyone once. The whole week's schedule is
  posted at once so players can play their matches in any order. Best for up
  to about 6 players. With an odd number, each player sits out one round,
  which doesn't count as a win or a loss.
- **Swiss:** rounds are posted one at a time, pairing players with the same
  record. Best once more people join.

- **Player page:** `index.html`
- **Organizer page:** `organizer.html` (needs the organizer passphrase)

## How a week runs

1. **Organizer:** on the Players tab, add each player with a 4-digit PIN (and
   their Arena username if you have it). Give each player their PIN.
2. **Organizer:** on This week, open *Create a new week*, pick the first day,
   the number of rounds, the Saturday group session hours, and who's playing.
3. **Players:** sign in with their name and PIN, tap the hours they're free,
   and save.
4. **Organizer, round robin weeks:** once availability is in, tap *Make the
   schedule*, check it, and post. Players see every opponent right away. Skip
   to step 5, then mark the tournament finished when every match is in.
   **Organizer, Swiss weeks:** once availability is in, tap *Pair round 1*. Round 1 is
   random, but the site picks the shuffle where opponents share the most free
   hours. Check the preview, set a play-by deadline, and post it.
5. **Players:** see their opponent and up to 5 suggested times they're both
   free. One player suggests a time, the other accepts it, and it's on the
   schedule. After playing, either player reports the result.
6. **Organizer:** when a round's results are in, pair the next round. Later
   rounds pair players with the same record, avoid rematches, and use shared
   free hours as a tiebreaker. Odd numbers get a bye (2-0 win) for the
   lowest-ranked player who hasn't had one.
7. **Organizer:** after the last round, mark the tournament finished.

Standings use 3 points for a win and 1 for a draw, then opponents'
match-win %, game-win %, and opponents' game-win % (33% floor), like official
Magic events.

## How it's built

- Plain HTML, CSS and JavaScript. No build step: GitHub Pages serves the files
  as they are.
- Data lives in a Supabase database (project "MTG Tournament"). The tables
  are locked; the site can only call the functions in `supabase/`, which check
  the player's PIN or the organizer passphrase. Eight wrong PINs in 15 minutes
  locks that player out for 15 minutes.
- `js/config.js` holds the database address and its publishable key. That key
  is meant to be public.
- Times are stored in Pacific Time. Each hour of the week is stored as a
  number: `day * 24 + hour`, where day 0 is the week's first day.
- Players pick their own time zone at the top of the player page (it's
  remembered on their device and guessed from the device the first time).
  The availability grid, suggested times, and deadlines all show in that
  zone. The organizer page always shows Pacific Time.

| File | What it does |
| --- | --- |
| `js/app.js` | Player page |
| `js/organizer.js` | Organizer page |
| `js/swiss.js` | Swiss pairing |
| `js/roundrobin.js` | Round robin schedule |
| `js/schedule.js` | Suggested match times |
| `js/standings.js` | Standings and tiebreakers |
| `js/slots.js` | Day and time labels |
| `supabase/*.sql` | Database tables and functions, in the order they were applied |

## Changing the hours on the availability grid

Edit `FIRST_HOUR` and `LAST_HOUR` in `js/config.js`.

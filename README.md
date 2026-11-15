# Crazy

The Ethiopian card game — UNO's cousin, played with a normal deck — online with friends.

Full rules: [RULES.md](RULES.md)

## Layout

```
packages/
  engine/   Pure TypeScript rules engine (no network, no UI) + tests
```

Coming next: `server/` (rooms + real-time play over WebSockets) and `web/` (the phone-friendly game table).

## Develop

```bash
npm install
npm test          # run the rules tests
npm run typecheck
```

## How the engine works

`CrazyGame` is the single source of truth and runs on the server.

- **Actions:** `play`, `draw`, `pass`, `callCrazy`, `snap`, plus `tick(now)` from a timer.
  Each returns a list of events to broadcast.
- **Illegal moves are allowed.** Every move is checked and its foul is stored
  privately. It's only punished if another player calls Crazy before the window
  closes. Playing out of turn is the exception: it's penalized instantly.
- **`viewFor(playerId)`** is what a client may see: your own hand, everyone else's
  card counts, the table — never other hands or a move's foul.

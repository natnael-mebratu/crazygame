# Crazy

The Ethiopian card game — UNO's cousin, played with a normal deck — online with friends.
One person creates a room, shares the link, everyone plays from their phone browser. No app install.

Full rules: [RULES.md](RULES.md)

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3001. To play with phones on the same Wi-Fi, open
`http://<your-computer's-IP>:3001` on each phone.

While changing code, `npm run dev` runs the server on :3001 and a hot-reloading
app on http://localhost:5173.

## Put it online

It's one Node server (it serves the app too), so any host that runs Node or Docker works.

**Render (free tier):** New → Web Service → connect this repo →
Build command `npm install && npm run build`, Start command `npm start`.
Render sets `PORT` automatically. Then share `https://<your-app>.onrender.com`.

**Docker (Fly.io, Railway, a VPS…):** the included `Dockerfile` builds and runs everything:

```bash
docker build -t crazy .
```

```bash
docker run -p 3001:3001 crazy
```

Games live in the server's memory: restarting the server ends running games.

## Layout

```
packages/
  engine/   The rules (pure TypeScript) + 39 rule tests
  server/   Rooms, real-time play over WebSockets (Socket.IO)
  web/      The phone app (React + Vite)
scripts/
  e2e.mjs   Plays full 4-player games in real browsers
```

## Tests

```bash
npm test
```

```bash
npm run e2e
```

Two more browser checks need the server started with `CRAZY_DEBUG=1` (a test-only switch that
lets the script set up hands; leave it off in production):

- `node scripts/popups.mjs` — screenshots every popup (CRAZY!, LAST!, penalties, win…)
- `node scripts/features.mjs` — checks the suit bar, swipe-to-drop, combos, sorting, two-row hand,
  last plays, the CRAZY! label and removing a player

`npm run e2e` needs the server running (`npm start`) and Playwright installed. It plays a whole
game with 4 phone browsers — including a deliberate mistake caught with CRAZY!, LAST! calls and a rematch.

## How it works

- **The server is the referee.** It holds the deck and every hand; each phone only receives its
  own cards plus everyone's card counts.
- **Mistakes are allowed.** Any move goes on the table. The server knows if it was illegal but only
  punishes it if someone hits CRAZY! before the next move (a winning last card gets 5 seconds). Playing out of turn
  and dodging a 2 / A♠ are caught automatically.
- **Refresh-proof.** Your seat is saved on your phone; reload or lose signal and you drop straight
  back into the game. If you're gone on your turn for 15 seconds, the game draws and passes for you.

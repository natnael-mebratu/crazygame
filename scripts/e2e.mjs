// Plays a full game with 4 phone browsers against a running server.
// Usage: node scripts/e2e.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3001';
const SHOTS = process.argv[3] ?? 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const NAMES = ['Natnael', 'Abel', 'Sara', 'Yoni'];
const RANK = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
const SUIT = { H: 'hearts', D: 'diamonds', S: 'spades', C: 'clubs' };
const SUIT_BTN = { H: 'Hearts', D: 'Diamonds', S: 'Spades', C: 'Clubs' };
const spoken = (c) => `${RANK[c.rank] ?? c.rank} of ${SUIT[c.suit]}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

const browser = await chromium.launch();
const pages = [];
const errors = [];
for (const name of NAMES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  pages.push({ name, page });
}

// Create + join
const host = pages[0].page;
await host.goto(BASE);
await host.getByLabel('Your name').fill(NAMES[0]);
await host.screenshot({ path: `${SHOTS}/01-home.png` });
await host.getByRole('button', { name: 'Create a game' }).click();
await host.locator('.code-tiles').waitFor();
const code = (await host.locator('.code-tiles').innerText()).replace(/\s/g, '');
log('room', code);
for (const { name, page } of pages.slice(1)) {
  await page.goto(`${BASE}/?room=${code}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: `Join room ${code}` }).click();
  await page.locator('.code-tiles').waitFor();
}
await host.getByRole('button', { name: /Deal cards \(4 players\)/ }).click();
await host.screenshot({ path: `${SHOTS}/02-lobby.png` }).catch(() => {});
for (const { page } of pages) await page.locator('.hand-card').first().waitFor();
await sleep(500);
await host.screenshot({ path: `${SHOTS}/03-start.png` });

const view = (page) => page.evaluate(() => window.__crazyView);

async function tapPlay(page, cards, suit) {
  try {
    await tapPlayInner(page, cards, suit);
  } catch (e) {
    await page.screenshot({ path: `${SHOTS}/fail.png` });
    console.log('hand:', JSON.stringify((await view(page)).you.hand.map(spoken)), 'playing', cards.map(spoken), suit);
    throw e;
  }
}
async function tapPlayInner(page, cards, suit) {
  for (const c of cards) await page.locator(`[data-card-id="${c.id}"]`).dispatchEvent("click");
  await page.locator(`[data-card-id="${cards[0].id}"]`).dispatchEvent("click"); // tap lead again = drop
  if (suit) await page.getByRole('button', { name: new RegExp(SUIT_BTN[suit]) }).click();
}

function legal(v) {
  const top = v.top;
  const hand = v.you.hand;
  if (!top) return { cards: [hand.find((c) => !['2', '5', '7', '8', 'J'].includes(c.rank)) ?? hand[0]] };
  if (v.pendingPenalty > 0) {
    const s = hand.find((c) => (c.rank === '2' && top.rank === '2') || (c.rank === 'A' && c.suit === 'S' && top.rank === '2' && top.suit === 'S'));
    return s ? { cards: [s] } : null;
  }
  const match = (c) => c.suit === v.activeSuit || c.rank === top.rank;
  // Combo when possible: 7 + same suit
  const seven = hand.find((c) => c.rank === '7' && match(c));
  if (seven) {
    const rest = hand.filter((c) => c !== seven && c.suit === seven.suit);
    if (rest.length) return { cards: [seven, ...rest] };
  }
  const plain = hand.find((c) => match(c) && c.rank !== '8' && c.rank !== 'J');
  if (plain) return { cards: [plain] };
  const wild = hand.find((c) => c.rank === '8' || c.rank === 'J');
  if (wild && !v.wildCooldown) {
    const counts = {};
    for (const c of hand) if (c !== wild) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
    const suit = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? wild.suit;
    return { cards: [wild], suit };
  }
  if (wild && match(wild)) return { cards: [wild], suit: v.activeSuit }; // keep the suit
  return null;
}

let moves = 0;
let foulDone = false;
let snaps = 0;
let shotMid = false;
const t0 = Date.now();

while (moves < 400) {
  const views = await Promise.all(pages.map(({ page }) => view(page)));
  if (views[0]?.status === 'finished') break;

  // SNAP race: anyone on 1 card snaps themselves.
  for (let i = 0; i < pages.length; i++) {
    const me = views[i].players.find((p) => p.id === views[i].you.id);
    if (views[i].you.hand.length === 1 && me.snap === 'open') {
      await pages[i].page.getByRole('button', { name: 'SNAP' }).click();
      snaps++;
      log(`${pages[i].name} snaps`);
    }
  }

  const ti = views.findIndex((v) => v.turnPlayerId === v.you.id);
  if (ti < 0) { await sleep(150); continue; }
  const { name, page } = pages[ti];
  const v = views[ti];

  // Once: play a wrong card on purpose and let the next player catch it.
  if (!foulDone && moves > 6 && v.top && v.pendingPenalty === 0 && !v.wildCooldown) {
    const bad = v.you.hand.find((c) => c.suit !== v.activeSuit && c.rank !== v.top.rank && !['8', 'J', '7'].includes(c.rank));
    if (bad) {
      log(`${name} plays ${spoken(bad)} illegally`);
      await tapPlay(page, [bad]);
      await sleep(250);
      const catcher = pages[(ti + 1) % pages.length];
      await catcher.page.getByRole('button', { name: 'CRAZY!' }).click();
      await sleep(300);
      await catcher.page.screenshot({ path: `${SHOTS}/05-crazy-called.png` });
      foulDone = true;
      await sleep(900);
      moves++;
      continue;
    }
  }

  const choice = legal(v);
  if (choice) {
    log(`${name} plays ${choice.cards.map(spoken).join(' + ')}${choice.suit ? ` → ${choice.suit}` : ''}`);
    await tapPlay(page, choice.cards, choice.suit);
  } else if (v.pendingPenalty > 0) {
    log(`${name} takes +${v.pendingPenalty}`);
    await page.getByRole('button', { name: /Take \+/ }).first().click();
  } else if (!v.hasDrawn) {
    log(`${name} draws`);
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
  } else {
    log(`${name} passes`);
    await page.getByRole('button', { name: 'Pass' }).click();
  }
  moves++;
  if (!shotMid && moves === 12) {
    await sleep(420);
    await host.screenshot({ path: `${SHOTS}/04-mid.png` });
    shotMid = true;
  }
  // Wait until the server reflects the move (turn or hand changed).
  const before = JSON.stringify([v.turnPlayerId, v.you.hand.length, v.hasDrawn, v.discardCount]);
  for (let i = 0; i < 40; i++) {
    const nv = await view(page);
    if (nv.status === 'finished' || JSON.stringify([nv.turnPlayerId, nv.you.hand.length, nv.hasDrawn, nv.discardCount]) !== before) break;
    await sleep(50);
  }
  await sleep(120);
}

// Wait for the win (Crazy window on the last card)
await host.locator('.sheet.win').waitFor({ timeout: 8000 }).catch(() => {});
const final = await view(host);
log(`finished=${final.status} winner=${final.winner && final.players.find((p) => p.id === final.winner).name} moves=${moves} snaps=${snaps} foulTested=${foulDone} secs=${((Date.now() - t0) / 1000).toFixed(1)}`);
await sleep(300);
await host.screenshot({ path: `${SHOTS}/06-end.png` });

// Rematch
if (final.status === 'finished') {
  await host.getByRole('button', { name: 'Play again' }).click();
  await pages[1].page.locator('.sheet.win').waitFor({ state: 'detached', timeout: 5000 });
  log('rematch dealt:', (await view(pages[1].page)).status);
  await sleep(400);
  const staleRematch = await pages[1].page.locator('.feed-line').count();
  if (staleRematch) errors.push(`rematch shows ${staleRematch} old feed lines`);

  // Leave, start a brand-new room: nothing from the old game may show up.
  await host.getByRole('button', { name: 'Leave' }).click();
  host.once('dialog', (d) => d.accept());
  await host.getByRole('button', { name: 'Create a game' }).click({ timeout: 5000 }).catch(async () => {
    await host.getByRole('button', { name: 'Leave' }).click();
    await host.getByRole('button', { name: 'Create a game' }).click();
  });
  await host.locator('.code-tiles').waitFor();
  const code2 = (await host.locator('.code-tiles').innerText()).replace(/\s/g, '');
  const p2 = pages[1].page;
  await p2.evaluate(() => localStorage.removeItem('crazy.session'));
  await p2.goto(`${BASE}/?room=${code2}`);
  await p2.getByRole('button', { name: `Join room ${code2}` }).click();
  await host.getByRole('button', { name: /Deal cards/ }).click();
  await host.locator('.hand-card').first().waitFor();
  await sleep(500);
  const staleNew = await host.locator('.feed-line').count();
  if (staleNew) errors.push(`new room shows ${staleNew} old feed lines`);
  log('new room clean:', !staleRematch && !staleNew);
  await host.screenshot({ path: `${SHOTS}/07-new-room.png` });
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(final.status === 'finished' && !errors.length ? 0 : 1);

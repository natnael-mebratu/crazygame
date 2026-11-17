// Walks through every popup (start, CRAZY, wrong call, out of turn, SNAP, picker, penalty, win)
// and saves a screenshot of each. Needs a server started with CRAZY_DEBUG=1:
//   CRAZY_DEBUG=1 npm start   then   node scripts/popups.mjs [screenshotDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const B=process.env.BASE ?? 'http://localhost:3001', S=process.argv[2] ?? 'popup-shots';
import('node:fs').then(fs=>fs.mkdirSync(S,{recursive:true}));
const br = await chromium.launch();
const errors=[];
const mk=async n=>{const c=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const p=await c.newPage();p.on('pageerror',e=>errors.push(n+': '+e.message));return p;};
const [A,Bp,C]=[await mk('A'),await mk('B'),await mk('C')];
await A.goto(B); await A.getByLabel('Your name').fill('Natnael'); await A.getByRole('button',{name:'Create a game'}).click();
await A.locator('.code-tiles').waitFor(); const code=(await A.locator('.code-tiles').innerText()).replace(/\s/g,'');
for (const [p,n] of [[Bp,'Yeabsira'],[C,'Abel']]) { await p.goto(`${B}/?room=${code}`); await p.getByLabel('Your name').fill(n); await p.getByRole('button',{name:/Join room/}).click(); await p.locator('.code-tiles').waitFor(); }
await A.getByRole('button',{name:/Deal cards/}).click();
for (const p of [A,Bp,C]) await p.locator('.hand-card').first().waitFor();
const shot=async(p,n,ms=250)=>{await p.waitForTimeout(ms); await p.screenshot({path:`${S}/${n}.png`});};
const v=p=>p.evaluate(()=>window.__crazyView);
const rig=(r)=>A.evaluate(r=>window.__crazyRig(r),r);
const cid=async(p,label)=>{const h=(await v(p)).you.hand; const r={A:'A',J:'J',Q:'Q',K:'K'}; const c=h.find(c=>`${c.rank}${c.suit}`===label); if(!c) throw new Error('no '+label); return c.id;};
const play=async(p,labels,suit)=>{const ids=[];for(const l of labels) ids.push(await cid(p,l)); for(const id of ids) await p.locator(`[data-card-id="${id}"]`).dispatchEvent('click'); await p.locator(`[data-card-id="${ids[0]}"]`).dispatchEvent('click'); if(suit) await p.getByRole('button',{name:new RegExp(suit)}).click();};
// players: index 0 = Natnael(A), 1 = Yeabsira(B), 2 = Abel(C)
await shot(A,'01-start',300);
const st=(await v(A)).turnPlayerId; const pages={[ (await v(A)).you.id]:A, [(await v(Bp)).you.id]:Bp, [(await v(C)).you.id]:C};
const nonStarter=[A,Bp,C].find(p=>pages[st]!==p);
await nonStarter.getByRole('button',{name:'LAST!'}).click(); await shot(nonStarter,'02-prestart-snap',300);

const base={hands:[['KH','9S','4D','5C','JD'],['3C','8H','QS','2D','2S'],['6D','7C','10H','JS','AS']],top:'4S',turn:0};
await rig(base); await A.waitForTimeout(1800);
await play(A,['KH']); await shot(Bp,'03-B-sees-window',300);
await Bp.getByRole('button',{name:'CRAZY!'}).click();
await shot(A,'04a-A-caught',250); await shot(A,'04b-A-caught-later',1100); console.log('flying cards left 1.35s after penalty:', await A.locator('.fly').count());

await rig(base); await A.waitForTimeout(1800);
await play(A,['9S']); await A.waitForTimeout(300); await C.getByRole('button',{name:'CRAZY!'}).click();
await shot(C,'05-C-wrong-call',250); await shot(A,'05b-A-sees-wrong-call',50);

await A.waitForTimeout(1500);
await play(C,['6D']); await shot(C,'06-C-out-of-turn',250); await shot(A,'06b-A-sees-out-of-turn',50);

await A.waitForTimeout(1500);
await rig({hands:[['9S','KH'],base.hands[1],base.hands[2]],top:'4S',turn:0}); await A.waitForTimeout(400);
await play(A,['9S']); await shot(Bp,'07-B-sees-last-card',300);
await Bp.getByRole('button',{name:'LAST!'}).click(); await shot(A,'08-A-snapped',250);

await A.waitForTimeout(1500);
await rig({hands:[['9S','KH'],base.hands[1],base.hands[2]],top:'4S',turn:0}); await A.waitForTimeout(400);
await play(A,['9S']); await A.waitForTimeout(200); await A.getByRole('button',{name:'LAST!'}).click(); await shot(A,'09-A-safe',250);
await A.waitForTimeout(1500);
await C.getByRole('button',{name:'LAST!'}).click(); await shot(C,'10-C-false-snap',250);

await A.waitForTimeout(1500);
await rig(base); await A.waitForTimeout(400);
await play(A,['JD']).catch(()=>{}); await shot(A,'11-picker',300);
await A.getByRole('button',{name:/Spades/}).click(); await A.waitForTimeout(500);

await rig({hands:[['2H','9S','KD'],['3C','8H','QS'],base.hands[2]],top:'9H',turn:0}); await A.waitForTimeout(400);
await play(A,['2H']); await shot(Bp,'12-B-pending',500);
await play(Bp,['QS']); await shot(Bp,'13-B-dodge',300);

await Bp.waitForTimeout(1500);
await rig({hands:[['9S'],base.hands[1],base.hands[2]],top:'4S',turn:0}); await A.waitForTimeout(400);
await A.getByRole('button',{name:'LAST!'}).click(); await A.waitForTimeout(300);
await play(A,['9S']); await shot(Bp,'14-B-last-card-window',600);
await shot(Bp,'15-win',5200);
for (const [n,p] of [['A',A],['B',Bp],['C',C]]) console.log(n,'flying cards left at end:', await p.locator('.fly').count());
console.log(errors.length?errors.join('\n'):'no page errors');
await br.close();

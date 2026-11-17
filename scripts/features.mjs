// Checks the play features in a real browser. Needs a server started with CRAZY_DEBUG=1:
//   CRAZY_DEBUG=1 npm start   then   node scripts/features.mjs [screenshotDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const B=process.env.BASE ?? 'http://localhost:3001', S=process.argv[2] ?? 'feature-shots';
(await import('node:fs')).mkdirSync(S,{recursive:true});
const br = await chromium.launch(); const errors=[]; const ok=(n,c)=>console.log((c?'PASS':'FAIL')+'  '+n);
const mk=async n=>{const c=await br.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});const p=await c.newPage();p.on('pageerror',e=>errors.push(n+': '+e.message));p.on('dialog',d=>d.accept());return p;};
const [A,Bp,C]=[await mk('A'),await mk('B'),await mk('C')];
await A.goto(B); await A.getByLabel('Your name').fill('Natnael'); await A.getByRole('button',{name:'Create a game'}).click();
await A.locator('.code-tiles').waitFor(); const code=(await A.locator('.code-tiles').innerText()).replace(/\s/g,'');
for (const [p,n] of [[Bp,'Yeabsira'],[C,'Abel']]) { await p.goto(`${B}/?room=${code}`); await p.getByLabel('Your name').fill(n); await p.getByRole('button',{name:/Join room/}).click(); await p.locator('.code-tiles').waitFor(); }
await A.getByRole('button',{name:/Deal cards/}).click(); for (const p of [A,Bp,C]) await p.locator('.hand-card').first().waitFor();
const v=p=>p.evaluate(()=>window.__crazyView); const rig=r=>A.evaluate(r=>window.__crazyRig(r),r);
const id=async(p,l)=>(await v(p)).you.hand.find(c=>`${c.rank}${c.suit}`===l).id;
const card=async(p,l)=>p.locator(`[data-card-id="${await id(p,l)}"]`);
const W=ms=>A.waitForTimeout(ms);
await W(1900);

// 1. suit bar above the hand
await rig({hands:[['JD','9S','4S','KS','5H','2C'],['3C','8H','QS','2D'],['6D','7C','10H','JS']],top:'4H',turn:0}); await W(400);
await (await card(A,'JD')).dispatchEvent('click'); await (await card(A,'JD')).dispatchEvent('click'); await W(250);
const bar=await A.locator('.suit-bar').boundingBox(); const handBox=await A.locator('.hand').boundingBox();
ok('suit bar shows instead of a sheet', !!bar && await A.locator('.sheet').count()===0);
ok('suit bar sits above the hand, not over it', bar && bar.y+bar.height <= handBox.y+2);
const sp=await A.getByRole('button',{name:/^Spades, you hold 3/}).count(); ok('suit buttons show how many you hold (♠ 3)', sp===1);
await A.screenshot({path:`${S}/1-suit-bar.png`});
await A.getByRole('button',{name:/^Spades/}).click(); await W(600);
const chip=await A.locator('.chip.suit').innerText(); ok('suit chip says who called it: '+JSON.stringify(chip), /called by you/.test(chip));
const chipB=await Bp.locator('.chip.suit').innerText(); ok('others see "called by Natnael": '+JSON.stringify(chipB), /called by Natnael/.test(chipB));

// 11. CRAZY label (B looks at A's move)
const crazyTxt=await Bp.locator('.btn.crazy').innerText(); ok('CRAZY! says what it calls: '+JSON.stringify(crazyTxt.replace(/\n/g,' ')), /on Natnael/.test(crazyTxt));
await Bp.screenshot({path:`${S}/2-called-by-and-crazy-label.png`});

// 2. swipe up drops a card
await rig({hands:[['9S','4S','KS','5H'],['3C','8H','QS','2D'],['6D','7C','10H','JS']],top:'4S',turn:0}); await W(400);
const el=await card(A,'9S'); const bb=await el.boundingBox();
await A.mouse.move(bb.x+10,bb.y+bb.height/2); await A.mouse.down(); await A.mouse.move(bb.x+12,bb.y+bb.height/2-30,{steps:4}); await A.mouse.move(bb.x+12,bb.y+bb.height/2-70,{steps:4}); await A.mouse.up();
await W(800); ok('swipe up dropped 9♠', (await v(A)).top?.rank==='9' && (await v(A)).top?.suit==='S');

// 3. tap outside cancels a lifted card
await rig({hands:[['9S','4S','KS','5H'],['3C','8H','QS','2D'],['6D','7C','10H','JS']],top:'4S',turn:0}); await W(400);
await (await card(A,'KS')).dispatchEvent('click'); await W(150); const lifted=await A.locator('.hand-card.picked').count();
await A.locator('.table-area').click({position:{x:30,y:300}}); await W(150);
ok('tap on the table puts the lifted card back', lifted===1 && await A.locator('.hand-card.picked').count()===0);

// 4. combo shows which card lands on top
await rig({hands:[['7S','4S','KS','5H','2S'],['3C','8H','QS','2D'],['6D','7C','10H','JS']],top:'4S',turn:0}); await W(400);
await (await card(A,'7S')).dispatchEvent('click'); await A.getByRole('button',{name:/\+ all/}).click(); await W(150);
const st=await A.locator('.sel-text').innerText(); ok('combo text names the top card: '+JSON.stringify(st), /on top/.test(st));
await A.screenshot({path:`${S}/3-combo-top.png`});
await A.locator('.table-area').click({position:{x:30,y:300}});

// 5. fresh glow + Pass nudge after drawing
await A.getByRole('button',{name:'Draw',exact:true}).click(); await W(500);
ok('drawn card glows', await A.locator('.hand-card.fresh').count()===1);
ok('Pass pulses after drawing', await A.locator('.btn.nudge').count()===1);
await A.screenshot({path:`${S}/4-fresh-card.png`});
await A.getByRole('button',{name:'Pass'}).click(); await W(400);

// 6. sort toggle
const before=await A.locator('.hand-card').evaluateAll(b=>b.map(x=>x.getAttribute('aria-label')));
await A.getByRole('button',{name:/Change sorting/}).click(); await W(400);
const after=await A.locator('.hand-card').evaluateAll(b=>b.map(x=>x.getAttribute('aria-label')));
ok('sort toggle reorders: '+after.join(', '), JSON.stringify(before)!==JSON.stringify(after));
await A.getByRole('button',{name:/Change sorting/}).click();

// 7. two rows with many cards
await rig({hands:[['AS','2S','3S','4S','5S','6S','7S','8S','9S','10S','JS','QS','KS','AH','2H','3H'],['3C','8H'],['6D','7C']],top:'4D',turn:1}); await W(600);
const tops=await A.locator('.hand-card').evaluateAll(b=>[...new Set(b.map(x=>Math.round(parseFloat(x.style.top))))].length);
const scrollW=await A.locator('.hand').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
ok('16 cards: two rows, no sideways scrolling', tops>=2 && scrollW);
await A.screenshot({path:`${S}/5-two-rows.png`});

// 10. recent plays panel
await rig({hands:[['9S','4S','KS'],['3S','8H','QS'],['6D','7C','10H']],top:'4S',turn:0}); await W(300);
await (await card(A,'9S')).dispatchEvent('click'); await (await card(A,'9S')).dispatchEvent('click'); await W(500);
await (await card(Bp,'3S')).dispatchEvent('click'); await (await card(Bp,'3S')).dispatchEvent('click'); await W(700);
await A.getByRole('button',{name:/last cards played/}).click(); await W(250);
const rows=await A.locator('.recent-row').count(); ok('tap pile shows last plays ('+rows+' rows)', rows>=2);
await A.screenshot({path:`${S}/6-recent.png`});
await A.locator('.recent').click();

// LAST! button name
ok('button renamed to LAST!', await A.getByRole('button',{name:'LAST!'}).count()===1);

// 12. host removes a player who left
await C.context().close(); await W(1200);
const removeBtn=A.getByRole('button',{name:'Remove'}); ok('host sees Remove on the player who left', await removeBtn.count()===1);
await A.screenshot({path:`${S}/7-remove.png`});
await removeBtn.click(); await W(800);
const vv=await v(A); ok('player removed, game goes on with 2 players', vv.players.length===2 && vv.status==='playing');
console.log(errors.length?errors.join('\n'):'no page errors'); await br.close();

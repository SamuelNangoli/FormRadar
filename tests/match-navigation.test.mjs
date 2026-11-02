import test from 'node:test';
import assert from 'node:assert/strict';
import {matchHref,matchesHref,readMatchNavigation} from '../src/match-navigation.js';

const context={league:'PL',season:'2025',page:'Predictions',filter:'results',from:'2026-10-30',to:'2026-11-09',search:'Sunderland & Chelsea',demo:false,selectedId:538155};

test('a match link survives a new tab or reload with its exact fixture and historical list context',()=>{
  const href=matchHref({id:538155},context);
  assert.ok(href.startsWith('#match/538155?'));
  const route=readMatchNavigation(href);
  assert.deepEqual(route,{kind:'match',id:538155,context});
  const back=readMatchNavigation(matchesHref(route.context));
  assert.deepEqual(back,{kind:'list',context});
  assert.equal(readMatchNavigation(matchHref({id:537869},context)).id,537869,'the other home/away meeting stays a separate fixture');
});

test('demo match links stay explicit and cannot be interpreted as a real provider match',()=>{
  const demo={...context,season:'',demo:true,league:'CL',selectedId:'CL-demo-1'};
  assert.deepEqual(readMatchNavigation(matchHref({id:'CL-demo-1'},demo)),{kind:'match',id:'CL-demo-1',context:demo});
  for(const hash of ['#match/CL-demo-1?competition=CL','#match/PL-demo-1?competition=CL&demo=1','#match/538155?demo=1'])assert.equal(readMatchNavigation(hash).kind,'invalid');
});

test('malformed links cannot select an unrelated fixture or inject paths, seasons or navigation targets',()=>{
  for(const hash of ['#match/0','#match/-2','#match/1/lineups','#match/1%2flineups','#match/https://attacker.test','#match/NaN','#match/99999999','#match'])assert.equal(readMatchNavigation(hash).kind,'invalid');
  assert.equal(readMatchNavigation('#main-content'),null);
  const parsed=readMatchNavigation('#match/538155?competition=invalid&season=9999&view=https://attacker.test&filter=broken&from=2026-02-31&q='+encodeURIComponent('<a href="https://attacker.test">'));
  assert.equal(parsed.id,538155);assert.equal(parsed.context.league,'PL');assert.equal(parsed.context.season,'');assert.equal(parsed.context.page,'Live Scores');assert.equal(parsed.context.filter,'all');assert.notEqual(parsed.context.from,'2026-02-31');
  assert.equal(parsed.context.search,'<a href="https://attacker.test">');
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createGuardRunner}=require('./ppc-campaign-guard-runner.cjs');
function fixture(source,reply,extra={}){
  const writes=[],requests=[];
  const runner=createGuardRunner({now:()=>600001,lease:async()=>{},
    db:{query:async(q,p)=>{
      if(q.startsWith('SELECT halted'))return [{halted:false}];
      if(q.includes('MIN(updated_at)'))return [];
      if(q.startsWith('SELECT * FROM ppc_campaign_guard_jobs'))return [{contact_id:'c1',revision:3,source}];
      if(q.startsWith('SELECT * FROM ppc_campaign_guard_memberships'))return [];
      writes.push({q,p});return [];
    }},sourceRequest:async(provider,path)=>{requests.push(path);return reply(path);},
    campaignRequest:async()=>{throw Error('Unexpected campaign mutation');},...extra});
  return {runner,writes,requests};
}
test('temporary active-contact deferral keeps work pending and expires without an agent',async()=>{
 const f=fixture({},()=>{throw Error('No provider request while deferred');},{deferredContacts:{c1:new Date(900000).toISOString()}});
 assert.equal(await f.runner.step(),true);
 assert.equal(f.requests.length,0);
 assert.ok(f.writes.some(x=>x.q.includes('SET retry_at=$2')&&x.p[2]===3));
 assert.equal(f.writes.some(x=>x.q.includes('SET processed_revision')),false);
 const expired=fixture({at:600000,contact:{id:'c1'},notes:[]},()=>{throw Error('No refresh required');},{deferredContacts:{c1:new Date(500000).toISOString()}});
 assert.equal(await expired.runner.step(),true);
 assert.ok(expired.writes.some(x=>x.q.includes('SET processed_revision')));
});
test('stale-source authorization failure halts guard without requesting notes or mutating campaigns',async()=>{
  const f=fixture({at:0},()=>({ok:false,status:401}));
  assert.deepEqual(await f.runner.step(),{error:'GUARD_SOURCE_HTTP_401'});
  assert.deepEqual(f.requests,['/contacts/c1']);
  assert.equal(f.writes.find(x=>x.q.includes('SET halted')).p[0],true);
  assert.equal(f.writes.some(x=>x.q.includes('SET processed_revision')),false);
});
test('missing timestamp triggers refresh and transient errors retry without permanent halt',async()=>{
  const f=fixture({},()=>({ok:false,status:429}));
  await f.runner.step();
  assert.equal(f.requests.length,1);
  assert.equal(f.writes.find(x=>x.q.includes('SET halted')).p[0],false);
  assert.ok(f.writes.some(x=>x.q.includes("INTERVAL '60 seconds'")));
});
test('malformed fresh source halts before membership evaluation',async()=>{
  const f=fixture({at:600000,contact:{id:'wrong'},notes:[]},()=>{throw Error('Unexpected refresh');});
  await f.runner.step();
  assert.equal(f.writes.find(x=>x.q.includes('SET halted')).p[0],true);
  assert.equal(f.requests.length,0);
});
test('processing acknowledges only the captured revision so a newer queued revision remains pending',async()=>{
  const f=fixture({at:600000,contact:{id:'c1'},notes:[]},()=>{throw Error('Unexpected refresh');});
  assert.equal(await f.runner.step(),true);
  assert.deepEqual(f.writes.find(x=>x.q.includes('SET processed_revision')).p,['c1',3]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('./ppc-team-note-service.cjs');
const { createRefresher, briefFromNotes, comparable } = require('./ppc-team-note-refresh.cjs');
const { LOCATION_ID } = require('./ppc-sales-dialer-webhook-inbox.cjs');

test('imported undated calls distinguish recorded date from a callback date',()=>{
  const body='[UNDERWRITING NOTE v3 call=99]\nCaller: Montelli\nCall Date: Unknown\nFollow-up: Call tomorrow at 1 PM';
  const brief=briefFromNotes([{body,dateAdded:'2026-09-06'}],false);
  assert.match(brief,/2026-09-06 recorded/);
  assert.match(brief,/call date unverified/);
  assert.match(brief,/Call tomorrow at 1 PM/);
  const ordinary=briefFromNotes([{body:'Seller wants to talk tomorrow',dateAdded:'2026-09-09',userName:'Kayla'}],false);
  assert.match(ordinary,/2026-09-09 \/ Kayla:/);
  assert.doesNotMatch(ordinary,/call date unverified/);
});

test('duplicate dialer targets keep independent restart verification checkpoints', async () => {
  const states=new Map(), writes=[]; const briefs=new Map();
  const deps={
    progress:{get:async k=>states.get(k),set:async(k,s)=>states.set(k,s),clear:async k=>states.delete(k)},
    ghl:async p=>({ok:true,data:p.endsWith('/notes')?{notes:[{body:'Kayla spoke with seller about roof repairs.',dateAdded:'2026-09-09'}]}:{contact:{locationId:LOCATION_ID,phone:'+15715550123'}}}),
    justcall:async(p,m='GET',b)=>{
      if(m==='PUT'){writes.push(p);briefs.set(p,b.custom_fields[0].value);return {ok:true};}
      if(briefs.has(p))return {ok:false,status:429};
      return {ok:true,data:{phone_number:'+15715550123',custom_fields:[{id:1252710,value:'Old'}]}};
    },
  };
  for(const id of [101,102])await createRefresher(deps).refresh({contactId:'same-source',salesDialerContactId:id,progressKey:'same-source:'+id,dryRun:false});
  assert.equal(states.get('same-source:101').phase,'VERIFY');
  assert.equal(states.get('same-source:102').phase,'VERIFY');
  assert.equal(states.size,2);
  const retry=await createRefresher({...deps,justcall:async p=>({ok:true,data:{phone_number:'+15715550123',custom_fields:[{id:1252710,value:briefs.get(p)}]}})}).refresh({contactId:'same-source',salesDialerContactId:101,progressKey:'same-source:101',dryRun:false});
  assert.equal(retry.verified,true);assert.equal(states.has('same-source:101'),false);
  assert.equal(states.get('same-source:102').phase,'VERIFY');assert.equal(writes.length,2);
});

test('service cannot mutate source notes or any destination except its brief', async () => {
  const service = createService({ db: { query() { throw Error('Unexpected DB access'); } } });
  await assert.rejects(service.request('ghl','/contacts/one/notes','POST',{}),/SOURCE_WRITE/);
  await assert.rejects(service.request('justcall','/sales_dialer/contacts/123','DELETE'),/DESTINATION_WRITE/);
  await assert.rejects(service.request('justcall','/sales_dialer/contacts/123','PUT',{custom_fields:[{id:1252711,value:'x'}]}),/DESTINATION_SCOPE/);
});
test('disabled service never accesses database or providers', async () => {
  const service=createService({env:{},db:{query(){throw Error('Unexpected DB access');}}});
  service.start(); await service.wake(); service.stop();
});
test('another instance cannot proceed while a lease is held', async () => {
  const service=createService({db:{query:async()=>[]},env:{PPC_NOTE_SERVICE_ENABLED:'true'}});
  await assert.rejects(service.step(),/LEASE_UNAVAILABLE/);
});
test('cloud progress is awaited and successful write resumes readback only after a restart', async () => {
  let state=null, brief='Previous brief', failReadback=true, writes=0;
  const source=[{id:'note',body:"Seller said do not call today; call Friday.",dateAdded:'2026-09-08',userName:'Kayla'}];
  const before=JSON.stringify(source);const requests=[];
  const dependencies={
    progress:{get:async()=>state,set:async(_,s)=>{await Promise.resolve();state=s;},clear:async()=>{state=null;},recordReplacement:async()=>{}},
    ghl:async(path)=>{requests.push(path);return {ok:true,data:path.endsWith('/notes')?{notes:source}:{contact:{locationId:LOCATION_ID,phone:'+15715550123'}}};},
    justcall:async(path,method='GET',body)=>{
      requests.push(method+' '+path);
      if(method==='PUT'){writes++;brief=body.custom_fields[0].value;return {ok:true};}
      if(writes && failReadback){failReadback=false;return {ok:false,status:429};}
      return {ok:true,data:{phone_number:'+15715550123',custom_fields:[{id:1252710,value:brief},{id:1252711,value:'STOP'}]}};
    },
  };
  const first=await createRefresher(dependencies).refresh({contactId:'one',salesDialerContactId:123,dryRun:false,eventId:'1'});
  assert.equal(first.status,'error');assert.equal(state.phase,'VERIFY');
  // An hourly provider cooldown must not discard proof of the successful PUT.
  state.at=Date.now()-2*60*60*1000;
  const count=requests.length;
  const second=await createRefresher(dependencies).refresh({contactId:'one',salesDialerContactId:123,dryRun:false,eventId:'2'});
  assert.equal(second.verified,true);assert.equal(second.processed_event_id,'1');assert.equal(writes,1);
  assert.deepEqual(requests.slice(count),['GET /sales_dialer/contacts/123']);assert.equal(JSON.stringify(source),before);
});
test('brief keeps corrected conversation and teammate attribution instead of receipt metadata',()=>{
  const notes=[
    {id:'receipt',body:'Call ID: 99\nCall Duration: 60\nRecording: https://example.com',dateAdded:'2026-09-09'},
    {id:'old',body:'[UNDERWRITING NOTE v2 call=88]\nWrong earlier extraction',dateAdded:'2026-09-08'},
    {id:'correct',body:'[UNDERWRITING NOTE v3 call=88]\nCaller: Kayla\n- Callback Request: Call Friday\nSeller needs roof work',dateAdded:'2026-09-08'},
  ];const original=JSON.stringify(notes),brief=briefFromNotes(notes,false);
  assert.match(brief,/Call with Kayla/);assert.match(brief,/Call Friday/);assert.doesNotMatch(brief,/Call ID|Recording|Wrong earlier/);
  assert.equal(JSON.stringify(notes),original);
  assert.equal(comparable("said 'I'm not selling'"),comparable('said ‘I‘m not selling'));
  assert.notEqual(comparable("I'm not selling"),comparable("I'm selling"));
});

test('persisted provider cooldown prevents network calls after restart',async()=>{
  let calls=0;
  const service=createService({now:()=>1000,env:{JUSTCALL_API_KEY:'fixture',JUSTCALL_API_SECRET:'fixture'},
    db:{query:async(q)=>{
      if(q.includes('UPDATE ppc_note_service_control'))return [{id:1}];
      if(q.includes('SELECT next_at'))return [{next_at:90000,blocked_until:120000}];
      return [];
    }},fetcher:async()=>{calls++;throw Error('must not send');}});
  const result=await service.request('justcall','/sales_dialer/contacts/123');
  assert.equal(result.status,429);assert.equal(result.retry_at,new Date(120000).toISOString());assert.equal(calls,0);
});
test('provider feedback is durably saved before returning a rate-limit response',async()=>{
  const updates=[];
  const service=createService({now:()=>1000,env:{JUSTCALL_API_KEY:'fixture',JUSTCALL_API_SECRET:'fixture'},
    db:{query:async(q,p)=>{if(q.includes('UPDATE ppc_note_service_control'))return [{id:1}];
      if(q.includes('RETURNING provider'))return [{provider:'justcall'}];
      if(q.includes('SET blocked_until'))updates.push(p);return [];}},
    fetcher:async()=>({ok:false,status:429,headers:new Map([['retry-after','120']]),json:async()=>({})})});
  const result=await service.request('justcall','/sales_dialer/contacts/123');
  assert.equal(updates.length,1);assert.ok(updates[0][1]>=121000);assert.equal(result.status,429);
});

test('generic fresh objective is corrected with readback; specific plans and stages stay intact', async()=>{
  for (const [objective,expected] of [['Fresh Lead — Call ASAP','Review team notes before calling'],['Call Friday at 2 pm','Call Friday at 2 pm']]) {
    let fields=[{id:1252710,value:'old brief'},{id:1252708,value:objective},{id:1252715,value:'New Lead / Call ASAP'}];
    const original=JSON.stringify(fields); let writes=0;
    const result=await createRefresher({
      ghl:async(path)=>({ok:true,data:path.endsWith('/notes')?{notes:[{id:'a',body:'Roof needs repairs',userName:'Kayla'}]}:{contact:{locationId:LOCATION_ID,phone:'5715550123'}}}),
      justcall:async(path,method='GET',body)=>{
        if(method==='PUT'){writes++;fields=fields.map(f=>body.custom_fields.find(u=>u.id===f.id)||f);return {ok:true};}
        return {ok:true,data:{phone_number:'15715550123',custom_fields:fields}};
      }
    }).refresh({contactId:'one',salesDialerContactId:123,dryRun:false});
    assert.equal(result.verified,true);assert.equal(writes,1);
    assert.equal(fields.find(f=>f.id===1252708).value,expected);
    assert.equal(fields.find(f=>f.id===1252715).value,JSON.parse(original).find(f=>f.id===1252715).value);
  }
});

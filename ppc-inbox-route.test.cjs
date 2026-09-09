const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inbox = require('./ppc-sales-dialer-webhook-inbox.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
const start = source.indexOf("app.post('/webhook/ghl', async");
const prefix = source.slice(start, source.indexOf('    switch (webhookType)', start));
function fixture(fail = false) {
  const events = [];
  let handler;
  vm.runInNewContext(prefix + '} catch(error) { throw error; }});', {
    app: { post: (_path, callback) => { handler = callback; } },
    normalizeWebhookPayload: (req) => req.body,
    extractTelegramOutreachMarkers: () => ({}),
    dialerInboxModule: inbox,
    getTeamNoteService: () => null,
    getDialerWebhookInbox: () => ({ enqueue: async () => { events.push('saved'); if(fail) throw new Error('storage unavailable'); } }),
    console: { error() {} },
  });
  const res = { status(code) { events.push(code); return this; }, json(body) { events.push(body); return this; } };
  return { handler, res, events };
}
test('note event is saved before acknowledgment and original note is unchanged', async () => {
  const f = fixture();
  const payload = { type:'NoteCreate', locationId:inbox.LOCATION_ID, contactId:'contact-1', body:'Original Kayla note' };
  const before = JSON.stringify(payload);
  await f.handler({body:payload},f.res);
  assert.deepEqual(f.events.slice(0,2),['saved',200]);
  assert.equal(JSON.stringify(payload),before);
});
test('storage failure returns 503 so the event can retry', async () => {
  const f = fixture(true);
  await f.handler({body:{type:'NoteCreate',locationId:inbox.LOCATION_ID,contactId:'contact-1'}},f.res);
  assert.deepEqual(f.events.slice(0,2),['saved',503]);
});
test('other locations do not enter the PPC event store', async () => {
  const f = fixture();
  await f.handler({body:{type:'NoteCreate',locationId:'other-location',contactId:'contact-1'}},f.res);
  assert.equal(f.events.includes('saved'),false);
  assert.equal(f.events[0],200);
});

test('contact tag protection changes and opportunity owner changes enter the durable inbox',async()=>{
  for(const payload of [
    {type:'ContactTagUpdate',locationId:inbox.LOCATION_ID,id:'contact-1',tags:['do-not-call']},
    {type:'OpportunityAssignedToUpdate',locationId:inbox.LOCATION_ID,id:'opportunity-1',contactId:'contact-1',assignedTo:'team-member'},
  ]){
    assert.equal(inbox.normalizeEvent(payload).contact_id,'contact-1');
    const f=fixture();await f.handler({body:payload},f.res);
    assert.deepEqual(f.events.slice(0,2),['saved',200]);
  }
});

test('approved note workflow is durable and repeated identical deliveries are not lost', async () => {
  const payload = { location:{id:inbox.LOCATION_ID}, contact_id:'contact-1',
    workflow:{id:inbox.NOTE_WORKFLOW_ID}, customData:{ppc_event:'team_note_changed'},
    note:{body:'Original team note'} };
  const before = JSON.stringify(payload);
  const first = inbox.normalizeEvent(payload);
  const second = inbox.normalizeEvent(payload);
  assert.equal(first.event_type,'ContactContextChanged');
  assert.equal(first.contact_id,'contact-1');
  assert.notEqual(first.payload_hash,second.payload_hash);
  assert.equal(JSON.stringify(first).includes('Original team note'),false);
  const f = fixture();
  await f.handler({body:payload},f.res);
  assert.deepEqual(f.events.slice(0,2),['saved',200]);
  assert.equal(JSON.stringify(payload),before);
  const failed = fixture(true);
  await failed.handler({body:payload},failed.res);
  assert.deepEqual(failed.events.slice(0,2),['saved',503]);
  for (const invalid of [
    {...payload,workflow:{id:'unrelated'}},
    {...payload,location:{id:'other-location'}},
    {...payload,customData:{}},
    {...payload,contact_id:null,id:'opportunity-only'},
  ]) assert.equal(inbox.normalizeEvent(invalid),null);
});

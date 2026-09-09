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

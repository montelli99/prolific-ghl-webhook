const test=require('node:test'),assert=require('node:assert/strict');
const {createCampaignGuard,notesFingerprint}=require('./ppc-campaign-guard.cjs');
const {LOCATION,PIPELINE}=require('./ppc-campaign-membership-policy.cjs');
function fixture(){const truth={contact:{id:'c',locationId:LOCATION,phone:'+15715550123'},opportunities:[{pipelineId:PIPELINE,status:'open'}],notes:[],stageName:'New Lead / Call ASAP'};return {truth,row:{state:'ACTIVE',contact_id:'c',campaign_id:3379399,dialer_contact_id:123,phone:'5715550123',reviewed_notes_hash:notesFingerprint([])}};}
test('ambiguous removal resumes with verification, never a blind repeat',async()=>{const {truth,row}=fixture();truth.contact.assignedTo='teammate';let calls=0;const events=[];const guard=createCampaignGuard({store:{checked:async()=>{},transition:async(_,state)=>{row.state=state;events.push(state);},removalResponse:async()=>{}},dialer:{remove:async()=>{calls++;assert.equal(row.state,'VERIFY_REQUIRED');throw Error('lost response');}}});
assert.equal((await guard.evaluate(row,truth)).status,'verification_required');await guard.evaluate(row,truth);assert.equal(calls,1);
await assert.rejects(guard.verify(row,{complete:false,campaignId:row.campaign_id,presentIds:new Set()}),/COMPLETE_MEMBERSHIP/);
await assert.rejects(guard.verify(row,{complete:true,campaignId:999,presentIds:new Set()}),/COMPLETE_MEMBERSHIP/);
row.updated_at='2026-09-09T20:00:00Z'; await assert.rejects(guard.verify(row,{complete:true,campaignId:row.campaign_id,presentIds:new Set(),startedAt:'2026-09-09T19:59:00Z'}),/POST_MUTATION/); await guard.verify(row,{complete:true,campaignId:row.campaign_id,presentIds:new Set(),startedAt:'2026-09-09T20:01:00Z'});assert.equal(row.state,'HELD');assert.deepEqual(events,['VERIFY_REQUIRED','HELD']);});
test('changed notes require review while unchanged approved notes stay',async()=>{const {truth,row}=fixture();let removed=0;const guard=createCampaignGuard({store:{checked:async()=>{},transition:async(_,s)=>{row.state=s;},removalResponse:async()=>{}},dialer:{remove:async()=>{removed++;return {ok:true};}}});assert.equal((await guard.evaluate(row,truth)).status,'kept');truth.notes=[{id:'new',body:'Spoke to seller, preparing offer.'}];await guard.evaluate(row,truth);assert.equal(removed,1);});
test('identity mismatch never removes membership',async()=>{const {truth,row}=fixture();truth.contact.phone='+15715559999';const guard=createCampaignGuard({store:{},dialer:{remove:async()=>{throw Error('must not call');}}});assert.equal((await guard.evaluate(row,truth)).error,'MEMBERSHIP_IDENTITY_UNVERIFIED');});
test('note order does not invalidate review, edited content does',()=>{const a={id:'a',body:'No answer'},b={id:'b',body:'No answer again'};assert.equal(notesFingerprint([a,b]),notesFingerprint([b,a]));assert.notEqual(notesFingerprint([a]),notesFingerprint([{...a,body:'Spoke with seller'}]));});

test('authorization and invalid removal responses surface an error while preserving verification checkpoint',async()=>{
  for(const status of [400,401,403]){
    const {truth,row}=fixture();truth.contact.assignedTo='teammate';let audited=false;
    const guard=createCampaignGuard({store:{transition:async(_,s)=>{row.state=s;},removalResponse:async()=>{audited=true;}},dialer:{remove:async()=>({ok:false,status})}});
    const result=await guard.evaluate(row,truth);
    assert.equal(result.status,'error');assert.match(result.error,new RegExp(String(status)));
    assert.equal(row.state,'VERIFY_REQUIRED');assert.equal(audited,true);
  }
});


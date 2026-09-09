const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateMembership:check,CAMPAIGNS,LOCATION,PIPELINE}=require('./ppc-campaign-membership-policy.cjs');
const fixture=()=>({campaignId:CAMPAIGNS.NOA2,contact:{locationId:LOCATION},opportunities:[{pipelineId:PIPELINE,status:'open'}],stageName:'Called Another Day in PM, No Answer',notes:[],historyReviewed:true,photoFollowupVerified:true});
test('Awaiting Photos requires a real pending photo request and excludes received photos',()=>{
 const x={...fixture(),campaignId:CAMPAIGNS.AWAITING};
 assert.ok(check({...x,photoFollowupVerified:false}).reasons.includes('PHOTO_FOLLOWUP_UNVERIFIED'));
 assert.ok(check({...x,photosReceived:true}).reasons.includes('PHOTOS_ALREADY_RECEIVED'));
});
test('Fresh excludes recorded outreach even when stage and reviewed history look clear',()=>{
 const fresh={...fixture(),campaignId:CAMPAIGNS.FRESH,stageName:'New Lead / Call ASAP'};
 for(const body of ['<p>noa 8/10</p>','left vm requesting pics','Incoming SMS\nMessage: Yes','Call ID: 123','Spoke with seller','contacted September 9; answered and hung up',"can't get past google screening",'call her back in 1 hr.'])assert.ok(check({...fresh,notes:[{body}]}).reasons.includes('PRIOR_OUTREACH'));
 assert.equal(check({...fresh,notes:[{body:'Property has 3 bedrooms and 2 bathrooms'}]}).keep,true);
 assert.equal(check({...fixture(),notes:[{body:'noa 8/10'}]}).reasons.includes('PRIOR_OUTREACH'),false);
});
test('NOA2 accepts the actual in-PM stage while rejecting fresh stage',()=>{const x=fixture();assert.equal(check(x).keep,true);assert.ok(check({...x,stageName:'New Lead / Call ASAP'}).reasons.includes('STAGE_MISMATCH'));});

test('seller STOP with punctuation or emoji remains a stop request',()=>{
  for(const body of ['Incoming SMS\nMessage: Stop 🛑','Incoming SMS\nMessage: STOP!!!'])assert.ok(check({...fixture(),notes:[{body}]}).reasons.includes('EXPLICIT_STOP'));
  assert.equal(check({...fixture(),notes:[{body:'Incoming SMS\nMessage: Stop by tomorrow'}]}).reasons.includes('EXPLICIT_STOP'),false);
});
test('either assignment surface excludes generic lists, including Montelli ownership',()=>{for(const owner of ['teammate','PGfXxlXCRXs3hXN3Gq7R']){const x=fixture();x.contact.assignedTo=owner;assert.equal(check(x).keep,false);delete x.contact.assignedTo;x.opportunities[0].assignedTo=owner;assert.equal(check(x).keep,false);}});
test('Awaiting Photos exception never bypasses stop, DND, or callback protection',()=>{const x=fixture();x.campaignId=CAMPAIGNS.AWAITING;x.opportunities[0].assignedTo='teammate';assert.equal(check(x).keep,true);assert.equal(check({...x,openCallback:true}).keep,false);x.notes=[{body:'Incoming SMS\nMessage: STOP'}];assert.ok(check(x).reasons.includes('EXPLICIT_STOP'));x.notes=[];x.contact.dnd=true;assert.equal(check(x).keep,false);});
test('assignment exception is exclusive to Awaiting Photos',()=>{const x=fixture();x.campaignId=3379643;x.opportunities[0].assignedTo='teammate';assert.ok(check(x).reasons.includes('TEAM_ASSIGNED'));});
test('Montelli ownership also excludes non-photo follow-up lists',()=>{for(const campaignId of [3379643,3379660]){const x=fixture();x.campaignId=campaignId;x.opportunities[0].assignedTo='PGfXxlXCRXs3hXN3Gq7R';assert.ok(check(x).reasons.includes('TEAM_ASSIGNED'));}});
test('missing history, wrong location and ambiguous opportunities fail closed',()=>{const x=fixture();assert.equal(check({...x,historyReviewed:false}).keep,false);assert.equal(check({...x,contact:{locationId:'other'}}).keep,false);assert.equal(check({...x,opportunities:[...x.opportunities,...x.opportunities]}).keep,false);});
test('open opportunity in sold stage cannot use the Awaiting Photos exception',()=>{const x=fixture();assert.equal(check({...x,campaignId:CAMPAIGNS.AWAITING,stageName:'Property Sold'}).keep,false);assert.equal(check({...x,campaignId:123}).keep,false);});

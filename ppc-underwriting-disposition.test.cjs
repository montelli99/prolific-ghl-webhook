'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createUnderwritingDisposition,OWNER,STAGE}=require('./ppc-underwriting-disposition.cjs');
function fixture({otherAgent=false,otherOwner=false,failWrite=false,savedState}={}){
 const label='MOVE TO READY TO UNDERWRITE — Qualified + Photos Confirmed';
 const c={id:'contact1',locationId:'GDq92uruRngbi9mLGGrV',phone:'+13012689155',tags:[label]};
 const o={id:'opp1',contactId:c.id,pipelineId:'ril84XHGQleRgE0W0FKU',pipelineStageId:'1a0d789b-c11d-47a2-9152-6a7ce07dc833',status:'open',assignedTo:otherOwner?'teammate':null};
 const call={call_id:123,agent_id:otherAgent?77:508588,agent_email:'montelliscottrei@gmail.com',contact_number:'13012689155',call_date:'2026-09-09',call_time:'22:00:00',call_info:{type:'Connected',disposition:label,duration:100}};
 let receipt=savedState?{state:savedState,contact_id:c.id,opportunity_id:o.id}:null;const writes=[];
 const db={query:async(q,p)=>{if(q.startsWith('SELECT'))return receipt?[receipt]:[];if(q.startsWith('INSERT'))receipt={state:'PREPARED',contact_id:c.id,opportunity_id:o.id};if(q.startsWith('UPDATE'))receipt.state=p[1];return [];}};
 const runner=createUnderwritingDisposition({db,lease:async()=>{},now:()=>Date.parse('2026-09-09T23:00:00Z'),request:async(provider,path,method,body)=>{
  if(method==='PUT'){writes.push({path,body});if(failWrite)throw Error('lost response');Object.assign(path.includes('opportunities')?o:c,body);return {ok:true,status:200};}
  return {ok:true,status:200,data:path.includes('/sales_dialer/')?{data:call}:path.includes('/search?')?{opportunities:[o]}:path.includes('/opportunities/')?{opportunity:{...o}}:{contact:{...c}}};
 }});
 return {runner,c,o,call,writes,notes:[{body:'Outgoing Call (Answered)\nCall ID: 123'}],receipt:()=>receipt};
}
test('verified Montelli underwriting disposition moves and assigns both records once',async()=>{const f=fixture();assert.equal((await f.runner.process(f.c,f.notes)).status,'assigned_and_moved');assert.equal(f.o.pipelineStageId,STAGE);assert.equal(f.o.assignedTo,OWNER);assert.equal(f.c.assignedTo,OWNER);assert.equal(f.writes.length,2);await f.runner.process(f.c,f.notes);assert.equal(f.writes.length,2);});
test('another agent or teammate ownership never transfers the lead',async()=>{for(const options of [{otherAgent:true},{otherOwner:true}]){const f=fixture(options);await f.runner.process(f.c,f.notes);assert.equal(f.writes.length,0);}});
test('a lost write response stays verification-only on restart',async()=>{const f=fixture({failWrite:true});await assert.rejects(f.runner.process(f.c,f.notes));assert.equal(f.receipt().state,'VERIFY_OPPORTUNITY');await f.runner.process(f.c,f.notes);assert.equal(f.writes.length,1);assert.equal(f.receipt().state,'REVIEW');});
test('a newer human stage change is preserved',async()=>{const f=fixture();f.o.lastStageChangeAt='2026-09-09T22:30:00Z';assert.equal((await f.runner.process(f.c,f.notes)).status,'newer_stage_change');assert.equal(f.writes.length,0);});
test('tag alone and old or mismatched call evidence cannot claim a lead',async()=>{for(const change of [f=>f.call.contact_number='19999999999',f=>f.call.call_date='2026-09-01',f=>f.call.call_info.disposition='No Answer',f=>f.notes=[]]){const f=fixture();change(f);await f.runner.process(f.c,f.notes);assert.equal(f.writes.length,0);}});

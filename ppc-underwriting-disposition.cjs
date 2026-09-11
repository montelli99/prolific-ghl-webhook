'use strict';
const LOCATION='GDq92uruRngbi9mLGGrV',PIPELINE='ril84XHGQleRgE0W0FKU';
const OWNER='PGfXxlXCRXs3hXN3Gq7R',STAGE='5147c1cf-0a9f-450a-86d8-02e9c75db4e5';
const LABEL='move to ready to underwrite — qualified + photos confirmed';
const PHOTO_STAGE='0bac4afa-7cd0-4019-84ad-6f2a2dc33422';
const PHOTO_LABEL='move to awaiting photos - property details confirmed';
const TARGETS=new Map([[LABEL,STAGE],[PHOTO_LABEL,PHOTO_STAGE]]);
const PHOTO_EARLY=new Set(['987659e7-1561-4b65-9e1d-ba975b7fa392','d31c50be-0148-4769-b3bd-cf32c2a16bff','1a0d789b-c11d-47a2-9152-6a7ce07dc833','f03f27b9-f3c1-4534-b07e-8cc3c9186f7a',PHOTO_STAGE]);
const EARLY=new Set(['d31c50be-0148-4769-b3bd-cf32c2a16bff','1a0d789b-c11d-47a2-9152-6a7ce07dc833','f03f27b9-f3c1-4534-b07e-8cc3c9186f7a','0bac4afa-7cd0-4019-84ad-6f2a2dc33422','3992a1ff-44eb-49da-ad32-c25ad33403e7',STAGE]);
const norm=x=>String(x||'').trim().toLowerCase();
const phone=x=>String(x||'').replace(/\D/g,'').replace(/^(\d{10})$/,'1$1');
function verifyCall(call,contact,now){
 const at=Date.parse(`${call.call_date}T${call.call_time}Z`);
 return call.agent_id===508588&&norm(call.agent_email)==='montelliscottrei@gmail.com'&&
 phone(call.contact_number)===phone(contact.phone)&&phone(contact.phone).length===11&&
 TARGETS.has(norm(call.call_info?.disposition))&&call.call_info?.type==='Connected'&&
 Number.isFinite(at)&&at<=now&&now-at<86400000;
}
function createUnderwritingDisposition({db,request,lease,now=Date.now}){
 let ready;
 async function ensure(){if(!ready)ready=db.query(`CREATE TABLE IF NOT EXISTS ppc_underwriting_dispositions(
 call_id TEXT PRIMARY KEY,contact_id TEXT NOT NULL,opportunity_id TEXT,state TEXT NOT NULL,
 evidence JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).catch(e=>{ready=null;throw e});await ready;}
 async function read(path,provider='ghl'){const r=await request(provider,path,'GET');if(!r.ok)throw Error('UNDERWRITING_READ_'+r.status);return r.data;}
 async function process(contact,notes){
  if(contact?.locationId!==LOCATION||!contact.tags?.some(t=>TARGETS.has(norm(t))))return {status:'not_applicable'};
  const ids=notes.flatMap(n=>{const b=n.bodyText||n.body||'';return /^Outgoing Call \(Answered\)/.test(b)?[...b.matchAll(/^Call ID: (\d+)$/gm)].map(m=>m[1]):[];}).sort((a,b)=>Number(b)-Number(a));
  if(!ids.length)return {status:'awaiting_call_note'};
  const callId=ids[0];await ensure();
  const [saved]=await db.query('SELECT * FROM ppc_underwriting_dispositions WHERE call_id=$1',[callId]);
  if(saved?.state==='DONE'||saved?.state==='REVIEW')return {status:saved.state};
  const call=(await read('/sales_dialer/calls/'+callId,'justcall')).data;
  if(!call||String(call.call_id)!==callId||!verifyCall(call,contact,now()))return {status:'call_not_eligible'};
  const label=norm(call.call_info.disposition),target=TARGETS.get(label);
  const allowed=target===PHOTO_STAGE?PHOTO_EARLY:EARLY;
  const found=await read(`/opportunities/search?location_id=${LOCATION}&contact_id=${encodeURIComponent(contact.id)}`);
  const matches=(found.opportunities||[]).filter(o=>o.pipelineId===PIPELINE&&o.status==='open');
  if(matches.length!==1)return {status:'opportunity_ambiguous'};
  const oid=matches[0].id;
  const current=(await read('/contacts/'+contact.id)).contact;
  const opp=(await read('/opportunities/'+oid)).opportunity;
  const [protection]=await db.query(`SELECT
    EXISTS(SELECT 1 FROM ppc_callback_commitments WHERE contact_id=$1 AND commitment_status='OPEN') AS open_callback,
    EXISTS(SELECT 1 FROM ppc_photo_automation_state WHERE contact_id=$1 AND photos_received=TRUE) AS photos_received`,[contact.id]);
  if(current?.dnd||current?.tags?.some(t=>/^(stop|dnc|do not call|opt.out)$/i.test(norm(t)))||
    Object.values(current?.dndSettings||{}).some(v=>v?.status==='active')||protection?.open_callback||
    (target===PHOTO_STAGE&&protection?.photos_received))return {status:'protected_contact_or_callback'};
  if(current?.id!==contact.id||current.locationId!==LOCATION||phone(current.phone)!==phone(call.contact_number)||
    !current.tags?.some(t=>norm(t)===label)||opp?.contactId!==contact.id||opp.pipelineId!==PIPELINE||opp.status!=='open'||!allowed.has(opp.pipelineStageId)||
    [current.assignedTo,opp.assignedTo].some(x=>x&&x!==OWNER))return {status:'protected_owner_or_stage'};
  const callEnd=Date.parse(`${call.call_date}T${call.call_time}Z`)+Number(call.call_info.duration)*1000;
  if(!Number.isFinite(callEnd))return {status:'call_time_unverified'};
  if(opp.pipelineStageId!==target&&Date.parse(opp.lastStageChangeAt)>callEnd)return {status:'newer_stage_change'};
  if(saved&&(saved.contact_id!==contact.id||saved.opportunity_id!==oid))throw Error('UNDERWRITING_RECEIPT_IDENTITY');
  if(saved?.evidence?.targetStage&&saved.evidence.targetStage!==target)return review(callId);
  if(!saved){await lease();await db.query(`INSERT INTO ppc_underwriting_dispositions(call_id,contact_id,opportunity_id,state,evidence)
    VALUES($1,$2,$3,'PREPARED',$4::jsonb) ON CONFLICT DO NOTHING`,[callId,contact.id,oid,JSON.stringify({call,targetStage:target,beforeContact:current,beforeOpportunity:opp})]);}
  // A lost response is read back, never blindly repeated after a restart.
  if(saved?.state==='VERIFY_OPPORTUNITY'&&(opp.pipelineStageId!==target||opp.assignedTo!==OWNER))return review(callId);
  if(saved?.state==='VERIFY_CONTACT'&&current.assignedTo!==OWNER)return review(callId);
  if(opp.pipelineStageId!==target||opp.assignedTo!==OWNER){
   await state(callId,'VERIFY_OPPORTUNITY');
   const r=await request('ghl','/opportunities/'+oid,'PUT',{pipelineStageId:target,assignedTo:OWNER});
   const verified=(await read('/opportunities/'+oid)).opportunity;
   if(verified?.pipelineStageId!==target||verified?.assignedTo!==OWNER||verified?.contactId!==contact.id){await review(callId);throw Error('UNDERWRITING_OPPORTUNITY_VERIFY_'+r.status);}
  }
  const latest=(await read('/contacts/'+contact.id)).contact;
  if(latest?.assignedTo&&latest.assignedTo!==OWNER)return review(callId);
  if(latest?.assignedTo!==OWNER){
   await state(callId,'VERIFY_CONTACT');
   const r=await request('ghl','/contacts/'+contact.id,'PUT',{assignedTo:OWNER});
   const verified=(await read('/contacts/'+contact.id)).contact;
   if(verified?.assignedTo!==OWNER){await review(callId);throw Error('UNDERWRITING_CONTACT_VERIFY_'+r.status);}
  }
  await state(callId,'DONE');contact.assignedTo=OWNER;return {status:'assigned_and_moved',callId,opportunityId:oid,targetStage:target};
 }
 async function state(id,s){await lease();await db.query('UPDATE ppc_underwriting_dispositions SET state=$2,updated_at=NOW() WHERE call_id=$1',[id,s]);}
 async function review(id){await state(id,'REVIEW');return {status:'review_required'};}
 return {process,ensure};
}
module.exports={createUnderwritingDisposition,verifyCall,OWNER,STAGE,PHOTO_STAGE};

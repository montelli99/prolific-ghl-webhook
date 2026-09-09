'use strict';
const crypto=require('node:crypto');
const {evaluateMembership}=require('./ppc-campaign-membership-policy.cjs');
function notesFingerprint(notes){
  if(!Array.isArray(notes))throw Error('NOTES_UNVERIFIED');
  const values=notes.map(n=>[String(n.id||''),String(n.bodyText||n.body||''),String(n.dateUpdated||n.dateAdded||'')]);
  values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
const phone=p=>{const s=String(p||'').replace(/\D/g,'');return s.length===10?'1'+s:s.length===11&&s.startsWith('1')?s:null;};
// Dependencies must enforce the shared provider budget and worker lease.
// Store changes are durable before a removal; ambiguous outcomes are verified
// before another removal attempt. This component cannot add contacts or notes.
function createCampaignGuard({store,dialer,auditOnly=false}){
  async function evaluate(row,truth){
    if(row.state!=='ACTIVE'&&row.state!=='RECHECK_REQUIRED')return {status:'deferred',state:row.state};
    if(truth.contact?.id!==row.contact_id||!phone(row.phone)||phone(truth.contact.phone)!==phone(row.phone))return {status:'error',error:'MEMBERSHIP_IDENTITY_UNVERIFIED'};
    const decision=evaluateMembership({...truth,campaignId:Number(row.campaign_id),historyReviewed:notesFingerprint(truth.notes)===row.reviewed_notes_hash});
    if(auditOnly){await store.observe(row,{...decision,source:truth});return {status:decision.keep?'audit_kept':'audit_review_required'};}
    if(decision.keep){await store.checked(row);return {status:'kept'};}
    await store.transition(row,'VERIFY_REQUIRED',{reasons:decision.reasons,source:truth});
    // VERIFY_REQUIRED deliberately precedes the request: a crash or lost
    // response must never cause an unverified repeat of the mutation.
    let response;try{response=await dialer.remove(Number(row.campaign_id),Number(row.dialer_contact_id));}
    catch{return {status:'verification_required',reasons:decision.reasons};}
    await store.removalResponse(row,response);
    if(response?.status===401||response?.status===403)
      return {status:'error',error:'GUARD_REMOVAL_HTTP_'+response.status};
    if(response?.status===400)
      return {status:'error',error:'GUARD_REMOVAL_UNVERIFIED_HTTP_400'};
    return {status:'verification_required',reasons:decision.reasons};
  }
  async function verify(row,scan){
    if(row.state!=='VERIFY_REQUIRED')return {status:'deferred'};
    if(scan?.complete!==true||Number(scan.campaignId)!==Number(row.campaign_id)||
      !(scan.presentIds instanceof Set))throw Error('COMPLETE_MEMBERSHIP_SCAN_REQUIRED');
    const started=Date.parse(scan.startedAt),changed=Date.parse(row.updated_at);
    if(!Number.isFinite(started)||!Number.isFinite(changed)||started<changed)
      throw Error('POST_MUTATION_SCAN_REQUIRED');
    const present=scan.presentIds.has(String(row.dialer_contact_id));
    await store.transition(row,present?'RECHECK_REQUIRED':'HELD',{verifiedAt:new Date().toISOString()});
    return {status:present?'recheck_required':'held'};
  }
  return {evaluate,verify};
}
module.exports={notesFingerprint,createCampaignGuard};

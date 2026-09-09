'use strict';
const LOCATION='GDq92uruRngbi9mLGGrV', PIPELINE='ril84XHGQleRgE0W0FKU';
const MONTELLI='PGfXxlXCRXs3hXN3Gq7R';
const CAMPAIGNS={FRESH:3379399,NOA1:3379400,NOA2:3379401,AWAITING:3379538};
const supported=new Set([...Object.values(CAMPAIGNS),3379643,3379537,3379660]);
const terminal=/no comps|changed number|under contract with another|decided to list|overpriced|changed mind|seller declined|property sold|under contract with us|offer made|repitch|sent apt times|no answer after gc|awaiting seller info|contract drafted|sent psa|buyers|earnest|title|closing/i;
const stages={
  [CAMPAIGNS.FRESH]:/^(?:New Lead\s*\/\s*Call ASAP|New Lead|Call ASAP)$/i,
  [CAMPAIGNS.NOA1]:/^Called (?:in PM|once),? No Answer$/i,
  [CAMPAIGNS.NOA2]:/^Called Another Day(?: in PM)?,? No Answer$/i,
};
// This decides whether an EXISTING membership is protected or needs review.
// It never grants ownership, adds a contact, or infers consent from an empty note.
function evaluateMembership({campaignId,contact,opportunities,stageName,notes,activeClaim=false,openCallback=false,historyReviewed=false}={}){
  const reasons=[];const generic=Object.hasOwn(stages,campaignId);
  if(!supported.has(campaignId))return {keep:false,reasons:['CAMPAIGN_UNVERIFIED']};
  if(!contact||contact.locationId!==LOCATION||!Array.isArray(opportunities)||!Array.isArray(notes))return {keep:false,reasons:['SOURCE_UNVERIFIED']};
  const os=opportunities.filter(o=>o.pipelineId===PIPELINE);
  if(os.length!==1)return {keep:false,reasons:['OPPORTUNITY_UNVERIFIED']};
  const o=os[0];
  if(o.status!=='open')reasons.push('NOT_OPEN');
  if(!stageName||terminal.test(stageName))reasons.push('NON_CALL_STAGE');
  if(contact.dnd||Object.entries(contact.dndSettings||{}).some(([k,v])=>/call/i.test(k)&&v?.status==='active')||contact.tags?.some(t=>/^(stop|dnc|do not call|opt.out)$/i.test(t)))reasons.push('DND');
  const owners=[contact.assignedTo,o.assignedTo].filter(Boolean);
  if(generic&&owners.length)reasons.push('ASSIGNED');
  else if(campaignId!==CAMPAIGNS.AWAITING&&owners.some(x=>x!==MONTELLI))reasons.push('TEAM_ASSIGNED');
  if(notes.some(n=>{
    const body=String(n.bodyText||n.body||'').replace(/<[^>]+>/g,' ');
    const message=/^Incoming SMS[\s\S]*Message:\s*([\s\S]*)$/i.exec(body)?.[1];
    return message!==undefined&&/^(stop|unsubscribe|do not call)$/i.test(message.replace(/[^\p{L}\p{N}\s]/gu,'').trim());
  }))reasons.push('EXPLICIT_STOP');
  if(activeClaim)reasons.push('ACTIVE_CLAIM');
  if(openCallback)reasons.push('CALLBACK_REVIEW');
  if(generic&&!stages[campaignId].test(stageName||''))reasons.push('STAGE_MISMATCH');
  if(!historyReviewed)reasons.push('HISTORY_REVIEW_REQUIRED');
  return {keep:reasons.length===0,reasons};
}
module.exports={evaluateMembership,CAMPAIGNS,LOCATION,PIPELINE};

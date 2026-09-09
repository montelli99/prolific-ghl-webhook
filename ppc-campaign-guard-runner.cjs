'use strict';
const {createGuardStore}=require('./ppc-campaign-guard-store.cjs');
const {createCampaignGuard}=require('./ppc-campaign-guard.cjs');
const {createCampaignScanner}=require('./ppc-campaign-scanner.cjs');
const {LOCATION,PIPELINE}=require('./ppc-campaign-membership-policy.cjs');
function createGuardRunner({db,lease,sourceRequest,campaignRequest,now=Date.now}){
  const store=createGuardStore({db,lease});
  const guard=createCampaignGuard({store,dialer:{remove:(campaign,id)=>campaignRequest('DELETE',campaign,id)}});
  const scanner=createCampaignScanner({store:store.scans,request:campaignRequest});
  let stageMap=null,stagesAt=0;
  async function inspect(contactId,contact,notes){
    const rows=await db.query("SELECT * FROM ppc_campaign_guard_memberships WHERE contact_id=$1 AND state IN ('ACTIVE','RECHECK_REQUIRED')",[contactId]);
    if(!rows.length)return;
    const response=await sourceRequest('ghl',`/opportunities/search?location_id=${LOCATION}&contact_id=${encodeURIComponent(contactId)}`);
    if(!response.ok)throw Error('GUARD_SOURCE_HTTP_'+response.status);
    if(!stageMap||now()-stagesAt>3600000){const p=await sourceRequest('ghl',`/opportunities/pipelines?locationId=${LOCATION}`);if(!p.ok||!Array.isArray(p.data?.pipelines))throw Error('GUARD_STAGES_UNVERIFIED');stageMap=new Map(p.data.pipelines.flatMap(p=>(p.stages||[]).map(s=>[s.id,s.name])));stagesAt=now();}
    const opportunities=response.data?.opportunities;
    if(!Array.isArray(opportunities))throw Error('GUARD_OPPORTUNITIES_UNVERIFIED');
    const os=opportunities.filter(o=>o.pipelineId===PIPELINE);
    const [protection]=await db.query(`SELECT
      EXISTS(SELECT 1 FROM ppc_lead_claims WHERE contact_id=$1 AND claim_status='ACTIVE') AS active_claim,
      EXISTS(SELECT 1 FROM ppc_callback_commitments WHERE contact_id=$1 AND commitment_status='OPEN') AS open_callback`,[contactId]);
    for(const row of rows){const result=await guard.evaluate(row,{contact,notes,opportunities,stageName:os.length===1?stageMap.get(os[0].pipelineStageId):null,activeClaim:protection.active_claim,openCallback:protection.open_callback});if(result.status==='error')throw Error(result.error);}
  }
  async function verifyStep(){
    const [pending]=await db.query("SELECT campaign_id,MIN(updated_at) AS oldest FROM ppc_campaign_guard_memberships WHERE state='VERIFY_REQUIRED' GROUP BY campaign_id ORDER BY MIN(updated_at) LIMIT 1");
    if(!pending)return false;
    const scan=await scanner.advance(Number(pending.campaign_id),pending.oldest);
    if(scan.error)throw Error(scan.error);
    if(scan.complete){const rows=await db.query("SELECT * FROM ppc_campaign_guard_memberships WHERE campaign_id=$1 AND state='VERIFY_REQUIRED' AND updated_at<=$2",[pending.campaign_id,scan.startedAt]);for(const row of rows)await guard.verify(row,scan);}
    return true;
  }
  async function enqueue(contactId,contact,notes){
    await lease();
    await db.query(`INSERT INTO ppc_campaign_guard_jobs(contact_id,source)
      SELECT $1,$2::jsonb WHERE EXISTS(SELECT 1 FROM ppc_campaign_guard_memberships WHERE contact_id=$1 AND state IN ('ACTIVE','RECHECK_REQUIRED'))
      ON CONFLICT(contact_id) DO UPDATE SET source=EXCLUDED.source,revision=ppc_campaign_guard_jobs.revision+1,retry_at=NULL,updated_at=NOW()`,
      [contactId,JSON.stringify({contact,notes,at:now()})]);
  }
  async function step(){
    const [control]=await db.query('SELECT halted FROM ppc_campaign_guard_control WHERE id=1');
    if(control?.halted)return false;
    async function failure(error){
      const message=error.message||'GUARD_FAILED';
      const halt=/401|403|IDENTITY|SHAPE|UNVERIFIED|REVISION/.test(message);
      await lease();await db.query('UPDATE ppc_campaign_guard_control SET halted=$1,last_error=$2,updated_at=NOW() WHERE id=1',[halt,message]);
      return {error:message};
    }
    try{if(await verifyStep())return true;}catch(e){return failure(e);}
    // A verified failed removal remains eligible for a fresh source check even
    // when the original note job was already acknowledged before the scan.
    await lease();
    await db.query(`INSERT INTO ppc_campaign_guard_jobs(contact_id,source)
      SELECT DISTINCT m.contact_id,'{}'::jsonb FROM ppc_campaign_guard_memberships m
      LEFT JOIN ppc_campaign_guard_jobs j ON j.contact_id=m.contact_id
      WHERE m.state='RECHECK_REQUIRED' AND (j.contact_id IS NULL OR j.processed_revision=j.revision)
      ON CONFLICT(contact_id) DO UPDATE SET source=EXCLUDED.source,revision=ppc_campaign_guard_jobs.revision+1,retry_at=NULL,updated_at=NOW()`);
    const [job]=await db.query('SELECT * FROM ppc_campaign_guard_jobs WHERE processed_revision<revision AND (retry_at IS NULL OR retry_at<=NOW()) ORDER BY updated_at LIMIT 1');
    if(!job)return false;
    try{
      let {contact,notes,at}=job.source||{};
      if(!Number.isFinite(at)||now()-at>300000){
        const c=await sourceRequest('ghl',`/contacts/${encodeURIComponent(job.contact_id)}`);
        if(!c.ok)throw Error('GUARD_SOURCE_HTTP_'+c.status);
        const n=await sourceRequest('ghl',`/contacts/${encodeURIComponent(job.contact_id)}/notes`);
        if(!n.ok)throw Error('GUARD_SOURCE_HTTP_'+n.status);
        contact=c.data?.contact;notes=n.data?.notes;
      }
      if(!contact||contact.id!==job.contact_id||!Array.isArray(notes))throw Error('GUARD_SOURCE_SHAPE_UNVERIFIED');
      await inspect(job.contact_id,contact,notes);await lease();
      await db.query('UPDATE ppc_campaign_guard_jobs SET processed_revision=$2,last_error=NULL,retry_at=NULL WHERE contact_id=$1',[job.contact_id,job.revision]);return true;
    }catch(e){await lease();await db.query("UPDATE ppc_campaign_guard_jobs SET last_error=$2,retry_at=NOW()+INTERVAL '60 seconds' WHERE contact_id=$1",[job.contact_id,e.message]);return failure(e);}
  }
  return {ensure:store.ensure,inspect,verifyStep,enqueue,step};
}
module.exports={createGuardRunner};

'use strict';
function createGuardStore({db,lease}){
  async function ensure(){
    await db.query(`CREATE TABLE IF NOT EXISTS ppc_campaign_guard_control (
      id INTEGER PRIMARY KEY CHECK(id=1),halted BOOLEAN NOT NULL DEFAULT FALSE,last_error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query('INSERT INTO ppc_campaign_guard_control(id) VALUES(1) ON CONFLICT DO NOTHING');
    await db.query(`CREATE TABLE IF NOT EXISTS ppc_campaign_guard_memberships (
      campaign_id BIGINT NOT NULL,dialer_contact_id TEXT NOT NULL,contact_id TEXT NOT NULL,
      phone TEXT NOT NULL,reviewed_notes_hash TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'ACTIVE',revision BIGINT NOT NULL DEFAULT 0,
      last_checked_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(campaign_id,dialer_contact_id))`);
    await db.query(`CREATE TABLE IF NOT EXISTS ppc_campaign_guard_audit (
      id BIGSERIAL PRIMARY KEY,campaign_id BIGINT NOT NULL,dialer_contact_id TEXT NOT NULL,
      event TEXT NOT NULL,detail JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS ppc_campaign_guard_scans (
      campaign_id BIGINT PRIMARY KEY,state JSONB NOT NULL,revision BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS ppc_campaign_guard_jobs (
      contact_id TEXT PRIMARY KEY,source JSONB NOT NULL,revision BIGINT NOT NULL DEFAULT 1,
      processed_revision BIGINT NOT NULL DEFAULT 0,retry_at TIMESTAMPTZ,last_error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  }
  async function transition(row,state,detail){
    if(!['VERIFY_REQUIRED','RECHECK_REQUIRED','HELD'].includes(state))throw Error('GUARD_STATE_INVALID');
    await lease();
    const changed=await db.query(`WITH changed AS (
      UPDATE ppc_campaign_guard_memberships SET state=$5,revision=revision+1,updated_at=NOW()
      WHERE campaign_id=$1 AND dialer_contact_id=$2 AND contact_id=$3 AND revision=$4
      RETURNING *), audit AS (
      INSERT INTO ppc_campaign_guard_audit(campaign_id,dialer_contact_id,event,detail)
      SELECT campaign_id,dialer_contact_id,$5,$6::jsonb FROM changed)
      SELECT * FROM changed`,[row.campaign_id,row.dialer_contact_id,row.contact_id,row.revision,state,JSON.stringify(detail)]);
    if(changed.length!==1)throw Error('GUARD_REVISION_CHANGED');
    Object.assign(row,changed[0]);
  }
  async function checked(row){await lease();const changed=await db.query(`UPDATE ppc_campaign_guard_memberships
    SET last_checked_at=NOW(),state='ACTIVE',revision=revision+1 WHERE campaign_id=$1 AND dialer_contact_id=$2 AND contact_id=$3 AND revision=$4 RETURNING campaign_id`,
    [row.campaign_id,row.dialer_contact_id,row.contact_id,row.revision]);if(changed.length!==1)throw Error('GUARD_REVISION_CHANGED');}
  async function removalResponse(row,response){await lease();await db.query(`INSERT INTO ppc_campaign_guard_audit(campaign_id,dialer_contact_id,event,detail)
    VALUES($1,$2,'REMOVAL_RESPONSE',$3::jsonb)`,[row.campaign_id,row.dialer_contact_id,JSON.stringify({ok:response?.ok===true,status:response?.status||null})]);}
  const scans={
    async get(id){const [r]=await db.query('SELECT state,revision FROM ppc_campaign_guard_scans WHERE campaign_id=$1',[id]);return r?{...r.state,revision:r.revision}:null;},
    async begin(id,state){await lease();const [r]=await db.query(`INSERT INTO ppc_campaign_guard_scans(campaign_id,state) VALUES($1,$2::jsonb)
      ON CONFLICT(campaign_id) DO UPDATE SET state=EXCLUDED.state,revision=ppc_campaign_guard_scans.revision+1,updated_at=NOW()
      RETURNING state,revision`,[id,JSON.stringify(state)]);return {...r.state,revision:r.revision};},
    async set(id,state){await lease();const rows=await db.query(`UPDATE ppc_campaign_guard_scans SET state=$2::jsonb,revision=revision+1,updated_at=NOW()
      WHERE campaign_id=$1 AND revision=$3 RETURNING revision`,[id,JSON.stringify(state),state.revision]);if(rows.length!==1)throw Error('SCAN_REVISION_CHANGED');},
  };
  return {ensure,transition,checked,removalResponse,scans};
}
module.exports={createGuardStore};

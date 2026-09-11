"use strict";
const crypto = require('node:crypto');
const { feedback } = require('./ppc-api-budget.cjs');
const { createRefresher } = require('./ppc-team-note-refresh.cjs');
const { createGuardRunner } = require('./ppc-campaign-guard-runner.cjs');
const { createUnderwritingDisposition, OWNER, STAGE, PHOTO_STAGE } = require('./ppc-underwriting-disposition.cjs');
const AUTHORS = {
  PGfXxlXCRXs3hXN3Gq7R: 'Montelli Scott', SvdGukwgAhqzbVBO6Xl4: 'Kayla R Mauser',
  nxm2vJmHXBeGBXT2tbxu: 'Seth PPC', '2pTsqC5vrzCvtR2v9oYG': 'Roberta PPC',
  LFZFWwgJVb0MYFsqAggb: 'Jael PPC', Pj3UnKISg2ZIo4W2ntbt: 'Jill PPC',
  '4ObDKq93U5V8xNJAhpSn': 'Zayre Blatnik2', L4duPlSIyHJLTPkNElNs: 'Marissa Jarmon PPC',
  MBk7q522Bdb7XDE3zp2F: 'Nolb PPC', piXgaCcKw0qv3ckTDqhE: 'Krystal Thatcher PPC',
  RSNq79qQyT8968xTH6E1: 'Michael Walsh',
};

function createService({ db, env = process.env, fetcher = fetch, now = Date.now }) {
  const owner = crypto.randomUUID();
  let ready, running = false, stopping = false, timer, seededAt = 0;
  let activeCycle = Promise.resolve(), lastCycleAt = null, lastSuccessfulCycleAt = null, lastCycleError = null;
  const enabled = () => env.PPC_NOTE_SERVICE_ENABLED === 'true';
  const workerEnabled = () => enabled() && env.PPC_NOTE_WORKER_ENABLED !== 'false';
  async function ensure() {
    if (!ready) ready = (async () => {
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_note_service_control (
        id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, lease_until TIMESTAMPTZ,
        halted BOOLEAN NOT NULL DEFAULT FALSE, last_error TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`INSERT INTO ppc_note_service_control(id) VALUES(1) ON CONFLICT DO NOTHING`);
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_note_progress (
        contact_id TEXT PRIMARY KEY, state JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_note_replacements (
        id BIGSERIAL PRIMARY KEY, contact_id TEXT NOT NULL, state JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW())`);
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_note_provider_budget (
        provider TEXT PRIMARY KEY, next_at BIGINT NOT NULL DEFAULT 0,
        blocked_until BIGINT NOT NULL DEFAULT 0, gap INTEGER NOT NULL DEFAULT 3000)`);
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_team_note_brief_jobs (
        contact_id TEXT PRIMARY KEY, dialer_contact_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ, last_error TEXT,
        last_synced_at TIMESTAMPTZ, done_event_id BIGINT NOT NULL DEFAULT 0,
        claimed_event_id BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await db.query(`ALTER TABLE ppc_team_note_brief_jobs ADD COLUMN IF NOT EXISTS verified BOOLEAN,
        ADD COLUMN IF NOT EXISTS result TEXT, ADD COLUMN IF NOT EXISTS worker_owner TEXT`);
      // Keep the legacy table intact for rollback. Each destination now owns its
      // event cursor and restart checkpoint, including duplicate dialer records.
      await db.query(`CREATE TABLE IF NOT EXISTS ppc_team_note_targets (
        LIKE ppc_team_note_brief_jobs INCLUDING DEFAULTS,
        progress_key TEXT NOT NULL,
        PRIMARY KEY(contact_id,dialer_contact_id))`);
      if(env.PPC_CAMPAIGN_GUARD_ENABLED==='true')await guardRunner.ensure();
    })().catch(e => { ready = null; throw e; });
    return ready;
  }
  async function lease() {
    const rows = await db.query(`UPDATE ppc_note_service_control SET owner=$1,
      lease_until=NOW()+INTERVAL '90 seconds',updated_at=NOW() WHERE id=1 AND NOT halted
      AND (owner=$1 OR lease_until IS NULL OR lease_until<NOW()) RETURNING id`, [owner]);
    if (!rows.length) throw new Error('NOTE_SERVICE_LEASE_UNAVAILABLE');
  }
  async function request(provider, path, method = 'GET', body) {
    if (provider === 'ghl' && method !== 'GET') throw new Error('SOURCE_WRITE_PROHIBITED');
    if (provider === 'justcall' && (method !== 'GET' && method !== 'PUT')) throw new Error('DESTINATION_WRITE_PROHIBITED');
    if (provider === 'justcall' && (!/^\/sales_dialer\/contacts\/\d+$/.test(path) ||
      (method === 'PUT' && (!Array.isArray(body?.custom_fields) ||
        ![1,2].includes(body.custom_fields.length) || body.custom_fields[0].id !== 1252710 ||
        Object.keys(body).some(k => k !== 'custom_fields') ||
        (body.custom_fields.length === 2 && (body.custom_fields[1].id !== 1252708 ||
          !['Review team notes before calling','DO NOT CONTACT. Review team notes.'].includes(body.custom_fields[1].value)))))))
      throw new Error('DESTINATION_SCOPE_PROHIBITED');
    return performRequest(provider,path,method,body);
  }
  async function campaignRequest(method,campaignId,contactId,page=0) {
    if(env.PPC_CAMPAIGN_GUARD_ENABLED!=='true')throw Error('CAMPAIGN_GUARD_DISABLED');
    if(method==='DELETE'&&env.PPC_CAMPAIGN_GUARD_MODE!=='enforce')throw Error('CAMPAIGN_GUARD_AUDIT_ONLY');
    // Completed SMS72H is deliberately excluded. No campaign creation, bulk
    // deletion, contact deletion, calling, or contact-field mutation is exposed.
    if(![3379399,3379400,3379401,3379538,3379643,3379660].includes(campaignId))throw Error('CAMPAIGN_SCOPE_PROHIBITED');
    if(method==='GET'&&Number.isInteger(page)&&page>=0&&page<100)
      return performRequest('justcall',`/sales_dialer/campaigns/contacts?campaign_id=${campaignId}&per_page=50&page=${page}`,'GET');
    if(method==='DELETE'&&Number.isSafeInteger(contactId)&&contactId>0)
      return performRequest('justcall',`/sales_dialer/campaigns/contact?campaign_id=${campaignId}&contact_id=${contactId}&remove_all=false`,'DELETE');
    throw Error('CAMPAIGN_SCOPE_PROHIBITED');
  }
  async function performRequest(provider,path,method='GET',body) {
    await lease();
    const floor = provider === 'justcall' ? 3000 : 500;
    await db.query(`INSERT INTO ppc_note_provider_budget(provider,gap) VALUES($1,$2) ON CONFLICT DO NOTHING`, [provider, floor]);
    for (;;) {
    const reservation = await db.query(`UPDATE ppc_note_provider_budget SET next_at=$2+GREATEST(gap,$3)
      WHERE provider=$1 AND next_at<=$2 AND blocked_until<=$2 RETURNING provider`, [provider, now(), floor]);
    if (reservation.length) break;
    {
      const [b] = await db.query(`SELECT next_at,blocked_until FROM ppc_note_provider_budget WHERE provider=$1`, [provider]);
      const retryAt = Math.max(Number(b.next_at), Number(b.blocked_until));
      if (retryAt-now()>30000) return { ok: false, status: 429, retry_at: new Date(retryAt).toISOString() };
      await new Promise(resolve => setTimeout(resolve, Math.max(20,retryAt-now())));
      await lease();
    }
    }
    const key = provider === 'ghl' ? env.PPC_GHL_API_KEY : env.JUSTCALL_API_KEY;
    if (!key || (provider === 'justcall' && !env.JUSTCALL_API_SECRET)) throw new Error('NOTE_SERVICE_CREDENTIALS_MISSING');
    const base = provider === 'ghl' ? 'https://services.leadconnectorhq.com' : 'https://api.justcall.io/v2.1';
    const response = await fetcher(base + path, {
      method, headers: { Authorization: provider === 'ghl' ? 'Bearer ' + key : key + ':' + env.JUSTCALL_API_SECRET,
        Version: '2021-07-28', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
    });
    const headers = Object.fromEntries(response.headers);
    const observed = feedback(provider, headers, response.status, now());
    await db.query(`UPDATE ppc_note_provider_budget SET blocked_until=GREATEST(blocked_until,$2),
      gap=$3,next_at=GREATEST(next_at,$4) WHERE provider=$1`, [provider, observed.blockedUntil, observed.gap, now()+observed.gap]);
    let data; try { data = await response.json(); } catch { data = null; }
    return { ok: response.ok, status: response.status, data,
      retry_at: response.status === 429 ? new Date(observed.blockedUntil).toISOString() : null };
  }
  const progress = {
    async get(id) { return (await db.query('SELECT state FROM ppc_note_progress WHERE contact_id=$1', [id]))[0]?.state || null; },
    async set(id, state) {
      await lease();
      await db.query(`INSERT INTO ppc_note_progress(contact_id,state) VALUES($1,$2::jsonb)
        ON CONFLICT(contact_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()`, [id, JSON.stringify(state)]);
    },
    async clear(id) { await lease(); await db.query('DELETE FROM ppc_note_progress WHERE contact_id=$1', [id]); },
    async recordReplacement(id, state) {
      await lease();
      await db.query('INSERT INTO ppc_note_replacements(contact_id,state) VALUES($1,$2::jsonb)', [id, JSON.stringify(state)]);
    },
  };
  const guardRunner=createGuardRunner({db,lease,sourceRequest:request,campaignRequest,now,auditOnly:env.PPC_CAMPAIGN_GUARD_MODE!=='enforce',deferredContacts:JSON.parse(env.PPC_CAMPAIGN_GUARD_DEFER_UNTIL||'{}')});
  const underwriting=createUnderwritingDisposition({db,lease,now,request:async(provider,path,method='GET',body)=>{
    if(method==='GET'&&provider==='ghl')return request(provider,path);
    if(method==='GET'&&provider==='justcall'&&/^\/sales_dialer\/calls\/\d+$/.test(path))return performRequest(provider,path);
    if(method==='PUT'&&provider==='ghl'&&body?.assignedTo===OWNER&&
      ((/^\/contacts\/[A-Za-z0-9]+$/.test(path)&&Object.keys(body).length===1)||
       (/^\/opportunities\/[A-Za-z0-9]+$/.test(path)&&Object.keys(body).length===2&&[STAGE,PHOTO_STAGE].includes(body.pipelineStageId))))return performRequest(provider,path,method,body);
    throw Error('UNDERWRITING_SCOPE_PROHIBITED');
  }});
  const refresher = createRefresher({ ghl: (p,m,b) => request('ghl',p,m,b),
    justcall: (p,m,b) => request('justcall',p,m,b), loadUsers: async () => AUTHORS, progress,
    onSource:async(id,c,n)=>{await underwriting.process(c,n);if(env.PPC_CAMPAIGN_GUARD_ENABLED==='true')await guardRunner.enqueue(id,c,n);} });
  async function step() {
    await lease();
    await db.query(`UPDATE ppc_sales_dialer_webhook_inbox i SET status='COMPLETED',last_error=NULL,retry_at=NULL,updated_at=NOW()
      WHERE status IN ('PENDING','RETRY_PENDING','PROCESSING') AND EXISTS(
        SELECT 1 FROM ppc_team_note_targets t WHERE t.contact_id=i.contact_id AND t.done_event_id>=i.id)`);
    await db.query(`UPDATE ppc_sales_dialer_webhook_inbox i SET status='NOT_APPLICABLE',
      last_error='NO_REGISTERED_DIALER_DESTINATION',retry_at=NULL,updated_at=NOW()
      WHERE status IN ('PENDING','RETRY_PENDING') AND created_at<NOW()-INTERVAL '10 minutes'
        AND NOT EXISTS(SELECT 1 FROM ppc_team_note_targets t WHERE t.contact_id=i.contact_id)`);
    const [urgent]=await db.query(`SELECT EXISTS(SELECT 1 FROM ppc_team_note_targets
      WHERE status IN ('PENDING','RETRY_PENDING') AND (retry_at IS NULL OR retry_at<=NOW())) AS pending`);
    // Explicit ingestion/retry work must not sit behind a long campaign scan.
    const guardResult=env.PPC_CAMPAIGN_GUARD_ENABLED==='true'&&!urgent.pending?await guardRunner.step():false;
    if (now()-seededAt>300000) {
      await db.query(`INSERT INTO ppc_team_note_targets
        (contact_id,dialer_contact_id,status,attempts,retry_at,last_error,last_synced_at,
         done_event_id,claimed_event_id,updated_at,verified,result,worker_owner,progress_key)
        SELECT contact_id,dialer_contact_id,status,attempts,retry_at,last_error,last_synced_at,
         done_event_id,claimed_event_id,updated_at,verified,result,worker_owner,contact_id
        FROM ppc_team_note_brief_jobs ON CONFLICT(contact_id,dialer_contact_id) DO NOTHING`);
      await db.query(`INSERT INTO ppc_team_note_targets(contact_id,dialer_contact_id,progress_key)
        SELECT DISTINCT contact_id,provider_contact->>'id',contact_id||':'||(provider_contact->>'id')
        FROM ppc_sales_dialer_sync_jobs
        WHERE contact_id IS NOT NULL AND provider_contact->>'id' IS NOT NULL
        ON CONFLICT(contact_id,dialer_contact_id) DO NOTHING`);
      seededAt=now();
    }
    const [job] = await db.query(`WITH candidate AS (
      SELECT j.contact_id,j.dialer_contact_id,COALESCE((SELECT MAX(i.id) FROM ppc_sales_dialer_webhook_inbox i
        WHERE i.contact_id=j.contact_id),0) AS event_id FROM ppc_team_note_targets j
      WHERE j.status<>'FAILED' AND (j.status<>'PROCESSING' OR j.updated_at<NOW()-INTERVAL '3 minutes')
        AND (j.retry_at IS NULL OR j.retry_at<=NOW())
        AND (j.status IN ('PENDING','RETRY_PENDING','PROCESSING') OR ($2::boolean AND (
          j.last_synced_at<NOW()-INTERVAL '6 hours' OR EXISTS(SELECT 1 FROM ppc_sales_dialer_webhook_inbox i
          WHERE i.contact_id=j.contact_id AND i.id>j.done_event_id)))
      ORDER BY (j.status IN ('PENDING','RETRY_PENDING','PROCESSING')) DESC,
        (COALESCE((SELECT MAX(i.id) FROM ppc_sales_dialer_webhook_inbox i WHERE i.contact_id=j.contact_id),0)>j.done_event_id) DESC,
        j.last_synced_at NULLS FIRST,j.attempts,j.contact_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    ) UPDATE ppc_team_note_targets j SET status='PROCESSING',attempts=attempts+1,
      claimed_event_id=c.event_id,worker_owner=$1,updated_at=NOW() FROM candidate c
      WHERE j.contact_id=c.contact_id AND j.dialer_contact_id=c.dialer_contact_id RETURNING j.*`, [owner,guardResult!==true]);
    if (!job) return guardResult===true;
    let result;
    try { result = await refresher.refresh({ contactId: job.contact_id,
      salesDialerContactId: job.dialer_contact_id, progressKey: job.progress_key,
      eventId: job.claimed_event_id, dryRun: false }); }
    catch (e) { result = { status:'error',error: /LEASE/.test(e.message) ? 'NOTE_SERVICE_LEASE_UNAVAILABLE' : 'NOTE_SERVICE_REQUEST_FAILED' }; }
    await lease();
    if (result.status === 'ok') {
      await db.query(`UPDATE ppc_team_note_targets SET status='COMPLETED',retry_at=NULL,last_error=NULL,
        last_synced_at=NOW(),done_event_id=$3,verified=$4,result=$5,updated_at=NOW()
        WHERE contact_id=$1 AND worker_owner=$2 AND dialer_contact_id=$6`, [job.contact_id,owner,result.processed_event_id ?? job.claimed_event_id,
        result.verified || false,result.result,job.dialer_contact_id]);
    } else {
      const terminal = /MISMATCH|FIELD_MISSING|RESPONSE_INVALID|OTHER_FIELD_CHANGED|HTTP 401|HTTP 403/.test(result.error || '');
      const retry = new Date(Math.max(now()+5000, Date.parse(result.retry_at||'')||now()+60000)).toISOString();
      await db.query(`UPDATE ppc_team_note_targets SET status=$3,retry_at=$4,last_error=$5,updated_at=NOW()
        WHERE contact_id=$1 AND worker_owner=$2 AND dialer_contact_id=$6`, [job.contact_id,owner,terminal?'FAILED':'RETRY_PENDING',terminal?null:retry,result.error,job.dialer_contact_id]);
      if (terminal) {
        await db.query(`UPDATE ppc_note_service_control SET halted=TRUE,last_error=$2,updated_at=NOW() WHERE id=1 AND owner=$1`, [owner,result.error]);
        console.error('[PPC notes] verification failed; writes halted');
        return false;
      }
    }
    return true;
  }
  async function wake() {
    if (!workerEnabled() || stopping || running) return;
    running = true;
    lastCycleAt = new Date(now()).toISOString();
    activeCycle = (async () => { try {
      await ensure();
      const deadline = now()+45000;
      while (now()<deadline && workerEnabled() && !stopping && await step()) {}
      lastSuccessfulCycleAt = new Date(now()).toISOString();
      lastCycleError = null;
    } catch (e) {
      lastCycleError = String(e?.message || 'UNKNOWN_CYCLE_ERROR').slice(0, 240);
      if (lastCycleError !== 'NOTE_SERVICE_LEASE_UNAVAILABLE') console.error('[PPC notes] service cycle failed:', lastCycleError);
    }
    finally { running = false; } })();
    await activeCycle;
  }
  function start() {
    stopping = false;
    if (workerEnabled() && !timer) { timer=setInterval(wake,10000); timer.unref(); void wake(); }
  }
  async function stop() {
    stopping = true;
    clearInterval(timer); timer=null;
    await activeCycle;
    if (ready) await db.query(`UPDATE ppc_note_service_control SET owner=NULL,lease_until=NULL,updated_at=NOW()
      WHERE id=1 AND owner=$1`, [owner]);
  }
  async function health() {
    await ensure();
    const [control] = await db.query('SELECT owner,lease_until,halted,last_error,updated_at FROM ppc_note_service_control WHERE id=1');
    const counts = await db.query('SELECT status,verified,count(*)::int AS count FROM ppc_team_note_targets GROUP BY status,verified');
    const [backlog] = await db.query(`SELECT MIN(updated_at) FILTER (WHERE status IN ('PENDING','RETRY_PENDING','PROCESSING')) AS oldest_pending_at,
      COUNT(*) FILTER (WHERE status IN ('PENDING','RETRY_PENDING','PROCESSING'))::int AS pending,
      COUNT(*) FILTER (WHERE status='FAILED')::int AS failed FROM ppc_team_note_targets`);
    const [events] = await db.query('SELECT MAX(created_at) AS last_event_at FROM ppc_sales_dialer_webhook_inbox');
    const inbox_counts=await db.query('SELECT status,count(*)::int AS count FROM ppc_sales_dialer_webhook_inbox GROUP BY status');
    const [inbox_backlog]=await db.query(`SELECT MIN(created_at) FILTER (WHERE status IN ('PENDING','RETRY_PENDING','PROCESSING')) AS oldest_pending_at,
      COUNT(*) FILTER (WHERE status IN ('PENDING','RETRY_PENDING','PROCESSING'))::int AS pending,
      COUNT(*) FILTER (WHERE status='FAILED')::int AS failed FROM ppc_sales_dialer_webhook_inbox`);
    let campaign_guard={enabled:false};
    if(env.PPC_CAMPAIGN_GUARD_ENABLED==='true'){
      const [guardControl]=await db.query('SELECT halted,last_error,updated_at FROM ppc_campaign_guard_control WHERE id=1');
      const membershipCounts=await db.query('SELECT state,count(*)::int AS count FROM ppc_campaign_guard_memberships GROUP BY state');
      const [queue]=await db.query('SELECT count(*)::int AS pending FROM ppc_campaign_guard_jobs WHERE processed_revision<revision');
      campaign_guard={enabled:true,mode:env.PPC_CAMPAIGN_GUARD_MODE==='enforce'?'enforce':'audit',...guardControl,counts:membershipCounts,pending:queue.pending};
    }
    return { enabled:enabled(),worker_enabled:workerEnabled(),running,stopping,
      runtime:env.PPC_WORKER_HOST||'render',revision:env.RENDER_GIT_COMMIT||env.GIT_COMMIT||'local',
      instance_id:env.RENDER_INSTANCE_ID||null,last_cycle_at:lastCycleAt,
      last_successful_cycle_at:lastSuccessfulCycleAt,last_cycle_error:lastCycleError,lease_active:control.owner===owner,
      lease_until:control.lease_until,halted:control.halted,last_error:control.last_error,
      updated_at:control.updated_at,backlog,counts,last_event_at:events.last_event_at,
      inbox:{backlog:inbox_backlog,counts:inbox_counts},campaign_guard };
  }
  return { start, stop, wake, ensure, step, request, campaignRequest, progress, health };
}
module.exports = { createService, AUTHORS };

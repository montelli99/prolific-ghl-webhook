"use strict";

const crypto = require("node:crypto");
const LOCATION_ID = "GDq92uruRngbi9mLGGrV";
const NOTE_WORKFLOW_ID = "2027fc35-4aed-4854-83f3-a75b134b81bb";
const EVENTS = new Set([
  "NoteCreate",
  "NoteUpdate",
  "NoteDelete",
  "ContactUpdate",
  "ContactDndUpdate",
  "OpportunityCreate",
  "OpportunityUpdate",
  "OpportunityStageUpdate",
  "OpportunityStatusUpdate",
  "OpportunityAssignedToUpdate",
]);

function normalizeEvent(payload = {}) {
  const workflowNote = payload.workflow?.id === NOTE_WORKFLOW_ID &&
    payload.customData?.ppc_event === "team_note_changed";
  const type = workflowNote ? "NoteUpdate" : String(payload.type || "");
  const location = payload.locationId || payload.location_id || payload.location?.id;
  if (location !== LOCATION_ID || !EVENTS.has(type)) return null;
  const contactId =
    payload.contactId ||
    payload.contact_id ||
    payload.contact?.id ||
    (type.startsWith("Contact") ? payload.id : null);
  const opportunityId =
    payload.opportunityId ||
    payload.opportunity_id ||
    (type.startsWith("Opportunity") ? payload.id : null);
  if (!contactId && !opportunityId) return null;
  if (workflowNote && (typeof contactId !== "string" || !contactId)) return null;
  return {
    event_type: type,
    contact_id: contactId || null,
    opportunity_id: opportunityId || null,
    source_version: String(payload.dateUpdated || payload.updatedAt || payload.requestId || ""),
    // Standard workflow deliveries do not guarantee a unique note/version ID.
    // Never permanently deduplicate them by body: A -> B -> A is a real change.
    // Repeated deliveries safely coalesce through the contact job and readback.
    payload_hash: workflowNote ? crypto.randomUUID() :
      crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

function createWebhookInbox(db) {
  let ready;
  function ensureTable() {
    if (!ready)
      ready = db
        .query(`CREATE TABLE IF NOT EXISTS ppc_sales_dialer_webhook_inbox (
      id BIGSERIAL PRIMARY KEY, payload_hash TEXT UNIQUE NOT NULL, event_type TEXT NOT NULL,
      contact_id TEXT, opportunity_id TEXT, source_version TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
      retry_at TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
        .catch((error) => {
          ready = null;
          throw error;
        });
    return ready;
  }
  async function enqueue(payload) {
    const event = normalizeEvent(payload);
    if (!event) return { status: "ok", result: "NOT_APPLICABLE" };
    await ensureTable();
    const rows = await db.query(
      `INSERT INTO ppc_sales_dialer_webhook_inbox
      (payload_hash,event_type,contact_id,opportunity_id,source_version) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (payload_hash) DO NOTHING RETURNING id`,
      [
        event.payload_hash,
        event.event_type,
        event.contact_id,
        event.opportunity_id,
        event.source_version,
      ],
    );
    return { status: "ok", result: rows.length ? "QUEUED" : "ALREADY_QUEUED" };
  }
  async function claimNext() {
    await ensureTable();
    const rows =
      await db.query(`UPDATE ppc_sales_dialer_webhook_inbox SET status='PROCESSING', attempts=attempts+1,updated_at=NOW()
      WHERE id=(SELECT id FROM ppc_sales_dialer_webhook_inbox WHERE
        (status IN ('PENDING','RETRY_PENDING') AND (retry_at IS NULL OR retry_at<=NOW()))
        OR (status='PROCESSING' AND updated_at<NOW()-INTERVAL '15 minutes')
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
    return rows[0] || null;
  }
  async function finish(id) {
    await db.query(
      "UPDATE ppc_sales_dialer_webhook_inbox SET status='COMPLETED',last_error=NULL,retry_at=NULL,updated_at=NOW() WHERE id=$1",
      [id],
    );
  }
  async function fail(id, error, retryAt) {
    await db.query(
      "UPDATE ppc_sales_dialer_webhook_inbox SET status=$2,last_error=$3,retry_at=$4,updated_at=NOW() WHERE id=$1",
      [id, retryAt ? "RETRY_PENDING" : "FAILED", error, retryAt || null],
    );
  }
  return { ensureTable, enqueue, claimNext, finish, fail };
}

function createProductionWebhookInbox() {
  const url = process.env.PPC_AUTOMATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("PPC_CANONICAL_DATABASE_UNAVAILABLE");
  return createWebhookInbox(require("@neondatabase/serverless").neon(url));
}

module.exports = { LOCATION_ID, NOTE_WORKFLOW_ID, normalizeEvent, createWebhookInbox, createProductionWebhookInbox };

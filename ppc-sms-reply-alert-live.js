'use strict';

const { neon } = require('@neondatabase/serverless');
const { PIPELINE_CHAT_ID, PIPELINE_THREAD_ID } = require('./ppc-sms-reply-alert');

function createLiveAlertDependencies(env = process.env) {
  const databaseUrl = env.PPC_AUTOMATION_DATABASE_URL || env.DATABASE_URL;
  const ghlToken = env.PPC_GHL_API_KEY;
  const telegramToken = env.PPC_TELEGRAM_BOT_TOKEN;
  if (!databaseUrl || !ghlToken || !telegramToken || !env.JUSTCALL_API_SECRET) {
    throw new Error('PPC reply alert missing database, GHL, Telegram, or JustCall configuration');
  }
  const sql = neon(databaseUrl);
  const ready = sql`CREATE TABLE IF NOT EXISTS ppc_justcall_telegram_alerts (
    event_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    telegram_message_id BIGINT
  )`;
  return {
    justcallSecret: env.JUSTCALL_API_SECRET,
    async ghlGet(path) {
      const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
        headers: { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`PPC GHL lookup failed: ${response.status}`);
      return response.json();
    },
    async claim(eventId) {
      await ready;
      const rows = await sql`INSERT INTO ppc_justcall_telegram_alerts (event_id, status)
        VALUES (${eventId}, 'CLAIMED')
        ON CONFLICT (event_id) DO UPDATE SET status = 'CLAIMED', claimed_at = NOW()
        WHERE ppc_justcall_telegram_alerts.status <> 'SENT'
          AND ppc_justcall_telegram_alerts.claimed_at < NOW() - INTERVAL '2 minutes'
        RETURNING event_id`;
      if (rows.length) return 'claimed';
      const existing = await sql`SELECT status FROM ppc_justcall_telegram_alerts WHERE event_id = ${eventId}`;
      return existing[0]?.status === 'SENT' ? 'sent' : 'pending';
    },
    async sendTelegram(text) {
      const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: PIPELINE_CHAT_ID, message_thread_id: PIPELINE_THREAD_ID,
          text, disable_web_page_preview: true }), signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`Pipeline Telegram alert failed: ${response.status}`);
      const body = await response.json();
      if (!body.ok || !body.result?.message_id) throw new Error('Pipeline Telegram alert had no message receipt');
      return body.result.message_id;
    },
    async markSent(eventId) {
      await sql`UPDATE ppc_justcall_telegram_alerts SET status = 'SENT', sent_at = NOW()
        WHERE event_id = ${eventId} AND status = 'CLAIMED'`;
    },
    async release(eventId) {
      await sql`DELETE FROM ppc_justcall_telegram_alerts WHERE event_id = ${eventId} AND status = 'CLAIMED'`;
    },
  };
}

module.exports = { createLiveAlertDependencies };

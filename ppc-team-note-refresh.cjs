"use strict";
function normalizePhone(value) { const d=String(value||'').replace(/\D/g,''); return d.length===10?'1'+d:d.length===11&&d.startsWith('1')?d:null; }
const SD_FIELDS = { SELLER_CALL_BRIEF: 1252710, LATEST_SELLER_RESPONSE: 1252711 };
const { LOCATION_ID } = require("./ppc-sales-dialer-webhook-inbox.cjs");

function comparable(value) {
  // JustCall's text renderer changes quote typography. Keep apostrophes and
  // every word/number; ignore double-quote delimiters and whitespace only.
  const text = String(value || "")
    .replace(/[“”"]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  // JustCall can omit the final closing single quote of a quoted passage.
  // Require an opening delimiter; internal apostrophes remain significant.
  return /(?:^|\s)'\S[\s\S]*'$/.test(text) ? text.slice(0, -1) : text;
}

function noteText(body) {
  let text = String(body || "")
    .replace(/<\s*br\s*\/?\s*>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  // Provider call receipts are not conversation notes. Retain an explicitly
  // attached note, if present, but omit numbers, recording links and timings.
  if (/^(?:Outgoing Call[^\n]*\n|Incoming Call[^\n]*\n)?Call ID:/i.test(text.trim())) {
    const attached = text.match(/(?:^|\n)(?:Call Notes|Notes):\s*([\s\S]*)/i);
    return attached ? attached[1].trim() : "";
  }
  text = text
    .replace(/^\[(?:UNDERWRITING NOTE|MONTELLI TRANSCRIPT)[^\n]*\]\s*/m, "")
    .replace(/^(?:SELLER CALL \/ UNDERWRITING NOTES|Property:|Caller:|Call Date:|Call Source:|Call ID:|Duration:|Call family:|Sales platform:|Evidence source:|SMS conversation with|This conversation is associated with|SMS ID:|Date & Time:|Received from:|Received on:)[^\n]*(?:\n|$)/gm, "")
    .replace(/^Incoming SMS\s*\n/, "")
    .replace(/^\s*Date:[^\n]*(?:\n|$)/gm, "")
    .replace(/[↙️↗️]+\s*\[(Incoming|Outgoing)\s*\|[^\]]*\]:\s*/g, "$1: ")
    .replace(/\nTranscript:[\s\S]*$/, "")
    .trim();
  // Preserve the note's own wording; make callback instructions visible first.
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const callbacks = lines.filter((line) => /^-?\s*(?:Callback Request|Follow Up|Follow-up):/i.test(line));
  return [...callbacks, ...lines.filter((line) => !callbacks.includes(line))].join(" ").replace(/\s+/g, " ").trim();
}

function briefFromNotes(notes, suppressed, users = {}) {
  const source = Array.isArray(notes) ? notes : [];
  const correctedCalls = new Map();
  for (const note of source) {
    const match = String(note.body || "").match(/^\[UNDERWRITING NOTE v(\d+) call=(\d+)/);
    if (match && Number(match[1]) > (correctedCalls.get(match[2])?.version || 0))
      correctedCalls.set(match[2], { version: Number(match[1]), id: note.id });
  }
  const list = source.filter((note) => {
    const match = String(note.body || "").match(/^\[(?:UNDERWRITING NOTE v\d+|MONTELLI TRANSCRIPT) call=(\d+)/);
    return !match || !correctedCalls.has(match[1]) || correctedCalls.get(match[1]).id === note.id;
  })
    .map((note) => ({
      ...note,
      text: noteText(note.body),
    }))
    .filter((note) => note.text)
    .sort(
      (a, b) =>
        (Date.parse(b.dateUpdated || b.dateAdded) || 0) -
        (Date.parse(a.dateUpdated || a.dateAdded) || 0),
    );
  if (!list.length) return null;
  const header = suppressed ? "DO NOT CONTACT. GHL notes: " : "GHL notes: ";
  const lines = list.slice(0, 2).map((note) => {
    const caller = /^\[UNDERWRITING NOTE/.test(note.body || "")
      ? String(note.body).match(/^Caller:\s*([^\n]+)/m)?.[1]
      : null;
    const author = note.userName || note.author?.name || users[note.userId] || (caller ? `Call with ${caller}` : "team member");
    const date = note.dateUpdated || note.dateAdded || "date unavailable";
    const text = note.text.length > 150 ? note.text.slice(0, 147) + "..." : note.text;
    return `${String(date).slice(0, 10)} / ${author}: ${text}`;
  });
  return (header + lines.join(" | ")).slice(0, 450);
}

function createProgress(directory) {
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  fs.mkdirSync(directory, { recursive: true });
  const file = (id) =>
    path.join(directory, crypto.createHash("sha256").update(String(id)).digest("hex") + ".json");
  return {
    recordReplacement(id, value) {
      // Retain the old generated brief locally before replacing that one field.
      // This audit is separate from the resumable checkpoint cleared on success.
      fs.appendFileSync(
        path.join(directory, "replacements.jsonl"),
        JSON.stringify({ at: new Date().toISOString(), contactId: id, ...value }) + "\n",
      );
    },
    get(id) {
      try {
        return JSON.parse(fs.readFileSync(file(id), "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        return null;
      }
    },
    set(id, value) {
      const target = file(id);
      const temp = target + "." + process.pid + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(value));
      fs.renameSync(temp, target);
    },
    clear(id) {
      try {
        fs.unlinkSync(file(id));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    },
  };
}

function createRefresher({
  ghl,
  justcall,
  loadUsers = async () => ({}),
  progress = { get: () => null, set: () => {}, clear: () => {} },
}) {
  async function refresh({ contactId, salesDialerContactId, dryRun = true, eventId = 0 }) {
    if (!contactId || !salesDialerContactId)
      return { status: "error", error: "EXISTING_CONTACT_MAPPING_REQUIRED" };
    const failed = (name, response) => ({
      status: "error",
      error: `${name}: HTTP ${response.status}`,
      retry_at: response.retry_at || null,
    });
    const endpoint = `/sales_dialer/contacts/${encodeURIComponent(salesDialerContactId)}`;
    let saved = dryRun ? null : await progress.get(contactId);
    if (
      saved &&
      (saved.dialerId !== String(salesDialerContactId) || Date.now() - saved.at > 15 * 60_000)
    ) {
      await progress.clear(contactId);
      saved = null;
    }
    async function verify(state) {
      const readBack = await justcall(endpoint);
      if (!readBack.ok) return failed("DIALER_BRIEF_READBACK_FAILED", readBack);
      const verifiedContact = readBack.data?.data || readBack.data;
      if (normalizePhone(verifiedContact.phone_number) !== normalizePhone(state.contact.phone))
        return { status: "error", error: "DIALER_READBACK_IDENTITY_MISMATCH" };
      const verified = new Map(
        (verifiedContact.custom_fields || []).map((f) => [Number(f.key ?? f.id), f.value]),
      );
      if (comparable(verified.get(SD_FIELDS.SELLER_CALL_BRIEF)) !== comparable(state.brief))
        return { status: "error", error: "DIALER_BRIEF_READBACK_MISMATCH" };
      for (const field of state.fields) {
        const id = Number(field.key ?? field.id);
        if (id !== SD_FIELDS.SELLER_CALL_BRIEF && verified.get(id) !== field.value)
          return { status: "error", error: "DIALER_OTHER_FIELD_CHANGED_DURING_REFRESH" };
      }
      await progress.clear(contactId);
      return {
        status: "ok",
        result: "UPDATED",
        verified: true,
        source_note_count: state.notes.length,
        processed_event_id: state.eventId,
      };
    }
    // A successful write needs only readback after a rate limit, never another
    // write or source scan. Preserve its event version so newer changes remain queued.
    if (saved?.phase === "VERIFY") return verify(saved);
    if (saved && (Date.now() - saved.at > 5 * 60_000 || BigInt(eventId) > BigInt(saved.eventId)))
      saved = null;
    if (!saved) {
      const contactRead = await ghl(`/contacts/${encodeURIComponent(contactId)}`);
      if (!contactRead.ok) return failed("GHL_CONTACT_READ_FAILED", contactRead);
      const contact = contactRead.data?.contact;
      if (!contact || contact.locationId !== LOCATION_ID)
        return { status: "error", error: "GHL_LOCATION_MISMATCH" };
      const notesRead = await ghl(`/contacts/${encodeURIComponent(contactId)}/notes`);
      if (!notesRead.ok) return failed("GHL_NOTES_READ_FAILED", notesRead);
      if (!Array.isArray(notesRead.data?.notes))
        return { status: "error", error: "GHL_NOTES_RESPONSE_INVALID" };
      saved = {
        phase: "SOURCE",
        at: Date.now(),
        dialerId: String(salesDialerContactId),
        contact,
        notes: notesRead.data.notes,
        users: await loadUsers(),
        eventId: String(eventId),
      };
      if (!dryRun) await progress.set(contactId, saved);
    }
    const { contact, notes, users } = saved;
    // No source text means no destination change; do not consume a dialer call.
    if (!notes.length) {
      if (!dryRun) await progress.clear(contactId);
      return {
        status: "ok",
        result: "NO_NOTES_PRESERVED_EXISTING_BRIEF",
        processed_event_id: saved.eventId,
      };
    }
    const current = await justcall(endpoint);
    if (!current.ok) return failed("DIALER_CONTACT_READ_FAILED", current);
    const dialer = current.data?.data || current.data;
    if (
      !normalizePhone(contact.phone) ||
      normalizePhone(contact.phone) !== normalizePhone(dialer.phone_number)
    )
      return { status: "error", error: "EXACT_PHONE_MISMATCH" };
    const fields = Array.isArray(dialer.custom_fields) ? dialer.custom_fields : [];
    const existing = fields.find((f) => Number(f.key ?? f.id) === SD_FIELDS.SELLER_CALL_BRIEF);
    if (!existing) return { status: "error", error: "DIALER_BRIEF_FIELD_MISSING" };
    const sellerResponse =
      fields.find((f) => Number(f.key ?? f.id) === SD_FIELDS.LATEST_SELLER_RESPONSE)?.value || "";
    const suppressed =
      Boolean(contact.dnd) ||
      /DO NOT CONTACT|\bSTOP\b|\bDND\b/i.test(existing.value || "") ||
      /^\s*(stop|unsubscribe|do not contact)\s*[.!]?\s*$/i.test(sellerResponse);
    let brief = briefFromNotes(notes, suppressed, users);
    // Replace our own old metadata-only rendering, never an unrelated manual brief.
    if (!brief && /^(?:DO NOT CONTACT\. )?GHL notes:/.test(existing.value || ""))
      brief = (suppressed ? "DO NOT CONTACT. " : "") + "No readable conversation-note text found in GHL. Review call history for call outcomes.";
    if (!brief) {
      if (!dryRun) await progress.clear(contactId);
      return {
        status: "ok",
        result: "NO_NOTES_PRESERVED_EXISTING_BRIEF",
        processed_event_id: saved.eventId,
      };
    }
    if (comparable(existing.value) === comparable(brief)) {
      if (!dryRun) await progress.clear(contactId);
      return {
        status: "ok",
        result: "ALREADY_CURRENT",
        verified: true,
        processed_event_id: saved.eventId,
      };
    }
    if (dryRun)
      return {
        status: "ok",
        result: "PREVIEW",
        brief,
        source_note_count: notes.length,
      };
    await progress.recordReplacement?.(contactId, {
      dialerId: String(salesDialerContactId),
      fieldId: SD_FIELDS.SELLER_CALL_BRIEF,
      previousValue: existing.value,
      proposedValue: brief,
      sourceNoteIds: notes.map((note) => note.id).filter(Boolean),
      eventId: saved.eventId,
    });
    const write = await justcall(endpoint, "PUT", {
      custom_fields: [{ id: SD_FIELDS.SELLER_CALL_BRIEF, value: brief }],
    });
    if (!write.ok) return failed("DIALER_BRIEF_WRITE_FAILED", write);
    saved = { ...saved, phase: "VERIFY", at: Date.now(), brief, fields };
    await progress.set(contactId, saved);
    return verify(saved);
  }
  return { refresh };
}
module.exports = { createRefresher, briefFromNotes, comparable, createProgress };

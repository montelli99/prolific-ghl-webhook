# Learnings

## LRN-20260722-001 — Creative Financing = HIGH Equity, Not Low
**Correction from Montelli (2026-07-22):** Creative deals target HIGHER-equity properties, not low-equity. Higher equity gives sellers flexibility to accept creative structures (seller carry, partial down payment, balloon, sub-to). Low-equity sellers are constrained by their lender and can't negotiate terms. The PropWire Creative Financing filter surfaces assumable loans, free & clear, and high-equity — the pool where creative deal structures actually work.

---

# Learnings — GHL Automations Topic

## LRN-20260716-001: Render URL Was in Chat History
**What happened:** I searched files extensively for the Render URL when Montelli said "you should already have it." The URL (`https://prolific-ghl-webhook.onrender.com`) was in recent chat history, not in any config file.
**Lesson:** When user says "you already have it" — check recent chat context FIRST before searching files. Chat context is authoritative for recent infrastructure decisions.
**Applied to:** CHANNEL_NOTES.md updated with Render URL. Future: scan last 20 messages before file searches when user claims prior knowledge.

## LRN-20260716-002: JustCall API Auth Format
**What happened:** Multiple failed curl attempts with Bearer token and basic auth before finding the correct `api_key:api_secret` header format.
**Lesson:** JustCall v2.1 uses `Authorization: api_key:api_secret` (colon-separated, not Bearer). Required fields: `justcall_number`, `contact_number`, `body`.
**Applied to:** Updated montelli-config.js and webhook-sms-automation.js with correct auth.

## LRN-20260716-003: Deploy Before Claiming Endpoint Works
**What happened:** I added `/webhook/ghl/sms` to voice_server.js locally and told Montelli the endpoint was ready. But it wasn't deployed to Render yet — returned "Not found" when tested.
**Lesson:** Always verify deployment status before claiming an endpoint is live. Local code ≠ deployed code.
**Applied to:** Explicitly told Montelli he needs to git push to Render.

## LRN-20260716-004: Permission Issues on CHANNEL_NOTES.md
**What happened:** Multiple write/edit failures on CHANNEL_NOTES.md due to file permissions.
**Lesson:** .learnings/ directory is more reliable for append-only logs than protected workspace files.
**Applied to:** Using .learnings/ for durable notes going forward.

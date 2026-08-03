# Montelli Contact Card Specification

**Version:** 2.0.0
**Card Hash:** `77bbcbdab80a604d3161d0a898fd92e1832d258c7c91a41349a86a5d18f60065`
**VCF Asset:** `ghl-automations/data/runtime/montelli-scott-divinity-aligned.vcf`

## Owner-Approved Identity (2026-08-03)

| Field | Classification | Value | Status |
|-------|---------------|-------|--------|
| Full Name | OWNER_APPROVED | Montelli Scott | VERIFIED |
| Title | OWNER_APPROVED | Property Outreach | VERIFIED |
| Company | OWNER_APPROVED | Divinity Aligned LLC | VERIFIED |
| Phone | OWNER_APPROVED | +15716012619 | VERIFIED |
| Email | OWNER_APPROVED | montelliscottrei@gmail.com | VERIFIED |
| Website | OWNER_APPROVED | https://www.divinityaligned.net/ | VERIFIED |
| Headshot | OWNER_NOT_SUPPLIED | — | NOT INCLUDED |
| Business Address | OWNER_EXCLUDED | — | NOT INCLUDED |
| Logo | OWNER_EXCLUDED | — | NOT INCLUDED |
| Social Links | OWNER_EXCLUDED | — | NOT INCLUDED |
| Recent Closings | OWNER_NOT_SUPPLIED | — | NOT INCLUDED |

**Owner decisions (2026-08-03):**
- Do not use CEO, Co-Founder, Chief Investment Officer, Acquisitions, or any other executive title.
- Do not use Prolific Capital on this contact card.
- Do not use Kayla's email.
- Do not use the website's 513 number.
- Do not include a street address.
- Do not invent a logo, photo, social profile, or additional field.
- "Property Outreach" is the final approved title because it covers both listing-agent outreach and future off-market seller outreach without implying underwriting or negotiation authority.

## Current Card

The card contains 7 fields (FN, N, ORG, TITLE, TEL, EMAIL, URL). All fields are owner-approved. No fields are missing. The card is ready for self-test and production use.

## VCF Format

- Version: 3.0
- MIME: text/vcard
- Delivery: MMS attachment via JustCall (both numbers support MMS)
- Recipient can tap "Add Contact" on Android and iPhone

## States

| State | Meaning |
|-------|---------|
| CCC_TEXT_REQUIRED | CCC text shortcut not yet sent after qualifying call |
| CCC_TEXT_SENT | CCC text shortcut sent |
| CONTACT_CARD_REQUIRED | Contact card not yet sent after qualifying call |
| CONTACT_CARD_SENT | Contact card sent and delivery confirmed |
| CONTACT_CARD_FAILED | Contact card delivery failed |
| CONTACT_CARD_UNCERTAIN | Contact card delivery status unknown |

## Rules

- CCC_TEXT_SENT does NOT satisfy CONTACT_CARD_SENT
- A plain text message is not a contact card
- Contact card delivery requires explicit operator approval
- No automatic retry after uncertain result
- Missing optional fields do NOT block the card
- No fields are currently missing; card is production-ready

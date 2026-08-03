# Montelli Contact Card Specification

**Version:** 1.0.0
**Card Hash:** `c566de3c5f7cad1f1490981b5dc91613aee05f786f47a731541a7dbf06e813e3`
**VCF Asset:** `ghl-automations/data/runtime/montelli-scott-prolific-capital.vcf`

## Course Requirements

The Kayla course explicitly requires the contact card to contain:

| Field | Classification | Value | Status |
|-------|---------------|-------|--------|
| Full Name | COURSE_EXPLICIT_REQUIRED | Montelli Scott | VERIFIED |
| Title | COURSE_EXPLICIT_REQUIRED | Real Estate Investor \| Multifamily | VERIFIED |
| Company | COURSE_EXPLICIT_REQUIRED | Prolific Capital | VERIFIED |
| Phone | COURSE_EXPLICIT_REQUIRED | +15716012619 | VERIFIED |
| Email | COURSE_VISIBLE_IN_EXAMPLE | montelliscottrei@gmail.com | VERIFIED |
| Headshot | COURSE_EXPLICIT_REQUIRED | — | MISSING |
| Recent Closings | COURSE_EXPLICIT_REQUIRED | — | MISSING |
| Website | COURSE_VISIBLE_IN_EXAMPLE | — | OPTIONAL |
| Business Address | COURSE_UNKNOWN | — | OPTIONAL |
| Logo | COURSE_UNKNOWN | — | OPTIONAL |
| Social Links | COURSE_UNKNOWN | — | OPTIONAL |

**Course sources:**
- `AIREI_MASTER_PLAYBOOK.md:18` — "Set up contact card on phone with headshot"
- `AIREI_MASTER_PLAYBOOK.md:19-27` — Recent closings in notes section
- `AIREI_MASTER_PLAYBOOK.md:8-17` — Email signature format (name, title, company, phone, website)
- `AIREI_MASTER_PLAYBOOK.md:373` — "first name + company name + property address"
- `KAYLA_COACHING_REFERENCE.md:30-31` — "Sends contact card + website (credibility)"

## Current Card

The minimum verified card contains 6 fields (FN, N, ORG, TITLE, TEL, EMAIL). It is functional for self-testing. Two COURSE_EXPLICIT_REQUIRED fields are missing (headshot, recent closings) and must be supplied by the owner before production use.

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
- Missing COURSE_EXPLICIT_REQUIRED fields block production use but not self-testing

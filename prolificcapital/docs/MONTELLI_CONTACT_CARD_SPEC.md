# Montelli Contact Card Specification

**Version:** 1.0.0
**Owner:** Montelli Scott
**Company:** Prolific Capital

## Purpose

After every completed call, the Kayla course requires sending a contact card (CCC — Call Complete Confirmation). This is separate from the CCC text shortcut. The contact card is an actual shareable contact asset (VCF/vCard) that the recipient can tap to save Montelli's contact information.

## Field Matrix

| Field | Current Verified Value | Source | Required | Missing | Owner Confirmation |
|-------|----------------------|--------|----------|---------|-------------------|
| Full Name | Montelli Scott | secrets/.env, JustCall user | Yes | No | — |
| Title | CEO & Co-Founder | docs (Team Biographies) | Yes | No | — |
| Company | Prolific Capital | secrets/.env, JustCall | Yes | No | — |
| Primary Phone | +1 (571) 601-2619 | JustCall phone-numbers | Yes | No | — |
| Email | montelliscottrei@gmail.com | secrets/.env, JustCall user | Yes | No | — |
| Website | — | — | No | Yes | REQUIRED |
| Business Address | — | — | No | Yes | REQUIRED |
| Logo/Photo | — | — | No | Yes | REQUIRED |
| Social Links | — | — | No | Yes | OPTIONAL |
| Notes/Description | Real estate investment — creative financing, subject-to, cash offers | Course context | No | No | — |

## Delivery Method

**Selected:** VCF/vCard as MMS attachment via JustCall.

JustCall supports MMS on both numbers (571-601-2619 and 904-447-2520). A standards-compliant VCF file can be attached as MMS media. The recipient can tap "Add Contact" on both Android and iPhone.

## Course Alignment

- **CCC text:** Sent after every completed call (COURSE_EXPLICIT). Contains the closings/website wording.
- **Contact card:** Sent after every completed call (COURSE_EXPLICIT). A separate asset from the CCC text.
- **Timing:** Both CCC text and contact card are sent after a qualifying completed call, before advancing to Stage 2.

## States

| State | Meaning |
|-------|---------|
| CCC_TEXT_REQUIRED | CCC text shortcut has not been sent after a completed call |
| CCC_TEXT_SENT | CCC text shortcut has been sent |
| CONTACT_CARD_REQUIRED | Contact card has not been sent after a completed call |
| CONTACT_CARD_SENT | Contact card has been sent and delivery confirmed |
| CONTACT_CARD_FAILED | Contact card delivery failed |
| CONTACT_CARD_UNCERTAIN | Contact card delivery status unknown |

## Rules

- CCC_TEXT_SENT alone does NOT satisfy CONTACT_CARD_SENT
- A plain text message is not a contact card
- Contact card delivery requires explicit operator approval
- No automatic retry after uncertain result
- Missing owner information blocks contact card readiness but does NOT block the INT-only canary

## Asset Hosting

The VCF file should be generated from verified owner information and stored in a runtime configuration directory. It must not be committed to public Git history with personal PII.

## Update Procedure

1. Owner provides missing fields (website, business address, logo/photo)
2. VCF file is regenerated with complete information
3. Card hash is updated
4. Contact card readiness transitions from BLOCKED to READY

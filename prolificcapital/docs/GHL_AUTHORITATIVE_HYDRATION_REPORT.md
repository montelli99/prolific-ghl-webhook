# GHL Authoritative Hydration Report

**Generated:** 2026-08-02T12:40:36.361Z
**Status:** GHL_HYDRATION_COMPLETE
**Hydration duration:** 56 seconds
**Total opportunities hydrated:** 213

## Executive Summary

A hydration defect was identified in the previous pipeline scanner: the contact endpoint returns `{ contact: {...}, traceId }`, but the hydrator assigned the entire response body to the contact variable and read properties from the wrapper. This caused every contact to serialize as `{}` and 207 production opportunities to be misclassified as UNKNOWN.

This report documents the rebuilt authoritative hydration pipeline, the API endpoint capability matrix, the completeness of hydration, and the corrected opportunity classification.

## Endpoint Matrix

| Endpoint | Purpose | Supported Fields | Unsupported Fields | Notes |
|---|---|---|---|---|
| GET /opportunities/search | List opportunities in a pipeline | opportunity.id, opportunity.name, opportunity.monetaryValue, opportunity.pipelineId, opportunity.pipelineStageId, opportunity.pipelineStageUId, opportunity.assignedTo, opportunity.status, opportunity.source, opportunity.lastStatusChangeAt, opportunity.lastStageChangeAt, opportunity.createdAt, opportunity.updatedAt, opportunity.forecastProbability, opportunity.effectiveProbability, opportunity.contactId, opportunity.locationId, opportunity.customFields, opportunity.lostReasonId, opportunity.followers, opportunity.relations, opportunity.contact {id, name, companyName, email, phone, tags, score}, opportunity.sort, opportunity.attributions | opportunity.internalSource, opportunity.isAttribute, opportunity.lastActionDate | Returns complete custom fields and a contact summary object. Does not return full contact tags metadata or internalSource. |
| GET /opportunities/{id} | Read a single opportunity | opportunity.id, opportunity.name, opportunity.monetaryValue, opportunity.pipelineId, opportunity.pipelineStageId, opportunity.assignedTo, opportunity.status, opportunity.lastStatusChangeAt, opportunity.lastStageChangeAt, opportunity.createdAt, opportunity.updatedAt, opportunity.contactId, opportunity.isAttribute, opportunity.internalSource {type, id, apiVersion, channel, source}, opportunity.locationId, opportunity.lastActionDate, opportunity.followers, opportunity.contact {id, name, email, phone, tags} | opportunity.customFields are present but may differ in shape; verified present | Authoritative source for created/updated timestamps and internalSource. |
| GET /contacts/{id} | Read a single contact | contact.id, contact.dateAdded, contact.dateUpdated, contact.tags, contact.type, contact.locationId, contact.firstName, contact.lastName, contact.email, contact.phone, contact.country, contact.createdBy, contact.followers, contact.customFields, contact.additionalEmails, contact.additionalPhones |  | Returns full contact details including tags, additional emails/phones, and custom fields. |
| GET /contacts/{id}/notes | Read contact notes | notes[].id, notes[].body, notes[].createdBy, notes[].dateAdded, notes[].contactId |  | Available and returns notes array. |
| GET /opportunities/{id}/notes | Read opportunity-specific notes |  | all | Returns 404 Not Found. Opportunity notes are not exposed on a separate endpoint; they appear to be stored on the contact timeline. |
| GET /contacts/{id}/tasks | Read contact tasks |  | all | Returns 404. Task endpoint path is not supported with this token or does not exist at this path. |
| GET /contacts/{id}/timeline | Read contact timeline / activity |  | all | Returns 404. Timeline endpoint not available at this path with this token. |
| GET /contacts/{id}/conversations | Read contact conversations |  | all | Returns 404. Conversations endpoint not available at this path with this token. |

## Hydration Completeness

| Data Source | Status | Coverage |
|---|---|---|
| Opportunity list (search) | AVAILABLE | 100% — all 213 opportunities returned with custom fields and contact summary |
| Opportunity direct GET | AVAILABLE | 100% — direct read succeeded for all 213 opportunities |
| Contact direct GET | AVAILABLE | 100% — direct read succeeded for all linked contacts |
| Contact notes | AVAILABLE | 100% — endpoint returned notes for contacts that have them |
| Opportunity notes | API_NOT_SUPPORTED | Endpoint returns 404; notes appear to live on contact timeline |
| Contact tasks | API_NOT_SUPPORTED | Endpoint returns 404 at this path |
| Contact timeline | API_NOT_SUPPORTED | Endpoint returns 404 at this path |
| Contact conversations | API_NOT_SUPPORTED | Endpoint returns 404 at this path |

## Observed Search Response Fields

- id
- name
- monetaryValue
- pipelineId
- pipelineStageId
- pipelineStageUId
- assignedTo
- status
- source
- lastStatusChangeAt
- lastStageChangeAt
- createdAt
- updatedAt
- forecastProbability
- effectiveProbability
- contactId
- locationId
- customFields
- lostReasonId
- followers
- relations
- contact
- sort
- attributions

## Observed Contact Keys in Search Response

- id
- name
- companyName
- email
- phone
- tags
- score

## Observed Custom Field IDs in Search Response

- 04ZDfCUio59HYRtaXp84
- 6oDNJgfuKflDgS0fPsuz
- 7Qk4VP3Uvi7W3NViBHxM
- 99d9lvtzQelTxcSxBgL1
- 9TrSain4Y6OB60Nvi7B3
- 9f50Xt7Uw8rdDRY0oWDi
- AQpmT5bILW6RrCJj8WIw
- BF27QFffcBYyFicATmQG
- DebNF41orJXBk778HHIn
- FP9PrUN1rudLi4IEw1mo
- HNjy4oAdFEUNAsxpvt5o
- IeSrwyB7Qw6QBMAmhc6Y
- JzvYZ6sEP9Y8dLrip7KQ
- N9k8B1Eb9yCVY9t18X99
- R0yVRrmzWRuYbZvLqmuQ
- UsBUF2NyOiPwPBzs9zbA
- bNUaLqPpKB2IY7nMx1Gh
- e42a8Riv9ljjd96nsYth
- i6woEmjcZmzVx0tM6mRj
- k198PybZpHpw7xvJyShQ
- Qdh4R86kMwHbsmxcM3ub

## Classification Summary

| Classification | Count |
|---|---|
| PRODUCTION | 206 |
| LIVE_WALK | 3 |
| LEGACY_TEST | 4 |
| SIMULATION | 0 |
| QA | 0 |
| DEMO | 0 |
| SANDBOX | 0 |
| UNKNOWN | 0 |

- **Production opportunities:** 206
- **Non-production or unknown opportunities:** 7
- **Unknown count:** 0
- **Expected unknown count after hydration:** 0

## Non-Production / Unknown Records

| Opportunity ID | Property | Stage | Classification | Confidence | Recommended Action | Evidence |
|---|---|---|---|---|---|---|
| DnrmcPqxpxeJNwPE2NNc | Montelli Workflow E2E Test - DO NOT CONTACT | Lead Entered | LEGACY_TEST | HIGH | ARCHIVE | opportunity name contains test marker: "Montelli Workflow E2E Test - DO NOT CONTACT" |
| ZHy1Qb0E0QopO0CYjbSm | Webhook Smoke 1780932634783 | Lead Entered | LEGACY_TEST | HIGH | ARCHIVE | opportunity name contains test marker: "Webhook Smoke 1780932634783" |
| HTQjWRoMarAye3GBPCQh | 11411 Huggins St, Leesburg FL 34788 | Offer Ready | LIVE_WALK | HIGH | ARCHIVE | address matches known live-walk/test address: 11411 Huggins St, Leesburg FL 34788 |
| U3WVG53dtszGHMU8E54a | 11411 Huggins St, Leesburg FL 34788 | Offer Ready | LIVE_WALK | HIGH | ARCHIVE | address matches known live-walk/test address: 11411 Huggins St, Leesburg FL 34788 |
| uDUfpVFUpZiFs4MmOX55 | 11411 Huggins St, Leesburg FL 34788 | Lead Entered | LIVE_WALK | HIGH | ARCHIVE | address matches known live-walk/test address: 11411 Huggins St, Leesburg FL 34788 |
| X8JdlmCz8KDrJwZTWzfX | Atlas Field Test 1780843380662 | Lead Entered | LEGACY_TEST | HIGH | ARCHIVE | opportunity name contains test marker: "Atlas Field Test 1780843380662" |
| 292Uk9yASN9CUIfDn1Wx | Atlas Field Test 1780843355022 | Lead Entered | LEGACY_TEST | HIGH | ARCHIVE | opportunity name contains test marker: "Atlas Field Test 1780843355022" |

## Defect Root Cause

Previous hydrator code:
```js
contact = await client.transport({ url: `.../contacts/${contactId}` }).then(r => r.body);
// r.body is { contact: {...}, traceId }
// contact.firstName, contact.lastName, etc. are all undefined
```

Correct pattern:
```js
const response = await ghRequest(`/contacts/${contactId}`);
const contact = response.body.contact || {};
```

## Conclusion

The GHL API returns all data required to classify opportunities correctly. The previous UNKNOWN count of 207 was entirely caused by the hydrator bug. After correction, 206 opportunities are confirmed production (Atlas-imported), 7 are confirmed non-production test/live-walk artifacts, and 0 remain genuinely unclassified (pre-Atlas records with no markers).

**Final return code: GHL_HYDRATION_COMPLETE**

## Production Effects

- sends: 0
- GHL writes: 0
- stage movements: 0

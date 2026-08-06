'use strict';

const RECIPIENT_TYPES = Object.freeze({
  PERSON: 'PERSON',
  TEAM: 'TEAM',
  BROKERAGE: 'BROKERAGE',
  COMPANY: 'COMPANY',
  LLC: 'LLC',
  TRUST: 'TRUST',
  ESTATE: 'ESTATE',
  GOVERNMENT: 'GOVERNMENT',
  UNKNOWN: 'UNKNOWN',
});

const ORG_INDICATORS = [
  /\bTEAM\b/i, /\bGROUP\b/i, /\bREALTY\b/i, /\bREAL\s+ESTATE\b/i,
  /\bBROKERAGE\b/i, /\bPROPERTIES\b/i, /\bPROPERTY\s+GROUP\b/i,
  /\bHOMES\b/i, /\bHOME\s+TEAM\b/i, /\bLLC\b/i, /\bINC\b/i, /\bCORP\b/i,
  /\bCORPORATION\b/i, /\bCOMPANY\b/i, /\bCO\.\b/i, /\bPARTNERS\b/i,
  /\bASSOCIATES\b/i, /\bRESOURCES\b/i, /\bSOLUTIONS\b/i,
  /\bINVESTMENTS\b/i, /\bCAPITAL\b/i, /\bHOLDINGS\b/i,
  /\bTRUST\b/i, /\bESTATE\b/i, /\bMANAGEMENT\b/i, /\bSERVICES\b/i,
  /\bENTERPRISES\b/i, /\bVENTURES\b/i, /\bDEVELOPMENT\b/i,
  /\bCONSULTING\b/i, /\bADVISORS\b/i, /\bAGENCY\b/i,
];

const TEAM_INDICATORS = [/\bTEAM\b/i, /\bHOME\s+TEAM\b/i, /\bPROPERTY\s+GROUP\b/i];
const BROKERAGE_INDICATORS = [/\bREALTY\b/i, /\bREAL\s+ESTATE\b/i, /\bBROKERAGE\b/i, /\bHOMES\b/i, /\bPROPERTIES\b/i, /\bAGENCY\b/i];
const LLC_INDICATORS = [/\bLLC\b/i];
const TRUST_INDICATORS = [/\bTRUST\b/i];
const ESTATE_INDICATORS = [/\bESTATE\b/i];
const GOV_INDICATORS = [/\bCITY\s+OF\b/i, /\bCOUNTY\s+OF\b/i, /\bSTATE\s+OF\b/i, /\bGOVERNMENT\b/i, /\bHOUSING\s+AUTHORITY\b/i, /\bMUNICIPAL\b/i];

function classifyRecipient(contact) {
  const name = (contact.contactName || '').trim();
  const firstName = (contact.firstName || '').trim();
  const lastName = (contact.lastName || '').trim();
  const company = (contact.company || contact.organization || '').trim();
  const role = (contact.contactRole || contact.role || '').trim();
  const type = (contact.type || contact.contactType || '').trim();

  const evidence = [];
  let confidence = 'HIGH';

  const hasOrgInName = ORG_INDICATORS.some(r => r.test(name));

  if (firstName && lastName && firstName.split(/\s+/).length === 1) {
    const fullName = (firstName + ' ' + lastName).trim();
    if ((fullName === name || name.startsWith(firstName)) && !hasOrgInName) {
      return {
        recipientType: RECIPIENT_TYPES.PERSON,
        confidence: 'HIGH',
        evidence: [{ source: 'structured_name', firstName, lastName }],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  if (firstName && !lastName && firstName.split(/\s+/).length === 1) {
    const hasOrgIndicator = ORG_INDICATORS.some(r => r.test(name));
    if (!hasOrgIndicator) {
      return {
        recipientType: RECIPIENT_TYPES.PERSON,
        confidence: 'MEDIUM',
        evidence: [{ source: 'first_name_only', firstName }],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  if (company && company !== name) {
    evidence.push({ source: 'separate_company_field', company });
  }

  for (const re of TEAM_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.TEAM,
        confidence: 'HIGH',
        evidence: [{ source: 'name_pattern', pattern: 'TEAM_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  for (const re of LLC_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.LLC,
        confidence: 'HIGH',
        evidence: [{ source: 'name_pattern', pattern: 'LLC_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  for (const re of TRUST_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.TRUST,
        confidence: 'HIGH',
        evidence: [{ source: 'name_pattern', pattern: 'TRUST_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  for (const re of ESTATE_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.ESTATE,
        confidence: 'MEDIUM',
        evidence: [{ source: 'name_pattern', pattern: 'ESTATE_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  for (const re of GOV_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.GOVERNMENT,
        confidence: 'HIGH',
        evidence: [{ source: 'name_pattern', pattern: 'GOV_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  for (const re of BROKERAGE_INDICATORS) {
    if (re.test(name)) {
      return {
        recipientType: RECIPIENT_TYPES.BROKERAGE,
        confidence: 'HIGH',
        evidence: [{ source: 'name_pattern', pattern: 'BROKERAGE_INDICATOR', matched: name.match(re)?.[0] }, ...evidence],
        sourceFields: { firstName, lastName, company, role },
      };
    }
  }

  if (hasOrgInName) {
    return {
      recipientType: RECIPIENT_TYPES.COMPANY,
      confidence: 'MEDIUM',
      evidence: [{ source: 'name_pattern', pattern: 'ORG_INDICATOR', matched: name }, ...evidence],
      sourceFields: { firstName, lastName, company, role },
    };
  }

  if (firstName && lastName) {
    return {
      recipientType: RECIPIENT_TYPES.PERSON,
      confidence: 'LOW',
      evidence: [{ source: 'has_first_and_last', firstName, lastName }, ...evidence],
      sourceFields: { firstName, lastName, company, role },
    };
  }

  const nameWords = name.split(/\s+/).filter(w => w.length > 0);
  if (nameWords.length >= 2 && nameWords.length <= 3 && !hasOrgInName) {
    return {
      recipientType: RECIPIENT_TYPES.PERSON,
      confidence: 'LOW',
      evidence: [{ source: 'name_looks_like_person', name }, ...evidence],
      sourceFields: { firstName, lastName, company, role },
    };
  }

  return {
    recipientType: RECIPIENT_TYPES.UNKNOWN,
    confidence: 'LOW',
    evidence: [{ source: 'no_classification_match' }, ...evidence],
    sourceFields: { firstName, lastName, company, role },
  };
}

module.exports = { RECIPIENT_TYPES, classifyRecipient };

# Atlas Exception Queue Current

Generated: 2026-07-30T20:31:01.649Z

Source artifact: `lead-tracking/atlas-deals/reconciliations/atlas-blocked-rows-69-217-273-final-disposition-eac14b494825.json`
Source hash: `eac14b494825e050ccaffe8a8ad10bf41a685a9e7c0761002b861472ef7bb384`

| Row | State | Classification | Source Name | Phone | Email | Candidate Contacts | Candidate Opportunities | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `import-ready:69` | `OPEN_SOURCE_DATA_CONFLICT` | `SOURCE_DATA_CONFLICT` | Jill Smisek | (214) 202-7615 | txbroker@therealbrokerage.com | vikcBqKuhkZsI4BvVA9Z | none | keep excluded until corrected source identity is supplied |
| `import-ready:217` | `OPEN_IDENTITY_AMBIGUITY` | `PERMANENT_IDENTITY_AMBIGUITY` | Steven Koleno | (804) 656-5007 | contact@beycome.com | x5ul9LVmA0VfovTXiLIT, qY89ZfUrPowQ9GfpsdRW | none | keep excluded until source-backed identity evidence selects exactly one contact |
| `import-ready:273` | `OPEN_IDENTITY_AMBIGUITY` | `PERMANENT_IDENTITY_AMBIGUITY` | Candy Hernandez | (972) 849-3414 |  | KyeQjferUuFVy684p9gb, ufuQ5dK0qbZlAmaad9RT | none | keep excluded until source-backed identity evidence selects exactly one contact |

## Details

### import-ready:69

- Raw address: 706 Goodyear St, Irving TX 75062
- Normalized address: 706goodyearst|irving|tx|75062
- Source property ID: https://propwire.com/realestate/706-Goodyear-St/154344705/mls-listing
- Conflicting data: historical row-69 reconciliation/remediation evidence records contact identity conflict/source identity defect; prior incorrectly linked opportunity was remediated separately and the source identity remains defective
- Missing evidence: corrected source identity from the data provider or operator-owned source, followed by fresh contact and opportunity duplicate preflight
- Safe resolution requirements: corrected source identity from the data provider or operator-owned source, followed by fresh contact and opportunity duplicate preflight
- May be reconsidered: yes

### import-ready:217

- Raw address: 3506 N 12th St, Tampa FL 33605
- Normalized address: 3506n12thst|tampa|fl|33605
- Source property ID: https://propwire.com/realestate/3506-N-12th-St/3714122/mls-listing
- Conflicting data: multiple credible contact candidates; no deterministic source-backed selector
- Missing evidence: source-backed corrected listing-agent identity with exact person-level phone/email, plus duplicate-free preflight
- Safe resolution requirements: source-backed corrected listing-agent identity with exact person-level phone/email, plus duplicate-free preflight
- May be reconsidered: yes

### import-ready:273

- Raw address: 3311 Bremond St, Houston TX 77004
- Normalized address: 3311bremondst|houston|tx|77004
- Source property ID: https://propwire.com/realestate/3311-Bremond-St/44487857/mls-listing
- Conflicting data: multiple credible contact candidates; no deterministic source-backed selector
- Missing evidence: source-backed corrected listing-agent identity with exact person-level phone/email, plus duplicate-free preflight
- Safe resolution requirements: source-backed corrected listing-agent identity with exact person-level phone/email, plus duplicate-free preflight
- May be reconsidered: yes


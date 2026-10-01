# P1–P8 Premise Evidence Register

This register records only auditable metadata; it does not copy genuine certificates, warehouse receipts, personal data, or confidential originals. Originals must be held by Legal/Business in a controlled evidence repository. Until records with authorized review exist, Stage F remains `PENDING-GATE`.

| ID | Premise | Evidence registration status | Owner | Review cycle | Stage F status |
| --- | --- | --- | --- | --- | --- |
| P1 | Cultural-property registry chain and owner records | Awaiting Legal entry of document hash, issuer, issue/collection dates | Legal | Annual | `PENDING-GATE` |
| P2 | Regulatory/judicial-chain linkage and court evidence admissibility boundary | Awaiting Legal entry of normative documents and applicable cases/rules | Legal | Annual | `PENDING-GATE` |
| P3 | Operating role of Zhongchuang Wenmao | Awaiting entity documents and authorization chain | Legal | Annual | `PENDING-GATE` |
| P4 | Equity, operations, warehousing, and approved import/export qualifications | Awaiting corporate registry, qualifications, and approvals | Legal | Annual | `PENDING-GATE` |
| P5 | Warehouse receipt includes registry reference and hash | Awaiting product/authority-signed data dictionary and synthetic example | Product | Semiannual | `PENDING-GATE` |
| P6 | One asset, one certificate, one token, and exclusive redemption rights | Technical gate exists; awaiting business/legal rights text | Product/Legal | Semiannual | `PENDING-GATE` |
| P7 | T+0 snapshot, T+3 change, revocation, and re-signing workflow | State machine and synthetic tests exist; awaiting signed SLA/business calendar | Product/Legal | Semiannual | `PENDING-GATE` |
| P8 | Giraffe provides asset-fact verification only and isolates financial activity | Code/API/UI gates exist; awaiting formal contract and legal opinion | Legal | Annual | `PENDING-GATE` |

Each formal evidence record must include at least: `evidenceId`, file/registry name, issuing entity, issue date, collection date, SHA-256, logical custody reference, access level, review cycle, owner, review conclusion, and expiration date. Do not enter actual server paths, credentials, or personal identity fields in this repository.

## Read-only preliminary review of existing materials (not formal confirmation)

On 2026-08-25, a read-only preliminary review was conducted of the business-provided “Introduction to Zhongchuang Wenmao (Beijing) Cultural Relics & Art Co., Ltd.” The original was not copied into the repository. SHA-256: `009e5423b0e592465182c753eca0b5eb581ca7a41361b5036d34b34f878020c5`. This is an institutional introduction, not a government registry, license, court judgment, or competent-authority certificate. It may only be recorded as candidate evidence:

| Premise | Observable content in the material | Formal evidence still missing | Preliminary conclusion |
| --- | --- | --- | --- |
| P1 | Pages 9–11 describe the China Cultural Relics Preservation Chain, blockchain record-keeping, registration/ownership confirmation, standardized registration fields, and a sample digital registration certificate | Authoritative data dictionary, registry rules, owner-field rules, and formal samples | `PARTIAL-EVIDENCE` |
| P2 | Page 13 describes a joint “Evidence Chain” pilot and evidence collection, notarization, and preservation workflows | Competent-authority documents, judicial-chain technical/legal contract, admissibility rules or judgments; the material cannot prove all regulatory relationships stated by the user | `PARTIAL-EVIDENCE` |
| P3 | Pages 9 and 14 describe the China Cultural Relics Preservation Chain as managed/operated by Zhongchuang Wenmao and describe its development, operating, and agency roles | Valid authorization from China Cultural Relics Exchange Center or another relevant rights holder | `PARTIAL-EVIDENCE` |
| P4 | Page 4 describes Zhongchuang Wenmao as established by China Cultural Relics Exchange Center and wholly state-owned | Corporate registry records, complete equity chain, cultural-property trading/warehousing qualifications, and approved import/export licenses; an introduction cannot replace a license | `PARTIAL-EVIDENCE` |
| P5 | Pages 10–11 show a blockchain certificate and concepts for hashes/registry information | Warehouse-receipt data dictionary, warehouse issuance rules, and formal samples binding receipts to registry hashes | `PARTIAL-EVIDENCE` |

The “Pitch Deck - Chainart Registry And Compliance Layer” has SHA-256 `d24c915e983a9425d3b526dba34e5e7d406228943e190d8917d91829db8b050f`; it is a product-concept reference only, not independent factual evidence or legal authority for P1–P8. This preliminary review must not generate `evidence/acceptance/premise-evidence.json`; gates can be cleared only after Legal reviews and signs off on each controlled original.

## Candidate official public sources (read-only research, 2026-08-25)

The following public sources may be used for cross-checking a Legal evidence package. They do not independently prove licenses, equity, asset ownership, or admissibility in a specific case:

- China Intellectual Property Protection Network (a Ministry of Commerce IP public-service source) reports a registration pilot by the Shanghai Intellectual Property Office and China Cultural Relics Exchange Center, and describes the China Cultural Relics Preservation Chain as built by that Center for cultural data registration and management: `https://ipr.mofcom.gov.cn/article/gnxw/zfbm/zfbmdf/sh/202602/1995149.html`;
- Capital Civilization Network reports strategic cooperation between “Evidence Chain” and the China Cultural Relics Preservation Chain and digital cultural-relic outcomes. This supports the limited fact that judicial evidence-preservation cooperation exists; it does not establish prior admissibility of arbitrary preservation-chain records by an Internet court: `https://www.bjwmb.gov.cn/yw/10048173.html`;
- Supreme People’s Court public materials confirm the judicial-chain platform and online verification application but do not establish in that material that the China Cultural Relics Preservation Chain is connected or its records are automatically admissible: `https://www.court.gov.cn/zixun/xiangqing/384671.html`;
- The Supreme People’s Court “Provisions on the Jurisdiction of Internet Courts” can be used to check jurisdictional boundaries for disputes involving network data and virtual property; it is not case-specific recognition of this project or the preservation-chain evidence: `https://www.court.gov.cn/zixun/xiangqing/478291.html`.

Accordingly, P1’s limited premises (“the platform exists and is used for registration”) and P2’s limited premises (“Evidence Chain cooperation / general judicial-chain capability”) receive partial cross-checking from official public sources. P2’s full regulatory-entity name, formal connection between the preservation chain and judicial chain, and court-admissibility boundary, as well as P3 operating authority and P4 equity/all licenses, still require formal originals and legal opinion.

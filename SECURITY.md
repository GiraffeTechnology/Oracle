# Security policy

Report suspected vulnerabilities privately to the repository administrators. Do not place secrets,
personal information, certificate originals, warehouse documents or exploit data in public issues.

This repository must not receive private keys, seed phrases, passwords, source-system credentials,
production database addresses or identity mappings. Synthetic test keys are generated in memory and are
not persisted.

Production mode remains fail-closed unless the controlled host supplies an exact SHA-256-pinned deployment
module and the separate production/write acknowledgements. This technical path is not Stage F authorization.

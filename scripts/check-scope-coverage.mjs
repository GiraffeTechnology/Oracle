#!/usr/bin/env node
/**
 * Automates the scope-coverage audit in ACCEPTANCE_RWA_ORACLE_ZH.md section 8.4: every
 * requirement ID in the PRD must have a row in the acceptance matrix, and every matrix row
 * must correspond to a PRD requirement. An ID on only one side is an audit failure.
 *
 * Also checks that requirement numbering has no gaps, the defect v0.3 states it fixed, and
 * that ORACLE-009 is a Giraffe obligation rather than a downstream constraint (section 8.6).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const prd = await readFile(resolve(root, 'docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md'), 'utf8');
const acceptance = await readFile(resolve(root, 'docs/ACCEPTANCE_RWA_ORACLE_ZH.md'), 'utf8');

const failures = [];

const prdIds = new Set([...prd.matchAll(/^### ((?:ORACLE|CONSUMER|NFR)-\d+)/gm)].map((m) => m[1]));
const matrixIds = new Set(
  [...acceptance.matchAll(/^\| ((?:ORACLE|CONSUMER|NFR)-\d+) \|/gm)].map((m) => m[1]),
);

const onlyPrd = [...prdIds].filter((id) => !matrixIds.has(id)).sort();
const onlyMatrix = [...matrixIds].filter((id) => !prdIds.has(id)).sort();

if (onlyPrd.length > 0) failures.push(`no acceptance row for: ${onlyPrd.join(', ')}`);
if (onlyMatrix.length > 0)
  failures.push(`acceptance row without a PRD requirement: ${onlyMatrix.join(', ')}`);
if (prdIds.size === 0)
  failures.push('no requirement IDs parsed from the PRD; the check would pass vacuously');

for (const prefix of ['ORACLE', 'CONSUMER', 'NFR']) {
  const numbers = [...prdIds]
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.split('-')[1]))
    .sort((a, b) => a - b);
  if (numbers.length === 0) continue;
  const gaps = [];
  for (let n = 1; n <= numbers[numbers.length - 1]; n += 1) {
    if (!numbers.includes(n)) gaps.push(`${prefix}-${String(n).padStart(3, '0')}`);
  }
  if (gaps.length > 0) failures.push(`${prefix} numbering has gaps: ${gaps.join(', ')}`);
  process.stdout.write(`  ${prefix}: ${numbers.length} requirements, no numbering gap\n`);
}

// Section 8.6: ORACLE-009 is Giraffe's own obligation and must sit in the L2 section.
const oracleSection = prd.slice(
  prd.indexOf('## 6. L2 验证层需求'),
  prd.indexOf('## 7. 下游协议消费约束'),
);
if (!oracleSection.includes('### ORACLE-009')) {
  failures.push('ORACLE-009 is not in the L2 section; acceptance section 8.6 fails the audit');
}

process.stdout.write(`  scope coverage: ${prdIds.size} PRD IDs, ${matrixIds.size} matrix rows\n`);

if (failures.length > 0) {
  process.stderr.write('Scope coverage failed (acceptance section 8.4/8.6):\n');
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  'Scope coverage verified: PRD and acceptance matrix agree in both directions.\n',
);

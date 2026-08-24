/**
 * Guards the constants that `docs/erc/` publishes as frozen.
 *
 * Every value below is re-derived from the archived specification text rather than trusted:
 * interface IDs are recomputed selector by selector, the EIP-712 canonical type strings are
 * compared between the specification and the reference implementation, and the SHA-256 values
 * recorded in the test report are recomputed from the archived files.
 *
 * This never compiles or runs Solidity. The ERC work belongs to a separate project
 * (PRD v0.2 section 0); the archive is reference material and this check only keeps it
 * internally consistent.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  formatSelector,
  functionSelector,
  interfaceId,
  parseInterfaceSignatures,
} from '../src/erc-constants.ts';

const ARCHIVE = resolve(import.meta.dirname, '..', 'docs', 'erc');
const CANDIDATE = 'ERC_SUBMISSION_CANDIDATE_EN.md';
const REPORT = 'PRE_SUBMISSION_TEST_REPORT_ZH.txt';
const REFERENCE = join('reference', 'VersionedRWACertificateReference.sol');

/** Frozen interface IDs. Changing either invalidates the archived test report. */
const FROZEN_INTERFACE_IDS: readonly (readonly [string, string])[] = [
  ['IVersionedRWACertificate', '0xebaa86a0'],
  ['IDeferredCertificateSettlement', '0x2773d4c9'],
];

/** ERC-8325 is a mandatory dependency of the proposal, so its ID is pinned too. */
const ERC8325_SIGNATURES = [
  'anchorIdOf(uint256)',
  'anchorRegistry()',
  'isAnchorActiveFor(uint256)',
];
const ERC8325_INTERFACE_ID = '0x4a967b01';

const EIP712_TYPES = ['SettlementAuthorization', 'CancellationAuthorization'];

/** Files whose SHA-256 the test report records; the paths are archive-relative. */
const HASHED_FILES: Record<string, string> = {
  'GIRAFFE_ERC_FORMAL_ZH.txt': 'GIRAFFE_ERC_FORMAL_ZH.txt',
  'GIRAFFE_ERC_FORMAL_EN.txt': 'GIRAFFE_ERC_FORMAL_EN.txt',
  'ERC_SUBMISSION_CANDIDATE_EN.md': CANDIDATE,
  'VersionedRWACertificateReference.sol': REFERENCE,
  'protocol.cjs': join('reference', 'protocol.cjs'),
};

const failures: string[] = [];

function check(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    process.stdout.write(`  ok   ${label}: ${actual}\n`);
    return;
  }
  failures.push(`${label}: expected ${expected}, derived ${actual}`);
  process.stdout.write(`  FAIL ${label}: expected ${expected}, derived ${actual}\n`);
}

function read(relativePath: string): string {
  return readFileSync(join(ARCHIVE, relativePath), 'utf8');
}

const candidate = read(CANDIDATE);
const reference = read(REFERENCE);
const report = read(REPORT);

process.stdout.write('interface IDs re-derived from the specification text\n');
const selectorOwners = new Map<string, string>();
for (const [name, expected] of FROZEN_INTERFACE_IDS) {
  const signatures = parseInterfaceSignatures(candidate, name);
  check(name, formatSelector(interfaceId(signatures)), expected);

  for (const signature of signatures) {
    const selector = formatSelector(functionSelector(signature));
    const owner = selectorOwners.get(selector);
    if (owner !== undefined && owner !== signature) {
      failures.push(`selector collision ${selector}: ${owner} vs ${signature}`);
      process.stdout.write(`  FAIL selector collision ${selector}: ${owner} vs ${signature}\n`);
    }
    selectorOwners.set(selector, signature);
  }
}
process.stdout.write(`  ok   no selector collision across ${selectorOwners.size} selectors\n`);

check(
  'ERC-8325 IAssetBoundTokenId',
  formatSelector(interfaceId(ERC8325_SIGNATURES)),
  ERC8325_INTERFACE_ID,
);

/**
 * The document also states these IDs in prose, in the interface sections and again in Test
 * Cases. Every stated ID must be one of the three derived values, so prose cannot drift away
 * from the ABI it describes.
 */
const derivedIds = new Set([...FROZEN_INTERFACE_IDS.map(([, id]) => id), ERC8325_INTERFACE_ID]);
const statedIds = [...candidate.matchAll(/interface ID is `(0x[0-9a-f]{8})`/g)].map((m) => m[1]!);
const unknownIds = statedIds.filter((id) => !derivedIds.has(id));
check('every ID stated in prose is derived', String(unknownIds.length), '0');
if (statedIds.length === 0) {
  failures.push('no interface ID is stated in prose; the guard would pass vacuously');
}
process.stdout.write(`  ok   ${statedIds.length} prose statements checked\n`);

process.stdout.write('\nEIP-712 canonical types: specification vs reference implementation\n');
for (const type of EIP712_TYPES) {
  const pattern = new RegExp(`${type}\\([^)]*\\)`);
  const inSpec = pattern.exec(candidate)?.[0];
  const inImpl = pattern.exec(reference)?.[0];
  if (inSpec === undefined || inImpl === undefined) {
    failures.push(`${type}: canonical type string missing from specification or reference`);
    process.stdout.write(`  FAIL ${type}: missing\n`);
    continue;
  }
  check(`${type} matches reference`, String(inSpec === inImpl), 'true');
}

process.stdout.write('\nSHA-256 recorded in the test report vs archived files\n');
const recorded = new Map<string, string>();
for (const match of report.matchAll(/([\w.]+\.(?:txt|md|sol|cjs))\s*\n\s*([0-9A-Fa-f]{64})/g)) {
  recorded.set(match[1]!, match[2]!.toLowerCase());
}
for (const [name, relativePath] of Object.entries(HASHED_FILES)) {
  const expected = recorded.get(name);
  if (expected === undefined) {
    failures.push(`${name}: no SHA-256 recorded in ${REPORT}`);
    process.stdout.write(`  FAIL ${name}: not recorded in the report\n`);
    continue;
  }
  const actual = createHash('sha256')
    .update(readFileSync(join(ARCHIVE, relativePath)))
    .digest('hex');
  check(name, actual, expected);
}

process.stdout.write('\n');
if (failures.length > 0) {
  process.stderr.write(`Frozen ERC constants drifted (${failures.length}):\n`);
  for (const failure of failures) {
    process.stderr.write(`  ${failure}\n`);
  }
  process.stderr.write(
    '\nThe archive under docs/erc/ is the record of a frozen ABI. If a change is intended,\n' +
      'refreeze deliberately: update the specification, the reference implementation and the\n' +
      'SHA-256 values in the test report together.\n',
  );
  process.exit(1);
}
process.stdout.write(
  'Frozen ERC constants verified: interface IDs, EIP-712 types and file hashes.\n',
);

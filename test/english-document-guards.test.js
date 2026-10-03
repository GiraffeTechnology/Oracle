import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DECISIONS = 'docs/DECISIONS_ZH.md';
const PRD = 'docs/PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md';
const BRIEF = 'docs/TESTNET_TASK_HOODI_ZH.md';
const ARCHIVE = 'docs/erc/README.md';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'oracle-english-guards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'docs/erc', 'config', 'src']) mkdirSync(path.join(root, directory), { recursive: true });
  for (const file of [DECISIONS, PRD, BRIEF, ARCHIVE, 'docs/ACCEPTANCE_RWA_ORACLE_ZH.md', 'config/iteration-acceptance.json', 'scripts/check-decision-consistency.mjs', 'scripts/check-scope-coverage.mjs']) copyFileSync(path.resolve(file), path.join(root, file));
  const run = (guard) => spawnSync(process.execPath, [path.join(root, 'scripts', guard)], { cwd: root, encoding: 'utf8', timeout: 10000 });
  const edit = (file, before, after) => {
    const full = path.join(root, file), text = readFileSync(full, 'utf8');
    assert.ok(text.includes(before), `negative fixture must change ${file}: ${before}`);
    writeFileSync(full, text.replace(before, after));
  };
  return { root, run, edit };
}

test('English decision and scope documents pass the existing constraints', (t) => {
  const f = fixture(t);
  for (const guard of ['check-decision-consistency.mjs', 'check-scope-coverage.mjs']) {
    const result = f.run(guard); assert.equal(result.status, 0, result.stderr);
  }
});

const clauses = [
  [DECISIONS, 'is the sole authoritative requirements document', 'is optional', /D-001/],
  [PRD, '| Version | v0.4 |', '| Version | v0.3 |', /D-001 names v0.4/],
  [DECISIONS, '**Hoodi is the preferred public-chain testnet**', '**Hoodi is optional**', /D-002/],
  [BRIEF, '| Target network | **Hoodi (chainId 560048)**; Sepolia is an optional rerun |', '| Target network | **Sepolia**; Hoodi (chainId 560048) is an optional rerun |', /does not name Hoodi first/],
  [DECISIONS, '**Hoodi is a test chain, not a production chain.**', 'Hoodi is a chain.', /required clause/],
  [DECISIONS, 'Passing Hoodi tests does **not** clear the written go/no-go', 'Passing Hoodi tests clears the written go/no-go', /required clause/],
  [BRIEF, '**Hoodi is a test chain, not a production chain.**', 'Hoodi is a chain.', /required clause/],
  [BRIEF, '**Do not deploy to mainnet or use real funds.**', 'Deployment is optional.', /required clause/],
  [BRIEF, '**Hoodi passing does not clear production gates**', 'Hoodi passing clears production gates', /required clause/],
  [DECISIONS, '**ArtFi is the agent for public-chain trading of the cultural-relic-chain registration product**', 'A consumer exists', /D-006/],
  [DECISIONS, '**Ordinary ERC-721 transfers are not blocked while registry processing is pending.**', 'Ordinary transfers may be blocked.', /D-008/],
  [PRD, 'The NFT must not be placed in protocol custody, a non-transferable state, or any equivalent transfer-blocking mechanism.', 'The NFT may be frozen.', /D-008/],
  [PRD, 'Right Classification: Deferrable and Perishable', 'Other Classification', /D-008/],
];
for (const [index, [file, before, after, message]] of clauses.entries()) {
  test(`English guard still rejects missing or contradictory clause ${index + 1}`, (t) => {
    const f = fixture(t); f.edit(file, before, after);
    const result = f.run('check-decision-consistency.mjs');
    assert.equal(result.status, 1, result.stdout); assert.match(result.stderr, message);
  });
}

test('English guard rejects a conflicting preferred network in another document', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'docs/conflict.md'), 'Sepolia is the preferred public-chain testnet; Hoodi is optional.\n');
  const result = f.run('check-decision-consistency.mjs');
  assert.equal(result.status, 1); assert.match(result.stderr, /conflict.md does not name Hoodi first/);
});

test('repository boundary still rejects consumer coupling and chain broadcasts', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'src/invalid.js'), 'const consumer = "ArtFi";\nconst method = "sendTransaction";\n');
  const result = f.run('check-decision-consistency.mjs');
  assert.equal(result.status, 1); assert.match(result.stderr, /ArtFi reference/); assert.match(result.stderr, /public-chain write path/);
});

test('scope guard still rejects moving ORACLE-009 out of the L2 section', (t) => {
  const f = fixture(t);
  const full = path.join(f.root, PRD), text = readFileSync(full, 'utf8');
  const section = text.match(/### ORACLE-009[\s\S]*?(?=### ORACLE-010)/)[0];
  writeFileSync(full, text.replace(section, '') + '\n' + section);
  const result = f.run('check-scope-coverage.mjs');
  assert.equal(result.status, 1); assert.match(result.stderr, /ORACLE-009 is not in the L2 section/);
});

test('scope guard still rejects a missing acceptance row', (t) => {
  const f = fixture(t), name = 'docs/ACCEPTANCE_RWA_ORACLE_ZH.md';
  const full = path.join(f.root, name), text = readFileSync(full, 'utf8');
  assert.match(text, /^\| ORACLE-009 \|/m);
  writeFileSync(full, text.replace(/^\| ORACLE-009 \|.*\n/m, ''));
  const result = f.run('check-scope-coverage.mjs');
  assert.equal(result.status, 1); assert.match(result.stderr, /no acceptance row for: ORACLE-009/);
});

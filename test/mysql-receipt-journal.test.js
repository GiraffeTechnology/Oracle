import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MySqlReceiptJournal } from '../src/adapters/mysql-receipt-journal.js';
import {
  MySqlTransactionError,
  getMySqlTransactionDiagnostics,
} from '../src/adapters/mysql-repository.js';
import { evidenceHash } from '../src/domain/canonical-json.js';
import { sqlFixture } from './fixtures/receipt-journal.mjs';

const hash = (byte) => `0x${byte.repeat(64)}`;
const TX = hash('a');
const BLOCK = hash('b');
const asHex = (value) => Buffer.from(value).toString('hex');

function intent(overrides = {}) {
  return {
    sourceId: 'synthetic-authority',
    schemaVersion: 'registration-receipt.v1',
    envelopeHash: hash('1').slice(2),
    idempotencyKey: 'synthetic-receipt-1',
    nonceHash: hash('2').slice(2),
    recordReference: 'synthetic-fixed-reference-1',
    registrationSource: 'REG_DIRECT',
    target: {
      chainId: '560048',
      contract: `0x${'cd'.repeat(20)}`,
      registerId: hash('3'),
      sourceAuthority: `0x${'ef'.repeat(20)}`,
    },
    tokenId: '1',
    expectedPreviousVersion: '0',
    previousCommitment: hash('0'),
    recordCommitment: hash('4'),
    registryReference: hash('5'),
    holder: `0x${'aa'.repeat(20)}`,
    effectiveAt: '1700000000',
    binding: {
      schemaId: hash('6'),
      mintPolicyHash: hash('7'),
      segmentDigest: hash('8'),
      requestHash: hash('9'),
      receiptDocumentHash: hash('c'),
    },
    ...overrides,
  };
}

function nextIntent(prior, overrides = {}) {
  return {
    ...prior,
    idempotencyKey: 'synthetic-receipt-2',
    nonceHash: hash('d').slice(2),
    envelopeHash: hash('e').slice(2),
    recordReference: 'synthetic-fixed-reference-2',
    expectedPreviousVersion: '1',
    previousCommitment: prior.recordCommitment,
    recordCommitment: hash('f'),
    effectiveAt: '1700000001',
    binding: { ...prior.binding, segmentDigest: hash('d') },
    ...overrides,
  };
}

function domainFailure(code) {
  return (failure) => {
    if (['SOURCE_RECEIPT_UPDATE_CONFLICT', 'SOURCE_RECEIPT_STORED_RECORD_INVALID'].includes(code)) {
      assert.ok(failure instanceof MySqlTransactionError);
      assert.equal(failure.outcome, 'ROLLED_BACK');
      assert.equal(getMySqlTransactionDiagnostics(failure).primaryError.message, code);
    } else assert.equal(failure.message, code);
    return true;
  };
}

const confirmation = (overrides = {}) => ({
  state: 'CONFIRMED',
  transactionHash: TX,
  blockHash: BLOCK,
  blockNumber: '12345',
  version: '1',
  ...overrides,
});

async function observeCurrent(journal, hash, observation) {
  const record = await journal.get(hash);
  return journal.observe(hash, observation, { expectedRevision: record.revision });
}

test('SQL-capture only: new/restarted instances share immutable durable records and exact canonical replays', async () => {
  const f = sqlFixture();
  const input = intent();
  const expected = evidenceHash(input);
  const record = await f.journal().prepare(input);
  assert.equal(record.intentHash, expected);
  assert.equal(record.executionReference, `oracle-receipt:${expected}`);
  assert.equal(record.state, 'PREPARED');
  assert.equal(record.revision, 0);
  assert.deepEqual(record.intent, input);
  assert.ok(Object.isFrozen(record.intent.binding));
  input.recordReference = 'caller-mutated-after-write';
  assert.equal(
    (await f.journal().get(expected)).intent.recordReference,
    'synthetic-fixed-reference-1',
  );
  assert.deepEqual(await f.journal().prepare(intent()), record);
  assert.equal(await f.journal().get(hash('f').slice(2)), null);
  assert.equal(f.database.rows.size, 1);
  assert.equal(
    f.log.filter(({ sql }) => sql?.startsWith('INSERT INTO source_receipt_journal ')).length,
    1,
  );
});

test('SQL-capture only: concurrent preparation and claim have one durable insert and one submission winner', async () => {
  const f = sqlFixture();
  const first = f.journal();
  const second = f.journal();
  const prepared = await Promise.all([first.prepare(intent()), second.prepare(intent())]);
  assert.deepEqual(prepared[0], prepared[1]);
  const results = await Promise.all([
    first.claim(prepared[0].intentHash),
    second.claim(prepared[0].intentHash),
  ]);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.ok(
    results.every((result) => result.record.state === 'SUBMITTING' && result.record.revision === 1),
  );
  assert.equal((await f.journal().claim(prepared[0].intentHash)).claimed, false);
  const winnerUpdate = f.log.find(({ sql }) =>
    sql?.startsWith('UPDATE source_receipt_journal SET '),
  );
  assert.ok(f.log.some(({ id, event }) => id === winnerUpdate.id && event === 'commit'));
  const prepares = new Map();
  for (const event of f.log.filter(({ sql }) =>
    sql?.startsWith('INSERT INTO source_receipt_journal_locks '),
  )) {
    const locks = prepares.get(event.id) ?? [];
    locks.push(asHex(event.parameters[0]));
    prepares.set(event.id, locks);
  }
  for (const locks of prepares.values())
    assert.deepEqual(
      locks,
      [...locks].sort(),
      'all shared identity locks use stable acquisition order',
    );
});

test('SQL-capture only: source idempotency, source nonce and canonical chain/contract segment uniqueness reject changed input', async () => {
  const f = sqlFixture();
  const initial = intent();
  const record = await f.journal().prepare(initial);
  await assert.rejects(
    () => f.journal().prepare({ ...initial, recordReference: 'different-reference' }),
    domainFailure('SOURCE_RECEIPT_IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    () => f.journal().prepare({ ...initial, registrationSource: 'REG_INTERMEDIARY' }),
    domainFailure('SOURCE_RECEIPT_IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    () => f.journal().prepare({ ...initial, idempotencyKey: 'new-key', tokenId: '2' }),
    domainFailure('SOURCE_RECEIPT_NONCE_CONFLICT'),
  );
  const otherSource = {
    ...initial,
    sourceId: 'other-source',
    tokenId: '2',
    target: { ...initial.target, contract: `0x${initial.target.contract.slice(2).toUpperCase()}` },
  };
  await assert.rejects(
    () => f.journal().prepare(otherSource),
    domainFailure('SOURCE_RECEIPT_SEGMENT_CONFLICT'),
  );
  assert.deepEqual(await f.journal().get(record.intentHash), record);
  assert.equal(f.database.rows.size, 1);
  const independent = {
    ...otherSource,
    binding: { ...otherSource.binding, segmentDigest: hash('d') },
  };
  assert.equal(
    (await f.journal().prepare(independent)).state,
    'PREPARED',
    'same key/nonce in another source is independent',
  );
});

test('SQL-capture only: claim permission is withheld until its commit is acknowledged', async () => {
  const f = sqlFixture();
  const journal = f.journal();
  const record = await journal.prepare(intent());
  const pause = f.pauseCommit();
  let completed = false;
  const claim = journal.claim(record.intentHash).then((value) => {
    completed = true;
    return value;
  });
  await pause.ready;
  assert.equal(completed, false);
  assert.equal(f.database.rows.get(record.intentHash).state, 'PREPARED');
  pause.resume();
  assert.equal((await claim).claimed, true);
  assert.equal(f.database.rows.get(record.intentHash).state, 'SUBMITTING');
});

test('SQL-capture only: concurrent cross-lane conflicting idempotency keys cannot both commit', async () => {
  const f = sqlFixture();
  const initial = intent();
  const changed = nextIntent(initial, { idempotencyKey: initial.idempotencyKey, tokenId: '2' });
  const outcomes = await Promise.allSettled([
    f.journal().prepare(initial),
    f.journal().prepare(changed),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
  domainFailure('SOURCE_RECEIPT_IDEMPOTENCY_CONFLICT')(
    outcomes.find(({ status }) => status === 'rejected').reason,
  );
  assert.equal(f.database.rows.size, 1);
});

test('SQL-capture only: token lane remains blocked until confirmation; historical reorg blocks a prepared successor claim', async () => {
  const f = sqlFixture();
  const j = f.journal();
  const initial = intent();
  const record = await j.prepare(initial);
  const next = nextIntent(initial);
  await assert.rejects(() => j.prepare(next), domainFailure('SOURCE_RECEIPT_LANE_UNRESOLVED'));
  await j.claim(record.intentHash);
  await observeCurrent(j, record.intentHash, {
    state: 'UNKNOWN',
    reason: 'SUBMISSION_OUTCOME_UNKNOWN',
  });
  assert.equal((await f.journal().claim(record.intentHash)).claimed, false);
  await assert.rejects(
    () => f.journal().prepare(next),
    domainFailure('SOURCE_RECEIPT_LANE_UNRESOLVED'),
  );
  await observeCurrent(j, record.intentHash, confirmation());
  const successor = await f.journal().prepare(next);
  assert.equal(successor.state, 'PREPARED');
  const reorg = await observeCurrent(f.journal(), record.intentHash, {
    state: 'REORGED',
    transactionHash: TX,
    reason: 'BLOCK_NOT_CANONICAL',
  });
  assert.equal(reorg.transactionHash, TX);
  assert.equal(reorg.blockHash, null);
  assert.equal(reorg.blockNumber, null);
  assert.equal(reorg.version, null);
  await assert.rejects(
    () => f.journal().claim(successor.intentHash),
    domainFailure('SOURCE_RECEIPT_LANE_UNRESOLVED'),
  );
  assert.equal((await f.journal().get(successor.intentHash)).state, 'PREPARED');
  await observeCurrent(
    f.journal(),
    record.intentHash,
    confirmation({ blockHash: hash('c'), blockNumber: '12346' }),
  );
  assert.equal((await f.journal().claim(successor.intentHash)).claimed, true);
});

test('SQL-capture only: invalid transitions and conflicting confirmations never overwrite immutable intent or tx identity', async () => {
  const f = sqlFixture();
  const j = f.journal();
  const prepared = await j.prepare(intent());
  await assert.rejects(
    () => observeCurrent(j, prepared.intentHash, confirmation()),
    domainFailure('SOURCE_RECEIPT_STATE_TRANSITION_INVALID'),
  );
  await j.claim(prepared.intentHash);
  await observeCurrent(j, prepared.intentHash, { state: 'SUBMITTED', transactionHash: TX });
  await assert.rejects(
    () =>
      observeCurrent(j, prepared.intentHash, { state: 'SUBMITTED', transactionHash: hash('c') }),
    domainFailure('SOURCE_RECEIPT_TRANSACTION_CONFLICT'),
  );
  await assert.rejects(
    () => observeCurrent(j, prepared.intentHash, confirmation({ version: '2' })),
    domainFailure('SOURCE_RECEIPT_VERSION_CONFLICT'),
  );
  const confirmed = await observeCurrent(j, prepared.intentHash, confirmation());
  assert.deepEqual(
    await observeCurrent(j, prepared.intentHash, confirmation()),
    confirmed,
    'exact observation replay does not increment revision',
  );
  await assert.rejects(
    () => observeCurrent(j, prepared.intentHash, confirmation({ blockHash: hash('c') })),
    domainFailure('SOURCE_RECEIPT_CONFIRMATION_CONFLICT'),
  );
  // A canonical receipt can lose confirmation depth. Remove proof and retain its tx identity.
  const pending = await observeCurrent(j, prepared.intentHash, {
    state: 'SUBMITTED',
    transactionHash: TX,
  });
  assert.equal(pending.blockHash, null);
  assert.equal(pending.version, null);
  assert.equal((await j.claim(prepared.intentHash)).claimed, false);
  await assert.rejects(
    () => observeCurrent(j, prepared.intentHash, { state: 'PREPARED' }),
    /SOURCE_RECEIPT_OBSERVATION_INVALID/,
  );
  await assert.rejects(
    () => observeCurrent(j, prepared.intentHash, { state: 'UNKNOWN', intent: intent() }),
    /SOURCE_RECEIPT_OBSERVATION_INVALID/,
  );
  const unknown = await observeCurrent(j, prepared.intentHash, { state: 'UNKNOWN' });
  assert.equal(unknown.transactionHash, TX);
  assert.equal(unknown.blockHash, null);
  assert.equal((await f.journal().claim(prepared.intentHash)).claimed, false);
  await observeCurrent(
    j,
    prepared.intentHash,
    confirmation({ blockHash: hash('c'), blockNumber: '12346' }),
  );
  assert.deepEqual((await f.journal().get(prepared.intentHash)).intent, prepared.intent);
});

test('SQL-capture only: unverified rejection keeps the lane quarantined but remains observable', async () => {
  const f = sqlFixture();
  const j = f.journal();
  const record = await j.prepare(intent());
  const rejected = await observeCurrent(j, record.intentHash, {
    state: 'REJECTED',
    reason: 'SOURCE_REJECTED',
  });
  assert.equal((await f.journal().claim(record.intentHash)).claimed, false);
  assert.deepEqual(
    await observeCurrent(j, record.intentHash, { state: 'REJECTED', reason: 'SOURCE_REJECTED' }),
    rejected,
  );
  assert.equal((await observeCurrent(j, record.intentHash, { state: 'UNKNOWN' })).state, 'UNKNOWN');
  await assert.rejects(
    () => j.prepare(nextIntent(intent())),
    domainFailure('SOURCE_RECEIPT_LANE_UNRESOLVED'),
  );
});

for (const phase of ['prepare', 'claim', 'observe']) {
  test(`SQL-capture only: ${phase} commit-unknown propagates without success, and restart observes committed state`, async () => {
    const f = sqlFixture();
    const j = f.journal();
    let record;
    if (phase !== 'prepare') record = await j.prepare(intent());
    if (phase === 'observe') await j.claim(record.intentHash);
    f.failCommit(true);
    const run =
      phase === 'prepare'
        ? () => j.prepare(intent())
        : phase === 'claim'
          ? () => j.claim(record.intentHash)
          : () => j.observe(record.intentHash, confirmation(), { expectedRevision: 1 });
    let successes = 0;
    await assert.rejects(
      async () => {
        const value = await run();
        successes += 1;
        return value;
      },
      (failure) => {
        assert.ok(failure instanceof MySqlTransactionError);
        assert.equal(failure.outcome, 'COMMIT_UNKNOWN');
        assert.equal(failure.code, 'MYSQL_COMMIT_UNKNOWN');
        assert.equal(failure.connectionState, 'DESTROYED');
        assert.equal(
          getMySqlTransactionDiagnostics(failure).primaryError.message,
          'synthetic-lost-commit-ack',
        );
        return true;
      },
    );
    assert.equal(successes, 0);
    const persisted = await f.journal().get(evidenceHash(intent()));
    assert.equal(
      persisted.state,
      phase === 'prepare' ? 'PREPARED' : phase === 'claim' ? 'SUBMITTING' : 'CONFIRMED',
    );
    if (phase !== 'prepare')
      assert.equal((await f.journal().claim(persisted.intentHash)).claimed, false);
    assert.equal(
      f.log.filter(({ sql }) => sql?.startsWith('INSERT INTO source_receipt_journal ')).length,
      1,
    );
  });
}

test('SQL-capture only: unacknowledged commit is not guessed successful when nothing persisted', async () => {
  const f = sqlFixture();
  f.failCommit(false);
  await assert.rejects(() => f.journal().prepare(intent()), { code: 'MYSQL_COMMIT_UNKNOWN' });
  assert.equal(await f.journal().get(evidenceHash(intent())), null);
  assert.equal(
    f.log.filter(({ sql }) => sql?.startsWith('INSERT INTO source_receipt_journal ')).length,
    1,
    'no automatic retry',
  );
});

for (const outcome of ['COMMIT_UNKNOWN', 'ROLLBACK_UNKNOWN', 'COMMITTED', 'NOT_STARTED']) {
  test(`repository ${outcome} error object propagates unchanged through every journal method`, async () => {
    const failure = new MySqlTransactionError({
      phase: 'COMMIT',
      outcome,
      primaryError: new Error('synthetic-private-detail'),
    });
    let calls = 0;
    const journal = new MySqlReceiptJournal({
      repository: {
        async transaction() {
          calls += 1;
          throw failure;
        },
      },
    });
    for (const run of [
      () => journal.prepare(intent()),
      () => journal.get(evidenceHash(intent())),
      () => journal.claim(evidenceHash(intent())),
      () => journal.observe(evidenceHash(intent()), confirmation(), { expectedRevision: 1 }),
    ]) {
      await assert.rejects(run, (actual) => actual === failure);
    }
    assert.equal(calls, 4);
  });
}

test('SQL-capture only: conditional-update failure rolls back; corrupted stored intent fails closed on restart', async () => {
  const f = sqlFixture();
  const record = await f.journal().prepare(intent());
  f.failUpdate();
  await assert.rejects(
    () => f.journal().claim(record.intentHash),
    domainFailure('SOURCE_RECEIPT_UPDATE_CONFLICT'),
  );
  assert.deepEqual(await f.journal().get(record.intentHash), record);
  f.database.rows.get(record.intentHash).intent_json = JSON.stringify({
    ...intent(),
    recordCommitment: hash('d'),
  });
  await assert.rejects(
    () => f.journal().get(record.intentHash),
    domainFailure('SOURCE_RECEIPT_STORED_RECORD_INVALID'),
  );
});

test('journal rejects malformed identifiers and unsolicited payload fields before any transaction', async () => {
  let calls = 0;
  const journal = new MySqlReceiptJournal({
    repository: {
      async transaction() {
        calls += 1;
        throw new Error('unexpected-transaction');
      },
    },
  });
  for (const bad of [
    intent({ tokenId: 1 }),
    intent({ tokenId: '01' }),
    intent({ sourceId: 'x'.repeat(129) }),
    intent({ sourceId: '\ud800' }),
    intent({ rawReceipt: 'not-permitted' }),
    intent({ expectedPreviousVersion: String(2n ** 64n - 1n) }),
  ]) {
    await assert.rejects(() => journal.prepare(bad), /SOURCE_RECEIPT_INTENT_INVALID/);
  }
  await assert.rejects(
    () => journal.get('not-an-intent-hash'),
    /SOURCE_RECEIPT_INTENT_HASH_INVALID/,
  );
  await assert.rejects(
    () =>
      journal.observe(
        evidenceHash(intent()),
        { state: 'CONFIRMED', transactionHash: TX },
        { expectedRevision: 1 },
      ),
    /SOURCE_RECEIPT_OBSERVATION_INVALID/,
  );
  await assert.rejects(
    () =>
      journal.observe(
        evidenceHash(intent()),
        { state: 'UNKNOWN', blockHash: BLOCK },
        { expectedRevision: 1 },
      ),
    /SOURCE_RECEIPT_OBSERVATION_INVALID/,
  );
  assert.equal(calls, 0);
});

test('fresh-install and additive upgrade migrations have identical receipt DDL with binary uniqueness', async () => {
  const initial = await readFile(new URL('../db/mysql/001_initial.sql', import.meta.url), 'utf8');
  const upgrade = await readFile(
    new URL('../db/mysql/002_source_receipt_journal.sql', import.meta.url),
    'utf8',
  );
  const tables = (sql) =>
    [...sql.matchAll(/CREATE TABLE IF NOT EXISTS source_receipt_[\s\S]*?\) ENGINE=InnoDB;/g)].map(
      ([ddl]) => ddl,
    );
  assert.equal(tables(upgrade).length, 2);
  assert.deepEqual(tables(initial), tables(upgrade));
  assert.match(upgrade, /source_id VARBINARY\(128\)/);
  assert.match(upgrade, /idempotency_key VARBINARY\(128\)/);
  assert.match(upgrade, /intent_json JSON NOT NULL/);
  for (const key of [
    'uq_source_receipt_execution',
    'uq_source_receipt_idempotency',
    'uq_source_receipt_nonce',
    'uq_source_receipt_segment',
  ])
    assert.ok(upgrade.includes(`UNIQUE KEY ${key}`));
  assert.match(upgrade, /INDEX idx_source_receipt_lane \(lane_hash, state\)/);
  assert.match(upgrade, /active_segment_digest BINARY\(32\) GENERATED ALWAYS AS/);
  assert.match(upgrade, /CASE WHEN state = 'OBSOLETE' AND transaction_hash IS NULL THEN NULL ELSE segment_digest END/);
  assert.match(upgrade, /UNIQUE KEY uq_source_receipt_segment \(chain_id, contract_address, active_segment_digest\)/);
  assert.ok(!/DROP TABLE|DELETE FROM|TRUNCATE/i.test(upgrade));
});

test('SQL-capture only: confirmed failed transaction releases a lane, retains proof, and reorg blocks a successor', async () => {
  const f = sqlFixture();
  const j = f.journal();
  const prepared = await j.prepare(intent());
  const claimed = await j.claim(prepared.intentHash);
  const failure = {
    state: 'FAILED',
    transactionHash: TX,
    blockHash: BLOCK,
    blockNumber: '12345',
    reason: 'TRANSACTION_REVERTED',
  };
  const failed = await j.observe(prepared.intentHash, failure, {
    expectedRevision: claimed.record.revision,
  });
  assert.equal(failed.blockHash, BLOCK);
  assert.equal(failed.version, null);
  assert.equal((await j.claim(prepared.intentHash)).claimed, false);
  const next = await j.prepare(nextIntent(intent()));
  const reorg = await j.observe(
    prepared.intentHash,
    { state: 'REORGED', transactionHash: TX },
    { expectedRevision: failed.revision },
  );
  await assert.rejects(
    () => j.claim(next.intentHash),
    domainFailure('SOURCE_RECEIPT_LANE_UNRESOLVED'),
  );
  await assert.rejects(
    () => j.observe(prepared.intentHash, failure, { expectedRevision: failed.revision }),
    /SOURCE_RECEIPT_OBSERVATION_STALE/,
  );
  assert.equal((await j.get(prepared.intentHash)).revision, reorg.revision);
  await j.observe(
    prepared.intentHash,
    confirmation({ blockHash: hash('c'), blockNumber: '12346' }),
    { expectedRevision: reorg.revision },
  );
  assert.equal((await j.get(prepared.intentHash)).state, 'CONFIRMED');
});

test('SQL-capture plus real lifecycle coordinator: lane/idempotency refusals stay local; database uncertainty blocks globally', async () => {
  const { createRepositoryExecutionScope } =
    await import('../src/services/repository-execution-scope.js');
  const f = sqlFixture();
  f.repository.pool.execute = async () => {
    throw new Error('unexpected pool-level query');
  };
  const scope = createRepositoryExecutionScope({
    repository: f.repository,
    isCompromised: () => false,
  });
  const journal = new MySqlReceiptJournal({ repository: scope.repository });
  const first = await scope.run(() => journal.prepare(intent()));
  await scope.run(() => journal.claim(first.intentHash));
  await scope.run(() =>
    journal.observe(
      first.intentHash,
      { state: 'SUBMITTED', transactionHash: TX },
      { expectedRevision: 1 },
    ),
  );
  await assert.rejects(
    () => scope.run(() => journal.prepare(nextIntent(intent()))),
    /SOURCE_RECEIPT_LANE_UNRESOLVED/,
  );
  assert.equal(scope.snapshot().state, 'ACCEPTING');
  await assert.rejects(
    () => scope.run(() => journal.prepare(intent({ holder: `0x${'f'.repeat(40)}` }))),
    /SOURCE_RECEIPT_IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(scope.snapshot().state, 'ACCEPTING');
  assert.equal((await scope.run(() => journal.get(first.intentHash))).state, 'SUBMITTED');
  f.failCommit(true);
  await assert.rejects(
    () => scope.run(() => journal.get(first.intentHash)),
    /MYSQL_COMMIT_UNKNOWN/,
  );
  assert.equal(scope.snapshot().state, 'BLOCKED');
  await assert.rejects(
    () => scope.run(() => journal.get(first.intentHash)),
    /REPOSITORY_ADMISSION_CLOSED/,
  );
});


test('SQL-capture only: obsolete never-submitted intent releases only its segment reservation and keeps history', async () => {
  const f = sqlFixture();
  const original = intent();
  const prepared = await f.journal().prepare(original);
  const obsolete = await f.journal().invalidatePrepared(prepared.intentHash, { expectedRevision: 0 });
  const corrected = nextIntent(original, { binding: { ...original.binding } });
  const replacement = await f.journal().prepare(corrected);
  assert.equal(replacement.state, 'PREPARED');
  assert.notEqual(replacement.intentHash, prepared.intentHash);
  assert.equal(f.database.rows.size, 2);
  assert.deepEqual(await f.journal().get(prepared.intentHash), obsolete);
  assert.deepEqual(await f.journal().prepare(original), obsolete);
  assert.equal((await f.journal().claim(prepared.intentHash)).claimed, false);
  assert.deepEqual(obsolete.intent, original);
  await assert.rejects(() => f.journal().prepare({ ...corrected, idempotencyKey: original.idempotencyKey }),
    domainFailure('SOURCE_RECEIPT_IDEMPOTENCY_CONFLICT'));
  await assert.rejects(() => f.journal().prepare({ ...corrected, nonceHash: original.nonceHash }),
    domainFailure('SOURCE_RECEIPT_NONCE_CONFLICT'));
});

test('SQL-capture only: concurrent corrections after obsolete preparation retain one segment reservation', async () => {
  const f = sqlFixture();
  const original = intent();
  const prepared = await f.journal().prepare(original);
  await f.journal().invalidatePrepared(prepared.intentHash, { expectedRevision: 0 });
  const corrected = nextIntent(original, { binding: { ...original.binding } });
  const competing = { ...corrected, idempotencyKey: 'competing-correction',
    nonceHash: hash('a').slice(2), recordReference: 'different-correction' };
  const results = await Promise.allSettled([f.journal().prepare(corrected), f.journal().prepare(competing)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  domainFailure('SOURCE_RECEIPT_SEGMENT_CONFLICT')(results.find((row) => row.status === 'rejected').reason);
  assert.equal(f.database.rows.size, 2);
});

test('SQL-capture only: claimed and unknown intents never release their segment to a correction', async () => {
  for (const state of ['SUBMITTING', 'UNKNOWN']) {
    const f = sqlFixture();
    const original = intent();
    const prepared = await f.journal().prepare(original);
    const claimed = await f.journal().claim(prepared.intentHash);
    if (state === 'UNKNOWN') await observeCurrent(f.journal(), prepared.intentHash,
      { state: 'UNKNOWN', reason: 'SUBMISSION_OUTCOME_UNKNOWN' });
    const current = await f.journal().get(prepared.intentHash);
    await assert.rejects(() => f.journal().invalidatePrepared(prepared.intentHash,
      { expectedRevision: current.revision }), domainFailure('SOURCE_RECEIPT_PREPARED_STATE_CHANGED'));
    await assert.rejects(() => f.journal().prepare(nextIntent(original,
      { binding: { ...original.binding } })), domainFailure('SOURCE_RECEIPT_SEGMENT_CONFLICT'));
    assert.deepEqual(await f.journal().get(prepared.intentHash), current);
    assert.equal(claimed.claimed, true);
  }
});

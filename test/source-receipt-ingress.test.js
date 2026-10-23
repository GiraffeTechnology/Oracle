import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, evidenceHash } from '../src/domain/canonical-json.js';
import { SourceRegistry } from '../src/domain/source-registry.js';
import { KeySetRegistry } from '../src/domain/key-set-registry.js';
import {
  SourceReceiptIngress,
  SOURCE_RECEIPT_SCHEMA,
  RECEIPT_BINDING_SCHEMA,
  verifySourceReceipt,
} from '../src/services/source-receipt-ingress.js';
import { sqlFixture } from './fixtures/receipt-journal.mjs';

const NOW = new Date('2026-10-16T18:00:00.000Z');
const word = (n) => `0x${String(n).repeat(64)}`;
const addr = (n) => `0x${String(n).repeat(40)}`;
const sourceId = 'synthetic-registry';
const target = {
  chainId: '31337',
  contract: addr('a'),
  registerId: word('1'),
  sourceAuthority: addr('b'),
};
const recordRef = 'record:registration-001';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const sourceRegistry = new SourceRegistry([
    {
      id: sourceId,
      displayName: 'Synthetic registry',
      kind: 'REGISTRY',
      keySetId: 'synthetic-source-keys',
      schemaVersions: [SOURCE_RECEIPT_SCHEMA],
      active: true,
    },
  ]);
  const keySetRegistry = new KeySetRegistry();
  keySetRegistry.register({
    keySetId: 'synthetic-source-keys',
    publicKey,
    validFrom: '2026-01-01T00:00:00.000Z',
  });
  const envelope = {
    sourceId,
    schemaVersion: SOURCE_RECEIPT_SCHEMA,
    recordReference: recordRef,
    issuedAt: NOW.toISOString(),
    nonce: 'nonce-001',
    idempotencyKey: 'receipt-001',
    payload: {
      registrationSource: 'REG_DIRECT',
      target,
      tokenId: '1',
      expectedPreviousVersion: '1',
      previousCommitment: word('2'),
      recordCommitment: word('3'),
      registryReference: word('4'),
      holder: addr('c'),
      effectiveAt: '2000',
      binding: {
        schemaId: RECEIPT_BINDING_SCHEMA,
        mintPolicyHash: word('5'),
        segmentDigest: word('6'),
        requestHash: word('7'),
        receiptDocumentHash: word('8'),
      },
    },
  };
  const signed = (value = envelope) => ({
    authenticated: true,
    sourceId: value.sourceId,
    schemaVersion: value.schemaVersion,
    record: structuredClone(value.payload),
    recordHash: evidenceHash(value.payload),
    envelope: structuredClone(value),
    signature: sign(null, Buffer.from(canonicalJson(value)), privateKey).toString('base64url'),
  });
  let response = signed();
  const verify = (value = response, extra = {}) =>
    verifySourceReceipt({
      response: value,
      recordRef,
      sourceId,
      registrationSource: 'REG_DIRECT',
      target,
      sourceRegistry,
      keySetRegistry,
      now: NOW,
      ...extra,
    });
  const db = sqlFixture();
  const calls = [];
  let writesEnabled = true;
  const writer = {
    async validateIntent(intent) {
      calls.push(['validate', intent]);
    },
    async submit(record) {
      calls.push(['submit', record]);
      assert.equal((await db.journal().get(record.intentHash)).state, 'SUBMITTING');
      return word('9');
    },
    async reconcile(record) {
      calls.push(['reconcile', record]);
      return {
        state: 'CONFIRMED',
        transactionHash: word('9'),
        blockHash: word('d'),
        blockNumber: '101',
        version: '2',
      };
    },
  };
  // Unit capability double, not an approved document parser. Full synthetic parsing is tested on the local-chain path.
  const formatVerifier = {
    async verifyOriginalRegistration({ profileId, intent }) {
      return {
        verified: true,
        profileId,
        intentHash: evidenceHash(intent),
        receiptDocumentHash: intent.binding.receiptDocumentHash,
        mintPolicyHash: intent.binding.mintPolicyHash,
        receiptFormatHash: word('a'),
      };
    },
  };
  const sourcePort = {
    async fetchByFixedReference(ref) {
      calls.push(['fetch', ref]);
      return response;
    },
  };
  const build = (overrides = {}) =>
    new SourceReceiptIngress({
      sourceId,
      registrationSource: 'REG_DIRECT',
      target,
      sourceRegistry,
      keySetRegistry,
      sourcePort,
      writer,
      formatVerifier,
      formatProfileId: 'synthetic-format.v1',
      journal: db.journal(),
      clock: () => NOW,
      writesAllowed: () => writesEnabled,
      ...overrides,
    });
  return {
    envelope,
    signed,
    verify,
    sourceRegistry,
    keySetRegistry,
    db,
    calls,
    writer,
    sourcePort,
    formatVerifier,
    build,
    setResponse(value) {
      response = value;
    },
    setWrites(value) {
      writesEnabled = value;
    },
  };
}

test('complete source signature binds original document digest, request, policy, route and fixed reference', () => {
  const f = fixture();
  const intent = f.verify();
  assert.equal(intent.sourceId, sourceId);
  assert.equal(intent.registrationSource, 'REG_DIRECT');
  assert.equal(intent.envelopeHash, evidenceHash(f.envelope));
  assert.equal(intent.binding.receiptDocumentHash, f.envelope.payload.binding.receiptDocumentHash);
  assert.deepEqual(intent.target, target);
  assert.ok(Object.isFrozen(intent.binding));
  assert.equal(Object.hasOwn(intent, 'signature'), false);
  for (const mutate of [
    (value) => {
      value.payload.holder = addr('f');
    },
    (value) => {
      value.payload.binding.receiptDocumentHash = word('f');
    },
    (value) => {
      value.payload.binding.requestHash = word('f');
    },
    (value) => {
      value.payload.binding.mintPolicyHash = word('f');
    },
    (value) => {
      value.payload.registrationSource = 'REG_ELECTRONIC';
    },
  ]) {
    const response = f.signed();
    mutate(response.envelope);
    response.record = structuredClone(response.envelope.payload);
    response.recordHash = evidenceHash(response.record);
    assert.throws(() => f.verify(response), /SIGNATURE_INVALID/);
  }
});

test('transport authenticated flag, matching TLS source, or digest without a signature never authenticates receipt fields', () => {
  const f = fixture();
  for (const change of [
    { signature: undefined },
    { signature: 'a'.repeat(86) },
    { authenticated: false },
    { recordHash: 'a'.repeat(64) },
    { sourceId: 'another-source' },
  ])
    assert.throws(() => f.verify({ ...f.signed(), ...change }));
  const response = f.signed();
  response.record.holder = addr('f');
  assert.throws(() => f.verify(response), /RECORD_HASH_MISMATCH/);
});

test('signed but wrong fixed domain/source/route/reference and unapproved schemas fail closed', () => {
  const f = fixture();
  for (const mutate of [
    (value) => {
      value.sourceId = 'another-source';
    },
    (value) => {
      value.schemaVersion = 'another.v1';
    },
    (value) => {
      value.recordReference = 'record:another';
    },
    (value) => {
      value.payload.target.chainId = '1';
    },
    (value) => {
      value.payload.target.contract = addr('d');
    },
    (value) => {
      value.payload.target.sourceAuthority = addr('d');
    },
    (value) => {
      value.payload.target.registerId = word('a');
    },
    (value) => {
      value.payload.registrationSource = 'REG_INTERMEDIARY';
    },
  ]) {
    const value = structuredClone(f.envelope);
    mutate(value);
    assert.throws(() => f.verify(f.signed(value)));
  }
  f.sourceRegistry.setActive(sourceId, false);
  assert.throws(() => f.verify(), /SOURCE_INACTIVE/);
});

test('full strict schema rejects additional caller authority, noncanonical integers and empty bindings', () => {
  const f = fixture();
  for (const mutate of [
    (value) => {
      value.url = 'https://example.invalid';
    },
    (value) => {
      value.payload.signerReference = 'deployment://signer/other';
    },
    (value) => {
      value.payload.target.endpoint = 'https://example.invalid';
    },
    (value) => {
      value.payload.tokenId = 1;
    },
    (value) => {
      value.payload.effectiveAt = '02000';
    },
    (value) => {
      value.payload.expectedPreviousVersion = '0';
    },
    (value) => {
      value.payload.expectedPreviousVersion = '18446744073709551615';
    },
    (value) => {
      value.payload.holder = addr('0');
    },
    (value) => {
      value.payload.binding.segmentDigest = word('0');
    },
    (value) => {
      value.payload.binding.schemaId = word('f');
    },
  ]) {
    const value = structuredClone(f.envelope);
    mutate(value);
    assert.throws(() => f.verify(f.signed(value)));
  }
});

test('expired, future, revoked and unapproved source keys cannot admit even correctly signed evidence', () => {
  const f = fixture();
  for (const issuedAt of ['2026-10-16T17:00:00.000Z', '2026-10-16T19:00:00.000Z', 'invalid'])
    assert.throws(() => f.verify(f.signed({ ...f.envelope, issuedAt })), /TIME_INVALID/);
  f.keySetRegistry.replace('synthetic-source-keys', 'REVOKED');
  assert.throws(() => f.verify(), /KEY_SET_NOT_ACTIVE/);
});

test('internal ingress persists and commits exclusive intent before writer execution, then reconciles', async () => {
  const f = fixture();
  const result = await f.build().ingest({ recordRef });
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.version, '2');
  assert.deepEqual(
    f.calls.map(([method]) => method),
    ['fetch', 'validate', 'submit', 'reconcile'],
  );
  assert.equal(f.db.database.rows.size, 1);
  assert.equal(
    result.intent.binding.receiptDocumentHash,
    f.envelope.payload.binding.receiptDocumentHash,
  );
});

test('exact replay after restart reconciles persisted proof and never repeats preflight or submission', async () => {
  const f = fixture();
  const first = await f.build().ingest({ recordRef });
  f.writer.validateIntent = async () => {
    throw new Error('projection advanced; stale preflight must not be run');
  };
  const second = await f.build().ingest({ recordRef });
  assert.equal(second.intentHash, first.intentHash);
  assert.equal(second.state, 'CONFIRMED');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('two restarted service instances race on one durable claim, with exactly one writer submission', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.build().ingest({ recordRef }),
    f.build().ingest({ recordRef }),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.ok(
    results.every(
      (result) =>
        result.status === 'fulfilled' ||
        result.reason.message === 'SOURCE_RECEIPT_OBSERVATION_STALE',
    ),
  );
  assert.equal(
    (await f.db.journal().get(evidenceHash(f.verify()))).intentHash,
    evidenceHash(f.verify()),
  );
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('uncertain claim commit prevents the writer, and a restarted uncertain intent only reconciles', async () => {
  const f = fixture();
  const journal = f.db.journal();
  const originalClaim = journal.claim.bind(journal);
  journal.claim = (hash) => {
    f.db.failCommit(true);
    return originalClaim(hash);
  };
  await assert.rejects(f.build({ journal }).ingest({ recordRef }), /MYSQL_COMMIT_UNKNOWN/);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
  const result = await f.build().reconcile({ intentHash: evidenceHash(f.verify()) });
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
});

test('unknown submission outcome survives restart and never triggers a blind resubmission', async () => {
  const f = fixture();
  let submits = 0;
  f.writer.submit = async () => {
    submits++;
    throw new Error('synthetic private transport detail');
  };
  f.writer.reconcile = async () => ({ state: 'UNKNOWN', reason: 'BROKER_OUTCOME_UNKNOWN' });
  const result = await f.build().ingest({ recordRef });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal((await f.build().reconcile({ intentHash: result.intentHash })).state, 'UNKNOWN');
  assert.equal((await f.build().ingest({ recordRef })).state, 'UNKNOWN');
  assert.equal(submits, 1);
});

test('reorg downgrades confirmed proof, retains transaction identity and never resubmits', async () => {
  const f = fixture();
  const confirmed = await f.build().ingest({ recordRef });
  f.writer.reconcile = async () => ({
    state: 'REORGED',
    transactionHash: confirmed.transactionHash,
    reason: 'RECEIPT_BLOCK_REORGED',
  });
  const result = await f.build().reconcile({ intentHash: confirmed.intentHash });
  assert.equal(result.state, 'REORGED');
  assert.equal(result.blockHash, null);
  assert.equal(result.transactionHash, confirmed.transactionHash);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('caller identity/holder/route overrides, disabled writes and a source disabled during fetch cause no persistence or execution', async () => {
  const f = fixture();
  for (const input of [
    { recordRef, holder: addr('f') },
    { recordRef, sourceId },
    { recordRef, registrationSource: 'REG_ELECTRONIC' },
    { recordRef: 'https://example.invalid/document' },
  ])
    await assert.rejects(f.build().ingest(input));
  f.setWrites(false);
  await assert.rejects(f.build().ingest({ recordRef }), /WRITES_DISABLED/);
  f.setWrites(true);
  f.sourcePort.fetchByFixedReference = async () => {
    f.sourceRegistry.setActive(sourceId, false);
    return f.signed();
  };
  await assert.rejects(f.build().ingest({ recordRef }), /SOURCE_INACTIVE/);
  assert.equal(f.db.database.rows.size, 0);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
});

test('post-submit persistence failure propagates exact database uncertainty without retrying side effects', async () => {
  const f = fixture();
  f.writer.submit = async () => {
    f.calls.push(['submit']);
    f.db.failCommit(true);
    return word('9');
  };
  await assert.rejects(f.build().ingest({ recordRef }), /MYSQL_COMMIT_UNKNOWN/);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
  assert.equal(
    (await f.build().reconcile({ intentHash: evidenceHash(f.verify()) })).state,
    'CONFIRMED',
  );
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('restart after prepare before claim resumes only the never-submitted intent', async () => {
  const f = fixture();
  const prepared = await f.db.journal().prepare(f.verify());
  assert.equal(prepared.state, 'PREPARED');
  const result = await f.build().ingest({ recordRef });
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('quarantined execution remains observable without a second submission', async () => {
  const f = fixture();
  const prepared = await f.db.journal().prepare(f.verify());
  await f.db.journal().claim(prepared.intentHash);
  await f.db
    .journal()
    .observe(
      prepared.intentHash,
      { state: 'REJECTED', transactionHash: word('9'), reason: 'TRANSACTION_MISMATCH' },
      { expectedRevision: 1 },
    );
  f.writer.reconcile = async () => ({
    state: 'UNKNOWN',
    transactionHash: word('9'),
    reason: 'TRANSACTION_NOT_OBSERVED',
  });
  const result = await f.build().reconcile({ intentHash: prepared.intentHash });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
});

test('lost confirmation depth removes confirmed coordinates and never resubmits', async () => {
  const f = fixture();
  const confirmed = await f.build().ingest({ recordRef });
  f.writer.reconcile = async () => ({
    state: 'SUBMITTED',
    transactionHash: word('9'),
    reason: 'CONFIRMATIONS_PENDING',
  });
  const pending = await f.build().reconcile({ intentHash: confirmed.intentHash });
  assert.equal(pending.state, 'SUBMITTED');
  assert.equal(pending.blockHash, null);
  assert.equal(pending.version, null);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
});

test('repository drain timeout fences a late source response before any journal or writer effect', async () => {
  const { createRepositoryExecutionScope } =
    await import('../src/services/repository-execution-scope.js');
  const f = fixture();
  f.db.repository.pool.execute = async () => {
    throw new Error('unexpected pool-level query');
  };
  const scope = createRepositoryExecutionScope({
    repository: f.db.repository,
    isCompromised: () => false,
  });
  let release, started;
  const arrived = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { MySqlReceiptJournal } = await import('../src/adapters/mysql-receipt-journal.js');
  const ingress = f.build({
    sourcePort: {
      async fetchByFixedReference() {
        started();
        await gate;
        return f.signed();
      },
    },
    journal: new MySqlReceiptJournal({ repository: scope.repository }),
    guardSideEffect: (operation) => scope.guardSideEffect(operation),
  });
  const operation = scope.run(() => ingress.ingest({ recordRef }));
  const rejected = assert.rejects(operation);
  await arrived;
  assert.equal((await scope.drain({ timeoutMs: 1 })).state, 'BLOCKED');
  release();
  await rejected;
  assert.equal(f.db.database.rows.size, 0);
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
  await assert.rejects(
    () => scope.run(() => ingress.ingest({ recordRef })),
    /REPOSITORY_ADMISSION_CLOSED/,
  );
});

test('a delayed old successful observation cannot overwrite a newer reorg or release its lane', async () => {
  const f = fixture();
  const confirmed = await f.build().ingest({ recordRef });
  let release, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  f.writer.reconcile = async () => {
    if (++calls === 1) {
      entered();
      await delayed;
      return {
        state: 'CONFIRMED',
        transactionHash: word('9'),
        blockHash: word('d'),
        blockNumber: '101',
        version: '2',
      };
    }
    return { state: 'REORGED', transactionHash: word('9'), reason: 'RECEIPT_BLOCK_NOT_CANONICAL' };
  };
  const oldObservation = f.build().reconcile({ intentHash: confirmed.intentHash });
  const stale = assert.rejects(oldObservation, /SOURCE_RECEIPT_OBSERVATION_STALE/);
  await ready;
  const reorg = await f.build().reconcile({ intentHash: confirmed.intentHash });
  release();
  await stale;
  assert.equal((await f.db.journal().get(confirmed.intentHash)).revision, reorg.revision);
  assert.equal((await f.db.journal().get(confirmed.intentHash)).state, 'REORGED');
  const next = structuredClone(f.verify());
  next.idempotencyKey = 'receipt-next';
  next.nonceHash = 'a'.repeat(64);
  next.binding.segmentDigest = word('e');
  await assert.rejects(() => f.db.journal().prepare(next));
});

test('a never-claimed durable receipt resumes past freshness only after reauthenticating the exact admitted envelope', async () => {
  const f = fixture();
  const prepared = await f.db.journal().prepare(f.verify());
  const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  await assert.rejects(() => f.build({ clock: () => later }).ingest({ recordRef }), /TIME_INVALID/);
  const resumed = await f
    .build({ clock: () => later })
    .reconcile({ intentHash: prepared.intentHash });
  assert.equal(resumed.state, 'CONFIRMED');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 1);
  const changed = fixture();
  const saved = await changed.db.journal().prepare(changed.verify());
  const replacement = structuredClone(changed.envelope);
  replacement.issuedAt = later.toISOString();
  replacement.nonce = 'nonce-replaced';
  changed.setResponse(changed.signed(replacement));
  await assert.rejects(
    () => changed.build({ clock: () => later }).reconcile({ intentHash: saved.intentHash }),
    /ACCEPTED_ENVELOPE_MISMATCH/,
  );
  changed.setResponse(changed.signed());
  changed.keySetRegistry.replace('synthetic-source-keys', 'REVOKED');
  await assert.rejects(
    () => changed.build({ clock: () => later }).reconcile({ intentHash: saved.intentHash }),
    /KEY_SET_NOT_ACTIVE/,
  );
  assert.equal(changed.calls.filter(([method]) => method === 'submit').length, 0);
});

test('strict original-format proof is required before any journal preparation or writer attempt', async () => {
  for (const change of [
    { verified: false },
    { profileId: 'unapproved-format.v1' },
    { intentHash: 'a'.repeat(64) },
    { receiptDocumentHash: word('f') },
    { mintPolicyHash: word('f') },
    { receiptFormatHash: word('0') },
    { rawDocument: 'never accepted' },
  ]) {
    const f = fixture();
    const original = f.formatVerifier.verifyOriginalRegistration;
    f.formatVerifier.verifyOriginalRegistration = async (input) => ({
      ...(await original(input)),
      ...change,
    });
    await assert.rejects(() => f.build().ingest({ recordRef }));
    assert.equal(f.db.database.rows.size, 0);
    assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
  }
  assert.throws(() => fixture().build({ formatVerifier: null }), /DEPENDENCY_INVALID/);
});

test('a never-claimed prepared intent whose predecessor changed becomes obsolete without blocking its successor', async () => {
  const f = fixture();
  const prepared = await f.db.journal().prepare(f.verify());
  f.writer.validateIntent = async () => {
    const failure = new Error('changed predecessor');
    failure.errorCode = 'RECEIPT_PREVIOUS_ENTRY_MISMATCH';
    throw failure;
  };
  const obsolete = await f.build().reconcile({ intentHash: prepared.intentHash });
  assert.equal(obsolete.state, 'OBSOLETE');
  assert.equal(obsolete.transactionHash, null);
  assert.equal((await f.db.journal().claim(prepared.intentHash)).claimed, false);
  const next = structuredClone(f.verify());
  next.idempotencyKey = 'receipt-next';
  next.nonceHash = 'a'.repeat(64);
  next.binding.segmentDigest = word('e');
  assert.equal((await f.db.journal().prepare(next)).state, 'PREPARED');
  assert.equal(f.calls.filter(([method]) => method === 'submit').length, 0);
  const claimed = fixture();
  const record = await claimed.db.journal().prepare(claimed.verify());
  await claimed.db.journal().claim(record.intentHash);
  await assert.rejects(
    () =>
      claimed.db
        .journal()
        .invalidatePrepared(record.intentHash, { expectedRevision: record.revision }),
    /PREPARED_STATE_CHANGED/,
  );
  assert.equal((await claimed.db.journal().get(record.intentHash)).state, 'SUBMITTING');
});

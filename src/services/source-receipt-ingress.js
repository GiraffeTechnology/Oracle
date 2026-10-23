import { createPublicKey, verify } from 'node:crypto';
import { canonicalJson, evidenceHash } from '../domain/canonical-json.js';
import { assertUint64, assertUint256, ADDRESS, BYTES32 } from '../ports/projection-source.js';

export const SOURCE_RECEIPT_SCHEMA = 'registration-receipt.v1';
export const REGISTRATION_SOURCES = Object.freeze([
  'REG_DIRECT',
  'REG_ELECTRONIC',
  'REG_INTERMEDIARY',
]);
export const RECEIPT_BINDING_SCHEMA =
  '0xee5bd417e3dddcc2dfb85f45260f817dc32e4c1945000d5bb7a738c142a4f9e3';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ENVELOPE_FIELDS = [
  'sourceId',
  'schemaVersion',
  'recordReference',
  'issuedAt',
  'nonce',
  'idempotencyKey',
  'payload',
];
const PAYLOAD_FIELDS = [
  'registrationSource',
  'target',
  'tokenId',
  'expectedPreviousVersion',
  'previousCommitment',
  'recordCommitment',
  'registryReference',
  'holder',
  'effectiveAt',
  'binding',
];
const TARGET_FIELDS = ['chainId', 'contract', 'registerId', 'sourceAuthority'];
const BINDING_FIELDS = [
  'schemaId',
  'mintPolicyHash',
  'segmentDigest',
  'requestHash',
  'receiptDocumentHash',
];

function fail(code) {
  throw new Error(code);
}
function exact(value, fields, code = 'SOURCE_RECEIPT_SCHEMA_INVALID') {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    fail(code);
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/.test(value))
    fail('SOURCE_RECEIPT_REPLAY_ID_INVALID');
  return value;
}
function fixedReference(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,255}$/.test(value) ||
    /^(?:https?|wss?):/i.test(value)
  )
    fail('SOURCE_RECEIPT_REFERENCE_INVALID');
  return value;
}
function digest(value, allowZero = false) {
  if (
    typeof value !== 'string' ||
    !BYTES32.test(value) ||
    (!allowZero && value.toLowerCase() === ZERO_HASH)
  )
    fail('SOURCE_RECEIPT_DIGEST_INVALID');
  return value.toLowerCase();
}
function address(value) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value.toLowerCase() === ZERO_ADDRESS)
    fail('SOURCE_RECEIPT_ADDRESS_INVALID');
  return value.toLowerCase();
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function normalizeReceiptTarget(target) {
  exact(target, TARGET_FIELDS, 'SOURCE_RECEIPT_TARGET_INVALID');
  const chainId = assertUint256(target.chainId, 'SOURCE_RECEIPT_CHAIN_INVALID');
  if (chainId === '0') fail('SOURCE_RECEIPT_CHAIN_INVALID');
  return freeze({
    chainId,
    contract: address(target.contract),
    registerId: digest(target.registerId),
    sourceAuthority: address(target.sourceAuthority),
  });
}

function activeKey({ sourceRegistry, keySetRegistry, sourceId, at }) {
  const source = sourceRegistry.requireActive(sourceId, SOURCE_RECEIPT_SCHEMA);
  const key = keySetRegistry.requireValid(source.keySetId, at);
  if (
    !Number.isFinite(new Date(key.validFrom).getTime()) ||
    (key.expiresAt !== null &&
      key.expiresAt !== undefined &&
      !Number.isFinite(new Date(key.expiresAt).getTime()))
  )
    fail('SOURCE_RECEIPT_KEY_INVALID');
  return { source, key };
}

/** Verify the original source's signed complete field commitment, not a caller flag or URL. */
export function verifySourceReceipt({
  response,
  recordRef,
  sourceId,
  registrationSource,
  target,
  sourceRegistry,
  keySetRegistry,
  now,
  maxClockSkewSeconds = 300,
  acceptedEnvelopeHash,
}) {
  let snapshot;
  try {
    snapshot = structuredClone(response);
  } catch {
    fail('SOURCE_RECEIPT_RESPONSE_INVALID');
  }
  const envelope = snapshot?.envelope;
  exact(envelope, ENVELOPE_FIELDS);
  if (
    envelope.sourceId !== sourceId ||
    envelope.schemaVersion !== SOURCE_RECEIPT_SCHEMA ||
    envelope.recordReference !== fixedReference(recordRef)
  )
    fail('SOURCE_RECEIPT_SOURCE_MISMATCH');
  if (
    snapshot.authenticated !== true ||
    snapshot.sourceId !== sourceId ||
    snapshot.schemaVersion !== SOURCE_RECEIPT_SCHEMA ||
    !snapshot.record
  )
    fail('SOURCE_RECEIPT_SOURCE_AUTHENTICATION_REQUIRED');
  const issuedAt = new Date(envelope.issuedAt);
  if (
    typeof envelope.issuedAt !== 'string' ||
    !Number.isFinite(issuedAt.getTime()) ||
    issuedAt.toISOString() !== envelope.issuedAt ||
    !Number.isFinite(now.getTime())
  )
    fail('SOURCE_RECEIPT_TIME_INVALID');
  const age = now - issuedAt;
  if (
    age < -maxClockSkewSeconds * 1000 ||
    (age > maxClockSkewSeconds * 1000 && acceptedEnvelopeHash !== evidenceHash(envelope))
  )
    fail('SOURCE_RECEIPT_TIME_INVALID');
  const encoded = Buffer.from(canonicalJson(envelope), 'utf8');
  if (encoded.length > 16384) fail('SOURCE_RECEIPT_PAYLOAD_TOO_LARGE');
  identifier(envelope.nonce);
  identifier(envelope.idempotencyKey);
  const { source, key } = activeKey({ sourceRegistry, keySetRegistry, sourceId, at: issuedAt });
  const current = activeKey({ sourceRegistry, keySetRegistry, sourceId, at: now });
  if (current.source.keySetId !== source.keySetId) fail('SOURCE_RECEIPT_KEY_CHANGED');
  let valid = false;
  try {
    if (typeof snapshot.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(snapshot.signature))
      fail('SOURCE_RECEIPT_SIGNATURE_INVALID');
    const publicKey =
      key.publicKey?.type === 'public' ? key.publicKey : createPublicKey(key.publicKey);
    valid =
      publicKey.asymmetricKeyType === 'ed25519' &&
      verify(null, encoded, publicKey, Buffer.from(snapshot.signature, 'base64url'));
  } catch {
    fail('SOURCE_RECEIPT_SIGNATURE_INVALID');
  }
  if (!valid) fail('SOURCE_RECEIPT_SIGNATURE_INVALID');
  if (
    snapshot.recordHash !== evidenceHash(envelope.payload) ||
    evidenceHash(snapshot.record) !== snapshot.recordHash
  )
    fail('SOURCE_RECEIPT_RECORD_HASH_MISMATCH');
  const payload = envelope.payload;
  exact(payload, PAYLOAD_FIELDS);
  if (
    !REGISTRATION_SOURCES.includes(registrationSource) ||
    payload.registrationSource !== registrationSource
  )
    fail('SOURCE_RECEIPT_REGISTRATION_SOURCE_MISMATCH');
  const normalizedTarget = normalizeReceiptTarget(payload.target);
  if (canonicalJson(normalizedTarget) !== canonicalJson(normalizeReceiptTarget(target)))
    fail('SOURCE_RECEIPT_DOMAIN_MISMATCH');
  exact(payload.binding, BINDING_FIELDS);
  const binding = Object.fromEntries(
    BINDING_FIELDS.map((field) => [field, digest(payload.binding[field])]),
  );
  if (binding.schemaId !== RECEIPT_BINDING_SCHEMA) fail('SOURCE_RECEIPT_BINDING_SCHEMA_INVALID');
  const expectedPreviousVersion = assertUint64(
    payload.expectedPreviousVersion,
    'SOURCE_RECEIPT_VERSION_INVALID',
  );
  if (expectedPreviousVersion === '0' || BigInt(expectedPreviousVersion) === (1n << 64n) - 1n)
    fail('SOURCE_RECEIPT_VERSION_INVALID');
  return freeze({
    sourceId,
    schemaVersion: SOURCE_RECEIPT_SCHEMA,
    registrationSource,
    recordReference: recordRef,
    envelopeHash: evidenceHash(envelope),
    idempotencyKey: envelope.idempotencyKey,
    nonceHash: evidenceHash({ sourceId, nonce: envelope.nonce }),
    target: normalizedTarget,
    tokenId: assertUint256(payload.tokenId, 'SOURCE_RECEIPT_TOKEN_INVALID'),
    expectedPreviousVersion,
    previousCommitment: digest(payload.previousCommitment),
    recordCommitment: digest(payload.recordCommitment),
    registryReference: digest(payload.registryReference, true),
    holder: address(payload.holder),
    effectiveAt: assertUint64(payload.effectiveAt, 'SOURCE_RECEIPT_EFFECTIVE_AT_INVALID'),
    binding,
  });
}

/** Internal Oracle source workflow. No HTTP upload, arbitrary holder, or signer parameter. */
export class SourceReceiptIngress {
  constructor({
    sourceId,
    registrationSource,
    sourcePort,
    sourceRegistry,
    keySetRegistry,
    target,
    journal,
    writer,
    formatVerifier,
    formatProfileId,
    clock = () => new Date(),
    guardSideEffect = (operation) => operation(),
    writesAllowed = () => false,
  }) {
    if (
      !REGISTRATION_SOURCES.includes(registrationSource) ||
      typeof sourceId !== 'string' ||
      !/^[a-z][a-z0-9-]{2,63}$/.test(sourceId) ||
      typeof sourcePort?.fetchByFixedReference !== 'function' ||
      typeof sourceRegistry?.requireActive !== 'function' ||
      typeof keySetRegistry?.requireValid !== 'function' ||
      ['prepare', 'get', 'claim', 'observe', 'invalidatePrepared'].some(
        (name) => typeof journal?.[name] !== 'function',
      ) ||
      ['validateIntent', 'submit', 'reconcile'].some(
        (name) => typeof writer?.[name] !== 'function',
      ) ||
      typeof formatVerifier?.verifyOriginalRegistration !== 'function' ||
      typeof formatProfileId !== 'string' ||
      !/^[a-z][a-z0-9._/-]{2,127}$/.test(formatProfileId) ||
      typeof clock !== 'function' ||
      typeof guardSideEffect !== 'function' ||
      typeof writesAllowed !== 'function'
    )
      fail('SOURCE_RECEIPT_DEPENDENCY_INVALID');
    Object.assign(this, {
      sourceId,
      registrationSource,
      sourcePort,
      sourceRegistry,
      keySetRegistry,
      target: normalizeReceiptTarget(target),
      journal,
      writer,
      formatVerifier,
      formatProfileId,
      clock,
      guardSideEffect,
      writesAllowed,
    });
  }

  assertAdmission() {
    if (this.writesAllowed() !== true) fail('SOURCE_RECEIPT_WRITES_DISABLED');
    activeKey({
      sourceRegistry: this.sourceRegistry,
      keySetRegistry: this.keySetRegistry,
      sourceId: this.sourceId,
      at: this.clock(),
    });
  }

  async ingest(input) {
    exact(input, ['recordRef'], 'SOURCE_RECEIPT_INPUT_INVALID');
    const recordRef = fixedReference(input.recordRef);
    this.assertAdmission();
    const response = await this.guardSideEffect(() =>
      this.sourcePort.fetchByFixedReference(recordRef),
    );
    this.assertAdmission();
    const intent = verifySourceReceipt({
      response,
      recordRef,
      sourceId: this.sourceId,
      registrationSource: this.registrationSource,
      target: this.target,
      sourceRegistry: this.sourceRegistry,
      keySetRegistry: this.keySetRegistry,
      now: this.clock(),
    });
    const existing = await this.journal.get(evidenceHash(intent));
    if (existing && existing.state !== 'PREPARED')
      return this.reconcile({ intentHash: existing.intentHash });
    return this.#admit(intent, existing);
  }

  async #admit(intent, existing = null) {
    // This server-owned capability must retrieve the original via its fixed source,
    // recompute its digest, validate the mint-committed format and map every signed field.
    // Source signature authentication alone is not original-document validation.
    const format = await this.guardSideEffect(() =>
      this.formatVerifier.verifyOriginalRegistration({
        profileId: this.formatProfileId,
        intent: structuredClone(intent),
      }),
    );
    exact(
      format,
      [
        'verified',
        'profileId',
        'intentHash',
        'receiptDocumentHash',
        'mintPolicyHash',
        'receiptFormatHash',
      ],
      'SOURCE_RECEIPT_FORMAT_PROOF_INVALID',
    );
    if (
      format.verified !== true ||
      format.profileId !== this.formatProfileId ||
      format.intentHash !== evidenceHash(intent) ||
      format.receiptDocumentHash !== intent.binding.receiptDocumentHash ||
      format.mintPolicyHash !== intent.binding.mintPolicyHash
    )
      fail('SOURCE_RECEIPT_FORMAT_PROOF_INVALID');
    digest(format.receiptFormatHash);
    this.assertAdmission();
    // Validate before persistence; once a durable claim exists, uncertainty never becomes a new submission.
    try {
      await this.guardSideEffect(() => this.writer.validateIntent(intent));
    } catch (failure) {
      if (
        existing?.state === 'PREPARED' &&
        failure?.errorCode === 'RECEIPT_PREVIOUS_ENTRY_MISMATCH'
      )
        return this.journal.invalidatePrepared(existing.intentHash, {
          expectedRevision: existing.revision,
        });
      throw failure;
    }
    this.assertAdmission();
    const prepared = existing ?? (await this.journal.prepare(intent));
    if (prepared.state !== 'PREPARED') return this.reconcile({ intentHash: prepared.intentHash });
    const claim = await this.journal.claim(prepared.intentHash);
    if (!claim.claimed) return this.reconcile({ intentHash: prepared.intentHash });
    let transactionHash;
    try {
      this.assertAdmission();
      transactionHash = await this.guardSideEffect(() => this.writer.submit(claim.record));
    } catch {
      // A broker may have submitted before its response failed. Persist uncertainty, never retry.
      return this.journal.observe(
        prepared.intentHash,
        { state: 'UNKNOWN', reason: 'SOURCE_RECEIPT_SUBMISSION_UNCERTAIN' },
        { expectedRevision: claim.record.revision },
      );
    }
    // If this commit is uncertain, propagate the repository outcome. Do not issue another write or submit.
    await this.journal.observe(
      prepared.intentHash,
      { state: 'SUBMITTED', transactionHash },
      { expectedRevision: claim.record.revision },
    );
    return this.reconcile({ intentHash: prepared.intentHash });
  }

  async reconcile(input) {
    exact(input, ['intentHash'], 'SOURCE_RECEIPT_INPUT_INVALID');
    if (typeof input.intentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.intentHash))
      fail('SOURCE_RECEIPT_INTENT_HASH_INVALID');
    const record = await this.journal.get(input.intentHash);
    if (!record) fail('SOURCE_RECEIPT_NOT_FOUND');
    if (
      record.intent.sourceId !== this.sourceId ||
      record.intent.registrationSource !== this.registrationSource ||
      canonicalJson(record.intent.target) !== canonicalJson(this.target) ||
      evidenceHash(record.intent) !== record.intentHash
    )
      fail('SOURCE_RECEIPT_STORED_INTENT_MISMATCH');
    if (record.state === 'OBSOLETE') return record;
    if (record.state === 'PREPARED') {
      // A durable authenticated acceptance can outlive the freshness window, but
      // only the exact original signed envelope may resume a never-claimed intent.
      this.assertAdmission();
      const response = await this.guardSideEffect(() =>
        this.sourcePort.fetchByFixedReference(record.intent.recordReference),
      );
      this.assertAdmission();
      const intent = verifySourceReceipt({
        response,
        recordRef: record.intent.recordReference,
        sourceId: this.sourceId,
        registrationSource: this.registrationSource,
        target: this.target,
        sourceRegistry: this.sourceRegistry,
        keySetRegistry: this.keySetRegistry,
        now: this.clock(),
        acceptedEnvelopeHash: record.intent.envelopeHash,
      });
      if (evidenceHash(intent) !== record.intentHash)
        fail('SOURCE_RECEIPT_ACCEPTED_ENVELOPE_MISMATCH');
      return this.#admit(intent, record);
    }
    let observation;
    try {
      observation = await this.guardSideEffect(() => this.writer.reconcile(record));
    } catch {
      observation = { state: 'UNKNOWN', reason: 'SOURCE_RECEIPT_OBSERVATION_UNAVAILABLE' };
    }
    return this.journal.observe(input.intentHash, observation, {
      expectedRevision: record.revision,
    });
  }
}

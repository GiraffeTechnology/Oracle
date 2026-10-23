import { canonicalJson, evidenceHash } from '../domain/canonical-json.js';

const INTENT_KEYS = [
  'sourceId',
  'schemaVersion',
  'envelopeHash',
  'idempotencyKey',
  'nonceHash',
  'recordReference',
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
const TARGET_KEYS = ['chainId', 'contract', 'registerId', 'sourceAuthority'];
const BINDING_KEYS = [
  'schemaId',
  'mintPolicyHash',
  'segmentDigest',
  'requestHash',
  'receiptDocumentHash',
];
const OBSERVATION_KEYS = [
  'state',
  'transactionHash',
  'blockHash',
  'blockNumber',
  'version',
  'reason',
];
const HASH = /^(?:0x)?[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const OBSERVED_STATES = ['SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED', 'REORGED', 'REJECTED'];
const TRANSITIONS = Object.freeze({
  PREPARED: ['REJECTED'],
  OBSOLETE: [],
  SUBMITTING: OBSERVED_STATES,
  SUBMITTED: OBSERVED_STATES,
  UNKNOWN: OBSERVED_STATES,
  CONFIRMED: OBSERVED_STATES,
  FAILED: OBSERVED_STATES,
  REORGED: OBSERVED_STATES,
  REJECTED: OBSERVED_STATES,
});
const COLUMNS =
  'intent_hash, execution_reference, source_id, idempotency_key, nonce_hash, chain_id, contract_address, register_id, token_id, lane_hash, segment_digest, intent_json, state, transaction_hash, block_hash, block_number, projection_version, reason, revision';
class ReceiptConflict extends Error {}
const conflict = (suffix) => new ReceiptConflict(`SOURCE_RECEIPT_${suffix}`);
const error = (suffix) => new Error(`SOURCE_RECEIPT_${suffix}`);

function plainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function keys(value, allowed, required = allowed) {
  return (
    plainObject(value) &&
    Reflect.ownKeys(value).every(
      (key) =>
        allowed.includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'),
    ) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function boundedText(value, maximum) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/[\uD800-\uDFFF]/u.test(value)
  );
}

function uint(value, bits) {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,77})$/.test(value) &&
    BigInt(value) < 2n ** BigInt(bits)
  );
}

function validHash(value) {
  return typeof value === 'string' && HASH.test(value);
}
function hashBytes(value) {
  return Buffer.from(value.replace(/^0x/, ''), 'hex');
}
function hashHex(value) {
  return hashBytes(value).toString('hex');
}
function bytes(value) {
  return Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null;
}
function utf8(value) {
  return bytes(value)?.toString('utf8') ?? value;
}
function storedHash(value, prefix = '') {
  const buffer = bytes(value);
  if (!buffer || buffer.length !== 32) throw error('STORED_RECORD_INVALID');
  return prefix + buffer.toString('hex');
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateIntent(intent) {
  if (
    !keys(intent, INTENT_KEYS) ||
    !keys(intent.target, TARGET_KEYS) ||
    !keys(intent.binding, BINDING_KEYS) ||
    !boundedText(intent.sourceId, 128) ||
    !boundedText(intent.schemaVersion, 128) ||
    !boundedText(intent.idempotencyKey, 128) ||
    !boundedText(intent.recordReference, 512) ||
    !boundedText(intent.registrationSource, 128) ||
    !boundedText(intent.target.sourceAuthority, 128) ||
    !boundedText(intent.binding.schemaId, 128) ||
    !uint(intent.target.chainId, 256) ||
    !uint(intent.tokenId, 256) ||
    !uint(intent.expectedPreviousVersion, 64) ||
    BigInt(intent.expectedPreviousVersion) === 2n ** 64n - 1n ||
    !uint(intent.effectiveAt, 64) ||
    typeof intent.target.contract !== 'string' ||
    !ADDRESS.test(intent.target.contract) ||
    typeof intent.holder !== 'string' ||
    !ADDRESS.test(intent.holder) ||
    ![
      intent.envelopeHash,
      intent.nonceHash,
      intent.target.registerId,
      intent.previousCommitment,
      intent.recordCommitment,
      intent.registryReference,
      intent.binding.mintPolicyHash,
      intent.binding.segmentDigest,
      intent.binding.requestHash,
      intent.binding.receiptDocumentHash,
    ].every(validHash)
  ) {
    throw error('INTENT_INVALID');
  }
}

function identity(intent) {
  const chainId = intent.target.chainId;
  const contract = intent.target.contract.toLowerCase();
  const registerId = hashHex(intent.target.registerId);
  const segmentDigest = hashHex(intent.binding.segmentDigest);
  const laneHash = evidenceHash({
    kind: 'source-receipt-lane.v1',
    chainId,
    contract,
    registerId,
    tokenId: intent.tokenId,
  });
  // Namespaced binary keys give all processes the same transaction-scoped locks.
  // Sorted acquisition also serializes cross-lane key, nonce and segment conflicts.
  const lockHashes = [
    laneHash,
    evidenceHash({
      kind: 'source-receipt-key.v1',
      sourceId: intent.sourceId,
      key: intent.idempotencyKey,
    }),
    evidenceHash({
      kind: 'source-receipt-nonce.v1',
      sourceId: intent.sourceId,
      nonce: hashHex(intent.nonceHash),
    }),
    evidenceHash({ kind: 'source-receipt-segment.v1', chainId, contract, segmentDigest }),
  ].sort();
  return { laneHash, lockHashes, chainId, contract, registerId, segmentDigest };
}

function decode(row) {
  if (!row) return null;
  try {
    const raw = utf8(row.intent_json);
    const intent = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(canonicalJson(raw));
    validateIntent(intent);
    const intentHash = storedHash(row.intent_hash);
    const scope = identity(intent);
    const revision = Number(row.revision);
    const record = {
      intentHash,
      executionReference: utf8(row.execution_reference),
      state: row.state,
      intent,
      transactionHash: row.transaction_hash == null ? null : storedHash(row.transaction_hash, '0x'),
      blockHash: row.block_hash == null ? null : storedHash(row.block_hash, '0x'),
      blockNumber: row.block_number == null ? null : utf8(row.block_number),
      version: row.projection_version == null ? null : utf8(row.projection_version),
      reason: row.reason ?? null,
      revision,
    };
    if (
      intentHash !== evidenceHash(intent) ||
      record.executionReference !== `oracle-receipt:${intentHash}` ||
      utf8(row.source_id) !== intent.sourceId ||
      utf8(row.idempotency_key) !== intent.idempotencyKey ||
      storedHash(row.nonce_hash) !== hashHex(intent.nonceHash) ||
      utf8(row.chain_id) !== scope.chainId ||
      bytes(row.contract_address)?.toString('hex') !== scope.contract.slice(2) ||
      storedHash(row.register_id) !== scope.registerId ||
      utf8(row.token_id) !== intent.tokenId ||
      storedHash(row.lane_hash) !== scope.laneHash ||
      storedHash(row.segment_digest) !== scope.segmentDigest ||
      !Object.hasOwn(TRANSITIONS, record.state) ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      (record.reason !== null && !boundedText(record.reason, 256))
    )
      throw error('STORED_RECORD_INVALID');
    if (record.state === 'CONFIRMED' || record.state === 'FAILED') {
      if (
        !record.transactionHash ||
        !record.blockHash ||
        !uint(record.blockNumber, 256) ||
        (record.state === 'CONFIRMED'
          ? record.version !== String(BigInt(intent.expectedPreviousVersion) + 1n)
          : record.version !== null)
      )
        throw error('STORED_RECORD_INVALID');
    } else if (
      record.blockHash !== null ||
      record.blockNumber !== null ||
      record.version !== null
    ) {
      throw error('STORED_RECORD_INVALID');
    }
    if (
      ['PREPARED', 'OBSOLETE', 'SUBMITTING'].includes(record.state) &&
      record.transactionHash !== null
    )
      throw error('STORED_RECORD_INVALID');
    if (['SUBMITTED', 'REORGED'].includes(record.state) && !record.transactionHash)
      throw error('STORED_RECORD_INVALID');
    return deepFreeze(record);
  } catch {
    throw error('STORED_RECORD_INVALID');
  }
}

function validateIntentHash(intentHash) {
  if (typeof intentHash !== 'string' || !/^[0-9a-f]{64}$/.test(intentHash))
    throw error('INTENT_HASH_INVALID');
}

function validateObservation(observation) {
  if (
    !keys(observation, OBSERVATION_KEYS, ['state']) ||
    !OBSERVED_STATES.includes(observation.state) ||
    ['transactionHash', 'blockHash'].some(
      (key) => observation[key] != null && !validHash(observation[key]),
    ) ||
    (observation.blockNumber != null && !uint(observation.blockNumber, 256)) ||
    (observation.version != null && !uint(observation.version, 64)) ||
    (observation.reason != null && !boundedText(observation.reason, 256)) ||
    (observation.state === 'CONFIRMED' &&
      (!validHash(observation.transactionHash) ||
        !validHash(observation.blockHash) ||
        !uint(observation.blockNumber, 256) ||
        !uint(observation.version, 64))) ||
    (observation.state === 'FAILED' &&
      (!validHash(observation.transactionHash) ||
        !validHash(observation.blockHash) ||
        !uint(observation.blockNumber, 256) ||
        observation.version != null)) ||
    (!['CONFIRMED', 'FAILED'].includes(observation.state) &&
      ['blockHash', 'blockNumber', 'version'].some((key) => observation[key] != null))
  ) {
    throw error('OBSERVATION_INVALID');
  }
}

/**
 * Oracle implementation-specific durable submission journal, not an ERC rule.
 * The injected repository exclusively owns connection acquisition, transactions,
 * outcome classification and disposal. Never retry or unwrap its outcome errors.
 * A committed claim is the only permission to attempt external submission.
 */
export class MySqlReceiptJournal {
  #repository;

  constructor({ repository }) {
    if (!repository || typeof repository.transaction !== 'function')
      throw error('REPOSITORY_INVALID');
    this.#repository = repository;
  }

  async #transaction(operation) {
    const result = await this.#repository.transaction(async (connection) => {
      try {
        return await operation(connection);
      } catch (failure) {
        // Expected refusals happen before journal mutation. Commit only harmless lock rows,
        // then report outside the transaction so lifecycle does not classify them as DB faults.
        if (failure instanceof ReceiptConflict) return { refusal: failure.message };
        throw failure;
      }
    });
    if (result?.refusal) throw new Error(result.refusal);
    return result;
  }

  async #lock(connection, lockHashes) {
    for (const lockHash of [...new Set(lockHashes)].sort()) {
      await connection.execute(
        'INSERT INTO source_receipt_journal_locks (lock_hash) VALUES (?) ON DUPLICATE KEY UPDATE lock_hash = lock_hash',
        [hashBytes(lockHash)],
      );
      const [rows] = await connection.execute(
        'SELECT lock_hash FROM source_receipt_journal_locks WHERE lock_hash = ? FOR UPDATE',
        [hashBytes(lockHash)],
      );
      if (rows.length !== 1) throw error('LOCK_FAILED');
    }
  }

  async #read(connection, intentHash, lock = false) {
    const [rows] = await connection.execute(
      `SELECT ${COLUMNS} FROM source_receipt_journal WHERE intent_hash = ?${lock ? ' FOR UPDATE' : ''}`,
      [hashBytes(intentHash)],
    );
    return decode(rows[0]);
  }

  async #lockedRecord(connection, intentHash) {
    const initial = await this.#read(connection, intentHash);
    if (!initial) throw conflict('NOT_FOUND');
    await this.#lock(connection, [identity(initial.intent).laneHash]);
    const current = await this.#read(connection, intentHash, true);
    if (!current) throw conflict('NOT_FOUND');
    return current;
  }

  async #assertLaneAvailable(connection, laneHash, exceptIntentHash) {
    const [rows] = await connection.execute(
      "SELECT intent_hash FROM source_receipt_journal WHERE lane_hash = ? AND state NOT IN ('CONFIRMED','FAILED','OBSOLETE') AND intent_hash <> ? FOR UPDATE",
      [hashBytes(laneHash), hashBytes(exceptIntentHash)],
    );
    if (rows.length !== 0) throw conflict('LANE_UNRESOLVED');
  }

  async prepare(input) {
    validateIntent(input);
    const intent = JSON.parse(canonicalJson(input));
    const intentHash = evidenceHash(intent);
    const scope = identity(intent);
    return this.#transaction(async (connection) => {
      await this.#lock(connection, scope.lockHashes);
      const [rows] = await connection.execute(
        `SELECT ${COLUMNS} FROM source_receipt_journal WHERE intent_hash = ? OR (source_id = ? AND idempotency_key = ?) OR (source_id = ? AND nonce_hash = ?) OR (chain_id = ? AND contract_address = ? AND segment_digest = ?) FOR UPDATE`,
        [
          hashBytes(intentHash),
          Buffer.from(intent.sourceId),
          Buffer.from(intent.idempotencyKey),
          Buffer.from(intent.sourceId),
          hashBytes(intent.nonceHash),
          Buffer.from(scope.chainId),
          Buffer.from(scope.contract.slice(2), 'hex'),
          hashBytes(scope.segmentDigest),
        ],
      );
      const existing = rows.map(decode);
      for (const record of existing) {
        if (record.intentHash === intentHash) continue;
        if (
          record.intent.sourceId === intent.sourceId &&
          record.intent.idempotencyKey === intent.idempotencyKey
        )
          throw conflict('IDEMPOTENCY_CONFLICT');
        if (
          record.intent.sourceId === intent.sourceId &&
          hashHex(record.intent.nonceHash) === hashHex(intent.nonceHash)
        )
          throw conflict('NONCE_CONFLICT');
        throw conflict('SEGMENT_CONFLICT');
      }
      if (existing.length !== 0) return existing[0];
      await this.#assertLaneAvailable(connection, scope.laneHash, intentHash);
      const executionReference = `oracle-receipt:${intentHash}`;
      await connection.execute(
        `INSERT INTO source_receipt_journal (intent_hash, execution_reference, source_id, idempotency_key, nonce_hash, chain_id, contract_address, register_id, token_id, lane_hash, segment_digest, intent_json, state, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [
          hashBytes(intentHash),
          Buffer.from(executionReference),
          Buffer.from(intent.sourceId),
          Buffer.from(intent.idempotencyKey),
          hashBytes(intent.nonceHash),
          Buffer.from(scope.chainId),
          Buffer.from(scope.contract.slice(2), 'hex'),
          hashBytes(scope.registerId),
          Buffer.from(intent.tokenId),
          hashBytes(scope.laneHash),
          hashBytes(scope.segmentDigest),
          canonicalJson(intent),
        ],
      );
      const result = await this.#read(connection, intentHash, true);
      if (!result) throw error('WRITE_NOT_OBSERVED');
      return result;
    });
  }

  async get(intentHash) {
    validateIntentHash(intentHash);
    return this.#transaction((connection) => this.#read(connection, intentHash));
  }

  async #update(connection, current, next) {
    if (current.revision >= Number.MAX_SAFE_INTEGER) throw error('REVISION_EXHAUSTED');
    const [result] = await connection.execute(
      'UPDATE source_receipt_journal SET state = ?, transaction_hash = ?, block_hash = ?, block_number = ?, projection_version = ?, reason = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE intent_hash = ? AND revision = ? AND state = ?',
      [
        next.state,
        next.transactionHash === null ? null : hashBytes(next.transactionHash),
        next.blockHash === null ? null : hashBytes(next.blockHash),
        next.blockNumber === null ? null : Buffer.from(next.blockNumber),
        next.version === null ? null : Buffer.from(next.version),
        next.reason,
        hashBytes(current.intentHash),
        current.revision,
        current.state,
      ],
    );
    if (result?.affectedRows !== 1) throw error('UPDATE_CONFLICT');
    return deepFreeze({ ...current, ...next, revision: current.revision + 1 });
  }

  async claim(intentHash) {
    validateIntentHash(intentHash);
    return this.#transaction(async (connection) => {
      const current = await this.#lockedRecord(connection, intentHash);
      if (current.state !== 'PREPARED') return Object.freeze({ claimed: false, record: current });
      await this.#assertLaneAvailable(connection, identity(current.intent).laneHash, intentHash);
      const record = await this.#update(connection, current, { ...current, state: 'SUBMITTING' });
      return Object.freeze({ claimed: true, record });
    });
  }

  async invalidatePrepared(intentHash, { expectedRevision } = {}) {
    validateIntentHash(intentHash);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw error('OBSERVATION_REVISION_REQUIRED');
    return this.#transaction(async (connection) => {
      const current = await this.#lockedRecord(connection, intentHash);
      if (current.state !== 'PREPARED' || current.revision !== expectedRevision)
        throw conflict('PREPARED_STATE_CHANGED');
      return this.#update(connection, current, {
        ...current,
        state: 'OBSOLETE',
        reason: 'PREDECESSOR_CHANGED',
      });
    });
  }

  async observe(intentHash, input, { expectedRevision } = {}) {
    validateIntentHash(intentHash);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw error('OBSERVATION_REVISION_REQUIRED');
    validateObservation(input);
    const observation = JSON.parse(canonicalJson(input));
    const result = await this.#transaction(async (connection) => {
      const current = await this.#lockedRecord(connection, intentHash);
      // The external observation belongs to the revision read BEFORE the RPC work.
      if (current.revision !== expectedRevision) return { stale: true };
      if (!TRANSITIONS[current.state].includes(observation.state))
        throw conflict('STATE_TRANSITION_INVALID');
      const transactionHash =
        observation.transactionHash == null
          ? current.transactionHash
          : `0x${hashHex(observation.transactionHash)}`;
      if (current.transactionHash !== null && transactionHash !== current.transactionHash)
        throw conflict('TRANSACTION_CONFLICT');
      if (
        ['SUBMITTED', 'CONFIRMED', 'FAILED', 'REORGED'].includes(observation.state) &&
        transactionHash === null
      )
        throw error('OBSERVATION_INVALID');
      const confirmed = observation.state === 'CONFIRMED';
      const settled = confirmed || observation.state === 'FAILED';
      const next = {
        state: observation.state,
        transactionHash,
        blockHash: settled ? `0x${hashHex(observation.blockHash)}` : null,
        blockNumber: settled ? observation.blockNumber : null,
        version: confirmed ? observation.version : null,
        reason: observation.reason ?? null,
      };
      if (confirmed && next.version !== String(BigInt(current.intent.expectedPreviousVersion) + 1n))
        throw conflict('VERSION_CONFLICT');
      if (
        ['CONFIRMED', 'FAILED'].includes(current.state) &&
        settled &&
        (next.state !== current.state ||
          next.blockHash !== current.blockHash ||
          next.blockNumber !== current.blockNumber ||
          next.version !== current.version)
      )
        throw conflict('CONFIRMATION_CONFLICT');
      if (Object.keys(next).every((key) => current[key] === next[key])) return current;
      return this.#update(connection, current, next);
    });
    // No failed transaction/rollback for a normal observation race. Never apply the stale result.
    if (result.stale) throw error('OBSERVATION_STALE');
    return result;
  }
}

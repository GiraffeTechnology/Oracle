import { evidenceHash } from '../domain/canonical-json.js';
import {
  ADDRESS,
  BYTES32,
  ProjectionSourceError,
  assertUint64,
  assertUint256,
} from '../ports/projection-source.js';
import {
  RECEIPT_ABI,
  RECEIPT_SCHEMA_ID,
  RECEIPT_FIELDS,
  ZERO_WORD,
  abiWord,
  abiWords,
  abiAddress,
  abiUint64,
} from './evm-receipt-source.js';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const HASH = /^(?:0x)?[0-9a-f]{64}$/;
const INTENT_FIELDS = [
  'sourceId',
  'registrationSource',
  'schemaVersion',
  'envelopeHash',
  'idempotencyKey',
  'nonceHash',
  'recordReference',
  'target',
  'tokenId',
  'expectedPreviousVersion',
  'previousCommitment',
  'recordCommitment',
  'registryReference',
  'holder',
  'effectiveAt',
  'binding',
]
  .sort()
  .join(',');
const fail = (code, status = 409) => new ProjectionSourceError(code, status);
const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : null);
function exactKeys(value, fields) {
  return !!value && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields;
}
function text(value, max) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
function word(value, nonzero = false) {
  return (
    typeof value === 'string' && BYTES32.test(value) && (!nonzero || lower(value) !== ZERO_WORD)
  );
}
function quantity(value) {
  return typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
    ? BigInt(value)
    : null;
}

/** ABI is closed over one operation: caller-controlled raw transaction data is never accepted. */
export function encodeReceiptAppend(intent) {
  return (
    RECEIPT_ABI.appendReceiptFromSourceChecked +
    [
      abiWord(intent.tokenId),
      intent.recordCommitment.slice(2),
      intent.registryReference.slice(2),
      intent.holder.slice(2).padStart(64, '0'),
      abiWord(intent.effectiveAt),
      abiWord(intent.expectedPreviousVersion),
      intent.previousCommitment.slice(2),
      ...RECEIPT_FIELDS.map((field) => intent.binding[field].slice(2)),
    ]
      .join('')
      .toLowerCase()
  );
}

/** Existing broker/signing reference only; this adapter neither provisions nor holds keys. */
export class SourceReceiptWriter {
  #projection;
  #client;
  #signerReference;
  #guard;
  #beforeSubmit;
  constructor({
    projection,
    executionClient,
    signerReference,
    guardSideEffect = (operation) => operation(),
    beforeSubmit = () => {},
  }) {
    if (
      !projection?.binding ||
      ![
        'receiptSnapshot',
        'snapshotAtBlock',
        'transactionObservation',
        'assertCanonicalBlock',
      ].every((key) => typeof projection[key] === 'function') ||
      !Number.isSafeInteger(projection.minConfirmations) ||
      projection.minConfirmations < 1
    )
      throw fail('RECEIPT_PROJECTION_INVALID', 400);
    if (
      !executionClient ||
      typeof executionClient.submit !== 'function' ||
      typeof executionClient.lookup !== 'function'
    )
      throw fail('RECEIPT_EXECUTION_CLIENT_INVALID', 400);
    if (!text(signerReference, 256) || /^(?:0x)?[0-9a-fA-F]{64}$/.test(signerReference))
      throw fail('RECEIPT_SIGNER_REFERENCE_INVALID', 400);
    if (typeof beforeSubmit !== 'function') throw fail('RECEIPT_PREFLIGHT_INVALID', 400);
    this.#beforeSubmit = beforeSubmit;
    if (typeof guardSideEffect !== 'function') throw fail('RECEIPT_GUARD_INVALID', 400);
    this.#projection = projection;
    this.#client = executionClient;
    this.#signerReference = signerReference;
    this.#guard = guardSideEffect;
  }

  async validateIntent(intent) {
    intent = structuredClone(intent);
    this.#intent(intent);
    const snapshot = await this.#guard(() => this.#projection.receiptSnapshot(intent.tokenId));
    this.#domain(snapshot, intent);
    if (lower(snapshot.mintPolicyHash) !== lower(intent.binding.mintPolicyHash))
      throw fail('RECEIPT_MINT_POLICY_MISMATCH');
    if (
      snapshot.entry.version !== intent.expectedPreviousVersion ||
      lower(snapshot.entry.recordCommitment) !== lower(intent.previousCommitment)
    )
      throw fail('RECEIPT_PREVIOUS_ENTRY_MISMATCH');
    if (
      snapshot.entry.supersededAt !== '0' ||
      BigInt(intent.effectiveAt) <= BigInt(snapshot.entry.effectiveAt)
    )
      throw fail('RECEIPT_EFFECTIVE_AT_INVALID');
    return snapshot;
  }

  async submit(record) {
    record = structuredClone(record);
    this.#record(record);
    // The service must durably claim this intent before invoking submit. A known
    // transaction is reconciled, never submitted again, including after restart.
    if (record.state !== 'SUBMITTING' || record.transactionHash)
      throw fail('RECEIPT_SUBMISSION_STATE_INVALID');
    await this.validateIntent(record.intent);
    const target = this.#projection.binding;
    const result = await this.#guard(() => {
      const check = this.#beforeSubmit(structuredClone(record.intent));
      if (check && typeof check.then === 'function') {
        void Promise.resolve(check).catch(() => {});
        throw fail('RECEIPT_PREFLIGHT_ASYNC_REFUSED', 503);
      }
      return this.#client.submit({
        executionReference: record.executionReference,
        signerReference: this.#signerReference,
        chainId: target.chainId,
        from: target.sourceAuthority,
        to: target.contract,
        data: encodeReceiptAppend(record.intent),
        value: '0x0',
      });
    });
    const hash = typeof result === 'string' ? result : result?.transactionHash;
    if (!word(hash, true)) throw fail('RECEIPT_EXECUTION_RESULT_UNKNOWN', 503);
    return hash.toLowerCase();
  }

  async reconcile(record) {
    record = structuredClone(record);
    this.#record(record);
    let transactionHash = record.transactionHash ? lower(record.transactionHash) : null;
    const observation = (state, reason, extra = {}) => ({
      state,
      transactionHash,
      reason,
      blockHash: ['CONFIRMED', 'FAILED'].includes(state) ? (extra.blockHash ?? null) : null,
      blockNumber: ['CONFIRMED', 'FAILED'].includes(state) ? (extra.blockNumber ?? null) : null,
      version: state === 'CONFIRMED' ? (extra.version ?? null) : null,
    });
    try {
      if (!transactionHash) {
        const found = await this.#guard(() =>
          this.#client.lookup({
            executionReference: record.executionReference,
            signerReference: this.#signerReference,
          }),
        );
        const recovered = typeof found === 'string' ? found : found?.transactionHash;
        if (!word(recovered, true)) return observation('UNKNOWN', 'EXECUTION_NOT_OBSERVED');
        transactionHash = recovered.toLowerCase();
      }
      if (record.blockHash && record.blockNumber) {
        await this.#guard(() =>
          this.#projection.assertCanonicalBlock({
            number: record.blockNumber,
            hash: lower(record.blockHash),
          }),
        );
      }
      const seen = await this.#guard(() =>
        this.#projection.transactionObservation(transactionHash),
      );
      if (!seen.transaction) return observation('UNKNOWN', 'TRANSACTION_NOT_OBSERVED');
      if (!this.#transaction(seen.transaction, record.intent, transactionHash))
        return observation('REJECTED', 'TRANSACTION_MISMATCH');
      if (!seen.receipt) return observation('SUBMITTED', 'RECEIPT_PENDING');
      if (!seen.canonical) return observation('REORGED', 'RECEIPT_BLOCK_NOT_CANONICAL');
      const receipt = seen.receipt;
      const block = seen.block;
      const extra = { blockHash: block.hash, blockNumber: block.number };
      if (
        lower(receipt.transactionHash) !== transactionHash ||
        lower(receipt.blockHash) !== lower(seen.transaction.blockHash) ||
        quantity(receipt.blockNumber) !== quantity(seen.transaction.blockNumber) ||
        lower(receipt.from) !== lower(record.intent.target.sourceAuthority) ||
        lower(receipt.to) !== lower(record.intent.target.contract)
      )
        return observation('REJECTED', 'RECEIPT_TRANSACTION_MISMATCH', extra);
      if (quantity(receipt.status) === 0n) {
        await this.#guard(() => this.#projection.assertCanonicalBlock(block));
        await this.#guard(() => this.#projection.assertCanonicalBlock(seen.head));
        const confirmedFailure =
          BigInt(seen.head.number) - BigInt(block.number) + 1n >=
          BigInt(this.#projection.minConfirmations);
        return observation(
          confirmedFailure ? 'FAILED' : 'SUBMITTED',
          confirmedFailure ? 'TRANSACTION_REVERTED' : 'FAILURE_CONFIRMATIONS_PENDING',
          extra,
        );
      }
      if (quantity(receipt.status) !== 1n)
        return observation('UNKNOWN', 'RECEIPT_STATUS_INVALID', extra);
      const version = (BigInt(record.intent.expectedPreviousVersion) + 1n).toString();
      if (!this.#logs(receipt, record.intent, transactionHash, version))
        return observation('REJECTED', 'RECEIPT_EVENTS_MISMATCH', extra);
      const snapshot = await this.#guard(() =>
        this.#projection.snapshotAtBlock(record.intent.tokenId, version, block),
      );
      this.#domain(snapshot, record.intent);
      const intent = record.intent;
      const expected = {
        version,
        holder: lower(intent.holder),
        effectiveAt: intent.effectiveAt,
        recordCommitment: lower(intent.recordCommitment),
        previousCommitment: lower(intent.previousCommitment),
        registryReference: lower(intent.registryReference),
      };
      // Later entries in the SAME block may close this entry. Verify that closure
      // as an interval, never require latest-only supersededAt=0 for historical proof.
      if (
        Object.entries(expected).some(([key, value]) => lower(snapshot.entry[key]) !== value) ||
        (snapshot.entry.supersededAt !== '0' &&
          BigInt(snapshot.entry.supersededAt) <= BigInt(intent.effectiveAt)) ||
        lower(snapshot.mintPolicyHash) !== lower(intent.binding.mintPolicyHash) ||
        RECEIPT_FIELDS.some(
          (field) => lower(snapshot.receiptBinding[field]) !== lower(intent.binding[field]),
        ) ||
        snapshot.block.number !== block.number ||
        snapshot.block.hash !== block.hash
      )
        return observation('REJECTED', 'RECEIPT_STATE_MISMATCH', { ...extra, version });
      if (snapshot.entry.supersededAt !== '0') {
        const nextVersion = (BigInt(version) + 1n).toString();
        const next = await this.#guard(() =>
          this.#projection.snapshotAtBlock(intent.tokenId, nextVersion, block),
        );
        this.#domain(next, intent);
        if (
          next.entry.version !== nextVersion ||
          next.entry.effectiveAt !== snapshot.entry.supersededAt ||
          lower(next.entry.previousCommitment) !== lower(intent.recordCommitment) ||
          next.block.number !== block.number ||
          next.block.hash !== block.hash
        ) {
          return observation('REJECTED', 'RECEIPT_STATE_MISMATCH');
        }
      }
      await this.#guard(() => this.#projection.assertCanonicalBlock(block));
      await this.#guard(() => this.#projection.assertCanonicalBlock(seen.head));
      const confirmations = BigInt(seen.head.number) - BigInt(block.number) + 1n;
      return observation(
        confirmations >= BigInt(this.#projection.minConfirmations) ? 'CONFIRMED' : 'SUBMITTED',
        confirmations >= BigInt(this.#projection.minConfirmations) ? null : 'CONFIRMATIONS_PENDING',
        { ...extra, version },
      );
    } catch (error) {
      if (error?.errorCode === 'RECEIPT_SOURCE_REORGED')
        return observation('REORGED', 'RECEIPT_BLOCK_NOT_CANONICAL');
      return observation('UNKNOWN', 'RECONCILIATION_UNAVAILABLE');
    }
  }

  #intent(intent) {
    if (
      !exactKeys(intent, INTENT_FIELDS) ||
      !text(intent.sourceId, 128) ||
      !text(intent.registrationSource, 128) ||
      !text(intent.schemaVersion, 128) ||
      !HASH.test(intent.envelopeHash) ||
      !HASH.test(intent.nonceHash) ||
      !text(intent.idempotencyKey, 256) ||
      !text(intent.recordReference, 2048) ||
      !exactKeys(intent.target, 'chainId,contract,registerId,sourceAuthority') ||
      !exactKeys(intent.binding, RECEIPT_FIELDS.toSorted().join(','))
    )
      throw fail('RECEIPT_INTENT_INVALID', 400);
    assertUint256(intent.tokenId, 'TOKEN_ID_INVALID');
    assertUint64(intent.expectedPreviousVersion, 'VERSION_INVALID');
    assertUint64(intent.effectiveAt, 'INSTANT_INVALID');
    if (
      intent.expectedPreviousVersion === '0' ||
      BigInt(intent.expectedPreviousVersion) === 2n ** 64n - 1n ||
      !word(intent.previousCommitment, true) ||
      !word(intent.recordCommitment, true) ||
      !word(intent.registryReference) ||
      lower(intent.previousCommitment) === lower(intent.recordCommitment) ||
      !ADDRESS.test(intent.holder) ||
      lower(intent.holder) === ZERO_ADDRESS ||
      RECEIPT_FIELDS.some((field) => !word(intent.binding[field], true)) ||
      lower(intent.binding.schemaId) !== RECEIPT_SCHEMA_ID
    )
      throw fail('RECEIPT_INTENT_INVALID', 400);
    this.#domain(intent.target, intent);
  }
  #domain(value, intent) {
    if (
      Object.entries(this.#projection.binding).some(
        ([key, expected]) =>
          lower(value[key]) !== lower(expected) || lower(intent.target[key]) !== lower(expected),
      )
    )
      throw fail('RECEIPT_DOMAIN_MISMATCH');
  }
  #record(record) {
    if (
      !record ||
      !/^[0-9a-f]{64}$/.test(record.intentHash) ||
      record.executionReference !== `oracle-receipt:${record.intentHash}`
    )
      throw fail('RECEIPT_RECORD_INVALID', 400);
    this.#intent(record.intent);
    if (
      evidenceHash(record.intent) !== record.intentHash ||
      (record.transactionHash && !word(record.transactionHash, true)) ||
      (record.blockHash && !word(record.blockHash, true))
    )
      throw fail('RECEIPT_RECORD_INVALID', 400);
    if (record.blockNumber != null) assertUint256(record.blockNumber, 'RECEIPT_RECORD_INVALID');
  }
  #transaction(transaction, intent, hash) {
    return (
      lower(transaction.hash) === hash &&
      quantity(transaction.chainId) === BigInt(intent.target.chainId) &&
      lower(transaction.from) === lower(intent.target.sourceAuthority) &&
      lower(transaction.to) === lower(intent.target.contract) &&
      lower(transaction.input) === encodeReceiptAppend(intent) &&
      quantity(transaction.value) === 0n
    );
  }
  #logs(receipt, intent, hash, version) {
    if (!Array.isArray(receipt.logs)) return false;
    const sourceLogs = receipt.logs.filter(
      (log) => lower(log.address) === lower(intent.target.contract),
    );
    const matches = (topic) => sourceLogs.filter((log) => lower(log.topics?.[0]) === topic);
    const superseded = matches(RECEIPT_ABI.registerSuperseded);
    const bound = matches(RECEIPT_ABI.receiptBound);
    if (superseded.length !== 1 || bound.length !== 1) return false;
    for (const log of [superseded[0], bound[0]]) {
      if (
        log.removed === true ||
        lower(log.transactionHash) !== hash ||
        lower(log.blockHash) !== lower(receipt.blockHash) ||
        quantity(log.blockNumber) !== quantity(receipt.blockNumber) ||
        log.topics.length !== 4 ||
        lower(log.topics[1]) !== `0x${abiWord(intent.tokenId)}` ||
        lower(log.topics[2]) !== `0x${abiWord(version)}`
      )
        return false;
    }
    const s = abiWords(superseded[0].data, 3);
    const b = abiWords(bound[0].data, 4);
    return (
      lower(superseded[0].topics[3]) === lower(intent.recordCommitment) &&
      `0x${s[0]}` === lower(intent.previousCommitment) &&
      abiAddress(s[1]) === lower(intent.holder) &&
      abiUint64(s[2]) === intent.effectiveAt &&
      lower(bound[0].topics[3]) === lower(intent.binding.segmentDigest) &&
      ['schemaId', 'mintPolicyHash', 'requestHash', 'receiptDocumentHash'].every(
        (field, index) => `0x${b[index]}` === lower(intent.binding[field]),
      )
    );
  }
}

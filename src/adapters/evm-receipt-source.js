import {
  ADDRESS,
  BYTES32,
  ProjectionSourceError,
  assertUint64,
  assertUint256,
} from '../ports/projection-source.js';

// Optional Oracle receipt extension, not an additional ERC-8415 requirement.
// Static ABI is verified against ethers and the Solidity contract in tests.
export const RECEIPT_ABI = Object.freeze({
  sourceAuthority: '0x42101596',
  registerId: '0xbbc2a065',
  ownerOf: '0x6352211e',
  entryCount: '0x1d1b039c',
  entryAt: '0xf6752412',
  mintPolicyHash: '0xa3b200a4',
  receiptBinding: '0x5b88055d',
  appendReceiptFromSource: '0x776f8761',
  appendReceiptFromSourceChecked: '0x75f1e78f',
  registerSuperseded: '0x6d326adf1c509abe8b7d6309ac4415aabef96767e10251298dae9ba14731d901',
  receiptBound: '0x669ebf88195d9e780d01e538bab469f3881143dc9345f50ed1048f5fa01ee862',
});
export const RECEIPT_SCHEMA_ID =
  '0xee5bd417e3dddcc2dfb85f45260f817dc32e4c1945000d5bb7a738c142a4f9e3';
export const ZERO_WORD = `0x${'0'.repeat(64)}`;
export const RECEIPT_FIELDS = Object.freeze([
  'schemaId',
  'mintPolicyHash',
  'segmentDigest',
  'requestHash',
  'receiptDocumentHash',
]);
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail = (code = 'RECEIPT_SOURCE_MALFORMED', status = 502) =>
  new ProjectionSourceError(code, status);
export const abiWord = (value) => BigInt(value).toString(16).padStart(64, '0');
export function abiWords(value, length) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${length * 64}}$`).test(value))
    throw fail();
  return value.slice(2).toLowerCase().match(/.{64}/g);
}
export function abiAddress(word) {
  if (!/^0{24}[0-9a-f]{40}$/.test(word) || `0x${word.slice(24)}` === ZERO_ADDRESS) throw fail();
  return `0x${word.slice(24)}`;
}
export function abiUint64(word) {
  const value = BigInt(`0x${word}`);
  if (value >= 2n ** 64n) throw fail();
  return value.toString();
}
function quantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value) || BigInt(value) >= 2n ** 256n)
    throw fail();
  return BigInt(value);
}
function blockValue(value) {
  if (!value || !BYTES32.test(value.hash) || value.hash.toLowerCase() === ZERO_WORD) throw fail();
  return { number: quantity(value.number).toString(), hash: value.hash.toLowerCase() };
}
function sameBlock(a, b) {
  return a.number === b.number && a.hash === b.hash;
}
function entryValue(value) {
  const words = abiWords(value, 7);
  const entry = {
    recordCommitment: `0x${words[0]}`,
    previousCommitment: `0x${words[1]}`,
    registryReference: `0x${words[2]}`,
    holder: abiAddress(words[3]),
    version: abiUint64(words[4]),
    effectiveAt: abiUint64(words[5]),
    supersededAt: abiUint64(words[6]),
  };
  if (
    entry.recordCommitment === ZERO_WORD ||
    entry.version === '0' ||
    (entry.supersededAt !== '0' && BigInt(entry.supersededAt) <= BigInt(entry.effectiveAt))
  )
    throw fail();
  return entry;
}

/** Read-only EIP-1193 transport with a fixed server-side domain and hash-pinned reads. */
export class EvmReceiptProjectionSource {
  #rpc;
  #binding;
  #minConfirmations;
  #guard;
  constructor({
    rpc,
    binding,
    minConfirmations = 2,
    guardSideEffect = (operation) => operation(),
  }) {
    if (!rpc || typeof rpc.request !== 'function') throw fail('RECEIPT_RPC_INVALID', 400);
    if (
      !binding ||
      Object.keys(binding).sort().join(',') !== 'chainId,contract,registerId,sourceAuthority'
    )
      throw fail('RECEIPT_DOMAIN_INVALID', 400);
    assertUint256(binding.chainId, 'RECEIPT_DOMAIN_INVALID');
    if (
      binding.chainId === '0' ||
      !ADDRESS.test(binding.contract) ||
      !ADDRESS.test(binding.sourceAuthority) ||
      binding.contract.toLowerCase() === ZERO_ADDRESS ||
      binding.sourceAuthority.toLowerCase() === ZERO_ADDRESS ||
      !BYTES32.test(binding.registerId) ||
      binding.registerId.toLowerCase() === ZERO_WORD
    )
      throw fail('RECEIPT_DOMAIN_INVALID', 400);
    if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 10000)
      throw fail('RECEIPT_CONFIRMATIONS_INVALID', 400);
    if (typeof guardSideEffect !== 'function') throw fail('RECEIPT_GUARD_INVALID', 400);
    this.#guard = guardSideEffect;
    this.#rpc = rpc;
    this.#binding = Object.freeze(
      Object.fromEntries(Object.entries(binding).map(([key, value]) => [key, value.toLowerCase()])),
    );
    this.#minConfirmations = minConfirmations;
  }
  get binding() {
    return this.#binding;
  }
  get minConfirmations() {
    return this.#minConfirmations;
  }

  async receiptSnapshot(tokenId, version = 'latest') {
    this.#validateSelection(tokenId, version);
    await this.#chain();
    return this.#snapshot(
      tokenId,
      version,
      blockValue(await this.#request('eth_getBlockByNumber', ['latest', false])),
    );
  }

  async snapshotAtBlock(tokenId, version, block) {
    this.#validateSelection(tokenId, version);
    assertUint256(block?.number, 'RECEIPT_BLOCK_INVALID');
    if (!BYTES32.test(block?.hash)) throw fail('RECEIPT_BLOCK_INVALID', 400);
    const pinned = { number: block.number, hash: block.hash.toLowerCase() };
    await this.#chain();
    await this.assertCanonicalBlock(pinned);
    return this.#snapshot(tokenId, version, pinned);
  }

  async assertCanonicalBlock(block) {
    const current = await this.#request('eth_getBlockByNumber', [
      `0x${BigInt(block.number).toString(16)}`,
      false,
    ]);
    if (!current || !sameBlock(blockValue(current), block))
      throw fail('RECEIPT_SOURCE_REORGED', 409);
  }

  /** Read-only transaction evidence. A missing result never means safe to resubmit. */
  async transactionObservation(transactionHash) {
    if (!BYTES32.test(transactionHash)) throw fail('RECEIPT_TRANSACTION_INVALID', 400);
    await this.#chain();
    const hash = transactionHash.toLowerCase();
    const [transaction, receipt, head] = await Promise.all([
      this.#request('eth_getTransactionByHash', [hash]),
      this.#request('eth_getTransactionReceipt', [hash]),
      this.#request('eth_getBlockByNumber', ['latest', false]),
    ]);
    const latest = blockValue(head);
    if (!transaction || !receipt) return { transaction, receipt, head: latest, canonical: null };
    if (!BYTES32.test(receipt.blockHash) || quantity(receipt.blockNumber) > BigInt(latest.number))
      throw fail();
    const block = {
      number: quantity(receipt.blockNumber).toString(),
      hash: receipt.blockHash.toLowerCase(),
    };
    const current = await this.#request('eth_getBlockByNumber', [receipt.blockNumber, false]);
    const canonical = !!current && sameBlock(blockValue(current), block);
    return { transaction, receipt, head: latest, block, canonical };
  }

  #validateSelection(tokenId, version) {
    assertUint256(tokenId, 'TOKEN_ID_INVALID');
    if (version !== 'latest') {
      assertUint64(version, 'VERSION_INVALID');
      if (version === '0') throw fail('VERSION_INVALID', 400);
    }
  }
  async #chain() {
    if (quantity(await this.#request('eth_chainId', [])).toString() !== this.#binding.chainId)
      throw fail('RECEIPT_DOMAIN_MISMATCH', 409);
  }
  async #snapshot(tokenId, version, block) {
    // Every contract read, including identity and token existence, uses this exact hash.
    const call = (selector, args = '') =>
      this.#request('eth_call', [
        { to: this.#binding.contract, data: `${selector}${args}` },
        { blockHash: block.hash, requireCanonical: true },
      ]);
    const [register, source, owner, countValue, policy] = await Promise.all([
      call(RECEIPT_ABI.registerId),
      call(RECEIPT_ABI.sourceAuthority),
      call(RECEIPT_ABI.ownerOf, abiWord(tokenId)),
      call(RECEIPT_ABI.entryCount, abiWord(tokenId)),
      call(RECEIPT_ABI.mintPolicyHash, abiWord(tokenId)),
    ]);
    const registerId = `0x${abiWords(register, 1)[0]}`;
    const sourceAuthority = abiAddress(abiWords(source, 1)[0]);
    abiAddress(abiWords(owner, 1)[0]); // ERC-721 owner establishes existence, never source authority.
    if (
      registerId !== this.#binding.registerId ||
      sourceAuthority !== this.#binding.sourceAuthority
    )
      throw fail('RECEIPT_DOMAIN_MISMATCH', 409);
    const count = abiUint64(abiWords(countValue, 1)[0]);
    if (count === '0') throw fail('EMPTY_PROJECTION', 404);
    const selected = version === 'latest' ? count : version;
    if (BigInt(selected) > BigInt(count)) throw fail('UNKNOWN_VERSION', 404);
    const mintPolicyHash = `0x${abiWords(policy, 1)[0]}`;
    if (mintPolicyHash === ZERO_WORD) throw fail('RECEIPT_POLICY_UNAVAILABLE', 503);
    const [entryData, bindingData] = await Promise.all([
      call(RECEIPT_ABI.entryAt, abiWord(tokenId) + abiWord(selected)),
      call(RECEIPT_ABI.receiptBinding, abiWord(tokenId) + abiWord(selected)),
    ]);
    const entry = entryValue(entryData);
    if (entry.version !== selected || (selected === count && entry.supersededAt !== '0'))
      throw fail();
    const words = abiWords(bindingData, 5);
    const receiptBinding = Object.fromEntries(
      RECEIPT_FIELDS.map((field, index) => [field, `0x${words[index]}`]),
    );
    await this.assertCanonicalBlock(block);
    return {
      tokenId,
      ...this.#binding,
      block: { ...block },
      entry,
      mintPolicyHash,
      receiptBinding,
    };
  }
  async #request(method, params) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.#guard(() => this.#rpc.request({ method, params }))),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(fail('RECEIPT_SOURCE_UNAVAILABLE', 503)), 10000);
        }),
      ]);
    } catch (error) {
      if (error instanceof ProjectionSourceError) throw error;
      throw fail('RECEIPT_SOURCE_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
  }
}

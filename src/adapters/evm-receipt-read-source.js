import { ADDRESS, BYTES32, ProjectionSourceError, assertUint64, assertUint256 } from '../ports/projection-source.js';

// Oracle's optional receipt extension, not an ERC-8415 interface requirement.
// Tuple order/selectors are reused from the original reviewed stage-2 source.
export const RECEIPT_SCHEMA_ID = '0xee5bd417e3dddcc2dfb85f45260f817dc32e4c1945000d5bb7a738c142a4f9e3';
export const RECEIPT_FIELDS = Object.freeze(['schemaId', 'mintPolicyHash', 'segmentDigest', 'requestHash', 'receiptDocumentHash']);
export const RECEIPT_READ_ABI = Object.freeze([
  'function registerId() view returns (bytes32)',
  'function sourceAuthority() view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function entryCount(uint256 tokenId) view returns (uint64)',
  'function mintPolicyHash(uint256 tokenId) view returns (bytes32)',
  'function entryAt(uint256 tokenId,uint64 version) view returns (tuple(bytes32 recordCommitment,bytes32 previousCommitment,bytes32 registryReference,address holder,uint64 version,uint64 effectiveAt,uint64 supersededAt))',
  'function receiptBinding(uint256 tokenId,uint64 version) view returns (tuple(bytes32 schemaId,bytes32 mintPolicyHash,bytes32 segmentDigest,bytes32 requestHash,bytes32 receiptDocumentHash))',
]);
const SELECTORS = Object.freeze({ registerId: '0xbbc2a065', sourceAuthority: '0x42101596', ownerOf: '0x6352211e', entryCount: '0x1d1b039c', mintPolicyHash: '0xa3b200a4', entryAt: '0xf6752412', receiptBinding: '0x5b88055d' });
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const fail = (code = 'RECEIPT_SOURCE_MALFORMED', status = 502) => new ProjectionSourceError(code, status);
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const hex = (value) => `0x${BigInt(value).toString(16)}`;
function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) || value.length > 66) throw fail();
  return BigInt(value);
}
function words(value, count) {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(value)) throw fail();
  return value.slice(2).toLowerCase().match(/.{64}/g);
}
function address(value) {
  if (!/^0{24}[0-9a-f]{40}$/.test(value) || `0x${value.slice(24)}` === ZERO_ADDRESS) throw fail();
  return `0x${value.slice(24)}`;
}
function uint64(value) {
  const number = BigInt(`0x${value}`);
  if (number >= 2n ** 64n) throw fail();
  return String(number);
}
function block(value) {
  if (!value || !BYTES32.test(value.hash) || value.hash.toLowerCase() === ZERO_WORD) throw fail();
  return { number: String(quantity(value.number)), hash: value.hash.toLowerCase() };
}
export function normalizeReceiptReadBinding(value) {
  try {
    if (!value || Object.keys(value).sort().join(',') !== 'chainId,contract,registerId,sourceAuthority') throw fail();
    assertUint256(value.chainId, 'RECEIPT_SOURCE_BINDING_INVALID');
    if (value.chainId === '0' || !ADDRESS.test(value.contract) || !ADDRESS.test(value.sourceAuthority) || !BYTES32.test(value.registerId) || value.contract.toLowerCase() === ZERO_ADDRESS || value.sourceAuthority.toLowerCase() === ZERO_ADDRESS || value.registerId.toLowerCase() === ZERO_WORD) throw fail();
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toLowerCase()])));
  } catch { throw fail('RECEIPT_SOURCE_BINDING_INVALID', 503); }
}

/** A fixed, server-owned read capability: no signing, sending, ingress or caller URL. */
export class EvmReceiptReadSource {
  #rpc;
  #binding;
  #code;
  #depth;
  #guard;
  #timeout;
  constructor({ rpc, binding, expectedRuntimeCode, minConfirmations, guardRead = (operation) => operation(), timeoutMs = 10000 }) {
    this.#binding = normalizeReceiptReadBinding(binding);
    if (typeof rpc?.request !== 'function' || typeof guardRead !== 'function') throw fail('RECEIPT_RPC_INVALID', 503);
    if (typeof expectedRuntimeCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(expectedRuntimeCode) || expectedRuntimeCode.length > 98306) throw fail('RECEIPT_RUNTIME_CODE_PIN_REQUIRED', 503);
    if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1 || minConfirmations > 256) throw fail('RECEIPT_CONFIRMATIONS_INVALID', 503);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail('RECEIPT_TIMEOUT_INVALID', 503);
    this.#rpc = rpc;
    this.#code = expectedRuntimeCode.toLowerCase();
    this.#depth = minConfirmations;
    this.#guard = guardRead;
    this.#timeout = timeoutMs;
  }

  async receiptSnapshot(tokenId, version = 'latest') {
    assertUint256(tokenId, 'TOKEN_ID_INVALID');
    if (version !== 'latest') {
      assertUint64(version, 'VERSION_INVALID');
      if (version === '0') throw fail('VERSION_INVALID', 400);
    }
    let expired = false;
    let timer;
    const request = async (method, params) => {
      if (expired) throw fail('RECEIPT_SOURCE_UNAVAILABLE', 503);
      try {
        const result = await this.#guard(() => {
          // A guard can defer its callback beyond this observation's deadline.
          // Fence the actual transport invocation, not only entry into the guard.
          if (expired) throw fail('RECEIPT_SOURCE_UNAVAILABLE', 503);
          return this.#rpc.request({ method, params });
        });
        if (expired) throw fail('RECEIPT_SOURCE_UNAVAILABLE', 503);
        return result;
      } catch (error) {
        if (error instanceof ProjectionSourceError) throw error;
        throw fail('RECEIPT_SOURCE_UNAVAILABLE', 503);
      }
    };
    const chain = async () => {
      if (String(quantity(await request('eth_chainId', []))) !== this.#binding.chainId) throw fail('RECEIPT_DOMAIN_MISMATCH', 409);
    };
    const observe = async () => {
      await chain();
      const head = block(await request('eth_getBlockByNumber', ['latest', false]));
      const selectedNumber = BigInt(head.number) - BigInt(this.#depth - 1);
      if (selectedNumber < 0n) throw fail('RECEIPT_CONFIRMATIONS_UNAVAILABLE', 503);
      const selectedBlock = block(await request('eth_getBlockByNumber', [hex(selectedNumber), false]));
      if (selectedBlock.number !== String(selectedNumber)) throw fail();
      const at = { blockHash: selectedBlock.hash, requireCanonical: true };
      const code = await request('eth_getCode', [this.#binding.contract, at]);
      if (typeof code !== 'string' || code.toLowerCase() !== this.#code) throw fail('RECEIPT_RUNTIME_IDENTITY_MISMATCH', 409);
      const call = (selector, args = '') => request('eth_call', [{ to: this.#binding.contract, data: selector + args }, at]);
      const [register, authority, owner, size, policy] = await Promise.all([
        call(SELECTORS.registerId), call(SELECTORS.sourceAuthority), call(SELECTORS.ownerOf, word(tokenId)),
        call(SELECTORS.entryCount, word(tokenId)), call(SELECTORS.mintPolicyHash, word(tokenId)),
      ]);
      if (`0x${words(register, 1)[0]}` !== this.#binding.registerId || address(words(authority, 1)[0]) !== this.#binding.sourceAuthority) throw fail('RECEIPT_DOMAIN_MISMATCH', 409);
      address(words(owner, 1)[0]); // Existence only; owner does not confer registration authority.
      const count = uint64(words(size, 1)[0]);
      if (count === '0') throw fail('EMPTY_PROJECTION', 404);
      const selected = version === 'latest' ? count : version;
      if (BigInt(selected) > BigInt(count)) throw fail('UNKNOWN_VERSION', 404);
      const mintPolicyHash = `0x${words(policy, 1)[0]}`;
      if (mintPolicyHash === ZERO_WORD) throw fail('RECEIPT_POLICY_UNAVAILABLE', 503);
      const [entryData, bindingData] = await Promise.all([
        call(SELECTORS.entryAt, word(tokenId) + word(selected)),
        call(SELECTORS.receiptBinding, word(tokenId) + word(selected)),
      ]);
      const tuple = words(entryData, 7);
      const entry = {
        recordCommitment: `0x${tuple[0]}`, previousCommitment: `0x${tuple[1]}`, registryReference: `0x${tuple[2]}`,
        holder: address(tuple[3]), version: uint64(tuple[4]), effectiveAt: uint64(tuple[5]), supersededAt: uint64(tuple[6]),
      };
      if (entry.version !== selected || entry.recordCommitment === ZERO_WORD || (selected === count && entry.supersededAt !== '0') || (selected !== count && entry.supersededAt === '0') || (entry.supersededAt !== '0' && BigInt(entry.supersededAt) <= BigInt(entry.effectiveAt))) throw fail();
      const receiptWords = words(bindingData, 5);
      const receiptBinding = Object.fromEntries(RECEIPT_FIELDS.map((name, index) => [name, `0x${receiptWords[index]}`]));
      const receiptAvailable = RECEIPT_FIELDS.some((name) => receiptBinding[name] !== ZERO_WORD);
      if (receiptAvailable && (receiptBinding.schemaId !== RECEIPT_SCHEMA_ID || receiptBinding.mintPolicyHash !== mintPolicyHash || RECEIPT_FIELDS.some((name) => receiptBinding[name] === ZERO_WORD))) throw fail();
      const canonical = block(await request('eth_getBlockByNumber', [hex(selectedNumber), false]));
      if (canonical.number !== selectedBlock.number || canonical.hash !== selectedBlock.hash) throw fail('RECEIPT_SOURCE_REORGED', 409);
      const finalHead = block(await request('eth_getBlockByNumber', ['latest', false]));
      if (BigInt(finalHead.number) - selectedNumber + 1n < BigInt(this.#depth)) throw fail('RECEIPT_CONFIRMATIONS_UNAVAILABLE', 503);
      await chain();
      return { tokenId, source: this.#binding, block: selectedBlock, entry, mintPolicyHash, receiptBinding, receiptAvailable,
        evidence: { kind: 'canonical-contract-state', head: finalHead, minimumConfirmations: this.#depth } };
    };
    try {
      return await Promise.race([observe(), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(fail('RECEIPT_SOURCE_UNAVAILABLE', 503)); }, this.#timeout);
      })]);
    } finally { expired = true; clearTimeout(timer); }
  }
}

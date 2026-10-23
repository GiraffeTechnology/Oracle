import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, id } from 'ethers';
import {
  EvmReceiptProjectionSource,
  RECEIPT_ABI,
  RECEIPT_SCHEMA_ID,
  ZERO_WORD,
  RECEIPT_FIELDS,
} from '../../src/adapters/evm-receipt-source.js';

const abi = new Interface([
  'function sourceAuthority() view returns(address)',
  'function registerId() view returns(bytes32)',
  'function ownerOf(uint256) view returns(address)',
  'function entryCount(uint256) view returns(uint64)',
  'function entryAt(uint256,uint64) view returns(tuple(bytes32 recordCommitment,bytes32 previousCommitment,bytes32 registryReference,address holder,uint64 version,uint64 effectiveAt,uint64 supersededAt))',
  'function mintPolicyHash(uint256) view returns(bytes32)',
  'function receiptBinding(uint256,uint64) view returns(tuple(bytes32 schemaId,bytes32 mintPolicyHash,bytes32 segmentDigest,bytes32 requestHash,bytes32 receiptDocumentHash))',
  'function appendReceiptFromSourceChecked(uint256,bytes32,bytes32,address,uint64,uint64,bytes32,(bytes32,bytes32,bytes32,bytes32,bytes32))',
  'function appendReceiptFromSource(uint256,bytes32,bytes32,address,uint64,(bytes32,bytes32,bytes32,bytes32,bytes32))',
  'event RegisterSuperseded(uint256 indexed tokenId,uint64 indexed version,bytes32 indexed recordCommitment,bytes32 previousCommitment,address holder,uint64 effectiveAt)',
  'event ReceiptBound(uint256 indexed tokenId,uint64 indexed version,bytes32 indexed segmentDigest,bytes32 schemaId,bytes32 mintPolicyHash,bytes32 requestHash,bytes32 receiptDocumentHash)',
]);
const address = (n) => `0x${n.repeat(40)}`;
const domain = {
  chainId: '31337',
  contract: address('1'),
  registerId: id('register'),
  sourceAuthority: address('2'),
};
const entry = {
  recordCommitment: id('record'),
  previousCommitment: ZERO_WORD,
  registryReference: id('reference'),
  holder: address('3'),
  version: '1',
  effectiveAt: '100',
  supersededAt: '0',
};
const binding = {
  schemaId: RECEIPT_SCHEMA_ID,
  mintPolicyHash: id('policy'),
  segmentDigest: id('segment'),
  requestHash: id('request'),
  receiptDocumentHash: id('document'),
};
const block = { number: '0xa', hash: id('block-10') };
function fixture(overrides = {}, options = {}) {
  const calls = [];
  const rpc = {
    async request(request) {
      calls.push(structuredClone(request));
      if (overrides.request) return overrides.request(request, calls);
      if (request.method === 'eth_chainId') return overrides.chainId ?? '0x7a69';
      if (request.method === 'eth_getBlockByNumber')
        return request.params[0] === 'latest' ? block : (overrides.canonical ?? block);
      if (request.method === 'eth_call') {
        const parsed = abi.parseTransaction(request.params[0]);
        const values = {
          sourceAuthority: domain.sourceAuthority,
          registerId: domain.registerId,
          ownerOf: address('4'),
          entryCount: 1n,
          entryAt: Object.values(entry),
          mintPolicyHash: binding.mintPolicyHash,
          receiptBinding: Object.values(binding),
          ...overrides.values,
        };
        if (overrides.missing === parsed.name) throw new Error('method absent');
        if (overrides.raw?.[parsed.name] !== undefined) return overrides.raw[parsed.name];
        return abi.encodeFunctionResult(parsed.name, [values[parsed.name]]);
      }
      throw new Error(`Unexpected ${request.method}`);
    },
  };
  return {
    rpc,
    calls,
    source: new EvmReceiptProjectionSource({ rpc, binding: domain, ...options }),
  };
}

test('static receipt selectors and event topics match canonical ethers ABI', () => {
  for (const name of [
    'sourceAuthority',
    'registerId',
    'ownerOf',
    'entryCount',
    'entryAt',
    'mintPolicyHash',
    'receiptBinding',
    'appendReceiptFromSource',
    'appendReceiptFromSourceChecked',
  ])
    assert.equal(RECEIPT_ABI[name], abi.getFunction(name).selector);
  assert.equal(RECEIPT_ABI.registerSuperseded, abi.getEvent('RegisterSuperseded').topicHash);
  assert.equal(RECEIPT_ABI.receiptBound, abi.getEvent('ReceiptBound').topicHash);
  assert.equal(RECEIPT_SCHEMA_ID, id('oracle.receipt-binding.v1'));
});

test('fixed-domain receipt snapshot pins every contract read and rechecks canonical hash', async () => {
  const { source, calls } = fixture();
  const result = await source.receiptSnapshot('9007199254740993');
  assert.deepEqual(result, {
    tokenId: '9007199254740993',
    ...domain,
    block: { number: '10', hash: block.hash },
    entry,
    mintPolicyHash: binding.mintPolicyHash,
    receiptBinding: binding,
  });
  const reads = calls.filter((call) => call.method === 'eth_call');
  assert.equal(reads.length, 7);
  for (const read of reads) {
    assert.equal(read.params[0].to, domain.contract);
    assert.deepEqual(read.params[1], { blockHash: block.hash, requireCanonical: true });
  }
  assert.deepEqual(calls.at(-1), { method: 'eth_getBlockByNumber', params: ['0xa', false] });
  assert.ok(Object.isFrozen(source.binding));
});

test('strict configuration refuses mutable domains, invalid confirmations, and caller selections', async () => {
  for (const invalid of [
    { ...domain, url: 'https://attacker.invalid' },
    { ...domain, chainId: 31337 },
    { ...domain, chainId: '0' },
    { ...domain, registerId: ZERO_WORD },
    { ...domain, sourceAuthority: address('0') },
    { ...domain, contract: 'bad' },
  ]) {
    assert.throws(
      () => new EvmReceiptProjectionSource({ rpc: { request() {} }, binding: invalid }),
    );
  }
  for (const minConfirmations of [0, -1, 1.5, 10001, '2'])
    assert.throws(() => fixture({}, { minConfirmations }));
  const { source, calls } = fixture();
  for (const token of [1, '01', '-1', '0x1', (2n ** 256n).toString()])
    await assert.rejects(source.receiptSnapshot(token));
  for (const version of ['0', '01', -1, 'pending', '0x1'])
    await assert.rejects(source.receiptSnapshot('1', version));
  assert.equal(calls.length, 0);
});

test('domain chain, contract identity, malformed ABI, missing optional extension all fail closed', async () => {
  const cases = [
    [{ chainId: '0x1' }, 'RECEIPT_DOMAIN_MISMATCH'],
    [{ values: { sourceAuthority: address('5') } }, 'RECEIPT_DOMAIN_MISMATCH'],
    [{ values: { registerId: id('other-register') } }, 'RECEIPT_DOMAIN_MISMATCH'],
    [{ raw: { entryAt: '0x' } }, 'RECEIPT_SOURCE_MALFORMED'],
    [{ raw: { receiptBinding: `0x${'0'.repeat(64 * 6)}` } }, 'RECEIPT_SOURCE_MALFORMED'],
    [{ raw: { sourceAuthority: `0x${'f'.repeat(64)}` } }, 'RECEIPT_SOURCE_MALFORMED'],
    [
      { raw: { entryCount: `0x${(2n ** 64n).toString(16).padStart(64, '0')}` } },
      'RECEIPT_SOURCE_MALFORMED',
    ],
    [{ missing: 'receiptBinding' }, 'RECEIPT_SOURCE_UNAVAILABLE'],
    [{ values: { mintPolicyHash: ZERO_WORD } }, 'RECEIPT_POLICY_UNAVAILABLE'],
    [{ values: { ownerOf: address('0') } }, 'RECEIPT_SOURCE_MALFORMED'],
  ];
  for (const [overrides, code] of cases)
    await assert.rejects(
      fixture(overrides).source.receiptSnapshot('1'),
      (error) => error.errorCode === code,
      code,
    );
});

test('unbound minted entry preserves zero binding, while unknown version is explicit', async () => {
  const { source } = fixture({ values: { receiptBinding: RECEIPT_FIELDS.map(() => ZERO_WORD) } });
  const snapshot = await source.receiptSnapshot('1', '1');
  assert.deepEqual(
    snapshot.receiptBinding,
    Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, ZERO_WORD])),
  );
  await assert.rejects(
    source.receiptSnapshot('1', '2'),
    (error) => error.errorCode === 'UNKNOWN_VERSION',
  );
});

test('canonical hash change rejects the entire snapshot; never fall back to unpinned reads', async () => {
  const { source, calls } = fixture({ canonical: { ...block, hash: id('reorg') } });
  await assert.rejects(
    source.receiptSnapshot('1'),
    (error) => error.errorCode === 'RECEIPT_SOURCE_REORGED',
  );
  assert.ok(
    calls
      .filter((call) => call.method === 'eth_call')
      .every((call) => typeof call.params[1] === 'object'),
  );
  const failing = fixture({ missing: 'mintPolicyHash' });
  await assert.rejects(failing.source.receiptSnapshot('1'));
  assert.equal(
    failing.calls.filter(
      (call) =>
        call.method === 'eth_call' && call.params[0].data.startsWith(RECEIPT_ABI.mintPolicyHash),
    ).length,
    1,
  );
});

test('exact block snapshots reject changed canonical hash before any contract read', async () => {
  const { source, calls } = fixture({ canonical: { ...block, hash: id('replacement') } });
  await assert.rejects(
    source.snapshotAtBlock('1', '1', { number: '10', hash: block.hash }),
    (error) => error.errorCode === 'RECEIPT_SOURCE_REORGED',
  );
  assert.equal(calls.filter((call) => call.method === 'eth_call').length, 0);
});

test('concurrent snapshots keep independent block pins even as latest advances', async () => {
  const blocks = [block, { number: '0xb', hash: id('block-11') }];
  let latest = 0;
  const inner = fixture();
  const pins = [];
  const source = new EvmReceiptProjectionSource({
    binding: domain,
    rpc: {
      async request(request) {
        if (request.method === 'eth_getBlockByNumber') {
          if (request.params[0] === 'latest') return blocks[latest++];
          return blocks.find((item) => item.number === request.params[0]);
        }
        if (request.method === 'eth_call') {
          pins.push(request.params[1].blockHash);
          await new Promise((resolve) => setImmediate(resolve));
        }
        return inner.rpc.request(request);
      },
    },
  });
  const results = await Promise.all([source.receiptSnapshot('1'), source.receiptSnapshot('2')]);
  assert.deepEqual(
    results.map((result) => result.block.hash),
    blocks.map((item) => item.hash),
  );
  for (const item of blocks) assert.equal(pins.filter((pin) => pin === item.hash).length, 7);
});

test('guard denies each dispatched RPC after lifecycle revocation', async () => {
  let count = 0;
  const { source, calls } = fixture(
    {},
    {
      guardSideEffect(operation) {
        if (++count > 2) throw new Error('CLOSED');
        return operation();
      },
    },
  );
  await assert.rejects(
    source.receiptSnapshot('1'),
    (error) => error.errorCode === 'RECEIPT_SOURCE_UNAVAILABLE',
  );
  assert.deepEqual(
    calls.map((item) => item.method),
    ['eth_chainId', 'eth_getBlockByNumber'],
  );
});

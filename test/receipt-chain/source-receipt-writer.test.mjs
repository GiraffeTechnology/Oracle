import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, id } from 'ethers';
import { evidenceHash } from '../../src/domain/canonical-json.js';
import {
  EvmReceiptProjectionSource,
  RECEIPT_SCHEMA_ID,
  ZERO_WORD,
  RECEIPT_FIELDS,
} from '../../src/adapters/evm-receipt-source.js';
import {
  SourceReceiptWriter,
  encodeReceiptAppend,
} from '../../src/adapters/source-receipt-writer.js';

const address = (n) => `0x${n.repeat(40)}`;
const domain = {
  chainId: '31337',
  contract: address('1'),
  registerId: id('register'),
  sourceAuthority: address('2'),
};
const abi = new Interface([
  'function appendReceiptFromSourceChecked(uint256,bytes32,bytes32,address,uint64,uint64,bytes32,tuple(bytes32 schemaId,bytes32 mintPolicyHash,bytes32 segmentDigest,bytes32 requestHash,bytes32 receiptDocumentHash))',
  'event RegisterSuperseded(uint256 indexed tokenId,uint64 indexed version,bytes32 indexed recordCommitment,bytes32 previousCommitment,address holder,uint64 effectiveAt)',
  'event ReceiptBound(uint256 indexed tokenId,uint64 indexed version,bytes32 indexed segmentDigest,bytes32 schemaId,bytes32 mintPolicyHash,bytes32 requestHash,bytes32 receiptDocumentHash)',
]);
function intentValue(overrides = {}) {
  return {
    sourceId: 'authorized-source',
    registrationSource: 'REG_DIRECT',
    schemaVersion: 'receipt.v1',
    envelopeHash: 'a'.repeat(64),
    nonceHash: 'b'.repeat(64),
    idempotencyKey: 'unique-receipt-1',
    recordReference: 'record:source:1',
    target: { ...domain },
    tokenId: '1',
    expectedPreviousVersion: '1',
    previousCommitment: id('previous'),
    recordCommitment: id('record'),
    registryReference: id('reference'),
    holder: address('3'),
    effectiveAt: '200',
    binding: {
      schemaId: RECEIPT_SCHEMA_ID,
      mintPolicyHash: id('policy'),
      segmentDigest: id('segment'),
      requestHash: id('request'),
      receiptDocumentHash: id('document'),
    },
    ...overrides,
  };
}
function recordValue(intent = intentValue(), overrides = {}) {
  const intentHash = evidenceHash(intent);
  return {
    intentHash,
    executionReference: `oracle-receipt:${intentHash}`,
    state: 'SUBMITTING',
    intent,
    transactionHash: null,
    blockHash: null,
    blockNumber: null,
    version: null,
    reason: null,
    revision: 1,
    ...overrides,
  };
}
function fixture(options = {}) {
  const intent = intentValue();
  const transactionHash = id('transaction');
  const block = { number: '10', hash: id('block') };
  const snapshot = {
    tokenId: '1',
    ...domain,
    block,
    entry: {
      version: '1',
      holder: intent.holder,
      effectiveAt: '100',
      supersededAt: '0',
      recordCommitment: intent.previousCommitment,
      previousCommitment: ZERO_WORD,
      registryReference: id('old-reference'),
    },
    mintPolicyHash: intent.binding.mintPolicyHash,
    receiptBinding: Object.fromEntries(RECEIPT_FIELDS.map((key) => [key, ZERO_WORD])),
  };
  const admitted = {
    ...snapshot,
    entry: {
      version: '2',
      holder: intent.holder,
      effectiveAt: intent.effectiveAt,
      supersededAt: '0',
      recordCommitment: intent.recordCommitment,
      previousCommitment: intent.previousCommitment,
      registryReference: intent.registryReference,
    },
    receiptBinding: { ...intent.binding },
  };
  const tx = {
    hash: transactionHash,
    chainId: '0x7a69',
    from: domain.sourceAuthority,
    to: domain.contract,
    input: encodeReceiptAppend(intent),
    value: '0x0',
    blockHash: block.hash,
    blockNumber: '0xa',
  };
  const receipt = {
    transactionHash,
    from: tx.from,
    to: tx.to,
    blockHash: block.hash,
    blockNumber: '0xa',
    status: '0x1',
    logs: [],
  };
  for (const [name, args] of [
    [
      'RegisterSuperseded',
      [
        intent.tokenId,
        '2',
        intent.recordCommitment,
        intent.previousCommitment,
        intent.holder,
        intent.effectiveAt,
      ],
    ],
    [
      'ReceiptBound',
      [
        intent.tokenId,
        '2',
        intent.binding.segmentDigest,
        intent.binding.schemaId,
        intent.binding.mintPolicyHash,
        intent.binding.requestHash,
        intent.binding.receiptDocumentHash,
      ],
    ],
  ]) {
    receipt.logs.push({
      ...abi.encodeEventLog(abi.getEvent(name), args),
      address: domain.contract,
      transactionHash,
      blockHash: block.hash,
      blockNumber: '0xa',
      removed: false,
    });
  }
  const seen = {
    transaction: tx,
    receipt,
    block,
    canonical: true,
    head: { number: '11', hash: id('head') },
  };
  const submissions = [];
  const lookups = [];
  const snapshots = [];
  const projection = {
    binding: domain,
    minConfirmations: 2,
    async receiptSnapshot() {
      return structuredClone(snapshot);
    },
    async snapshotAtBlock(...args) {
      snapshots.push(args);
      return structuredClone(admitted);
    },
    async transactionObservation() {
      return structuredClone(seen);
    },
    async assertCanonicalBlock() {},
  };
  const executionClient = {
    async submit(request) {
      submissions.push(request);
      return { transactionHash };
    },
    async lookup(request) {
      lookups.push(request);
      return { transactionHash };
    },
  };
  const makeWriter = (overrides = {}) =>
    new SourceReceiptWriter({
      projection,
      executionClient,
      signerReference: 'broker://existing-source-signer',
      ...options,
      ...overrides,
    });
  return {
    intent,
    record: recordValue(intent),
    transactionHash,
    block,
    snapshot,
    admitted,
    tx,
    receipt,
    seen,
    submissions,
    lookups,
    snapshots,
    projection,
    executionClient,
    makeWriter,
    writer: makeWriter(),
  };
}

test('writer accepts only existing signer reference and injected submit/lookup broker', () => {
  const f = fixture();
  assert.throws(() => f.makeWriter({ signerReference: `0x${'a'.repeat(64)}` }));
  assert.throws(() => f.makeWriter({ executionClient: { submit() {} } }));
  assert.throws(() => f.makeWriter({ projection: { binding: domain } }));
});

test('validated append encodes exact ABI arguments and configured signer/domain only', async () => {
  const f = fixture();
  assert.equal(await f.writer.submit(f.record), f.transactionHash);
  assert.equal(f.submissions.length, 1);
  assert.deepEqual(f.submissions[0], {
    executionReference: f.record.executionReference,
    signerReference: 'broker://existing-source-signer',
    chainId: domain.chainId,
    from: domain.sourceAuthority,
    to: domain.contract,
    value: '0x0',
    data: abi.encodeFunctionData('appendReceiptFromSourceChecked', [
      f.intent.tokenId,
      f.intent.recordCommitment,
      f.intent.registryReference,
      f.intent.holder,
      f.intent.effectiveAt,
      f.intent.expectedPreviousVersion,
      f.intent.previousCommitment,
      Object.values(f.intent.binding),
    ]),
  });
});

test('writer rejects altered domain, raw transaction additions, malformed binding and nonincreasing effectiveAt', async () => {
  const f = fixture();
  const invalid = [
    { target: { ...domain, chainId: '1' } },
    { target: { ...domain, sourceAuthority: address('9') } },
    { target: { ...domain, contract: address('9') } },
    { target: { ...domain, registerId: id('other') } },
    { data: '0xdeadbeef' },
    { binding: { ...f.intent.binding, schemaId: id('other-schema') } },
    { binding: { ...f.intent.binding, segmentDigest: ZERO_WORD } },
    { holder: address('0') },
    { expectedPreviousVersion: '2' },
    { previousCommitment: id('wrong-previous') },
    { binding: { ...f.intent.binding, mintPolicyHash: id('wrong-policy') } },
    { effectiveAt: '100' },
  ];
  for (const change of invalid)
    await assert.rejects(f.writer.submit(recordValue({ ...f.intent, ...change })));
  assert.equal(f.submissions.length, 0);
});

test('durable claim and canonical intent hash are mandatory; known transaction never resubmits', async () => {
  const f = fixture();
  for (const change of [
    { state: 'PREPARED' },
    { state: 'UNKNOWN' },
    { transactionHash: f.transactionHash },
    { intentHash: 'c'.repeat(64) },
    { executionReference: 'other' },
  ])
    await assert.rejects(f.writer.submit({ ...f.record, ...change }));
  const altered = structuredClone(f.record);
  altered.intent.effectiveAt = '300';
  await assert.rejects(f.writer.submit(altered));
  assert.equal(f.submissions.length, 0);
});

test('source disabled during awaited preflight is checked immediately before broker dispatch', async () => {
  const f = fixture();
  let active = true;
  f.projection.receiptSnapshot = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    active = false;
    return f.snapshot;
  };
  const writer = f.makeWriter({
    beforeSubmit() {
      if (!active) throw new Error('SOURCE_DISABLED');
    },
  });
  await assert.rejects(writer.submit(f.record), /SOURCE_DISABLED/);
  assert.equal(f.submissions.length, 0);
  // Disabled source does not prevent read-only reconciliation of old evidence.
  assert.equal(
    (await writer.reconcile({ ...f.record, transactionHash: f.transactionHash })).state,
    'CONFIRMED',
  );
});

test('caller mutation across awaited preflight cannot change the durably hashed append', async () => {
  const f = fixture();
  const expected = encodeReceiptAppend(f.intent);
  f.projection.receiptSnapshot = async () => {
    f.record.intent.holder = address('9');
    f.record.intent.binding.receiptDocumentHash = id('mutated');
    return f.snapshot;
  };
  await f.writer.submit(f.record);
  assert.equal(f.submissions[0].data, expected);
});

test('async pre-dispatch revocation hook is refused rather than accidentally bypassed', async () => {
  const f = fixture();
  await assert.rejects(
    f
      .makeWriter({
        beforeSubmit: async () => {
          throw new Error('revoked');
        },
      })
      .submit(f.record),
    (error) => error.errorCode === 'RECEIPT_PREFLIGHT_ASYNC_REFUSED',
  );
  assert.equal(f.submissions.length, 0);
});

test('lifecycle guard wraps preflight and execution dispatch; no execution after shutdown', async () => {
  const f = fixture();
  let calls = 0;
  const writer = f.makeWriter({
    guardSideEffect(operation) {
      if (++calls > 1) throw new Error('CLOSED');
      return operation();
    },
  });
  await assert.rejects(writer.submit(f.record), /CLOSED/);
  assert.equal(f.submissions.length, 0);
});

test('canonical successful tx requires exact source logs and onchain entry/binding', async () => {
  const f = fixture();
  const result = await f.writer.reconcile({
    ...f.record,
    state: 'SUBMITTED',
    transactionHash: f.transactionHash,
  });
  assert.deepEqual(result, {
    state: 'CONFIRMED',
    transactionHash: f.transactionHash,
    blockHash: f.block.hash,
    blockNumber: f.block.number,
    version: '2',
    reason: null,
  });
  assert.deepEqual(f.snapshots, [['1', '2', f.block]]);
  assert.equal(f.submissions.length, 0);
});

test('same-block successor must exactly verify a closed receipt entry interval', async () => {
  const f = fixture();
  f.admitted.entry.supersededAt = '300';
  const next = structuredClone(f.admitted);
  next.entry = {
    ...next.entry,
    version: '3',
    effectiveAt: '300',
    supersededAt: '0',
    previousCommitment: f.intent.recordCommitment,
    recordCommitment: id('next'),
  };
  f.projection.snapshotAtBlock = async (_, version) => (version === '2' ? f.admitted : next);
  assert.equal((await f.writer.reconcile(f.record)).state, 'CONFIRMED');
  next.entry.effectiveAt = '301';
  assert.equal((await f.writer.reconcile(f.record)).state, 'REJECTED');
});

test('pending receipt, insufficient confirmations, absent tx, reverted tx, broker unknown remain distinct', async () => {
  for (const [mutate, state, reason] of [
    [
      (f) => {
        f.seen.receipt = null;
      },
      'SUBMITTED',
      'RECEIPT_PENDING',
    ],
    [
      (f) => {
        f.seen.head.number = '10';
      },
      'SUBMITTED',
      'CONFIRMATIONS_PENDING',
    ],
    [
      (f) => {
        f.seen.transaction = null;
      },
      'UNKNOWN',
      'TRANSACTION_NOT_OBSERVED',
    ],
    [
      (f) => {
        f.receipt.status = '0x0';
      },
      'FAILED',
      'TRANSACTION_REVERTED',
    ],
    [
      (f) => {
        f.executionClient.lookup = async () => null;
      },
      'UNKNOWN',
      'EXECUTION_NOT_OBSERVED',
    ],
  ]) {
    const f = fixture();
    mutate(f);
    const result = await f.writer.reconcile(f.record);
    assert.equal(result.state, state);
    assert.equal(result.reason, reason);
    assert.equal(result.blockHash, state === 'FAILED' ? f.block.hash : null);
    assert.equal(result.blockNumber, state === 'FAILED' ? f.block.number : null);
    assert.equal(result.version, null);
    assert.equal(f.submissions.length, 0);
  }
});

test('restart recovers same execution reference without resubmission, even when broker cannot prove absence', async () => {
  const f = fixture();
  const restarted = f.makeWriter();
  assert.equal((await restarted.reconcile({ ...f.record, state: 'UNKNOWN' })).state, 'CONFIRMED');
  assert.deepEqual(f.lookups, [
    {
      executionReference: f.record.executionReference,
      signerReference: 'broker://existing-source-signer',
    },
  ]);
  f.executionClient.lookup = async () => ({ status: 'not-found' });
  assert.equal((await f.makeWriter().reconcile(f.record)).state, 'UNKNOWN');
  assert.equal(f.submissions.length, 0);
});

test('all transaction domain and calldata mismatches reject confirmation', async () => {
  for (const patch of [
    { from: address('9') },
    { to: address('9') },
    { chainId: '0x1' },
    { input: '0x' },
    { value: '0x1' },
    { hash: id('other') },
  ]) {
    const f = fixture();
    Object.assign(f.tx, patch);
    const result = await f.writer.reconcile(f.record);
    assert.equal(result.state, 'REJECTED');
    assert.equal(result.reason, 'TRANSACTION_MISMATCH');
  }
});

test('foreign emitter, incomplete/mismatched/removed logs, receipt identity and state mismatches never confirm', async () => {
  const changes = [
    (f) => {
      f.receipt.logs[0].address = address('9');
    },
    (f) => {
      f.receipt.logs.pop();
    },
    (f) => {
      f.receipt.logs[1].topics[3] = id('other-segment');
    },
    (f) => {
      f.receipt.logs[0].transactionHash = id('other-tx');
    },
    (f) => {
      f.receipt.logs[0].removed = true;
    },
    (f) => {
      f.receipt.logs.push(f.receipt.logs[0]);
    },
    (f) => {
      f.receipt.from = address('9');
    },
    (f) => {
      f.admitted.entry.holder = address('9');
    },
    (f) => {
      f.admitted.entry.previousCommitment = id('wrong');
    },
    (f) => {
      f.admitted.receiptBinding.requestHash = id('wrong');
    },
    (f) => {
      f.admitted.mintPolicyHash = id('wrong');
    },
  ];
  for (const mutate of changes) {
    const f = fixture();
    mutate(f);
    assert.notEqual((await f.writer.reconcile(f.record)).state, 'CONFIRMED');
  }
});

test('changed receipt block and reorg after prior confirmation return REORGED without resubmit', async () => {
  const f = fixture();
  f.seen.canonical = false;
  assert.equal((await f.writer.reconcile(f.record)).state, 'REORGED');
  f.seen.canonical = true;
  f.projection.assertCanonicalBlock = async () => {
    const error = new Error('changed hash');
    error.errorCode = 'RECEIPT_SOURCE_REORGED';
    throw error;
  };
  assert.equal(
    (
      await f.writer.reconcile({
        ...f.record,
        state: 'CONFIRMED',
        transactionHash: f.transactionHash,
        blockHash: f.block.hash,
        blockNumber: f.block.number,
        version: '2',
      })
    ).state,
    'REORGED',
  );
  assert.equal(f.submissions.length, 0);
});

test('provider and broker errors remain UNKNOWN and never invite automatic retry', async () => {
  const f = fixture();
  f.executionClient.lookup = async () => {
    throw new Error('private broker diagnostic');
  };
  const result = await f.writer.reconcile(f.record);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'RECONCILIATION_UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(f.submissions.length, 0);
});

test(
  'ephemeral Hardhat contract: bound source append, confirmation, restart, historical proof, reorg',
  { timeout: 120000 },
  async (t) => {
    const configHome = mkdtempSync(join(tmpdir(), 'receipt-hardhat-'));
    const priorConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    t.after(() => {
      if (priorConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = priorConfigHome;
      rmSync(configHome, { recursive: true, force: true });
    });
    const require = createRequire(import.meta.url);
    const hre = require('hardhat');
    const solc = createRequire(require.resolve('hardhat/package.json'))('solc');
    const output = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: 'Solidity',
          sources: {
            'OracleRegisterProjection.sol': {
              content: readFileSync(
                new URL('../../erc-8415/contracts/OracleRegisterProjection.sol', import.meta.url),
                'utf8',
              ),
            },
          },
          settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true,
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
          },
        }),
      ),
    );
    assert.deepEqual(
      (output.errors ?? []).filter((error) => error.severity === 'error'),
      [],
    );
    const compiled = output.contracts['OracleRegisterProjection.sol'].OracleRegisterProjection;
    const [source, owner, holder] = await hre.ethers.getSigners();
    const factory = new hre.ethers.ContractFactory(
      compiled.abi,
      compiled.evm.bytecode.object,
      source,
    );
    const contract = await factory.deploy(domain.registerId, source.address);
    await contract.waitForDeployment();
    const target = {
      ...domain,
      contract: (await contract.getAddress()).toLowerCase(),
      sourceAuthority: source.address.toLowerCase(),
    };
    const intent = intentValue({ target, holder: holder.address.toLowerCase() });
    await (
      await contract.mintReceiptFromSource(
        owner.address,
        1n,
        intent.previousCommitment,
        id('mint-ref'),
        holder.address,
        100n,
        intent.binding.mintPolicyHash,
      )
    ).wait();
    const checkpoint = await hre.network.provider.request({ method: 'evm_snapshot', params: [] });
    const projection = new EvmReceiptProjectionSource({
      rpc: hre.network.provider,
      binding: target,
      minConfirmations: 2,
    });
    const executions = new Map();
    let submitted = 0;
    const executionClient = {
      async submit(request) {
        submitted++;
        assert.equal(request.from, source.address.toLowerCase());
        const transaction = await source.sendTransaction({
          to: request.to,
          data: request.data,
          value: request.value,
          chainId: BigInt(request.chainId),
        });
        executions.set(request.executionReference, transaction.hash);
        return transaction.hash;
      },
      async lookup({ executionReference }) {
        return executions.get(executionReference) ?? null;
      },
    };
    const build = () =>
      new SourceReceiptWriter({
        projection,
        executionClient,
        signerReference: 'ephemeral:test-source',
      });
    const record = recordValue(intent);
    const hash = await build().submit(record);
    const pending = await build().reconcile({
      ...record,
      transactionHash: hash,
      state: 'SUBMITTED',
    });
    assert.equal(pending.state, 'SUBMITTED');
    assert.equal(pending.reason, 'CONFIRMATIONS_PENDING');
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    const confirmed = await build().reconcile({ ...record, state: 'UNKNOWN' });
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(confirmed.version, '2');
    assert.equal((await contract.ownerOf(1n)).toLowerCase(), owner.address.toLowerCase());
    assert.equal(
      (await projection.receiptSnapshot('1')).receiptBinding.receiptDocumentHash,
      intent.binding.receiptDocumentHash,
    );
    await (
      await contract.appendReceiptFromSource(
        1n,
        id('later-record'),
        id('later-ref'),
        holder.address,
        300n,
        {
          ...intent.binding,
          segmentDigest: id('later-segment'),
          requestHash: id('later-request'),
          receiptDocumentHash: id('later-document'),
        },
      )
    ).wait();
    assert.equal((await projection.receiptSnapshot('1')).entry.version, '3');
    assert.equal((await build().reconcile({ ...record, ...confirmed })).state, 'CONFIRMED');
    await hre.network.provider.request({ method: 'evm_revert', params: [checkpoint] });
    await hre.network.provider.request({ method: 'evm_mine', params: [] });
    assert.equal((await build().reconcile({ ...record, ...confirmed })).state, 'REORGED');
    assert.equal(submitted, 1);
  },
);

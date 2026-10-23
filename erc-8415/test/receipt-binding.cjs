const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ethers } = require('hardhat');
const solc = createRequire(require.resolve('hardhat/package.json'))('solc');
const hash = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));
const schemaId = hash('oracle.receipt-binding.v1');
const policyHash = hash('application-canonical-mint-policy');
const fields = [
  'schemaId',
  'mintPolicyHash',
  'segmentDigest',
  'requestHash',
  'receiptDocumentHash',
];

function compile() {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: {
          'OracleRegisterProjection.sol': {
            content: fs.readFileSync(
              path.join(__dirname, '../contracts/OracleRegisterProjection.sol'),
              'utf8',
            ),
          },
          'ApplicationHookFixture.sol': {
            content: `pragma solidity ^0.8.20;
        import "./OracleRegisterProjection.sol";
        contract ApplicationHookFixture is OracleRegisterProjection {
          error ApplicationAdmissionRejected();
          error ApplicationTransferRejected();
          constructor(bytes32 id, address source) OracleRegisterProjection(id, source) {}
          function _validateReceiptAdmission(uint256, address holder, uint64 effectiveAt,
            ReceiptBinding memory binding) internal view override {
            if (holder != sourceAuthority || effectiveAt != 2000 || binding.requestHash != keccak256("allowed-request"))
              revert ApplicationAdmissionRejected();
          }
          function transferFrom(address, address, uint256) public pure override {
            revert ApplicationTransferRejected();
          }
        }`,
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
  const errors = (output.errors || []).filter((item) => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map((item) => item.formattedMessage).join('\n'));
  return output.contracts;
}

async function rejectsCustom(contract, promise, name) {
  const selector = contract.interface.getError(name).selector;
  await assert.rejects(promise, (error) => {
    const data = error?.data ?? error?.error?.data ?? error?.info?.error?.data;
    return typeof data === 'string' && data.startsWith(selector);
  });
}

function binding(overrides = {}) {
  return {
    schemaId,
    mintPolicyHash: policyHash,
    segmentDigest: hash('segment-1'),
    requestHash: hash('request-1'),
    receiptDocumentHash: hash('authoritative-registration-document-1'),
    ...overrides,
  };
}

function values(receipt) {
  return fields.map((field) => receipt[field]);
}

describe('Optional source-authenticated receipt binding', function () {
  let compiled, projection, source, owner, buyer, outsider;
  const tokenId = 1n;
  before(() => {
    compiled = compile();
  });
  beforeEach(async () => {
    [, source, owner, buyer, outsider] = await ethers.getSigners();
    const artifact = compiled['OracleRegisterProjection.sol'].OracleRegisterProjection;
    projection = await new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      source,
    ).deploy(hash('register'), source.address);
    await projection.waitForDeployment();
  });
  async function mint(id = tokenId, policy = policyHash) {
    return projection.mintReceiptFromSource(
      owner.address,
      id,
      hash(`initial-${id}`),
      hash('source-reference'),
      owner.address,
      1000n,
      policy,
    );
  }
  async function append(receipt = binding(), options = {}) {
    return projection.appendReceiptFromSource(
      options.tokenId ?? tokenId,
      options.commitment ?? hash('record-2'),
      hash('source-reference-2'),
      options.holder ?? buyer.address,
      options.effectiveAt ?? 2000n,
      receipt,
    );
  }
  async function unchanged() {
    const entry = await projection.currentEntry(tokenId);
    assert.equal(entry.version, 1n);
    assert.equal(entry.holder, owner.address);
    assert.equal(entry.supersededAt, 0n);
    assert.equal(await projection.entryCount(tokenId), 1n);
    assert.equal(await projection.ownerOf(tokenId), owner.address);
    await rejectsCustom(projection, projection.receiptBinding(tokenId, 2n), 'InvalidEntry');
  }

  it('checked append atomically rejects stale version or commitment without consuming the receipt', async () => {
    await mint();
    const checked = (
      version,
      previous,
      receipt = binding(),
      commitment = hash('record-2'),
      effectiveAt = 2000n,
    ) =>
      projection.appendReceiptFromSourceChecked(
        tokenId,
        commitment,
        hash('ref'),
        buyer.address,
        effectiveAt,
        version,
        previous,
        receipt,
      );
    await rejectsCustom(projection, checked(0n, hash('initial-1')), 'PreviousEntryMismatch');
    await rejectsCustom(projection, checked(1n, hash('wrong')), 'PreviousEntryMismatch');
    await rejectsCustom(
      projection,
      projection
        .connect(outsider)
        .appendReceiptFromSourceChecked(
          tokenId,
          hash('record-2'),
          hash('ref'),
          buyer.address,
          2000n,
          1n,
          hash('initial-1'),
          binding(),
        ),
      'Unauthorized',
    );
    await unchanged();
    await checked(1n, hash('initial-1'));
    const other = binding({ segmentDigest: hash('segment-raced') });
    await rejectsCustom(
      projection,
      checked(1n, hash('initial-1'), other, hash('record-3'), 3000n),
      'PreviousEntryMismatch',
    );
    assert.equal((await projection.currentEntry(tokenId)).version, 2n);
    assert.equal((await projection.currentEntry(tokenId)).holder, buyer.address);
    assert.equal((await projection.entryAt(tokenId, 2n)).supersededAt, 0n);
    await rejectsCustom(projection, projection.receiptBinding(tokenId, 3n), 'InvalidEntry');
    // The failed compare did not consume either commitment or segment.
    await checked(2n, hash('record-2'), other, hash('record-3'), 3000n);
    assert.equal((await projection.currentEntry(tokenId)).version, 3n);
  });

  it('commits an immutable opaque policy with the actual NFT mint and initial entry', async () => {
    const tx = await mint();
    const receipt = await tx.wait();
    const events = receipt.logs.map((log) => projection.interface.parseLog(log));
    assert.deepEqual(
      events.map((event) => event.name),
      ['Transfer', 'RegisterInitialized', 'MintPolicyCommitted'],
    );
    assert.equal(events[2].args.tokenId, tokenId);
    assert.equal(events[2].args.mintPolicyHash, policyHash);
    assert.equal(await projection.mintPolicyHash(tokenId), policyHash);
    assert.equal(await projection.ownerOf(tokenId), owner.address);
    assert.equal((await projection.currentEntry(tokenId)).holder, owner.address);
    assert.deepEqual(
      values(await projection.receiptBinding(tokenId, 1n)),
      fields.map(() => ethers.ZeroHash),
    );
    await rejectsCustom(projection, mint(tokenId, hash('replacement-policy')), 'InvalidEntry');
    await rejectsCustom(
      projection,
      projection.mintFromSource(
        owner.address,
        tokenId,
        hash('new-initial'),
        hash('ref'),
        owner.address,
        1000n,
      ),
      'InvalidEntry',
    );
    assert.equal(await projection.mintPolicyHash(tokenId), policyHash);
  });

  it('rejects empty policy or invalid mint atomically without reserving the token', async () => {
    await rejectsCustom(projection, mint(tokenId, ethers.ZeroHash), 'InvalidReceiptBinding');
    await rejectsCustom(
      projection,
      projection.mintReceiptFromSource(
        ethers.ZeroAddress,
        tokenId,
        hash('initial'),
        hash('ref'),
        owner.address,
        1000n,
        policyHash,
      ),
      'InvalidAddress',
    );
    await rejectsCustom(
      projection,
      projection.mintReceiptFromSource(
        owner.address,
        tokenId,
        ethers.ZeroHash,
        hash('ref'),
        owner.address,
        1000n,
        policyHash,
      ),
      'InvalidEntry',
    );
    await rejectsCustom(projection, projection.mintPolicyHash(tokenId), 'TokenNotFound');
    await rejectsCustom(projection, projection.ownerOf(tokenId), 'TokenNotFound');
    assert.equal(await projection.balanceOf(owner.address), 0n);
    await mint();
    assert.equal(await projection.balanceOf(owner.address), 1n);
  });

  it('admits the holder, history entry, and exact receipt tuple in one source transaction', async () => {
    await mint();
    const tx = await append();
    const receipt = await tx.wait();
    const events = receipt.logs.map((log) => projection.interface.parseLog(log));
    assert.deepEqual(
      events.map((event) => event.name),
      ['RegisterSuperseded', 'ReceiptBound'],
    );
    const entry = await projection.entryAt(tokenId, 2n);
    assert.equal(entry.holder, buyer.address);
    assert.equal(entry.recordCommitment, hash('record-2'));
    assert.equal(entry.previousCommitment, hash('initial-1'));
    assert.equal(entry.effectiveAt, 2000n);
    assert.equal((await projection.entryAt(tokenId, 1n)).supersededAt, 2000n);
    assert.deepEqual(
      values(await projection.receiptBinding(tokenId, entry.version)),
      values(binding()),
    );
    assert.equal(events[1].args.version, entry.version);
    assert.equal(events[1].args.tokenId, tokenId);
    assert.equal(events[1].args.segmentDigest, binding().segmentDigest);
    assert.equal(
      await projection.ownerOf(tokenId),
      owner.address,
      'source registration does not transfer the NFT',
    );
    assert.equal(await projection.mintPolicyHash(tokenId), policyHash);
    assert.equal(await projection.RECEIPT_BINDING_SCHEMA_V1(), schemaId);
  });

  it('rejects users, token owners, approved operators, and other sources for both receipt writes', async () => {
    for (const caller of [owner, buyer, outsider]) {
      await rejectsCustom(
        projection,
        projection
          .connect(caller)
          .mintReceiptFromSource(
            owner.address,
            tokenId,
            hash('initial'),
            hash('ref'),
            owner.address,
            1000n,
            policyHash,
          ),
        'Unauthorized',
      );
    }
    await mint();
    await projection.connect(owner).approve(outsider.address, tokenId);
    await projection.connect(owner).setApprovalForAll(buyer.address, true);
    for (const caller of [owner, buyer, outsider]) {
      await rejectsCustom(
        projection,
        projection
          .connect(caller)
          .appendReceiptFromSource(
            tokenId,
            hash('record-2'),
            hash('ref'),
            buyer.address,
            2000n,
            binding(),
          ),
        'Unauthorized',
      );
    }
    await unchanged();
    await append();
  });

  it('rejects unsupported schema, mismatched policy, and each missing binding field', async () => {
    await mint();
    const invalid = [
      binding({ schemaId: hash('unknown-schema') }),
      binding({ mintPolicyHash: hash('other-policy') }),
    ];
    for (const field of fields) invalid.push(binding({ [field]: ethers.ZeroHash }));
    for (const receipt of invalid) {
      await rejectsCustom(projection, append(receipt), 'InvalidReceiptBinding');
      await unchanged();
    }
    await append();
  });

  it('does not consume a receipt or change the holder when entry validation fails', async () => {
    await mint();
    for (const [options, error] of [
      [{ commitment: ethers.ZeroHash }, 'InvalidEntry'],
      [{ commitment: hash('initial-1') }, 'CommitmentReused'],
      [{ holder: ethers.ZeroAddress }, 'InvalidAddress'],
      [{ effectiveAt: 1000n }, 'EffectiveAtNotIncreasing'],
      [{ effectiveAt: 999n }, 'EffectiveAtNotIncreasing'],
    ]) {
      await rejectsCustom(projection, append(binding(), options), error);
      await unchanged();
    }
    await append();
    assert.equal((await projection.currentEntry(tokenId)).version, 2n);
  });

  it('rejects receipt replay under a new record, version, or token', async () => {
    await mint();
    await append();
    await rejectsCustom(projection, append(), 'ReceiptSegmentReused');
    await rejectsCustom(
      projection,
      append(binding({ requestHash: hash('changed-request') }), {
        commitment: hash('record-3'),
        effectiveAt: 3000n,
      }),
      'ReceiptSegmentReused',
    );
    await mint(2n);
    await rejectsCustom(projection, append(binding(), { tokenId: 2n }), 'ReceiptSegmentReused');
    assert.equal((await projection.currentEntry(tokenId)).version, 2n);
    assert.equal((await projection.currentEntry(2n)).version, 1n);
    assert.deepEqual(values(await projection.receiptBinding(tokenId, 2n)), values(binding()));
  });

  it('retains distinct bindings by exact token and version with no overwrite path', async () => {
    await mint();
    await append();
    const next = binding({
      segmentDigest: hash('segment-2'),
      requestHash: hash('request-2'),
      receiptDocumentHash: hash('document-2'),
    });
    await append(next, {
      commitment: hash('record-3'),
      effectiveAt: 3000n,
      holder: outsider.address,
    });
    assert.deepEqual(values(await projection.receiptBinding(tokenId, 2n)), values(binding()));
    assert.deepEqual(values(await projection.receiptBinding(tokenId, 3n)), values(next));
    assert.equal((await projection.entryAt(tokenId, 3n)).holder, outsider.address);
    assert.equal((await projection.entryAt(tokenId, 2n)).supersededAt, 3000n);
    assert.equal(await projection.mintPolicyHash(tokenId), policyHash);
    for (const version of [0n, 4n])
      await rejectsCustom(projection, projection.receiptBinding(tokenId, version), 'InvalidEntry');
    await rejectsCustom(projection, projection.receiptBinding(999n, 1n), 'TokenNotFound');
  });

  it('rejects unbound legacy append for policy-bound tokens without changing their projection', async () => {
    await mint();
    await rejectsCustom(
      projection,
      projection.appendFromSource(tokenId, hash('record-2'), hash('ref'), buyer.address, 2000n),
      'ReceiptBindingRequired',
    );
    await unchanged();
    await append();
  });

  it('preserves legacy mint/append and never backfills or upgrades old records into policy proof', async () => {
    await projection.mintFromSource(
      owner.address,
      tokenId,
      hash('initial-1'),
      hash('ref'),
      owner.address,
      1000n,
    );
    await projection.appendFromSource(tokenId, hash('legacy-2'), hash('ref'), buyer.address, 2000n);
    assert.equal(await projection.mintPolicyHash(tokenId), ethers.ZeroHash);
    for (const version of [1n, 2n])
      assert.deepEqual(
        values(await projection.receiptBinding(tokenId, version)),
        fields.map(() => ethers.ZeroHash),
      );
    await rejectsCustom(projection, mint(), 'InvalidEntry');
    await rejectsCustom(
      projection,
      append(binding(), { commitment: hash('record-3'), effectiveAt: 3000n }),
      'InvalidReceiptBinding',
    );
    assert.equal(await projection.mintPolicyHash(tokenId), ethers.ZeroHash);
    assert.equal((await projection.currentEntry(tokenId)).version, 2n);
  });

  it('keeps base ERC-721 trading independent and grants no owner power to the source', async () => {
    await mint();
    await rejectsCustom(
      projection,
      projection.transferFrom(owner.address, buyer.address, tokenId),
      'Unauthorized',
    );
    await projection.connect(owner).approve(outsider.address, tokenId);
    await projection.connect(outsider).transferFrom(owner.address, buyer.address, tokenId);
    assert.equal(await projection.getApproved(tokenId), ethers.ZeroAddress);
    assert.equal(await projection.balanceOf(owner.address), 0n);
    assert.equal(await projection.balanceOf(buyer.address), 1n);
    assert.equal((await projection.currentEntry(tokenId)).holder, owner.address);
    await append(binding(), { holder: outsider.address });
    assert.equal(await projection.ownerOf(tokenId), buyer.address);
    assert.equal((await projection.currentEntry(tokenId)).holder, outsider.address);
  });

  it('runs a derived application admission hook atomically and routes safe transfers through its override', async () => {
    const artifact = compiled['ApplicationHookFixture.sol'].ApplicationHookFixture;
    projection = await new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      source,
    ).deploy(hash('register'), source.address);
    await projection.waitForDeployment();
    await mint();
    await rejectsCustom(projection, append(), 'ApplicationAdmissionRejected');
    await unchanged();
    await rejectsCustom(
      projection,
      projection
        .connect(owner)
        ['safeTransferFrom(address,address,uint256)'](owner.address, buyer.address, tokenId),
      'ApplicationTransferRejected',
    );
    await rejectsCustom(
      projection,
      projection
        .connect(owner)
        ['safeTransferFrom(address,address,uint256,bytes)'](
          owner.address,
          buyer.address,
          tokenId,
          '0x',
        ),
      'ApplicationTransferRejected',
    );
    await append(binding({ requestHash: hash('allowed-request') }), { holder: source.address });
    assert.equal((await projection.currentEntry(tokenId)).holder, source.address);
    assert.equal(await projection.ownerOf(tokenId), owner.address);
  });
});

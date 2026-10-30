const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const {
  buildExactHoodiArtifacts,
  configuredWalletAddresses,
  ControlledOfflineSigner,
  WALLET_ADDRESSES,
} = require('../../erc-reference/test/controlled-offline-signer.cjs');

// Real ethers validation of synthetic configuration, with no signer or bridge invocation.
const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';
const walletNames = ['ERC_TEST_WALLET_1_ADDRESS', 'ERC_TEST_WALLET_2_ADDRESS'];

describe('controlled signer configuration with real ethers', function () {
  let before;

  beforeEach(function () {
    before = new Map(walletNames.map((name) => [name, process.env[name]]));
    process.env.ERC_TEST_WALLET_1_ADDRESS = first;
    process.env.ERC_TEST_WALLET_2_ADDRESS = second;
  });

  afterEach(function () {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('requires two configured distinct nonzero wallet addresses', function () {
    assert.deepEqual(configuredWalletAddresses(), { ArtFi1: first, ArtFi2: second });
    for (const name of walletNames) {
      for (const value of [undefined, '', '   ', 'invalid', ethers.ZeroAddress]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
        assert.throws(configuredWalletAddresses);
        assert.throws(() => new ControlledOfflineSigner('ArtFi1', null));
      }
      process.env[name] = name === walletNames[0] ? first : second;
    }
    process.env.ERC_TEST_WALLET_2_ADDRESS = first;
    assert.throws(configuredWalletAddresses, /distinct nonzero/);
  });

  it('preserves ethers checksum validation and normalized duplicate rejection', function () {
    const lowercase = `0x${'ab'.repeat(20)}`;
    const checksummed = ethers.getAddress(lowercase);
    process.env.ERC_TEST_WALLET_1_ADDRESS = lowercase;
    assert.equal(configuredWalletAddresses().ArtFi1, checksummed);
    process.env.ERC_TEST_WALLET_2_ADDRESS = checksummed;
    assert.throws(configuredWalletAddresses, /distinct nonzero/);

    process.env.ERC_TEST_WALLET_2_ADDRESS = second;
    const invalidChecksum = checksummed.replace(/[a-fA-F]/, (letter) =>
      letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
    );
    assert.throws(() => ethers.getAddress(invalidChecksum), /checksum/i);
    process.env.ERC_TEST_WALLET_1_ADDRESS = invalidChecksum;
    assert.throws(configuredWalletAddresses, /checksum/i);
  });

  it('keeps aliases dynamic when configuration becomes missing', function () {
    assert.equal(WALLET_ADDRESSES.ArtFi1, first);
    assert.equal(WALLET_ADDRESSES.ArtFi2, second);
    delete process.env.ERC_TEST_WALLET_2_ADDRESS;
    assert.throws(() => WALLET_ADDRESSES.ArtFi1, /missing controlled-test configuration/);
    assert.throws(() => WALLET_ADDRESSES.ArtFi2, /missing controlled-test configuration/);
  });

  it('rejects address mismatches and unsupported wallet aliases', function () {
    const populated = {
      to: null,
      nonce: 7,
      gasLimit: 500000n,
      maxFeePerGas: 3000000000n,
      maxPriorityFeePerGas: 1000000000n,
      data: '0x60006000',
    };
    for (const [wallet, address] of [
      ['ArtFi1', second],
      ['ArtFi2', first],
    ]) {
      assert.throws(
        () => buildExactHoodiArtifacts({ wallet, address, populated }),
        /address mismatch/,
      );
    }
    assert.throws(
      () => buildExactHoodiArtifacts({ wallet: 'Unknown', address: first, populated }),
      /unsupported/,
    );
    assert.throws(() => new ControlledOfflineSigner('Unknown', null), /unsupported/);
  });

  it('retains arbitrary message and typed-data signing denial', async function () {
    const signer = new ControlledOfflineSigner('ArtFi1', null);
    await assert.rejects(signer.signMessage('synthetic-message'), /do not sign arbitrary messages/);
    await assert.rejects(signer.signTypedData({}, {}, {}), /do not sign arbitrary typed data/);
  });
});

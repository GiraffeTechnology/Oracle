import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  configuredWalletAddresses,
  configuredExecutablePath,
  configuredBridgeAuthorization,
} = require('../erc-reference/test/controlled-offline-signer.cjs');

function withConfiguration(values, callback) {
  const before = {};
  for (const [name, value] of Object.entries(values)) {
    before[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { callback(); } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('controlled signer requires two configured distinct nonzero wallet addresses', () => {
  const first = '0x1111111111111111111111111111111111111111';
  const second = '0x2222222222222222222222222222222222222222';
  withConfiguration({ ERC_TEST_WALLET_1_ADDRESS: first, ERC_TEST_WALLET_2_ADDRESS: second }, () => {
    assert.deepEqual(configuredWalletAddresses(), { ArtFi1: first, ArtFi2: second });
  });
  for (const value of [undefined, '', 'invalid', first, '0x0000000000000000000000000000000000000000']) {
    withConfiguration({ ERC_TEST_WALLET_1_ADDRESS: first, ERC_TEST_WALLET_2_ADDRESS: value }, () => {
      assert.throws(configuredWalletAddresses);
    });
  }
});

test('controlled signer requires explicit absolute executable paths', () => {
  for (const value of [undefined, '', 'relative-script.ps1']) {
    withConfiguration({ ERC_SIGNER_WRAPPER_PATH: value }, () => {
      assert.throws(() => configuredExecutablePath('ERC_SIGNER_WRAPPER_PATH'));
    });
  }
  withConfiguration({ ERC_SIGNER_WRAPPER_PATH: '/example/signer.ps1' }, () => {
    assert.equal(configuredExecutablePath('ERC_SIGNER_WRAPPER_PATH'), '/example/signer.ps1');
  });
});

test('controlled bridge requires an explicit authorization identifier', () => {
  for (const value of [undefined, '', 'invalid']) {
    withConfiguration({ ERC_CHAIN_BRIDGE_AUTHORIZATION_ID: value }, () => {
      assert.throws(configuredBridgeAuthorization);
    });
  }
  const value = '00000000-0000-0000-0000-000000000001';
  withConfiguration({ ERC_CHAIN_BRIDGE_AUTHORIZATION_ID: value }, () => {
    assert.equal(configuredBridgeAuthorization(), value);
  });
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  requiredConfiguration,
  configuredExecutablePath,
  configuredBridgeAuthorization,
} = require('../erc-reference/test/controlled-test-configuration.cjs');

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

test('controlled-test configuration requires nonempty wallet address inputs', () => {
  // Address semantics are validated with real ethers in the contract test suite.
  for (const name of ['ERC_TEST_WALLET_1_ADDRESS', 'ERC_TEST_WALLET_2_ADDRESS']) {
    for (const value of [undefined, '', '   ']) {
      withConfiguration({ [name]: value }, () => {
        assert.throws(() => requiredConfiguration(name), /missing controlled-test configuration/);
      });
    }
    withConfiguration({ [name]: '  configured-value  ' }, () => {
      assert.equal(requiredConfiguration(name), 'configured-value');
    });
  }
});

test('controlled signer requires explicit absolute executable paths', () => {
  for (const name of ['ERC_SIGNER_WRAPPER_PATH', 'ERC_CHAIN_BRIDGE_PATH']) {
    for (const value of [undefined, '', '   ', 'relative-script.ps1']) {
      withConfiguration({ [name]: value }, () => {
        assert.throws(() => configuredExecutablePath(name));
      });
    }
    withConfiguration({ [name]: '/example/signer.ps1' }, () => {
      assert.equal(configuredExecutablePath(name), '/example/signer.ps1');
    });
  }
});

test('controlled bridge requires an explicit authorization identifier', () => {
  for (const value of [undefined, '', '   ', 'invalid']) {
    withConfiguration({ ERC_CHAIN_BRIDGE_AUTHORIZATION_ID: value }, () => {
      assert.throws(configuredBridgeAuthorization);
    });
  }
  const value = '00000000-0000-0000-0000-000000000001';
  withConfiguration({ ERC_CHAIN_BRIDGE_AUTHORIZATION_ID: value }, () => {
    assert.equal(configuredBridgeAuthorization(), value);
  });
});

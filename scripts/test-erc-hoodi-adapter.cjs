const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const {
  buildExactHoodiArtifacts,
  ControlledOfflineSigner,
  HOODI_CHAIN_ID,
  WALLET_ADDRESSES
} = require("../erc-reference/test/controlled-offline-signer.cjs");

const base = {
  nonce: 7,
  gasLimit: 500000n,
  maxFeePerGas: 3_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  data: "0x60006000"
};
const fixedNow = Date.parse("2026-08-24T00:00:00Z");

// Synthetic addresses for isolated policy-construction tests only.
process.env.ERC_TEST_WALLET_1_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.ERC_TEST_WALLET_2_ADDRESS = "0x2222222222222222222222222222222222222222";

const deployment = buildExactHoodiArtifacts({
  wallet: "ArtFi1",
  address: WALLET_ADDRESSES.ArtFi1,
  populated: { ...base, to: null },
  now: fixedNow
});
assert.deepEqual(Object.keys(deployment.request), [
  "schemaVersion", "chainId", "type", "from", "to", "value", "nonce", "gas",
  "maxFeePerGas", "maxPriorityFeePerGas", "data", "accessList"
]);
assert.equal(deployment.request.chainId, HOODI_CHAIN_ID);
assert.equal(deployment.request.to, null);
assert.equal(deployment.request.value, "0");
assert.deepEqual(deployment.request.accessList, []);
assert.equal(deployment.policy.network, "hoodi");
assert.equal(deployment.policy.wallet, "ArtFi1");
assert.equal(deployment.policy.deployments.length, 1);
assert.equal(deployment.policy.allowedCalls.length, 0);
assert.equal(deployment.policy.deployments[0].action, "erc-test-deployment");
assert.equal(deployment.policy.deployments[0].initCodeKeccak256, ethers.keccak256(base.data));
assert.equal(Date.parse(deployment.policy.expiresAt), fixedNow + 60 * 60_000);

const target = "0x1111111111111111111111111111111111111111";
const callData = "0x12345678abcdef00";
const call = buildExactHoodiArtifacts({
  wallet: "ArtFi2",
  address: WALLET_ADDRESSES.ArtFi2,
  populated: { ...base, to: target, data: callData },
  now: fixedNow
});
assert.equal(call.policy.deployments.length, 0);
assert.equal(call.policy.allowedCalls.length, 1);
assert.deepEqual(call.policy.allowedCalls[0], {
  action: "erc-test-call",
  target: ethers.getAddress(target),
  selector: "0x12345678",
  calldataKeccak256: ethers.keccak256(callData)
});

assert.throws(() => buildExactHoodiArtifacts({
  wallet: "ArtFi1",
  address: WALLET_ADDRESSES.ArtFi2,
  populated: { ...base, to: null }
}), /address mismatch/);
assert.throws(() => buildExactHoodiArtifacts({
  wallet: "Unknown",
  address: WALLET_ADDRESSES.ArtFi1,
  populated: { ...base, to: null }
}), /unsupported/);

const signer = new ControlledOfflineSigner("ArtFi1", null);
assert.rejects(signer.signMessage("forbidden"));
assert.rejects(signer.signTypedData({}, {}, {}));

console.log("erc-hoodi-adapter: pass (exact deployment/call policy and arbitrary-signing denial)");

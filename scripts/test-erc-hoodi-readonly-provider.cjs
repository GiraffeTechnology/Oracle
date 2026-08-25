const assert = require("node:assert/strict");
const {
  BridgeReadonlyProvider,
  HOODI_CHAIN_ID,
  WALLET_ADDRESSES
} = require("../erc-reference/test/controlled-offline-signer.cjs");

(async () => {
  const provider = new BridgeReadonlyProvider();
  try {
    const network = await provider.getNetwork();
    assert.equal(Number(network.chainId), HOODI_CHAIN_ID);
    const block = await provider.getBlock("latest");
    assert.ok(block.number > 0);
    assert.ok(block.timestamp > 0);
    const feeData = await provider.getFeeData();
    assert.ok(feeData.maxFeePerGas > 0n);
    assert.ok(feeData.maxPriorityFeePerGas > 0n);
    const nonce1 = await provider.getTransactionCount(WALLET_ADDRESSES.ArtFi1, "pending");
    const nonce2 = await provider.getTransactionCount(WALLET_ADDRESSES.ArtFi2, "pending");
    const code = await provider.getCode("0x0000000000000000000000000000000000000000");
    assert.equal(code, "0x");
    const logs = await provider.getLogs({ fromBlock: block.number, toBlock: block.number });
    assert.ok(Array.isArray(logs));

    let writeDenied = false;
    try {
      await provider.send("eth_sendRawTransaction", ["0x02"]);
    } catch {
      writeDenied = true;
    }
    assert.equal(writeDenied, true, "provider-readonly must reject broadcast before submission");

    console.log(JSON.stringify({
      test: "erc-hoodi-readonly-provider",
      status: "pass",
      chainId: Number(network.chainId),
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
      artFi1PendingNonce: nonce1,
      artFi2PendingNonce: nonce2,
      logsArray: true,
      providerWriteDenied: true
    }));
  } finally {
    await provider.destroy();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

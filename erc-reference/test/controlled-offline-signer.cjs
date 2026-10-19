const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ethers } = require("ethers");
const {
  requiredConfiguration,
  configuredExecutablePath,
  configuredBridgeAuthorization
} = require("./controlled-test-configuration.cjs");

const HOODI_CHAIN_ID = 560048;
function configuredWalletAddresses() {
  const first = ethers.getAddress(requiredConfiguration("ERC_TEST_WALLET_1_ADDRESS"));
  const second = ethers.getAddress(requiredConfiguration("ERC_TEST_WALLET_2_ADDRESS"));
  if (first === ethers.ZeroAddress || second === ethers.ZeroAddress || first === second) {
    throw new Error("controlled test wallets must be distinct nonzero addresses");
  }
  return { ArtFi1: first, ArtFi2: second };
}

// Compatibility aliases; actual addresses are supplied by test configuration.
const WALLET_ADDRESSES = Object.freeze({
  get ArtFi1() { return configuredWalletAddresses().ArtFi1; },
  get ArtFi2() { return configuredWalletAddresses().ArtFi2; }
});

function sha256Utf8(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function writeExclusive(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function parseWrapperResult(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Ignore non-JSON PowerShell host output and parse only the final JSON object.
    }
  }
  throw new Error("offline signer returned no machine-readable result");
}

function invokeWrapper({ wallet, requestPath, policyPath, policyHash, outputPath }) {
  const wrapperPath = configuredExecutablePath("ERC_SIGNER_WRAPPER_PATH");
  const powershell = process.env.ERC_SIGNER_POWERSHELL || "powershell.exe";
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", wrapperPath,
      "-Action", "sign",
      "-Wallet", wallet,
      "-ChainId", String(HOODI_CHAIN_ID),
      "-Request", requestPath,
      "-Policy", policyPath,
      "-PinnedPolicySha256", policyHash,
      "-Output", outputPath
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 }
  );
  const parsed = parseWrapperResult(`${result.stdout || ""}\n${result.stderr || ""}`);
  if (result.status !== 0 || parsed.ok !== true) {
    throw new Error(`controlled offline signer refused: ${parsed.errorCode || "WRAPPER_REFUSED"}`);
  }
  return parsed;
}

function invokeBridge(action, params = {}, sensitiveStdinFile) {
  const bridgePath = configuredExecutablePath("ERC_CHAIN_BRIDGE_PATH");
  const powershell = process.env.ERC_SIGNER_POWERSHELL || "powershell.exe";
  const arguments = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", bridgePath,
    "-AuthorizedThreadId", configuredBridgeAuthorization(),
    "-Network", "hoodi",
    "-Action", action,
    "-ParamsJson", JSON.stringify(params),
    "-TimeoutSeconds", "900"
  ];
  if (sensitiveStdinFile) {
    arguments.push("-SensitiveStdinFile", sensitiveStdinFile);
  }
  const result = spawnSync(powershell, arguments, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const parsed = parseWrapperResult(`${result.stdout || ""}\n${result.stderr || ""}`);
  if (result.status !== 0 || parsed.ok !== true || parsed.network !== "hoodi") {
    throw new Error(`controlled Hoodi bridge refused: ${parsed.errorCode || "BRIDGE_REFUSED"}`);
  }
  if (parsed.chainIdentityAttested !== true) {
    throw new Error("controlled Hoodi bridge did not attest chain identity");
  }
  return parsed.result;
}

function broadcastThroughBridge(rawTransaction) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "giraffe-erc-broadcast-"));
  const sensitivePath = path.join(tempDirectory, "signed-transaction.txt");
  try {
    writeExclusive(sensitivePath, rawTransaction);
    const result = invokeBridge("broadcast-stdin", {}, sensitivePath);
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/);
    return result.txHash;
  } finally {
    try { fs.rmSync(sensitivePath, { force: true }); } catch { /* best effort */ }
    try { fs.rmdirSync(tempDirectory); } catch { /* best effort */ }
  }
}

async function confirmReceiptThroughBridge(transactionHash) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const result = invokeBridge("receipt", { txHash: transactionHash });
    if (result.receipt) {
      if (BigInt(result.receipt.status) !== 1n) throw new Error("Hoodi transaction reverted");
      return result.receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 12_000));
  }
  throw new Error("timed out waiting for Hoodi receipt through controlled bridge");
}

class BridgeReadonlyProvider extends ethers.JsonRpcProvider {
  constructor() {
    super("http://127.0.0.1:1", { name: "hoodi", chainId: HOODI_CHAIN_ID }, {
      staticNetwork: true,
      batchMaxCount: 1,
      polling: true,
      pollingInterval: 12_000
    });
  }

  async _send(payload) {
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = [];
    for (const request of requests) {
      const result = invokeBridge("provider-readonly", {
        rpcMethod: request.method,
        rpcParams: request.params || []
      });
      responses.push({ jsonrpc: "2.0", id: request.id, result: result.rpcResult });
    }
    return responses;
  }

  async getBlockNumber() {
    const block = await this.send("eth_getBlockByNumber", ["latest", false]);
    return Number(BigInt(block.number));
  }

  async getFeeData() {
    const history = await this.send("eth_feeHistory", ["0x5", "latest", [50]]);
    const baseFees = history.baseFeePerGas.map((value) => BigInt(value));
    const rewards = (history.reward || [])
      .flat()
      .map((value) => BigInt(value))
      .filter((value) => value > 0n)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const baseFee = baseFees.at(-1);
    const priorityFee = rewards.length > 0
      ? rewards[Math.floor(rewards.length / 2)]
      : 1_000_000_000n;
    return new ethers.FeeData(null, baseFee * 2n + priorityFee, priorityFee);
  }
}

function buildExactHoodiArtifacts({ wallet, address, populated, now = Date.now() }) {
  if (!(wallet in WALLET_ADDRESSES)) throw new Error("unsupported controlled wallet alias");
  if (ethers.getAddress(address) !== WALLET_ADDRESSES[wallet]) {
    throw new Error("controlled wallet address mismatch");
  }
  const to = populated.to === null || populated.to === undefined
    ? null
    : ethers.getAddress(populated.to);
  const request = {
    schemaVersion: 2,
    chainId: HOODI_CHAIN_ID,
    type: "eip1559",
    from: address,
    to,
    value: "0",
    nonce: Number(populated.nonce),
    gas: populated.gasLimit.toString(),
    maxFeePerGas: populated.maxFeePerGas.toString(),
    maxPriorityFeePerGas: populated.maxPriorityFeePerGas.toString(),
    data: populated.data,
    accessList: []
  };
  const exactAction = to === null
    ? {
        deployments: [{
          action: "erc-test-deployment",
          initCodeKeccak256: ethers.keccak256(populated.data)
        }],
        allowedCalls: []
      }
    : {
        deployments: [],
        allowedCalls: [{
          action: "erc-test-call",
          target: to,
          selector: populated.data.slice(0, 10),
          calldataKeccak256: ethers.keccak256(populated.data)
        }]
      };
  const policy = {
    schemaVersion: 3,
    network: "hoodi",
    chainId: HOODI_CHAIN_ID,
    wallet,
    from: address,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    ...exactAction
  };
  return { request, policy, to };
}

class ControlledOfflineSigner extends ethers.AbstractSigner {
  constructor(wallet, provider) {
    super(provider);
    if (!(wallet in WALLET_ADDRESSES)) throw new Error("unsupported controlled wallet alias");
    this.wallet = wallet;
    this.address = WALLET_ADDRESSES[wallet];
  }

  connect(provider) {
    return new ControlledOfflineSigner(this.wallet, provider);
  }

  async getAddress() {
    return this.address;
  }

  async signMessage() {
    throw new Error("controlled test wallets do not sign arbitrary messages");
  }

  async signTypedData() {
    throw new Error("controlled test wallets do not sign arbitrary typed data");
  }

  async #populate(transaction) {
    const populated = await this.populateTransaction(transaction);
    const network = await this.provider.getNetwork();
    assert.equal(Number(network.chainId), HOODI_CHAIN_ID, "controlled signer is Hoodi-only");
    assert.equal(Number(populated.chainId), HOODI_CHAIN_ID, "transaction chainId mismatch");
    assert.equal(populated.value ?? 0n, 0n, "controlled signer only permits zero-value calls");
    assert.ok(populated.data && populated.data !== "0x", "transaction data must be nonempty");
    assert.ok(populated.gasLimit > 0n, "gas limit is required");
    assert.ok(populated.maxFeePerGas > 0n, "maxFeePerGas is required");
    assert.ok(populated.maxPriorityFeePerGas > 0n, "maxPriorityFeePerGas is required");
    assert.ok(populated.maxPriorityFeePerGas <= populated.maxFeePerGas);
    return populated;
  }

  async #signPopulated(populated) {
    const { request, policy, to } = buildExactHoodiArtifacts({
      wallet: this.wallet,
      address: this.address,
      populated
    });

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "giraffe-erc-hoodi-"));
    const requestPath = path.join(tempDirectory, "request.json");
    const policyPath = path.join(tempDirectory, "policy.json");
    const outputPath = path.join(tempDirectory, "signed-transaction.txt");
    const requestText = JSON.stringify(request);
    const policyText = JSON.stringify(policy);
    try {
      writeExclusive(requestPath, requestText);
      writeExclusive(policyPath, policyText);
      const policyHash = sha256Utf8(policyText);
      const result = invokeWrapper({
        wallet: this.wallet,
        requestPath,
        policyPath,
        policyHash,
        outputPath
      });
      const rawTransaction = fs.readFileSync(outputPath, "utf8").trim();
      assert.match(rawTransaction, /^0x[0-9a-fA-F]+$/);
      assert.equal(
        sha256Utf8(rawTransaction).toLowerCase(),
        result.signedTransactionSha256.toLowerCase(),
        "signed transaction digest mismatch"
      );
      const decoded = ethers.Transaction.from(rawTransaction);
      assert.equal(decoded.chainId, BigInt(HOODI_CHAIN_ID));
      assert.equal(decoded.from, this.address);
      assert.equal(decoded.nonce, request.nonce);
      assert.equal(decoded.to, to);
      assert.equal(decoded.value, 0n);
      assert.equal(decoded.data, request.data);
      console.log("TESTNET_EVIDENCE", JSON.stringify({
        kind: "controlled-signature",
        wallet: this.wallet,
        chainId: HOODI_CHAIN_ID,
        action: result.action,
        nonce: result.nonce,
        requestSha256: result.requestSha256,
        policySha256: result.policySha256,
        signedTransactionSha256: result.signedTransactionSha256
      }));
      return rawTransaction;
    } finally {
      for (const candidate of [outputPath, requestPath, policyPath]) {
        try { fs.rmSync(candidate, { force: true }); } catch { /* best effort */ }
      }
      try { fs.rmdirSync(tempDirectory); } catch { /* best effort */ }
    }
  }

  async signTransaction(transaction) {
    return this.#signPopulated(await this.#populate(transaction));
  }

  async sendTransaction(transaction) {
    const populated = await this.#populate(transaction);
    const rawTransaction = await this.#signPopulated(populated);
    const transactionHash = broadcastThroughBridge(rawTransaction);
    assert.equal(
      transactionHash.toLowerCase(),
      ethers.keccak256(rawTransaction).toLowerCase(),
      "bridge returned an unexpected transaction hash"
    );
    const bridgeReceipt = await confirmReceiptThroughBridge(transactionHash);
    let response;
    for (let attempt = 0; attempt < 20 && !response; attempt += 1) {
      response = await this.provider.getTransaction(transactionHash);
      if (!response) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    if (!response) throw new Error("confirmed Hoodi transaction is unavailable from read provider");
    console.log("TESTNET_EVIDENCE", JSON.stringify({
      kind: "broadcast",
      wallet: this.wallet,
      nonce: populated.nonce,
      transactionHash,
      blockNumber: Number(BigInt(bridgeReceipt.blockNumber)),
      chainIdentityAttested: true,
      transport: "controlled-hoodi-bridge"
    }));
    return response;
  }
}

module.exports = {
  BridgeReadonlyProvider,
  buildExactHoodiArtifacts,
  ControlledOfflineSigner,
  HOODI_CHAIN_ID,
  WALLET_ADDRESSES,
  configuredWalletAddresses,
  configuredExecutablePath,
  configuredBridgeAuthorization
};

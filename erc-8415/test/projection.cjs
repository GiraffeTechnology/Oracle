const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const hre = require("hardhat");
const { ethers } = hre;

const hardhatRequire = createRequire(require.resolve("hardhat/package.json"));
const solc = hardhatRequire("solc");
const source = path.resolve(__dirname, "../contracts/OracleRegisterProjection.sol");
const b32 = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));

function compile() {
  const input = {
    language: "Solidity",
    sources: { "OracleRegisterProjection.sol": { content: fs.readFileSync(source, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts["OracleRegisterProjection.sol"];
}

function interfaceId(abi) {
  const iface = new ethers.Interface(abi);
  let value = 0n;
  for (const fragment of iface.fragments) {
    if (fragment.type === "function" && fragment.name !== "supportsInterface") {
      value ^= BigInt(fragment.selector);
    }
  }
  return ethers.toBeHex(value, 4);
}

async function rejectsCustom(iface, promise, errorName) {
  const selector = iface.getError(errorName).selector;
  await assert.rejects(promise, (error) => {
    const data = error?.data ?? error?.error?.data ?? error?.info?.error?.data;
    return typeof data === "string" && data.startsWith(selector);
  });
}

describe("ERC-8415 projection conformance", function () {
  let compiled;
  let projection;
  let sourceAuthority;
  let owner;
  let buyer;
  let outsider;

  const tokenId = 1n;
  const registerId = b32("authorized-register/v1");
  const commitment1 = b32("entry-1");
  const commitment2 = b32("entry-2");
  const reference1 = b32("source-proof-1");
  const reference2 = b32("source-proof-2");

  before(() => { compiled = compile(); });

  beforeEach(async () => {
    [, sourceAuthority, owner, buyer, outsider] = await ethers.getSigners();
    const artifact = compiled.OracleRegisterProjection;
    projection = await new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      sourceAuthority
    ).deploy(registerId, sourceAuthority.address);
    await projection.waitForDeployment();
  });

  async function initialize() {
    return projection.mintFromSource(
      owner.address,
      tokenId,
      commitment1,
      reference1,
      owner.address,
      1000n
    );
  }

  it("exposes only the ERC-165, ERC-721, and ERC-8415 projection interfaces", async () => {
    const projectionId = interfaceId(compiled.IRegisterProjection.abi);
    assert.equal(projectionId, "0x6309e170");
    assert.equal(await projection.supportsInterface("0x01ffc9a7"), true);
    assert.equal(await projection.supportsInterface("0x80ac58cd"), true);
    assert.equal(await projection.supportsInterface(projectionId), true);
    assert.equal(await projection.supportsInterface("0xf4a7d71b"), false);
    assert.equal(await projection.supportsInterface("0xffffffff"), false);
  });

  it("rejects zero or mutable authority identities", async () => {
    const artifact = compiled.OracleRegisterProjection;
    await rejectsCustom(
      new ethers.Interface(artifact.abi),
      new ethers.ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, sourceAuthority)
        .deploy(ethers.ZeroHash, sourceAuthority.address),
      "InvalidEntry"
    );
    await rejectsCustom(
      new ethers.Interface(artifact.abi),
      new ethers.ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, sourceAuthority)
        .deploy(registerId, ethers.ZeroAddress),
      "InvalidAddress"
    );
    assert.equal(await projection.registerId(), registerId);
    assert.equal(await projection.sourceAuthority(), sourceAuthority.address);
  });

  it("initializes version one with no predecessor and an open-ended interval", async () => {
    await initialize();
    const entry = await projection.currentEntry(tokenId);
    assert.equal(entry.version, 1n);
    assert.equal(entry.recordCommitment, commitment1);
    assert.equal(entry.previousCommitment, ethers.ZeroHash);
    assert.equal(entry.supersededAt, 0n);
    assert.equal(entry.holder, owner.address);
    assert.equal(await projection.entryCount(tokenId), 1n);
  });

  it("admits entries only from the configured source authority", async () => {
    await rejectsCustom(
      projection.interface,
      projection.connect(outsider).mintFromSource(
        owner.address, tokenId, commitment1, reference1, owner.address, 1000n
      ),
      "Unauthorized"
    );
    await initialize();
    await rejectsCustom(
      projection.interface,
      projection.connect(outsider).appendFromSource(
        tokenId, commitment2, reference2, buyer.address, 2000n
      ),
      "Unauthorized"
    );
    assert.equal((await projection.currentEntry(tokenId)).version, 1n);
  });

  it("appends n+1, links commitments, and closes the preceding interval", async () => {
    await initialize();
    await projection.appendFromSource(tokenId, commitment2, reference2, buyer.address, 2000n);
    const first = await projection.entryAt(tokenId, 1n);
    const second = await projection.entryAt(tokenId, 2n);
    assert.equal(first.supersededAt, 2000n);
    assert.equal(second.version, 2n);
    assert.equal(second.previousCommitment, commitment1);
    assert.equal(second.supersededAt, 0n);
    assert.equal(await projection.entryCount(tokenId), 2n);
  });

  it("rejects equal time, repeated commitments, and duplicate initialization", async () => {
    await initialize();
    await rejectsCustom(
      projection.interface,
      projection.appendFromSource(tokenId, commitment2, reference2, buyer.address, 1000n),
      "EffectiveAtNotIncreasing"
    );
    await rejectsCustom(
      projection.interface,
      projection.appendFromSource(tokenId, commitment1, reference2, buyer.address, 2000n),
      "CommitmentReused"
    );
    await rejectsCustom(
      projection.interface,
      projection.mintFromSource(
        buyer.address, tokenId, commitment2, reference2, buyer.address, 2000n
      ),
      "InvalidEntry"
    );
    assert.equal((await projection.currentEntry(tokenId)).version, 1n);
    assert.equal((await projection.entryAt(tokenId, 1n)).supersededAt, 0n);
  });

  it("rejects decreasing time and invalid or nonexistent version queries", async () => {
    await initialize();
    await projection.appendFromSource(tokenId, commitment2, reference2, buyer.address, 2000n);
    await rejectsCustom(
      projection.interface,
      projection.appendFromSource(
        tokenId, b32("entry-3"), b32("source-proof-3"), outsider.address, 1500n
      ),
      "EffectiveAtNotIncreasing"
    );
    await rejectsCustom(projection.interface, projection.entryAt(tokenId, 0n), "InvalidEntry");
    await rejectsCustom(projection.interface, projection.entryAt(tokenId, 3n), "InvalidEntry");
    await rejectsCustom(projection.interface, projection.currentEntry(999n), "TokenNotFound");
    await rejectsCustom(projection.interface, projection.entryAsOf(999n, 1000n), "TokenNotFound");
    assert.equal((await projection.currentEntry(tokenId)).version, 2n);
  });

  it("resolves entry and holder at exact interval boundaries", async () => {
    await initialize();
    await projection.appendFromSource(tokenId, commitment2, reference2, buyer.address, 2000n);
    await rejectsCustom(projection.interface, projection.entryAsOf(tokenId, 999n), "NoEntryAsOf");
    assert.equal((await projection.entryAsOf(tokenId, 1000n)).version, 1n);
    assert.equal((await projection.entryAsOf(tokenId, 1999n)).version, 1n);
    assert.equal((await projection.entryAsOf(tokenId, 2000n)).version, 2n);
    assert.equal(await projection.holderAsOf(tokenId, 1999n), owner.address);
    assert.equal(await projection.holderAsOf(tokenId, 2000n), buyer.address);
  });

  it("reports finality for every instant before the latest effective instant", async () => {
    await initialize();
    assert.equal(await projection.isFinalAsOf(tokenId, 999n), true);
    assert.equal(await projection.isFinalAsOf(tokenId, 1000n), false);
    await projection.appendFromSource(tokenId, commitment2, reference2, buyer.address, 2000n);
    assert.equal(await projection.isFinalAsOf(tokenId, 999n), true);
    assert.equal(await projection.isFinalAsOf(tokenId, 1000n), true);
    assert.equal(await projection.isFinalAsOf(tokenId, 1999n), true);
    assert.equal(await projection.isFinalAsOf(tokenId, 2000n), false);
  });

  it("rejects approving the current ERC-721 owner", async () => {
    await initialize();
    await rejectsCustom(
      projection.interface,
      projection.connect(owner).approve(owner.address, tokenId),
      "InvalidAddress"
    );
    assert.equal(await projection.getApproved(tokenId), ethers.ZeroAddress);
  });

  it("keeps ERC-721 trading independent from the register projection", async () => {
    await initialize();
    await projection.connect(owner).transferFrom(owner.address, buyer.address, tokenId);
    assert.equal(await projection.ownerOf(tokenId), buyer.address);
    assert.equal((await projection.currentEntry(tokenId)).holder, owner.address);
    await projection.appendFromSource(tokenId, commitment2, reference2, outsider.address, 2000n);
    assert.equal(await projection.ownerOf(tokenId), buyer.address);
    assert.equal((await projection.currentEntry(tokenId)).holder, outsider.address);
  });
});


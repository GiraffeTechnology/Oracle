const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const hre = require("hardhat");

const hardhatRequire = createRequire(require.resolve("hardhat/package.json"));
const solc = hardhatRequire("solc");
const { ethers } = hre;

const sourcePath = path.resolve(
  __dirname,
  "../contracts/VersionedRWACertificateReference.sol"
);

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "VersionedRWACertificateReference.sol": {
        content: fs.readFileSync(sourcePath, "utf8")
      }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] }
      }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  const warnings = (output.errors || []).filter((entry) => entry.severity === "warning");
  assert.equal(warnings.length, 0, warnings.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts["VersionedRWACertificateReference.sol"];
}

function interfaceId(abi, interfaceName) {
  const iface = new ethers.Interface(abi);
  let value = 0n;
  for (const fragment of iface.fragments) {
    if (fragment.type === "function") {
      if (fragment.name === "supportsInterface") continue;
      value ^= BigInt(fragment.selector);
    }
  }
  return ethers.toBeHex(value, 4);
}

function b32(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

describe("Versioned RWA Certificate Settlement submission gate", function () {
  let compiled;
  let contract;
  let anchorRegistryMock;
  let administrator;
  let owner;
  let recipient;
  let operator;
  let authority;
  let outsider;
  let chainId;

  const tokenId = 1n;
  const certificateV1 = b32("certificate-v1");
  const authorityReferenceV1 = b32("authority-reference-v1");
  const anchorIdV1 = b32("asset-anchor-1");

  before(function () {
    compiled = compile();
  });

  beforeEach(async function () {
    [administrator, owner, recipient, operator, authority, outsider] =
      await ethers.getSigners();
    chainId = Number((await ethers.provider.getNetwork()).chainId);
    const anchorArtifact = compiled.AssetAnchorRegistryLifecycleMock;
    const anchorFactory = new ethers.ContractFactory(
      anchorArtifact.abi,
      `0x${anchorArtifact.evm.bytecode.object}`,
      administrator
    );
    anchorRegistryMock = await anchorFactory.deploy();
    await anchorRegistryMock.waitForDeployment();
    await anchorRegistryMock.setActive(anchorIdV1, true);
    const artifact = compiled.VersionedRWACertificateReference;
    const factory = new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      administrator
    );
    contract = await factory.deploy(await anchorRegistryMock.getAddress());
    await contract.waitForDeployment();
    await contract.mint(
      owner.address,
      tokenId,
      certificateV1,
      authorityReferenceV1,
      1,
      authority.address,
      anchorIdV1
    );
  });

  async function start(idLabel = "settlement-1", destination = recipient, id = tokenId) {
    const block = await ethers.provider.getBlock("latest");
    const settlementId = b32(idLabel);
    const deadline = block.timestamp + 3600;
    await contract.connect(owner).beginSettlement(
      id,
      settlementId,
      destination.address,
      b32(`snapshot-${idLabel}`),
      deadline
    );
    return { settlementId, deadline };
  }

  async function authorization({
    settlementId,
    id = tokenId,
    from = owner.address,
    to = recipient.address,
    previousCertificateHash = certificateV1,
    newCertificateHash = b32("certificate-v2"),
    newCertificateVersion = 2,
    effectiveAt = 100,
    validUntil,
    nonce = 1n,
    signer = authority,
    verifyingContract
  }) {
    const block = await ethers.provider.getBlock("latest");
    const expiry = validUntil ?? block.timestamp + 1800;
    const domain = {
      name: "Versioned RWA Certificate Settlement",
      version: "1",
      chainId,
      verifyingContract: verifyingContract ?? await contract.getAddress()
    };
    const types = {
      SettlementAuthorization: [
        { name: "tokenId", type: "uint256" },
        { name: "settlementId", type: "bytes32" },
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "previousCertificateHash", type: "bytes32" },
        { name: "newCertificateHash", type: "bytes32" },
        { name: "newCertificateVersion", type: "uint64" },
        { name: "effectiveAt", type: "uint64" },
        { name: "validUntil", type: "uint64" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const value = {
      tokenId: id,
      settlementId,
      from,
      to,
      previousCertificateHash,
      newCertificateHash,
      newCertificateVersion,
      effectiveAt,
      validUntil: expiry,
      nonce
    };
    const signature = await signer.signTypedData(domain, types, value);
    const authorityData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint64", "uint256", "bytes"],
      [expiry, nonce, signature]
    );
    return { authorityData, newCertificateHash, effectiveAt, nonce };
  }

  async function cancellationAuthorization({
    settlementId,
    id = tokenId,
    reasonHash,
    validUntil,
    nonce = 900n,
    signer = authority
  }) {
    const block = await ethers.provider.getBlock("latest");
    const expiry = validUntil ?? block.timestamp + 1800;
    const domain = {
      name: "Versioned RWA Certificate Settlement",
      version: "1",
      chainId,
      verifyingContract: await contract.getAddress()
    };
    const types = {
      CancellationAuthorization: [
        { name: "settlementId", type: "bytes32" },
        { name: "tokenId", type: "uint256" },
        { name: "reasonHash", type: "bytes32" },
        { name: "validUntil", type: "uint64" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const signature = await signer.signTypedData(domain, types, {
      settlementId,
      tokenId: id,
      reasonHash,
      validUntil: expiry,
      nonce
    });
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint64", "uint256", "bytes"],
      [expiry, nonce, signature]
    );
  }

  it("compiles both interfaces and exposes deterministic ERC-165 IDs", async function () {
    const certificateId = interfaceId(compiled.IVersionedRWACertificate.abi);
    const settlementId = interfaceId(compiled.IDeferredCertificateSettlement.abi);
    assert.equal(certificateId, "0xebaa86a0");
    assert.equal(settlementId, "0x2773d4c9");
    assert.equal(await contract.supportsInterface("0x01ffc9a7"), true);
    assert.equal(await contract.supportsInterface("0x80ac58cd"), true);
    assert.equal(await contract.supportsInterface(certificateId), true);
    assert.equal(await contract.supportsInterface(settlementId), true);
    const anchorId = interfaceId(compiled.IAssetBoundTokenId.abi);
    assert.equal(anchorId, "0x4a967b01");
    assert.equal(await contract.supportsInterface(anchorId), true);
    assert.equal(await contract.supportsInterface("0xffffffff"), false);
  });

  it("exposes one immutable active ERC-8325 token-ID anchor", async function () {
    assert.equal(await contract.anchorIdOf(tokenId), anchorIdV1);
    assert.equal(await contract.anchorRegistry(), await anchorRegistryMock.getAddress());
    assert.equal(await contract.isAnchorActiveFor(tokenId), true);
    await anchorRegistryMock.setActive(anchorIdV1, false);
    assert.equal(await contract.isAnchorActiveFor(tokenId), false);
  });

  it("rejects settlement initiation while the ERC-8325 anchor is inactive", async function () {
    await anchorRegistryMock.setActive(anchorIdV1, false);
    const block = await ethers.provider.getBlock("latest");
    await assert.rejects(
      contract.connect(owner).beginSettlement(
        tokenId,
        b32("inactive-anchor-settlement"),
        recipient.address,
        b32("inactive-anchor-snapshot"),
        block.timestamp + 3600
      )
    );
  });

  it("freezes the normative EIP-712 type hashes and authorityData tuple", async function () {
    assert.equal(
      await contract.SETTLEMENT_AUTHORIZATION_TYPEHASH(),
      ethers.id(
        "SettlementAuthorization(uint256 tokenId,bytes32 settlementId,address from,address to,bytes32 previousCertificateHash,bytes32 newCertificateHash,uint64 newCertificateVersion,uint64 effectiveAt,uint64 validUntil,uint256 nonce)"
      )
    );
    assert.equal(
      await contract.CANCELLATION_AUTHORIZATION_TYPEHASH(),
      ethers.id(
        "CancellationAuthorization(bytes32 settlementId,uint256 tokenId,bytes32 reasonHash,uint64 validUntil,uint256 nonce)"
      )
    );
    const { settlementId } = await start("encoding-vector");
    const signed = await authorization({ settlementId, nonce: 4242n });
    const [validUntil, nonce, signature] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["uint64", "uint256", "bytes"],
      signed.authorityData
    );
    assert.ok(validUntil > 0n);
    assert.equal(nonce, 4242n);
    assert.equal(ethers.getBytes(signature).length, 65);
  });

  it("has no selector collision across the two proposed interfaces", function () {
    const signatures = [
      ...compiled.IVersionedRWACertificate.abi,
      ...compiled.IDeferredCertificateSettlement.abi
    ]
      .filter((entry) => entry.type === "function" && entry.name !== "supportsInterface")
      .map((entry) => {
        const signature = `${entry.name}(${entry.inputs.map((input) => input.type).join(",")})`;
        return [signature, ethers.id(signature).slice(0, 10)];
      });
    assert.equal(new Set(signatures.map(([, selector]) => selector)).size, signatures.length);
  });

  it("keeps reference runtime bytecode below the EIP-170 limit", function () {
    const deployed = compiled.VersionedRWACertificateReference.evm.deployedBytecode.object;
    const byteLength = deployed.length / 2;
    assert.ok(byteLength > 0);
    assert.ok(byteLength < 24_576, `runtime bytecode is ${byteLength} bytes`);
  });

  it("initializes version 1 and preserves an append-only record", async function () {
    const current = await contract.currentCertificate(tokenId);
    assert.equal(current.certificateHash, certificateV1);
    assert.equal(current.previousCertificateHash, ethers.ZeroHash);
    assert.equal(current.version, 1n);
    await assert.rejects(contract.certificateAt(tokenId, 2));
  });

  it("blocks owner and approved-operator transfers through every ERC-721 entry point", async function () {
    await contract.connect(owner).approve(operator.address, tokenId);
    const { settlementId } = await start();
    assert.equal(await contract.ownerOf(tokenId), owner.address);
    assert.equal(await contract.getApproved(tokenId), ethers.ZeroAddress);
    assert.equal(await contract.pendingSettlementOf(tokenId), settlementId);

    await assert.rejects(
      contract.connect(owner).transferFrom(owner.address, outsider.address, tokenId)
    );
    await assert.rejects(
      contract.connect(operator).transferFrom(owner.address, outsider.address, tokenId)
    );
    await assert.rejects(
      contract.connect(owner)["safeTransferFrom(address,address,uint256)"](
        owner.address, outsider.address, tokenId
      )
    );
    await assert.rejects(
      contract.connect(owner)["safeTransferFrom(address,address,uint256,bytes)"](
        owner.address, outsider.address, tokenId, "0x1234"
      )
    );
    assert.equal(await contract.ownerOf(tokenId), owner.address);
  });

  it("atomically supersedes the certificate and transfers the token", async function () {
    const { settlementId } = await start();
    const signed = await authorization({ settlementId });
    const tx = await contract.finalizeSettlement(
      settlementId,
      signed.newCertificateHash,
      b32("authority-reference-v2"),
      signed.effectiveAt,
      signed.authorityData
    );
    const receipt = await tx.wait();
    const eventNames = receipt.logs
      .map((log) => {
        try { return contract.interface.parseLog(log)?.name; } catch { return undefined; }
      })
      .filter(Boolean);
    for (const required of ["CertificateSuperseded", "Transfer", "SettlementFinalized"]) {
      assert.ok(eventNames.includes(required));
    }
    assert.equal(await contract.ownerOf(tokenId), recipient.address);
    const current = await contract.currentCertificate(tokenId);
    assert.equal(current.version, 2n);
    assert.equal(current.certificateHash, signed.newCertificateHash);
    assert.equal(current.previousCertificateHash, certificateV1);
    const oldRecord = await contract.certificateAt(tokenId, 1);
    assert.notEqual(oldRecord.supersededAt, 0n);
    assert.equal((await contract.settlement(settlementId)).status, 2n);
    assert.equal(await contract.pendingSettlementOf(tokenId), ethers.ZeroHash);
    assert.equal(await contract.usedNonces(authority.address, signed.nonce), true);
  });

  it("rejects a wrong signer and leaves holder and certificate unchanged", async function () {
    const { settlementId } = await start();
    const signed = await authorization({ settlementId, signer: outsider });
    await assert.rejects(
      contract.finalizeSettlement(
        settlementId,
        signed.newCertificateHash,
        b32("bad-reference"),
        signed.effectiveAt,
        signed.authorityData
      )
    );
    assert.equal(await contract.ownerOf(tokenId), owner.address);
    assert.equal((await contract.currentCertificate(tokenId)).version, 1n);
    assert.equal((await contract.settlement(settlementId)).status, 1n);
  });

  it("rejects expired authority data and finalization after settlement deadline", async function () {
    const first = await start("expired-authorization");
    const block = await ethers.provider.getBlock("latest");
    const expired = await authorization({
      settlementId: first.settlementId,
      validUntil: block.timestamp - 1,
      nonce: 501n
    });
    await assert.rejects(
      contract.finalizeSettlement(
        first.settlementId,
        expired.newCertificateHash,
        b32("expired-reference"),
        expired.effectiveAt,
        expired.authorityData
      )
    );

    await ethers.provider.send("evm_setNextBlockTimestamp", [first.deadline + 1]);
    await ethers.provider.send("evm_mine", []);
    const late = await authorization({
      settlementId: first.settlementId,
      validUntil: first.deadline + 100,
      nonce: 502n
    });
    await assert.rejects(
      contract.finalizeSettlement(
        first.settlementId,
        late.newCertificateHash,
        b32("late-reference"),
        late.effectiveAt,
        late.authorityData
      )
    );
    assert.equal(await contract.ownerOf(tokenId), owner.address);
    assert.equal((await contract.currentCertificate(tokenId)).version, 1n);
  });

  it("rejects concurrent pending settlement and reused settlement IDs", async function () {
    const first = await start("unique-settlement");
    const block = await ethers.provider.getBlock("latest");
    await assert.rejects(
      contract.connect(owner).beginSettlement(
        tokenId,
        b32("concurrent-settlement"),
        outsider.address,
        b32("concurrent-snapshot"),
        block.timestamp + 3600
      )
    );
    await ethers.provider.send("evm_setNextBlockTimestamp", [first.deadline + 1]);
    await ethers.provider.send("evm_mine", []);
    await contract.connect(owner).cancelSettlement(first.settlementId, b32("timeout"), "0x");
    await assert.rejects(
      contract.connect(owner).beginSettlement(
        tokenId,
        first.settlementId,
        outsider.address,
        b32("reused-snapshot"),
        first.deadline + 7200
      )
    );
  });

  it("rejects replayed authority nonces across tokens", async function () {
    const secondToken = 2n;
    const secondAnchor = b32("asset-anchor-2");
    await anchorRegistryMock.setActive(secondAnchor, true);
    await contract.mint(
      owner.address,
      secondToken,
      certificateV1,
      authorityReferenceV1,
      1,
      authority.address,
      secondAnchor
    );
    const first = await start("settlement-first", recipient, tokenId);
    const firstAuth = await authorization({ settlementId: first.settlementId, nonce: 77n });
    await contract.finalizeSettlement(
      first.settlementId,
      firstAuth.newCertificateHash,
      b32("reference-first"),
      firstAuth.effectiveAt,
      firstAuth.authorityData
    );

    const second = await start("settlement-second", outsider, secondToken);
    const secondAuth = await authorization({
      settlementId: second.settlementId,
      id: secondToken,
      to: outsider.address,
      nonce: 77n,
      newCertificateHash: b32("second-token-v2")
    });
    await assert.rejects(
      contract.finalizeSettlement(
        second.settlementId,
        secondAuth.newCertificateHash,
        b32("reference-second"),
        secondAuth.effectiveAt,
        secondAuth.authorityData
      )
    );
    assert.equal(await contract.ownerOf(secondToken), owner.address);
    assert.equal((await contract.currentCertificate(secondToken)).version, 1n);
  });

  it("allows holder cancellation after deadline without changing holder or certificate", async function () {
    const { settlementId, deadline } = await start();
    await ethers.provider.send("evm_setNextBlockTimestamp", [deadline + 1]);
    await ethers.provider.send("evm_mine", []);
    await contract.connect(owner).cancelSettlement(settlementId, b32("timeout"), "0x");
    assert.equal(await contract.ownerOf(tokenId), owner.address);
    assert.equal((await contract.currentCertificate(tokenId)).version, 1n);
    assert.equal((await contract.settlement(settlementId)).status, 3n);
    assert.equal(await contract.pendingSettlementOf(tokenId), ethers.ZeroHash);
  });

  it("accepts canonical EIP-712 authority cancellation before deadline", async function () {
    const { settlementId } = await start("authority-cancellation");
    const reasonHash = b32("authority-cancelled");
    const authorityData = await cancellationAuthorization({
      settlementId,
      reasonHash,
      nonce: 901n
    });
    await contract.connect(outsider).cancelSettlement(
      settlementId,
      reasonHash,
      authorityData
    );
    assert.equal((await contract.settlement(settlementId)).status, 3n);
    assert.equal(await contract.ownerOf(tokenId), owner.address);
    assert.equal((await contract.currentCertificate(tokenId)).version, 1n);
    assert.equal(await contract.usedNonces(authority.address, 901n), true);
  });

  it("accepts EIP-1271 contract authority authorization", async function () {
    const mockArtifact = compiled.ERC1271AuthorityMock;
    const mockFactory = new ethers.ContractFactory(
      mockArtifact.abi,
      `0x${mockArtifact.evm.bytecode.object}`,
      administrator
    );
    const authorityContract = await mockFactory.deploy(authority.address);
    await authorityContract.waitForDeployment();
    const secondToken = 9n;
    const secondAnchor = b32("asset-anchor-9");
    await anchorRegistryMock.setActive(secondAnchor, true);
    await contract.mint(
      owner.address,
      secondToken,
      certificateV1,
      authorityReferenceV1,
      1,
      await authorityContract.getAddress(),
      secondAnchor
    );
    const block = await ethers.provider.getBlock("latest");
    const settlementId = b32("erc1271-settlement");
    await contract.connect(owner).beginSettlement(
      secondToken,
      settlementId,
      recipient.address,
      b32("erc1271-snapshot"),
      block.timestamp + 3600
    );
    const signed = await authorization({
      settlementId,
      id: secondToken,
      nonce: 1271n,
      newCertificateHash: b32("erc1271-certificate-v2")
    });
    await contract.finalizeSettlement(
      settlementId,
      signed.newCertificateHash,
      b32("erc1271-reference"),
      signed.effectiveAt,
      signed.authorityData
    );
    assert.equal(await contract.ownerOf(secondToken), recipient.address);
    assert.equal((await contract.currentCertificate(secondToken)).version, 2n);
  });

  it("maintains consecutive append-only history over repeated T+n settlements", async function () {
    let currentOwner = owner;
    let currentHash = certificateV1;
    let currentVersion = 1;
    const destinations = [recipient, outsider, operator, owner];

    for (let index = 0; index < 8; index += 1) {
      const destination = destinations[index % destinations.length];
      if (destination.address === currentOwner.address) continue;
      const block = await ethers.provider.getBlock("latest");
      const settlementId = b32(`property-settlement-${index}`);
      await contract.connect(currentOwner).beginSettlement(
        tokenId,
        settlementId,
        destination.address,
        b32(`property-snapshot-${index}`),
        block.timestamp + 3600
      );
      const nextHash = b32(`property-certificate-${index}`);
      const signed = await authorization({
        settlementId,
        from: currentOwner.address,
        to: destination.address,
        previousCertificateHash: currentHash,
        newCertificateHash: nextHash,
        newCertificateVersion: currentVersion + 1,
        nonce: BigInt(1000 + index),
        effectiveAt: 200 + index
      });
      await contract.finalizeSettlement(
        settlementId,
        nextHash,
        b32(`property-reference-${index}`),
        200 + index,
        signed.authorityData
      );
      currentVersion += 1;
      const record = await contract.currentCertificate(tokenId);
      assert.equal(record.version, BigInt(currentVersion));
      assert.equal(record.previousCertificateHash, currentHash);
      assert.equal(record.certificateHash, nextHash);
      assert.equal(await contract.ownerOf(tokenId), destination.address);
      currentHash = nextHash;
      currentOwner = destination;
    }

    for (let version = 1; version <= currentVersion; version += 1) {
      const record = await contract.certificateAt(tokenId, version);
      assert.equal(record.version, BigInt(version));
    }
  });
});

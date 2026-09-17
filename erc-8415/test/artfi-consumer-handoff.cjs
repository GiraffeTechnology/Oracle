const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const hre = require("hardhat");
const { ethers } = hre;
const { PROJECTION_INTERFACE_ID, READ_ONLY_ABI, readProjection } = require(
  "../read-projection.cjs"
);

const hardhatRequire = createRequire(require.resolve("hardhat/package.json"));
const solc = hardhatRequire("solc");
const sourcePath = path.resolve(__dirname, "../contracts/OracleRegisterProjection.sol");
const fixturePath = path.resolve(__dirname, "../artfi-consumer.v1.json");
const hashLabel = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));

function compileProjection() {
  const input = {
    language: "Solidity",
    sources: {
      "OracleRegisterProjection.sol": { content: fs.readFileSync(sourcePath, "utf8") }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "OracleRegisterProjection": ["abi", "evm.bytecode.object"] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts["OracleRegisterProjection.sol"].OracleRegisterProjection;
}

describe("ArtFi read-only projection handoff", function () {
  it("reads identity, history, point-in-time holder, and finality through the public interface", async () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.equal(fixture.implementationCommit, "660c3216cdb90b30a1e557d1ab134c6dabd1743b");
    assert.equal(fixture.interfaceId, PROJECTION_INTERFACE_ID);
    assert.equal(fixture.fixture.profile, "TEST_ONLY_NO_REAL_VALUE");
    assert.equal(
      READ_ONLY_ABI.some((entry) => /mintFromSource|appendFromSource|settlement/i.test(entry)),
      false,
      "consumer ABI must remain read-only and settlement-free"
    );

    const [, sourceAuthority, owner, nextHolder] = await ethers.getSigners();
    const artifact = compileProjection();
    const registerId = hashLabel(fixture.fixture.registerIdLabel);
    const projection = await new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      sourceAuthority
    ).deploy(registerId, sourceAuthority.address);
    await projection.waitForDeployment();

    const [first, second] = fixture.fixture.entries;
    await projection.mintFromSource(
      owner.address,
      fixture.fixture.tokenId,
      hashLabel(first.recordCommitmentLabel),
      hashLabel(first.registryReferenceLabel),
      owner.address,
      first.effectiveAt
    );
    await projection.appendFromSource(
      fixture.fixture.tokenId,
      hashLabel(second.recordCommitmentLabel),
      hashLabel(second.registryReferenceLabel),
      nextHolder.address,
      second.effectiveAt
    );

    const snapshot = await readProjection({
      runner: ethers.provider,
      address: await projection.getAddress(),
      tokenId: BigInt(fixture.fixture.tokenId),
      instant: BigInt(fixture.fixture.queryInstant)
    });

    assert.equal(snapshot.registerId, registerId);
    assert.equal(snapshot.entryCount, "2");
    assert.equal(snapshot.asOf.version, fixture.fixture.expectedVersionAsOf);
    assert.equal(snapshot.current.version, fixture.fixture.expectedCurrentVersion);
    assert.equal(snapshot.holderAsOf, owner.address);
    assert.equal(snapshot.current.holder, nextHolder.address);
    assert.equal(snapshot.finalAsOf, fixture.fixture.expectedFinalAsOf);

    const beforeInitialization = await readProjection({
      runner: ethers.provider,
      address: await projection.getAddress(),
      tokenId: BigInt(fixture.fixture.tokenId),
      instant: 500n
    });
    // The instant precedes the first entry, so the projection does not cover
    // it: there is no entry and no holder to read. It is therefore not final
    // either, and isFinalAsOf answers false rather than reverting.
    assert.equal(beforeInitialization.asOf, null);
    assert.equal(beforeInitialization.holderAsOf, null);
    assert.equal(beforeInitialization.finalAsOf, false);
    assert.equal(beforeInitialization.entryCount, "2");
  });
});

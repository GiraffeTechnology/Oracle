const assert = require("node:assert/strict");
const { Contract, ZeroHash } = require("ethers");

const PROJECTION_INTERFACE_ID = "0x6309e170";

const READ_ONLY_ABI = [
  "function registerId() view returns (bytes32)",
  "function entryCount(uint256 tokenId) view returns (uint64)",
  "function currentEntry(uint256 tokenId) view returns ((bytes32 recordCommitment, bytes32 previousCommitment, bytes32 registryReference, address holder, uint64 version, uint64 effectiveAt, uint64 supersededAt) entry)",
  "function entryAt(uint256 tokenId, uint64 version) view returns ((bytes32 recordCommitment, bytes32 previousCommitment, bytes32 registryReference, address holder, uint64 version, uint64 effectiveAt, uint64 supersededAt) entry)",
  "function entryAsOf(uint256 tokenId, uint64 instant) view returns ((bytes32 recordCommitment, bytes32 previousCommitment, bytes32 registryReference, address holder, uint64 version, uint64 effectiveAt, uint64 supersededAt) entry)",
  "function holderAsOf(uint256 tokenId, uint64 instant) view returns (address holder)",
  "function isFinalAsOf(uint256 tokenId, uint64 instant) view returns (bool settled)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)"
];

function normalizeEntry(entry) {
  return Object.freeze({
    recordCommitment: entry.recordCommitment,
    previousCommitment: entry.previousCommitment,
    registryReference: entry.registryReference,
    holder: entry.holder,
    version: entry.version.toString(),
    effectiveAt: entry.effectiveAt.toString(),
    supersededAt: entry.supersededAt.toString()
  });
}

function assertOrderedHistory(history) {
  const commitments = new Set();
  history.forEach((entry, index) => {
    assert.notEqual(entry.recordCommitment, ZeroHash, "record commitment must be non-zero");
    assert.equal(commitments.has(entry.recordCommitment), false, "record commitment must be unique");
    commitments.add(entry.recordCommitment);
    assert.equal(entry.version, String(index + 1), "versions must be contiguous from one");
    assert.equal(
      entry.previousCommitment,
      index === 0 ? ZeroHash : history[index - 1].recordCommitment,
      "previous commitment must link to the prior entry"
    );
    if (index > 0) {
      assert.ok(
        BigInt(entry.effectiveAt) > BigInt(history[index - 1].effectiveAt),
        "effectiveAt must increase strictly"
      );
      assert.equal(
        history[index - 1].supersededAt,
        entry.effectiveAt,
        "the next effectiveAt must close the previous interval"
      );
    }
  });
  assert.equal(history.at(-1).supersededAt, "0", "the current interval must remain open");
}

async function readProjection({ runner, address, tokenId, instant }) {
  const projection = new Contract(address, READ_ONLY_ABI, runner);
  assert.equal(
    await projection.supportsInterface(PROJECTION_INTERFACE_ID),
    true,
    "target does not expose IRegisterProjection"
  );

  const registerId = await projection.registerId();
  assert.notEqual(registerId, ZeroHash, "register identity must be non-zero");
  const count = await projection.entryCount(tokenId);
  assert.ok(count > 0n, "token must have projection history");

  const history = [];
  for (let version = 1n; version <= count; version += 1n) {
    history.push(normalizeEntry(await projection.entryAt(tokenId, version)));
  }
  assertOrderedHistory(history);

  const current = normalizeEntry(await projection.currentEntry(tokenId));
  const asOf = normalizeEntry(await projection.entryAsOf(tokenId, instant));
  const holderAsOf = await projection.holderAsOf(tokenId, instant);
  const finalAsOf = await projection.isFinalAsOf(tokenId, instant);
  assert.equal(current.recordCommitment, history.at(-1).recordCommitment);
  assert.equal(asOf.holder, holderAsOf);

  return Object.freeze({
    interfaceId: PROJECTION_INTERFACE_ID,
    registerId,
    tokenId: tokenId.toString(),
    instant: instant.toString(),
    entryCount: count.toString(),
    current,
    asOf,
    holderAsOf,
    finalAsOf,
    history: Object.freeze(history)
  });
}

module.exports = {
  PROJECTION_INTERFACE_ID,
  READ_ONLY_ABI,
  normalizeEntry,
  assertOrderedHistory,
  readProjection
};

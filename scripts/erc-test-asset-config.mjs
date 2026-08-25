import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const REQUIRED_BOUNDARIES = [
  "TEST ONLY",
  "NO VALUE",
  "NO LEGAL EFFECT",
  "NO RIGHTS TRANSFER",
];

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(`UNIT-A39 test asset refused: ${message}`);
}

export function loadAuthorizedHoodiTestAsset(repositoryRoot, environment = process.env) {
  const assetDirectory = path.join(
    repositoryRoot,
    "erc-reference",
    "test-assets",
    "hoodi",
    "UNIT-A39",
  );
  const manifestPath = path.join(assetDirectory, "UNIT-A39-test-only-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  assert(manifest.schemaVersion === "1.0", "unsupported manifest version");
  assert(manifest.assetId === "UNIT-A39" && manifest.assetVersion === "000", "asset identity mismatch");
  assert(manifest.fileName === "UNIT-A39-000.PNG", "asset filename mismatch");
  assert(manifest.owner === "ArtCCH" && manifest.custodian === "ArtCCH", "owner or custodian mismatch");
  assert(manifest.authorizedNetwork?.name === "Hoodi testnet", "network name mismatch");
  assert(manifest.authorizedNetwork?.chainId === 560048, "Hoodi chainId mismatch");
  assert(manifest.bytes32FieldName === "assetFileSha256Bytes32", "bytes32 field mismatch");
  assert(/^0x[0-9a-fA-F]{64}$/.test(manifest.assetFileSha256Bytes32), "invalid bytes32 hash");
  assert(manifest.testAuthorization?.publicHashAnchoring === true, "public hash anchoring is not authorized");
  assert(manifest.testAuthorization?.testOnlyNftMint === true, "test-only NFT mint is not authorized");
  assert(manifest.testAuthorization?.chainExecutionByProducingTask === false, "producing task execution boundary mismatch");
  assert(
    REQUIRED_BOUNDARIES.every((boundary) => manifest.rightsBoundary?.includes(boundary)),
    "required rights boundary is missing",
  );

  const assetPath = path.join(assetDirectory, manifest.fileName);
  const assetBytes = readFileSync(assetPath);
  const assetStat = statSync(assetPath);
  assert(assetStat.size === manifest.fileBytes, "asset byte length mismatch");
  const actualHash = sha256Hex(assetBytes);
  assert(actualHash === manifest.assetFileSha256Bytes32.slice(2).toLowerCase(), "asset SHA-256 mismatch");

  const configuredHash = environment.ERC_TEST_ASSET_EVIDENCE_HASH;
  if (configuredHash) {
    assert(configuredHash.toLowerCase() === manifest.assetFileSha256Bytes32.toLowerCase(), "environment hash mismatch");
  }

  return Object.freeze({
    assetId: manifest.assetId,
    evidenceHash: manifest.assetFileSha256Bytes32,
    owner: manifest.owner,
    custodian: manifest.custodian,
    chainId: manifest.authorizedNetwork.chainId,
    testOnly: true,
  });
}

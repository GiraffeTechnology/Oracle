import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { assembleProductionConfiguration } from "../src/config/production-assembly.js";
import { loadL2DeploymentProfile, publicL2Profile, validateL2DeploymentProfile } from "../src/config/deployment-profile.js";
import { loadProtocolProfile, mapProtocolSettlementStatus, publicProtocolProfile, requireProtocolInterfaces, verifyProtocolArtifactBytes, verifyProtocolObservation } from "../src/protocol/protocol-profile.js";

const L2_FILE = path.resolve("config/l2.production.json");
const L3_FILE = path.resolve("config/l3.protocol.wd-0.1.1.json");

test("L2 production profile is complete and exposes no deployment references", async () => {
  const profile = await loadL2DeploymentProfile(L2_FILE);
  const publicProfile = publicL2Profile(profile);
  assert.equal(publicProfile.profileId, "giraffe-oracle-l2/production-v1");
  assert.deepEqual(publicProfile.sourceKinds, ["CERTIFICATE_AUTHORITY", "REGISTRY", "WAREHOUSE"]);
  assert.doesNotMatch(JSON.stringify(publicProfile), /deployment:\/\//);
});

test("L2 profile rejects non-loopback bind and caller-added fields", async () => {
  const profile = await loadL2DeploymentProfile(L2_FILE);
  assert.throws(() => validateL2DeploymentProfile({ ...profile, service: { ...profile.service, bindHost: "all" } }), /L2_NON_LOOPBACK_BIND_REJECTED/);
  assert.throws(() => validateL2DeploymentProfile({ ...profile, credential: "forbidden" }), /L2_PROFILE_UNKNOWN_FIELD/);
});

test("L3 working draft pins artifacts, interfaces and non-production claim", async () => {
  const profile = await loadProtocolProfile(L3_FILE);
  const publicProfile = publicProtocolProfile(profile);
  assert.equal(publicProfile.profileId, "giraffe-rwa-certificate-settlement/wd-0.1.1");
  assert.equal(publicProfile.productionClaimAllowed, false);
  assert.deepEqual(publicProfile.requiredAdvertisedInterfaces, ["0xebaa86a0", "0x2773d4c9", "0x4a967b01"]);
  assert.equal(Object.keys(publicProfile.artifacts).length, 5);
});

test("L3 compatibility requires both candidate interfaces plus ERC-8325", async () => {
  const profile = await loadProtocolProfile(L3_FILE);
  assert.throws(() => requireProtocolInterfaces(profile, [profile.interfaces.versionedCertificate]), /PROTOCOL_INTERFACE_MISSING/);
  assert.equal(requireProtocolInterfaces(profile, profile.requiredAdvertisedInterfaces), true);
});

test("L3 artifact intake verifies exact bytes and fails closed on changes", async () => {
  const profile = await loadProtocolProfile(L3_FILE);
  const artifacts = Object.fromEntries(Object.keys(profile.artifacts).map((key) => [key, Buffer.from(`frozen-${key}`)]));
  const fixtureProfile = {
    ...profile,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, bytes]) => [key, createHash("sha256").update(bytes).digest("hex")])),
  };
  assert.equal(verifyProtocolArtifactBytes(fixtureProfile, artifacts), true);
  assert.throws(() => verifyProtocolArtifactBytes(fixtureProfile, { ...artifacts, formalEnSha256: Buffer.from("changed") }), /PROTOCOL_ARTIFACT_HASH_MISMATCH/);
});

test("L3 pending observation preserves owner and blocks transfers", async () => {
  const profile = await loadProtocolProfile(L3_FILE);
  const input = {
    advertisedInterfaces: profile.requiredAdvertisedInterfaces,
    settlementStatus: 1,
    owner: "holder-a",
    from: "holder-a",
    transfersBlocked: true,
  };
  assert.deepEqual(verifyProtocolObservation(profile, input), {
    compatible: true,
    profileId: profile.profileId,
    oracleStatus: "TRANSFER_PENDING",
  });
  assert.throws(() => verifyProtocolObservation(profile, { ...input, transfersBlocked: false }), /PROTOCOL_PENDING_TRANSFER_GATE_MISSING/);
});

test("L3 finalize observation verifies atomic version and event set without relying on event order", async () => {
  const profile = await loadProtocolProfile(L3_FILE);
  const result = verifyProtocolObservation(profile, {
    advertisedInterfaces: [...profile.requiredAdvertisedInterfaces].reverse(),
    settlementStatus: 2,
    atomic: true,
    previousCertificateVersion: 8,
    certificateVersion: 9,
    events: ["SettlementFinalized", "Transfer", "CertificateSuperseded"],
  });
  assert.equal(result.oracleStatus, "VALID");
  assert.throws(() => verifyProtocolObservation(profile, {
    advertisedInterfaces: profile.requiredAdvertisedInterfaces,
    settlementStatus: 2,
    atomic: false,
    previousCertificateVersion: 8,
    certificateVersion: 9,
    events: ["CertificateSuperseded", "Transfer", "SettlementFinalized"],
  }), /PROTOCOL_FINALIZE_NOT_ATOMIC/);
  assert.equal(mapProtocolSettlementStatus(profile, 3), "VALID");
});

test("production assembly resolves every protected dependency and fails closed", async () => {
  const l2Profile = await loadL2DeploymentProfile(L2_FILE);
  const l3Profile = await loadProtocolProfile(L3_FILE);
  const calls = [];
  const assembled = await assembleProductionConfiguration({
    l2Profile,
    l3Profile,
    resolver: {
      async resolve(reference, kind) {
        calls.push({ reference, kind });
        return Object.freeze({ kind });
      },
    },
  });
  assert.equal(assembled.l3.profileId, l3Profile.profileId);
  assert.equal(calls.length, 10);
  await assert.rejects(() => assembleProductionConfiguration({ l2Profile, l3Profile, resolver: { async resolve() { return null; } } }), /PRODUCTION_PORT_MISSING|DEPLOYMENT_REFERENCE_UNRESOLVED/);
});


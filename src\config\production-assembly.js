import { assertProductionPorts } from "../ports/production-ports.js";
import { validateL2DeploymentProfile } from "./deployment-profile.js";
import { validateProtocolProfile } from "../protocol/protocol-profile.js";

export async function assembleProductionConfiguration({ l2Profile, l3Profile, resolver }) {
  const l2 = validateL2DeploymentProfile(l2Profile);
  const l3 = validateProtocolProfile(l3Profile);
  if (!resolver || typeof resolver.resolve !== "function") throw new Error("DEPLOYMENT_RESOLVER_MISSING");

  const resolved = Object.freeze({
    repository: await resolver.resolve(l2.database.connectionRef, "repository"),
    signer: await resolver.resolve(l2.signer.signerSetRef, "signer"),
    registrySource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "REGISTRY").transportRef, "source"),
    certificateSource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "CERTIFICATE_AUTHORITY").transportRef, "source"),
    warehouseSource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "WAREHOUSE").transportRef, "source"),
    eventPublisher: await resolver.resolve(l2.events.publisherRef, "event-publisher"),
    adminAuthenticator: await resolver.resolve(l2.security.adminAuthenticationRef, "admin-authenticator"),
    monitoring: await resolver.resolve(l2.operations.healthRef, "monitoring"),
    backup: await resolver.resolve(l2.operations.backupRef, "backup"),
    disasterRecovery: await resolver.resolve(l2.operations.disasterRecoveryRef, "disaster-recovery"),
  });
  assertProductionPorts(resolved);
  for (const [name, value] of Object.entries(resolved)) {
    if (!value) throw new Error(`DEPLOYMENT_REFERENCE_UNRESOLVED:${name}`);
  }
  return Object.freeze({ l2, l3, ports: resolved });
}

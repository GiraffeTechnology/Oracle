import { createSyntheticRuntime } from "../oracle-runtime.js";
import { AdminOperations } from "../services/admin-operations.js";
import { Authorizer } from "../services/authorizer.js";
import { CommandJournal } from "../services/command-journal.js";
import { DualControlQueue } from "../services/dual-control.js";
import { OracleControlPlane } from "../services/oracle-control-plane.js";

const TEST_ACTORS = Object.freeze({
  "oracle-test": ["ORACLE_OPERATOR"],
  "security-test": ["SECURITY_OFFICER"],
  "approver-test": ["APPROVER"],
  "auditor-test": ["AUDITOR"],
});

export function assembleIsolatedTestApplication({ config, env = process.env, signerRotationBroker = null, clock = () => new Date() }) {
  if (config?.environment !== "test") throw new Error("TEST_ASSEMBLY_ENVIRONMENT_REJECTED");
  const runtime = createSyntheticRuntime({ clock });
  const authorizer = new Authorizer();
  for (const [actorId, roles] of Object.entries(TEST_ACTORS)) authorizer.registerActor(actorId, roles);
  const dualControl = new DualControlQueue();
  const controlPlane = new OracleControlPlane({
    runtime,
    authorizer,
    dualControl,
    commandJournal: new CommandJournal(),
    outbox: runtime.outbox,
    signerRotationBroker,
    clock,
  });
  const adminOperations = new AdminOperations({ runtime, sourceRegistry: runtime.sourceRegistry, authorizer, reviewQueue: runtime.reviewQueue, dualControl, clock });
  const adminEnabled = env.GIRAFFE_ORACLE_TEST_ADMIN_ACK === "isolated-test-only";
  const authenticateAdmin = async (request) => {
    if (!adminEnabled) return null;
    const actorId = request.headers["x-oracle-test-actor"];
    return Object.hasOwn(TEST_ACTORS, actorId) ? actorId : null;
  };
  return Object.freeze({ runtime, sourceRegistry: runtime.sourceRegistry, controlPlane, adminOperations, authenticateAdmin });
}

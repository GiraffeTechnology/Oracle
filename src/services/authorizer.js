const ROLE_PERMISSIONS = Object.freeze({
  SOURCE_OPERATOR: new Set(["evidence:ingest"]),
  ORACLE_OPERATOR: new Set(["asset:verify", "token:bind", "attestation:issue", "settlement:manage"]),
  APPROVER: new Set(["action:approve"]),
  SECURITY_OFFICER: new Set(["source:disable", "attestation:revoke", "asset:freeze", "signer:rotate"]),
  AUDITOR: new Set(["audit:read", "audit:export"]),
  READER: new Set(["asset:read", "attestation:verify"]),
});

export class Authorizer {
  #actors = new Map();

  registerActor(actorId, roles) {
    if (typeof actorId !== "string" || actorId.length < 1 || actorId.length > 64 || !Array.isArray(roles) || roles.some((role) => !ROLE_PERMISSIONS[role])) {
      throw new Error("ACTOR_REGISTRATION_INVALID");
    }
    this.#actors.set(actorId, Object.freeze([...new Set(roles)]));
  }

  require(actorId, permission) {
    if (typeof actorId !== "string" || actorId.length < 1 || actorId.length > 64) throw new Error("ACTOR_ID_INVALID");
    const roles = this.#actors.get(actorId);
    if (!roles) throw new Error("ACTOR_NOT_REGISTERED");
    if (!roles.some((role) => ROLE_PERMISSIONS[role].has(permission))) {
      throw new Error(`PERMISSION_DENIED:${permission}`);
    }
    return Object.freeze({ actorId, roles: [...roles], permission });
  }
}

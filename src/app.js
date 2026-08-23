import http from "node:http";
import { ORACLE_STATUSES } from "./domain/oracle-status.js";
import { ADMIN_HTML } from "./admin-ui.js";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON_INVALID");
  }
}

export function createApp({ config, sourceRegistry, runtime = null }) {
  if (!config || !sourceRegistry) throw new Error("APP_DEPENDENCY_MISSING");

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (request.method === "POST" && requestUrl.pathname === "/v1/rwa/attestations/verify") {
      if (!runtime) {
        sendJson(response, 503, { valid: false, errorCode: "VERIFIER_NOT_CONFIGURED" });
        return;
      }
      try {
        const body = await readJson(request);
        const result = runtime.attestations.verify(body.attestation, {
          expectedSubject: body.expectedSubject,
          now: body.now ? new Date(body.now) : undefined,
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, {
          valid: false,
          errorCode: error.message,
        });
      }
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, errorCode: "METHOD_NOT_ALLOWED" });
      return;
    }

    if (requestUrl.pathname === "/admin") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
      });
      response.end(ADMIN_HTML);
      return;
    }
    if (requestUrl.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        service: "giraffe-rwa-oracle",
        version: "0.2.0",
      });
      return;
    }

    if (requestUrl.pathname === "/readyz") {
      sendJson(response, 200, {
        ok: true,
        environment: config.environment,
        externalWritesEnabled: config.externalWritesEnabled,
        registeredSources: sourceRegistry.listPublic().length,
      });
      return;
    }

    if (requestUrl.pathname === "/v1/oracle/statuses") {
      sendJson(response, 200, { statuses: ORACLE_STATUSES });
      return;
    }

    const assetMatch = requestUrl.pathname.match(/^\/v1\/rwa\/assets\/([a-zA-Z0-9_-]{3,128})$/);
    if (assetMatch && runtime) {
      const assetId = assetMatch[1];
      const asset = runtime.recordStore.getAsset(assetId);
      if (!asset) {
        sendJson(response, 404, { ok: false, errorCode: "ASSET_NOT_FOUND" });
        return;
      }
      sendJson(response, 200, {
        asset,
        status: runtime.stateEngine.current(assetId),
        currentCertificate: runtime.recordStore.currentCertificate(assetId),
        warehouse: runtime.recordStore.getWarehouse(assetId),
      });
      return;
    }

    const certificateMatch = requestUrl.pathname.match(/^\/v1\/rwa\/assets\/([a-zA-Z0-9_-]{3,128})\/certificate-history$/);
    if (certificateMatch && runtime) {
      sendJson(response, 200, { history: runtime.recordStore.certificateHistory(certificateMatch[1]) });
      return;
    }

    const tokenMatch = requestUrl.pathname.match(/^\/v1\/rwa\/tokens\/([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9:_-]{3,128})\/([a-zA-Z0-9_-]{1,128})(?:\/(certificate-history|eligibility))?$/);
    if (tokenMatch && runtime) {
      const [, chainId, contract, tokenId, view] = tokenMatch;
      const binding = runtime.tokenIndex.byToken(chainId, contract, tokenId);
      if (!binding) {
        sendJson(response, 404, { ok: false, errorCode: "TOKEN_NOT_FOUND" });
        return;
      }
      if (view === "certificate-history") {
        sendJson(response, 200, { binding, history: runtime.recordStore.certificateHistory(binding.assetId) });
        return;
      }
      if (view === "eligibility") {
        const status = runtime.stateEngine.current(binding.assetId);
        sendJson(response, 200, { binding, status, transferable: status === "VALID" });
        return;
      }
      sendJson(response, 200, { binding, status: runtime.stateEngine.current(binding.assetId), currentCertificate: runtime.recordStore.currentCertificate(binding.assetId) });
      return;
    }

    const attestationMatch = requestUrl.pathname.match(/^\/v1\/rwa\/attestations\/([a-f0-9-]{36})$/);
    if (attestationMatch && runtime) {
      const attestation = runtime.attestations.get(attestationMatch[1]);
      if (!attestation) {
        sendJson(response, 404, { ok: false, errorCode: "ATTESTATION_NOT_FOUND" });
        return;
      }
      sendJson(response, 200, { attestation, revoked: runtime.revocations.isRevoked(attestationMatch[1]) });
      return;
    }

    const settlementMatch = requestUrl.pathname.match(/^\/v1\/rwa\/settlements\/([a-zA-Z0-9_-]{3,128})$/);
    if (settlementMatch && runtime) {
      const settlement = runtime.settlements.get(settlementMatch[1]);
      if (!settlement) {
        sendJson(response, 404, { ok: false, errorCode: "SETTLEMENT_NOT_FOUND" });
        return;
      }
      sendJson(response, 200, { settlement });
      return;
    }

    sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND" });
  });
}

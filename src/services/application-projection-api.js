import { ProjectionSourceError, assertUint64 } from "../ports/projection-source.js";

/**
 * Oracle's application-facing projection API.
 *
 * This is the boundary at which the projection becomes available to a
 * consuming application. A consumer integrates here and never past it: the
 * ERC-8415 adapter and the projection infrastructure Oracle consumes are not
 * part of any application's integration surface. Per D-006 this module names
 * no particular consumer -- Oracle is an institutional integration layer, not
 * a vertical application.
 *
 * It is shaped to bind to the ERC-8415 reference wallet's reader port one
 * route per accessor, so a client can be pointed at Oracle without a
 * translation layer.
 *
 * Three rules this surface holds to, all from the standard:
 *
 * - the three questions stay three routes. Who was recorded, whether that can
 *   still change, and what the tradeable position is are never merged into one
 *   status. A caller handed a single value cannot tell which it was answered;
 * - an instant preceding the first entry is not covered. `entry/as-of` and
 *   `holder/as-of` refuse it; `finality/as-of` answers false without refusing;
 * - the ERC-721 owner is never substituted for a confirmed holder, including
 *   when a projection read fails. A failed read surfaces as a failure.
 *
 * Read-only. No settlement, payment, custody, release or refund path exists
 * here, and the surface consumed underneath exposes none to reach.
 */
export const APPLICATION_PROJECTION_PREFIX = "/v1/oracle/projection";

const ROUTE = new RegExp(
  `^${APPLICATION_PROJECTION_PREFIX}/([0-9]{1,20})(?:/(entry/current|entry/version/[0-9]{1,20}|entry/as-of/[0-9]{1,20}|holder/as-of/[0-9]{1,20}|finality/as-of/[0-9]{1,20}|position))?$`
);

/**
 * @param {object} deps
 * @param {import("../ports/projection-source.js").ProjectionSource} deps.projectionSource
 * @param {{ ownerOf?: (tokenId: string) => Promise<string> }} [deps.positionSource]
 *   The ERC-721 tradeable position. Absent means the API reports it as not
 *   read, never as equal to the confirmed holder.
 */
export function createApplicationProjectionApi({ projectionSource, positionSource }) {
  async function handle(method, pathname) {
    const match = ROUTE.exec(pathname);
    if (!match) return null;
    if (method !== "GET") {
      // Every write method is unroutable here, whatever the path.
      return { status: 405, body: { ok: false, errorCode: "PROJECTION_READ_ONLY" } };
    }

    const tokenId = assertUint64(match[1], "TOKEN_ID_INVALID");
    const tail = match[2];

    try {
      if (tail === undefined) {
        return {
          status: 200,
          body: {
            tokenId,
            registerId: await projectionSource.registerId(),
            entryCount: await projectionSource.entryCount(tokenId),
          },
        };
      }

      if (tail === "entry/current") {
        return { status: 200, body: { tokenId, entry: await projectionSource.currentEntry(tokenId) } };
      }

      if (tail.startsWith("entry/version/")) {
        const version = tail.slice("entry/version/".length);
        return { status: 200, body: { tokenId, entry: await projectionSource.entryAt(tokenId, version) } };
      }

      if (tail.startsWith("entry/as-of/")) {
        const instant = tail.slice("entry/as-of/".length);
        return { status: 200, body: { tokenId, instant, entry: await projectionSource.entryAsOf(tokenId, instant) } };
      }

      if (tail.startsWith("holder/as-of/")) {
        const instant = tail.slice("holder/as-of/".length);
        // The confirmed holder, and only that. Whether it can still change is
        // a separate question with a separate route.
        return { status: 200, body: { tokenId, instant, holder: await projectionSource.holderAsOf(tokenId, instant) } };
      }

      if (tail.startsWith("finality/as-of/")) {
        const instant = tail.slice("finality/as-of/".length);
        return { status: 200, body: { tokenId, instant, final: await projectionSource.isFinalAsOf(tokenId, instant) } };
      }

      if (tail === "position") {
        // The tradeable position, stated as a separate fact and labelled as
        // such. It is not the confirmed holder and is never used as one.
        const owner = positionSource?.ownerOf ? await positionSource.ownerOf(tokenId) : null;
        return {
          status: 200,
          body: {
            tokenId,
            tradeablePosition: owner,
            source: "erc-721",
            note: owner === null ? "not read" : "the tradeable position is not the confirmed holder",
          },
        };
      }

      return { status: 404, body: { ok: false, errorCode: "PROJECTION_ROUTE_NOT_FOUND" } };
    } catch (error) {
      if (error instanceof ProjectionSourceError) {
        return { status: error.status, body: { ok: false, errorCode: error.errorCode } };
      }
      throw error;
    }
  }

  return { handle, prefix: APPLICATION_PROJECTION_PREFIX };
}

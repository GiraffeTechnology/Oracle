import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const iterations = JSON.parse(readFileSync("config/iteration-acceptance.json", "utf8"));
const requirements = JSON.parse(readFileSync("config/prd-v0.4-acceptance.json", "utf8"));

test("all 13 iterations trace to every authoritative PRD requirement", () => {
  assert.equal(iterations.prdVersion, requirements.prdVersion);
  assert.equal(iterations.iterations.length, 13);
  assert.deepEqual(iterations.iterations.map(({ id }) => id), Array.from({ length: 13 }, (_, index) => `I${index}`));

  const authoritative = new Set(requirements.requirements.map(({ id }) => id));
  const mapped = new Set(iterations.iterations.flatMap(({ requirementIds }) => requirementIds));
  assert.deepEqual([...mapped].filter((id) => !authoritative.has(id)), []);
  assert.deepEqual([...authoritative].filter((id) => !mapped.has(id)), []);
});

test("iteration verifier pins the spec reporter before matching exact test names", () => {
  const source = readFileSync("scripts/verify-iterations.mjs", "utf8");
  assert.match(source, /\["--test", "--test-reporter=spec", "test\/\*\.test\.js"\]/);
  assert.match(source, /ITERATION_REQUIREMENT_UNMAPPED/);
});

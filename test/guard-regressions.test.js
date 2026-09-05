import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { matchFinancialOutputLine } from "../scripts/lib/financial-output-guard.mjs";
import { assertNamedInterfaceIds } from "../src/erc-constants.ts";

const EXPECTED_INTERFACE_IDS = [
  ["IVersionedRWACertificate", "0xebaa86a0"],
  ["IDeferredCertificateSettlement", "0x2773d4c9"],
  ["IAssetBoundTokenId", "0x4a967b01"],
];

test("financial scanner excludes only the exact enforcement path on the native platform", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "oracle-financial-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["scripts/lib", "src/services", "src/other"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of ["scripts/check-no-financial-output.mjs", "scripts/lib/financial-output-guard.mjs"]) {
    copyFileSync(path.resolve(file), path.join(root, file));
  }
  writeFileSync(path.join(root, "README.md"), "Oracle test fixture\n");
  writeFileSync(path.join(root, "src/services/product-boundary.js"), "const forbidden = /price/;\n");
  const run = () => spawnSync(process.execPath, [path.join(root, "scripts/check-no-financial-output.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
  const clean = run();
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /ORACLE-006 gate passed/);

  writeFileSync(path.join(root, "src/other/product-boundary.js"), "const response = { price: 100 };\n");
  const violation = run();
  assert.equal(violation.status, 1, violation.stderr);
  assert.match(violation.stderr, /src[\\/]other[\\/]product-boundary\.js:1: price output/);
});

test("ORACLE-006 static guard rejects a plain price field", () => {
  assert.deepEqual(matchFinancialOutputLine("const response = { price: 100 };", { codeSurface: true }), [
    { surface: "code", label: "price output" },
  ]);
});

test("ORACLE-006 static guard permits read-only marketplace provenance metadata", () => {
  for (const line of [
    'const listingStatus = observation.listingStatus;',
    'const saleHistory = observation.saleHistory;',
    'const source = observation.source;',
    'const provider = observation.provider;',
  ]) {
    assert.deepEqual(matchFinancialOutputLine(line, { codeSurface: true }), []);
  }
  assert.deepEqual(
    matchFinancialOutputLine("Documentation may discuss a marketplace price without exposing a field.", {
      codeSurface: false,
    }),
    [],
  );
});

test("frozen ERC guard binds each interface name to its exact ID", () => {
  const candidate = readFileSync(
    path.resolve("docs/erc/ERC_SUBMISSION_CANDIDATE_EN.md"),
    "utf8",
  );
  assert.deepEqual(
    [...assertNamedInterfaceIds(candidate, EXPECTED_INTERFACE_IDS)],
    EXPECTED_INTERFACE_IDS,
  );

  const swapped = candidate
    .replace(
      "`IVersionedRWACertificate` interface ID is `0xebaa86a0`",
      "`IVersionedRWACertificate` interface ID is `0x2773d4c9`",
    )
    .replace(
      "`IDeferredCertificateSettlement` interface ID is `0x2773d4c9`",
      "`IDeferredCertificateSettlement` interface ID is `0xebaa86a0`",
    );
  assert.throws(
    () => assertNamedInterfaceIds(swapped, EXPECTED_INTERFACE_IDS),
    /named interface ID mismatch/,
  );
});

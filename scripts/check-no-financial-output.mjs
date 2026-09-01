#!/usr/bin/env node
/**
 * ORACLE-006 / acceptance matrix row ORACLE-006: the oracle must not produce valuation, price,
 * collateral, yield, credit or investment-suitability output, and must not make prohibited
 * public claims (section 12 of the PRD).
 *
 * This gate scans the service surface for those terms so a financial field cannot reach an API
 * response, schema or public claim without a deliberate, reviewed change to this list.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { matchFinancialOutputLine } from './lib/financial-output-guard.mjs';

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * Scanned surfaces. This script itself is excluded: it necessarily names the banned terms.
 * `code` patterns match field and identifier names and apply to the service surface only, so
 * prose that merely explains the ban does not trip the gate; `all` patterns are prohibited
 * public claims and apply everywhere, documentation included.
 */
const CODE_TARGETS = ['src'];

/**
 * Files that enforce this same boundary and therefore must name the banned keys to reject
 * them. Excluding an enforcement point is not a weakening: it is excluded precisely because
 * it is what does the rejecting, exactly as this script excludes itself.
 */
const ENFORCEMENT_FILES = ['src/services/product-boundary.js'];
const PROSE_TARGETS = ['README.md'];
const SCAN_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.json', '.md'];

async function collectFiles(target) {
  const absolute = join(repoRoot, target);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return SCAN_EXTENSIONS.some((extension) => target.endsWith(extension)) ? [absolute] : [];
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'node_modules')
      .map((entry) => collectFiles(join(target, entry.name))),
  );
  return nested.flat();
}

const codeFiles = (await Promise.all(CODE_TARGETS.map(collectFiles))).flat();
const proseFiles = (await Promise.all(PROSE_TARGETS.map(collectFiles))).flat();
const files = [...codeFiles, ...proseFiles];
const codeFileSet = new Set(codeFiles);
const violations = [];

for (const file of files) {
  const contents = await readFile(file, 'utf8');
  if (ENFORCEMENT_FILES.some((allowed) => relative(repoRoot, file) === allowed)) {
    continue;
  }
  contents.split('\n').forEach((line, index) => {
    for (const { label } of matchFinancialOutputLine(line, {
      codeSurface: codeFileSet.has(file),
    })) {
      violations.push(`${relative(repoRoot, file)}:${index + 1}: ${label}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  process.stderr.write('ORACLE-006 violation: financial output is not allowed in this service.\n');
  for (const violation of violations) {
    process.stderr.write(`  ${violation}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `ORACLE-006 gate passed: scanned ${files.length} files, no financial output.\n`,
);

#!/usr/bin/env node
/**
 * Two gates the acceptance standard requires of CI (section 6):
 *
 *  - secrets: private keys, production credentials and raw source documents must not be in
 *    the repository (NFR-001, PRD section 11);
 *  - personal data: names, government identifiers, contact details and wallet-to-identity
 *    mappings must not reach the public surface (ORACLE-007, PRIVACY).
 *
 * Patterns are deliberately specific. The ERC archive legitimately contains 64-hex digests
 * and bytes32 literals, so a bare long-hex rule would be noise rather than a gate.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const SCAN_EXTENSIONS = [
  '.ts',
  '.mts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.sol',
];

/** This file necessarily contains the patterns it searches for. */
const SELF = resolve(import.meta.dirname, 'check-repository-hygiene.mjs');

const SECRET_PATTERNS = [
  { label: 'PEM private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    label: 'assigned private key',
    pattern:
      /\b(?:private_?key|PRIVATE_?KEY|mnemonic|MNEMONIC|seed_?phrase)\s*[:=]\s*['"][^'"\s]{16,}/,
  },
  { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    label: 'generic bearer secret',
    pattern: /\b(?:sk_live|rk_live|ghp_|gho_|github_pat_)[A-Za-z0-9_]{16,}/,
  },
  {
    label: 'assigned password or token',
    pattern: /\b(?:password|passwd|secret|api_?key|access_?token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
];

const PERSONAL_DATA_PATTERNS = [
  { label: 'email address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  {
    label: 'PRC resident identity number',
    pattern: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/,
  },
  { label: 'CN mobile number', pattern: /(?<![\d.])1[3-9]\d{9}(?![\d.])/ },
  {
    label: 'wallet-to-identity mapping',
    pattern: /0x[0-9a-fA-F]{40}\s*[:=]\s*['"][^'"]*(?:姓名|身份证|holder_name|owner_name)/,
  },
];

/** Emails that identify the project rather than a private individual. */
const ALLOWED_EMAILS = [/noreply@anthropic\.com/, /@example\.(?:com|invalid)/, /address@dom\.ain/];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collect(full)));
    } else if (
      SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) &&
      full !== SELF
    ) {
      files.push(full);
    }
  }
  return files;
}

const files = await collect(root);
const violations = [];

for (const file of files) {
  const contents = await readFile(file, 'utf8');
  contents.split('\n').forEach((line, index) => {
    for (const { label, pattern } of [...SECRET_PATTERNS, ...PERSONAL_DATA_PATTERNS]) {
      const match = pattern.exec(line);
      if (match === null) continue;
      if (label === 'email address' && ALLOWED_EMAILS.some((allowed) => allowed.test(match[0])))
        continue;
      violations.push(`${relative(root, file)}:${index + 1}: ${label}: ${match[0].slice(0, 60)}`);
    }
  });
}

if (violations.length > 0) {
  process.stderr.write('Repository hygiene failed (NFR-001 / ORACLE-007):\n');
  for (const violation of violations) process.stderr.write(`  ${violation}\n`);
  process.exit(1);
}
process.stdout.write(
  `Repository hygiene verified: scanned ${files.length} files, no secrets or personal data.\n`,
);

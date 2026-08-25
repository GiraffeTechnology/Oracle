#!/usr/bin/env node
/**
 * Keeps downstream documents consistent with docs/DECISIONS_ZH.md.
 *
 * This project has repeatedly drifted: three PRD versions in circulation, a working draft
 * naming an interface the frozen ABI had renamed, and two documents each claiming to be the
 * normative specification. The decision record is only useful if a contradiction fails the
 * build rather than waiting to be noticed.
 *
 * Checks:
 *   1. D-001's authoritative PRD exists and its stated version matches the file.
 *   2. D-002's priority testnet and chain ID appear in the testnet task brief.
 *   3. No document declares a different network as the priority testnet.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'docs');
const SELF = resolve(import.meta.dirname, 'check-decision-consistency.mjs');

const decisions = await readFile(join(docs, 'DECISIONS_ZH.md'), 'utf8');
const failures = [];

// --- D-001: authoritative PRD -------------------------------------------------
const prdMatch = /`docs\/(PRD_[\w.]+\.md)`\s*(v[\d.]+)\s*为唯一权威需求文档/.exec(decisions);
if (prdMatch === null) {
  failures.push('D-001 does not state an authoritative PRD file and version');
} else {
  const [, prdFile, prdVersion] = prdMatch;
  try {
    const prd = await readFile(join(docs, prdFile), 'utf8');
    const stated = /^\| 文档版本 \| (v[\d.]+) \|/m.exec(prd)?.[1];
    if (stated !== prdVersion) {
      failures.push(`D-001 names ${prdVersion} but ${prdFile} states ${stated ?? 'no version'}`);
    } else {
      process.stdout.write(`  ok   D-001 authoritative PRD: ${prdFile} ${prdVersion}\n`);
    }
  } catch {
    failures.push(`D-001 names ${prdFile}, which does not exist`);
  }
}

// --- D-002: priority testnet --------------------------------------------------
const netMatch = /\*\*([A-Za-z]+) 为优先公链测试网\*\*/.exec(decisions);
const chainMatch = /\| Chain ID \| \*\*(\d+)\*\*/.exec(decisions);
if (netMatch === null || chainMatch === null) {
  failures.push('D-002 does not state a priority testnet and chain ID');
} else {
  const network = netMatch[1];
  const chainId = chainMatch[1];
  process.stdout.write(`  ok   D-002 priority testnet: ${network} (chainId ${chainId})\n`);

  const KNOWN_NETWORKS = ['Hoodi', 'Sepolia', 'Holesky'];

  /**
   * The decided network must be the FIRST one named on a line. Presence alone is not enough:
   * a row reading "**Sepolia**; Hoodi as an optional rerun" mentions both, but names the
   * wrong one as primary.
   */
  const namesDecidedFirst = (line) => {
    const seen = KNOWN_NETWORKS.map((name) => ({ name, at: line.indexOf(name) })).filter(
      (entry) => entry.at >= 0,
    );
    if (seen.length === 0) return null;
    seen.sort((a, b) => a.at - b.at);
    return seen[0].name === network;
  };

  const brief = 'TESTNET_TASK_HOODI_ZH.md';
  try {
    const text = await readFile(join(docs, brief), 'utf8');
    const target = /^\| 目标网络 \| (.+?) \|/m.exec(text)?.[1] ?? '';
    if (namesDecidedFirst(target) !== true) {
      failures.push(`${brief} target network row does not name ${network} first: ${target}`);
    }
    if (!text.includes(chainId)) {
      failures.push(`${brief} does not mention chain ID ${chainId}`);
    }
  } catch {
    failures.push(`${brief} is missing; D-002 points to it for implementation`);
  }

  // No document may declare a different network as the priority testnet.
  const names = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md') && full !== SELF) names.push(full);
    }
  };
  await walk(docs);
  for (const file of names) {
    const text = await readFile(file, 'utf8');
    // Match the whole line: a line may legitimately name the priority network first and
    // the fallback second, so a match starting at the keyword would cut the decision off.
    for (const match of text.matchAll(/^.*(?:优先(?:公链)?测试网|目标网络).*$/gm)) {
      const line = match[0];
      if (namesDecidedFirst(line) === false) {
        failures.push(`${relative(root, file)} does not name ${network} first: ${line.trim()}`);
      }
    }
  }
  process.stdout.write(
    `  ok   ${names.length} documents checked for a conflicting priority network\n`,
  );
}

if (failures.length > 0) {
  process.stderr.write('Decision consistency failed (docs/DECISIONS_ZH.md):\n');
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  'Decision consistency verified: downstream documents match the decision record.\n',
);

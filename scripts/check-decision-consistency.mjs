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
 *   4. Both documents still state that the priority network is a test chain, not a
 *      production chain, and that passing on it releases no production gate.
 *   5. D-006's repository boundary holds: src/ carries no ArtFi coupling and no
 *      public-chain write path, both of which the decision record says do not exist here.
 *   6. D-007's supersession notice still stands on docs/erc/README.md, so the archived
 *      older proposal cannot be mistaken for the current one.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'docs');
const SELF = resolve(import.meta.dirname, 'check-decision-consistency.mjs');

const decisions = await readFile(join(docs, 'DECISIONS_ZH.md'), 'utf8');
const failures = [];

// --- D-001: authoritative PRD -------------------------------------------------
const prdMatch =
  /`?docs\/(PRD_[\w.]+\.md)`?\s*(v[\d.]+)\s+is the sole authoritative requirements document/.exec(
    decisions,
  );
if (prdMatch === null) {
  failures.push('D-001 does not state an authoritative PRD file and version');
} else {
  const [, prdFile, prdVersion] = prdMatch;
  try {
    const prd = await readFile(join(docs, prdFile), 'utf8');
    const stated = /^\| Version \| (v[\d.]+) \|/m.exec(prd)?.[1];
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
const netMatch = /\*\*([A-Za-z]+) is the preferred public-chain testnet\*\*/.exec(decisions);
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
    const target = /^\| Target network \| (.+?) \|/m.exec(text)?.[1] ?? '';
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
    for (const match of text.matchAll(
      /^.*(?:(?:preferred|priority) (?:public-chain )?testnet|target network|\u4f18\u5148(?:\u516c\u94fe)?\u6d4b\u8bd5\u7f51|\u76ee\u6807\u7f51\u7edc).*$/gim,
    )) {
      const line = match[0];
      if (namesDecidedFirst(line) === false) {
        failures.push(`${relative(root, file)} does not name ${network} first: ${line.trim()}`);
      }
    }
  }
  process.stdout.write(
    `  ok   ${names.length} documents checked for a conflicting priority network\n`,
  );

  /**
   * The priority testnet is a test chain. Both documents must say so, and must keep the
   * production gate separate: under acceptance section 2.1 the mainnet go/no-go is a legal
   * gate that no technical result releases. These clauses are load-bearing, so their absence
   * fails the build rather than being noticed later.
   */
  const REQUIRED_CLAUSES = [
    { file: 'DECISIONS_ZH.md', text: `**${network} is a test chain, not a production chain.**` },
    {
      file: 'DECISIONS_ZH.md',
      text: `Passing ${network} tests does **not** clear the written go/no-go`,
    },
    {
      file: 'TESTNET_TASK_HOODI_ZH.md',
      text: `**${network} is a test chain, not a production chain.**`,
    },
    { file: 'TESTNET_TASK_HOODI_ZH.md', text: '**Do not deploy to mainnet or use real funds.**' },
    {
      file: 'TESTNET_TASK_HOODI_ZH.md',
      text: `**${network} passing does not clear production gates**`,
    },
  ];
  for (const { file, text } of REQUIRED_CLAUSES) {
    const contents = await readFile(join(docs, file), 'utf8');
    if (!contents.includes(text)) {
      failures.push(`${file} is missing the required clause: ${text}`);
    }
  }
  process.stdout.write(`  ok   ${REQUIRED_CLAUSES.length} required test-chain clauses present\n`);
}

// --- D-006: Oracle / ArtFi repository boundary ---------------------------------
/**
 * D-006 states two things about this repository that are cheap to assert and expensive to
 * notice by eye once broken: it carries no ArtFi coupling, and it opens no public-chain
 * write path. PRD section 0.1 forbids reusing ArtFi's contracts, database or token
 * semantics; PRD section 5 puts chain writes in a different layer entirely. Both are the
 * kind of boundary that erodes through an innocent-looking import.
 *
 * Scope is src/ only. Documentation necessarily names ArtFi to describe the boundary, and
 * the Hoodi test plan labels its two test wallets ArtFi1 and ArtFi2.
 */
if (
  /\*\*ArtFi is the agent for public-chain trading of the cultural-relic-chain registration product\*\*/.test(
    decisions,
  )
) {
  const COUPLING = [
    { label: 'ArtFi reference', pattern: /\bartfi\b/i },
    {
      label: 'public-chain write path',
      pattern:
        /\b(sendTransaction|sendRawTransaction|eth_sendRawTransaction|broadcastTransaction)\b/,
    },
  ];
  const sources = [];
  const walkSrc = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walkSrc(full);
      else if (/\.(?:js|mjs|cjs|ts|mts)$/.test(entry.name)) sources.push(full);
    }
  };
  await walkSrc(join(root, 'src'));
  const before = failures.length;

  for (const file of sources) {
    const text = await readFile(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      for (const { label, pattern } of COUPLING) {
        if (pattern.test(line)) {
          failures.push(`${relative(root, file)}:${index + 1}: D-006 forbids ${label} in src/`);
        }
      }
    });
  }
  if (failures.length === before) {
    process.stdout.write(
      `  ok   D-006 repository boundary: ${sources.length} source files carry no ArtFi coupling or chain write\n`,
    );
  }
} else {
  failures.push('D-006 does not state the ArtFi relationship it is relied on for');
}

// --- D-007: the superseded ERC archive must say so ----------------------------
/**
 * docs/erc/ archives the older proposal. Its README once named the submission candidate
 * "the sole normative source", which was true within that archive and is now misleading
 * repository-wide: the current proposal lives on its own branch, has different interface
 * IDs, and reverses the freeze position. Someone reading the archive without the notice
 * would implement the wrong model, so the notice is load-bearing and its absence fails the
 * build rather than being noticed later.
 */
{
  const REQUIRED = [
    '本目录已被取代',
    '不得据本目录实现任何下游合约',
    'Asynchronous Register Projection for NFTs',
  ];
  const readme = join(root, 'docs', 'erc', 'README.md');
  try {
    const text = await readFile(readme, 'utf8');
    const missing = REQUIRED.filter((clause) => !text.includes(clause));
    for (const clause of missing) {
      failures.push(`docs/erc/README.md is missing the D-007 supersession clause: ${clause}`);
    }
    if (missing.length === 0) {
      process.stdout.write(
        `  ok   D-007 supersession notice: ${REQUIRED.length} clauses present on docs/erc/README.md\n`,
      );
    }
  } catch {
    // The archive may legitimately be removed once the frozen-constants guard stops
    // covering it; D-007 only requires the notice while the directory exists.
    process.stdout.write(
      '  ok   D-007: docs/erc/ archive absent, supersession notice not required\n',
    );
  }
}

// --- D-008: transfers are not blocked while a registry change is in flight -----
/**
 * D-008 resolves a normative head-on conflict: the ERC this project is submitting says ordinary
 * ERC-721 transfers MUST NOT be blocked while a projection gap is open, and PRD v0.3 required
 * exactly that block. The PRD gave way.
 *
 * A decision like this erodes quietly — someone reinstates a freeze because it reads as the
 * safer default, and the repository is back to implementing the opposite of the standard it
 * publishes. Both halves are therefore load-bearing: the decision itself, and the prohibition
 * the PRD now carries. Their absence fails the build.
 */
{
  const REQUIRED = [
    {
      file: join(docs, 'DECISIONS_ZH.md'),
      label: 'D-008 decision',
      text: '**Ordinary ERC-721 transfers are not blocked while registry processing is pending.**',
    },
    {
      file: join(docs, 'PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md'),
      label: 'PRD prohibition on any transfer block',
      text: 'The NFT must not be placed in protocol custody, a non-transferable state, or any equivalent transfer-blocking mechanism.',
    },
    {
      file: join(docs, 'PRD_RWA_ORACLE_PROTOCOL_L2_ZH.md'),
      label: 'PRD deferrable / perishable rights section',
      text: 'Right Classification: Deferrable and Perishable',
    },
  ];
  let ok = 0;
  for (const { file, label, text } of REQUIRED) {
    const contents = await readFile(file, 'utf8');
    if (contents.includes(text)) ok += 1;
    else failures.push(`${relative(root, file)} is missing the D-008 clause (${label}): ${text}`);
  }
  if (ok === REQUIRED.length) {
    process.stdout.write(`  ok   D-008 non-blocking transfer: ${ok} required clauses present\n`);
  }
}

if (failures.length > 0) {
  process.stderr.write('Decision consistency failed (docs/DECISIONS_ZH.md):\n');
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  'Decision consistency verified: downstream documents match the decision record.\n',
);

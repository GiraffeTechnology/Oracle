/**
 * Keccak-256 and ABI selector helpers used to re-derive the ERC constants that
 * `docs/erc/` records as frozen.
 *
 * The archived ERC material is reference documentation for a separate project (see
 * `docs/erc/README.md`), so this module deliberately depends on nothing outside the
 * standard library: it re-derives the published values from the specification text rather
 * than trusting them, and it never compiles or executes Solidity.
 */

const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

const ROTATION_OFFSETS: readonly (readonly number[])[] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;

function rotateLeft(value: bigint, bits: number): bigint {
  const n = BigInt(bits % 64);
  if (n === 0n) return value & MASK64;
  return ((value << n) | (value >> (64n - n))) & MASK64;
}

function permute(lanes: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    const c: bigint[] = [];
    for (let x = 0; x < 5; x += 1) {
      c.push(lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!);
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5]! ^ rotateLeft(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y += 1) {
        lanes[x + 5 * y] = lanes[x + 5 * y]! ^ d;
      }
    }
    const b: bigint[] = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft(lanes[x + 5 * y]!, ROTATION_OFFSETS[x]![y]!);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const i = x + 5 * y;
        lanes[i] = b[i]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK64 & b[((x + 2) % 5) + 5 * y]!);
      }
    }
    lanes[0] = lanes[0]! ^ ROUND_CONSTANTS[round]!;
  }
}

export function keccak256(message: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((message.length + 1) / RATE_BYTES) * RATE_BYTES);
  padded.set(message);
  padded[message.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! ^ 0x80;

  const lanes: bigint[] = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let i = 0; i < RATE_BYTES / 8; i += 1) {
      let lane = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        lane = (lane << 8n) | BigInt(padded[offset + i * 8 + byte]!);
      }
      lanes[i] = lanes[i]! ^ lane;
    }
    permute(lanes);
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let lane = lanes[i]!;
    for (let byte = 0; byte < 8; byte += 1) {
      digest[i * 8 + byte] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return digest;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The four-byte ABI selector of a canonical function signature, as an unsigned integer. */
export function functionSelector(signature: string): number {
  const digest = keccak256(new TextEncoder().encode(signature));
  return ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
}

/**
 * The ERC-165 interface ID: the XOR of the interface's own function selectors. Selectors
 * inherited from IERC165 are excluded, matching `type(I).interfaceId` in Solidity.
 */
export function interfaceId(signatures: readonly string[]): number {
  return signatures.reduce((acc, signature) => (acc ^ functionSelector(signature)) >>> 0, 0);
}

export function formatSelector(value: number): string {
  return `0x${value.toString(16).padStart(8, '0')}`;
}

/**
 * Canonical function signatures declared directly by a Solidity interface block, in
 * declaration order. Only `external` declarations are collected, and parameter names are
 * dropped so the result is the ABI signature.
 */
export function parseInterfaceSignatures(source: string, interfaceName: string): string[] {
  const block = new RegExp(
    `interface\\s+${interfaceName}\\s+is\\s+IERC165\\s*\\{([\\s\\S]*?)\\n\\}`,
  );
  const match = block.exec(source);
  if (match === null) {
    throw new Error(`interface ${interfaceName} not found`);
  }
  const body = match[1]!;
  const signatures: string[] = [];
  const fn = /function\s+(\w+)\s*\(([\s\S]*?)\)\s*external/g;
  let found: RegExpExecArray | null = fn.exec(body);
  while (found !== null) {
    const parameters = found[2]!
      .split(',')
      .map((parameter) => parameter.trim())
      .filter((parameter) => parameter.length > 0)
      .map((parameter) => parameter.split(/\s+/)[0]!);
    signatures.push(`${found[1]!}(${parameters.join(',')})`);
    found = fn.exec(body);
  }
  return signatures;
}

/** Named prose statements such as `IFoo` interface ID is `0x12345678`. */
export function parseNamedInterfaceIds(source: string): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  const statement =
    /(?:ERC-\d+\s+)?`([A-Za-z_][A-Za-z0-9_]*)`\s+interface ID is `(0x[0-9a-f]{8})`/g;
  let match: RegExpExecArray | null = statement.exec(source);
  while (match !== null) {
    const name = match[1]!;
    const id = match[2]!;
    if (named.has(name)) {
      throw new Error(`named interface ID is stated more than once: ${name}`);
    }
    named.set(name, id);
    match = statement.exec(source);
  }
  return named;
}

/**
 * Require an exact, unique interface-name to interface-ID inventory. A valid ID attached to
 * the wrong interface is a failure, not merely another member of an allowed ID set.
 */
export function assertNamedInterfaceIds(
  source: string,
  expectedEntries: readonly (readonly [string, string])[],
): ReadonlyMap<string, string> {
  const actual = parseNamedInterfaceIds(source);
  const expected = new Map(expectedEntries);
  const actualNames = [...actual.keys()].sort();
  const expectedNames = [...expected.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `named interface inventory mismatch: expected ${expectedNames.join(',')}; actual ${actualNames.join(',')}`,
    );
  }
  for (const [name, expectedId] of expected) {
    const actualId = actual.get(name);
    if (actualId !== expectedId) {
      throw new Error(
        `named interface ID mismatch: ${name}: expected ${expectedId}; actual ${actualId ?? 'missing'}`,
      );
    }
  }
  return actual;
}

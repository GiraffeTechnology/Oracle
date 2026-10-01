# Codex Task Brief: Run Giraffe ERC Reference-Implementation Tests on a Public Testnet

| Item | Content |
| --- | --- |
| Subject under test | erc-reference/contracts/VersionedRWACertificateReference.sol |
| Test suite | erc-reference/test/protocol.cjs |
| Local baseline | npx hardhat test → 17 passing / 0 failing (solc 0.8.26, optimizer runs=200, viaIR, chainId 31337) |
| Target network | **Hoodi (chainId 560048)**; Sepolia is an optional rerun |
| Decision basis | DECISIONS_ZH.md D-002 |
| Date | 2026-08-25 |

## 0. Network selection

**Use Hoodi, chainId 560048**, per DECISIONS_ZH.md D-002. Sepolia is an optional rerun if needed. Holesky was deprecated in September 2025 and must not be used.

Recorded trade-off (context only; not a blocker): ethereum.org lists Sepolia as the default recommended testnet for application and contract development and describes Hoodi as intended for validator and staking tests. Both can run this contract test.

**Read chainId from the actual RPC and assert it equals 560048; do not hard-code it in tests.** The EIP-712 domain changes with chainId, and hard-coding creates an incorrect domain separator. This is one of the most valuable aspects to validate on-chain.

**Hoodi is a test chain, not a production chain.** This task runs tests, not a launch. This project currently has no production chain, and Hoodi is not a mainnet substitute or pre-production environment. **Do not deploy to mainnet or use real funds.**

## 1. What an on-chain test can and cannot prove

**Can prove** (not covered by local tests):

- EIP-712 domain separation and signature verification using the real chainId; local fixed chainId 31337 can hide domain-separator errors;
- deadline and expiration behavior against real block time, without cheats;
- feasibility of a real deployment and EIP-170 runtime size;
- validation of ERC-1271 contract authority on the actual deployed contract.

**Cannot prove:** this is not a security audit, formal verification, or economic analysis. State-machine correctness is already covered locally; the public chain adds no new evidence for that.

## 2. Current state (read before execution)

- The test compiles solc itself (compile() in protocol.cjs) and does not depend on Hardhat artifacts.
- Three contracts are involved: VersionedRWACertificateReference, AssetAnchorRegistryLifecycleMock, and ERC1271AuthorityMock.
- **chainId is read dynamically** (protocol.cjs:80), so EIP-712 domains are portable. **Do not change this to a hard-coded value.**

## 3. Three required adaptations

### 3.1 Time cheat codes (blocker)

Lines 398, 430, and 490 of protocol.cjs use evm_setNextBlockTimestamp and evm_mine, which are unavailable on a public chain. Affected cases:

1. rejects expired authority data and finalization after settlement deadline
2. rejects concurrent pending settlement and reused settlement IDs
3. allows holder cancellation after deadline without changing holder or certificate

**Change:** set deadline to now + 90 seconds; then actually wait until deadline + 1 and confirm a new block has been produced (Hoodi and Sepolia both have roughly 12-second block times). Increase the Mocha timeout for these three cases accordingly.

**Do not skip or mark pending**—these are among the most valuable public-chain tests.

### 3.2 Deployment count

beforeEach deploys two contracts and mints for every case, resulting in about 51 transactions for 17 cases. Immutable deployments may be moved to before, with cases isolated by tokenId to reduce duration and gas. **Do not weaken any assertion.** If adopted, document how case isolation works.

### 3.3 Accounts: merging roles when only two test wallets are available (constraint)

All 17 cases can still run with only two operational test wallets, even though the suite originally used six roles. The authority only uses its private key for EIP-712 signing and never sends a transaction (finalizeSettlement is sent by the administrator), so it **may be an unfunded temporary key**.

Actual transaction behavior of the original roles:

| Role | Sends transactions? | Notes |
| --- | --- | --- |
| administrator | Yes | Default signer: deploys two contracts and mints |
| owner | Yes (11 call sites) | Primary operator |
| operator | Yes (1 call site) | Attempts transfer as approved operator; must fail |
| outsider | Yes (1 call site) | Submits valid authority-cancellation data |
| recipient | Yes (after becoming holder in multi-round cases) | Finalize recipient |
| authority | **No** | **Signs only; no gas required** |

**Required mapping:**

- **W1 (funded)** = administrator + operator + outsider + destination B
- **W2 (funded)** = owner (initial holder) + destination A
- **K3 (unfunded temporary key, generated in the test)** = authority

Required invariants: W1 ≠ W2; K3 ∉ {W1, W2} (otherwise “wrong signer” and “authority signature” cannot be distinguished).

**Pitfall (must address):** W1 acts as both operator and outsider. If a case approves W1 as operator, and a later case “external address submits valid authority cancellation data” reuses the same token, that case no longer proves that an *unprivileged caller* can cancel. Grant approval only within the operator case and revoke it at that case's end, or use a distinct tokenId for cancellation cases that was never approved to any operator. State the treatment explicitly in the report.

**Adapt multi-round T+n cases:** destinations = [recipient, outsider, operator, owner] at protocol.cjs:569 collapses after role merging to [W1, W1, W1, W2]. The loop's if destination.address === currentOwner.address continue then skips about half the iterations, reducing eight settlements to four. **Alternate [W1, W2]** to run all eight rounds and maintain or improve coverage. Do not simply reduce the loop count.

**Funding and usage:** beforeEach causes about 51 transactions, all borne by W1 and W2. Prefer moving immutable deployments to before as in §3.2 to reduce transactions (if done, explicitly reset approval state between cases, see the pitfall above), and ensure both wallets hold sufficient testnet ETH.

**Known loss for this plan** (report honestly): administrator and owner are no longer separate addresses. Therefore this on-chain run does not independently evidence the property “a single administrator cannot bypass authority authorization”; that property remains covered by the 17 local tests.

## 4. Network and key configuration

- Add Hoodi to hardhat.config.cjs, with url from HOODI_RPC_URL and accounts from environment variables; **provide only the two W1/W2 private keys**. Generate the authority key in the test with ethers.Wallet.createRandom(), use it only to sign, do not fund it or write it to configuration.
- **Private keys and RPC keys must come only from environment variables; never write them to the repository, configuration files, or commit history.**
- Use one-time test accounts. Never reuse keys holding value or used for another purpose.
- Before running, assert provider.getNetwork().chainId === 560048n; abort immediately if it differs.

## 5. Data compliance (important)

A testnet is a public chain and writes cannot be reversed. **Use only existing synthetic fixtures** (for example, certificate-v1 and asset-anchor-1). Do not write real certificate bytes, real registry references, real asset identifiers, warehouse-receipt information, or personal information. This matches PRD privacy requirements.

## 6. Required evidence

1. Network name and chainId read from the actual RPC (must be 560048).
2. Deployment addresses and deployment transaction hashes for all three contracts.
3. Complete test output with passing/failing counts and per-case results.
3b. Actual role mapping: W1/W2 addresses, temporary authority address, and where operator approval was granted and revoked.
4. Actual wait durations and before/after block numbers for the three time-dependent cases.
5. **On-chain interface checks:** call supportsInterface on the deployed contract and confirm true for:
   - 0x01ffc9a7 (ERC-165)
   - 0x80ac58cd (ERC-721)
   - 0x4a967b01 (ERC-8325 IAssetBoundTokenId)
   - 0xebaa86a0 (IVersionedRWACertificate)
   - 0x2773d4c9 (IDeferredCertificateSettlement)

   Also confirm 0xffffffff returns false.
6. A real finalize transaction hash and receipt confirming CertificateSuperseded, Transfer, and SettlementFinalized events (their order is SHOULD, not a failure condition).
7. Runtime bytecode size, confirmed below 24,576 bytes.
8. If any case fails, report it honestly; do not skip a case or relax an assertion.

## 7. Prohibited actions

- Do not modify the ABI, either of the two EIP-712 canonical type strings, or either interface ID. Any change invalidates the frozen 0xebaa86a0 / 0x2773d4c9 values and the file SHA-256 values in the test report.
- Do not weaken any MUST-level assertion to make tests pass.
- Do not deploy to mainnet or use real funds.
- Do not commit private keys, RPC keys, or .env files.

## 8. After completion

Add a testnet-results section to PRE_SUBMISSION_TEST_REPORT_ZH.txt with network, chainId, contract addresses, transaction hashes, and case results; update the file SHA-256 values in section 6 for any files changed.

Passing a testnet run is **not** an external security audit, legal opinion, regulatory approval, or Ethereum endorsement. It does not clear the five pre-submission gates for GitHub usernames, Ethereum Magicians discussion URL, ERC number, CC0/patent conclusion, or external-publication authorization.

Likewise, **Hoodi passing does not clear production gates**. Under acceptance standard §2.1, written go/no-go for mainnet, real assets, real funds, and each jurisdiction is a legal gate with status PENDING-GATE, not cleared by any technical test. Deployment addresses and transaction hashes from this task are test evidence and must not be described as product launch or approval.

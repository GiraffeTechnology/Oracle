# Controlled Hoodi test configuration

The controlled signer requires explicit deployment configuration. There are no built-in wallet addresses, local user paths or authorization identifiers.

- `ERC_TEST_WALLET_1_ADDRESS` and `ERC_TEST_WALLET_2_ADDRESS`: two distinct, nonzero test-wallet addresses. The existing `ArtFi1` and `ArtFi2` aliases are compatibility labels.
- `ERC_SIGNER_WRAPPER_PATH`: absolute path to the installed signer wrapper.
- `ERC_CHAIN_BRIDGE_PATH`: absolute path to the installed chain bridge.
- `ERC_CHAIN_BRIDGE_AUTHORIZATION_ID`: the bridge's configured authorization identifier in UUID form.
- `ERC_SIGNER_POWERSHELL`: optional PowerShell executable; defaults to `powershell.exe`.

Missing or invalid configuration fails before the affected signer or bridge action. Configuration does not bypass the wrapper's authorization: Hoodi-only chain identity, zero-value requests, exact address/calldata/nonce matching, expiring policies, exclusive temporary files, serial receipts and raw-transaction handling remain enforced.

The isolated adapter test uses synthetic addresses and performs no signing or broadcasting. Live testnet execution requires its independently configured signer and bridge. Historical test plans and recorded evidence do not populate runtime configuration.

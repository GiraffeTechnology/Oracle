# Shared ERC-8415 projection conformance vectors

`projection-vectors.json` is vendored, not authored here.

|               |                                                                    |
| ------------- | ------------------------------------------------------------------ |
| Upstream      | `GiraffeTechnology/ERC8415-Kit`                                    |
| Upstream path | `conformance/projection-vectors.json`                              |
| SHA-256       | `b461291f79e79628c2b8a31c43b9d4aab63ecb88c473ee0301f11b826f11a53b` |

Oracle consumes the Kit's temporal projection surface under the architecture
`ArtFi → Oracle → ERC8415-Kit → ERC-8415`, so the vectors that define those
semantics belong upstream and are copied in rather than rewritten.

`test/erc-8415-projection-vectors.test.js` recomputes the SHA-256 above on
every run. A local edit therefore fails rather than silently letting this copy
drift away from the Kit's.

Both divergences these vectors were introduced to catch were live in this
repository at the same time, in two separate implementations:

- an instant preceding the first entry reported final, in the consumer state
  machine **and** in `OracleRegisterProjection.sol`;
- an open gap folded into finality, in the consumer state machine.

Each implementation had its own hand-written tests, and both passed. That is
the failure mode a shared vector set exists to close.

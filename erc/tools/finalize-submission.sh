#!/usr/bin/env bash
# Turn the pre-submission tree into a submittable one.
#
#   ./tools/finalize-submission.sh <erc-number> <magicians-url> [outdir]
#
# Both inputs are required and neither can be invented:
#
#   <erc-number>     Authors do NOT choose this. ERC numbers are assigned by
#                    the editors, sequentially, and an author-chosen number is
#                    treated as number gaming and reassigned. Submit with the
#                    numeric placeholder 9999, then run this script again with
#                    the number the editor assigns in review, and update the
#                    PR. It is also not the pull request number: numbering
#                    became sequential from 7500.
#   <magicians-url>  The real thread. Must match
#                    ^https://ethereum-magicians.org/t/[^/]+/[0-9]+$
#                    Post the thread first. Do not put a number in its title
#                    before an editor has assigned one.
#
# Why a placeholder cannot be submitted, both verified against the official
# tooling rather than assumed:
#   * `eip: XXXX` fails eipw's preamble-eip, which requires an unsigned
#     integer, and omitting the header fails preamble-req.
#   * A filename of erc-XXXX.md makes eipw-action's path2number() throw
#     "file name not in correct format", which crashes the linter job in
#     ethereum/ERCs CI before any linting happens.
set -euo pipefail

N="${1:-}"; URL="${2:-}"; OUT="${3:-$(cd "$(dirname "$0")/.." && pwd)/../erc-submission}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

[[ "$N" =~ ^[0-9]+$ ]] || { echo "error: <erc-number> must be digits, got '${N}'" >&2; exit 2; }
[[ "$URL" =~ ^https://ethereum-magicians\.org/t/[^/]+/[0-9]+$ ]] || {
  echo "error: <magicians-url> must match ^https://ethereum-magicians.org/t/[^/]+/[0-9]+\$" >&2
  echo "       got '${URL}'" >&2; exit 2; }

rm -rf "$OUT"; mkdir -p "$OUT/ERCS" "$OUT/assets"
sed -e "s|^eip: XXXX$|eip: ${N}|" \
    -e "s|^discussions-to: .*$|discussions-to: ${URL}|" \
    -e "s|assets/eip-xxxx/|assets/eip-${N}/|g" \
    "$HERE/ERCS/erc-xxxx.md" > "$OUT/ERCS/erc-${N}.md"
cp -r "$HERE/assets/eip-xxxx" "$OUT/assets/eip-${N}"
# The asset package names itself after the proposal too.
find "$OUT/assets/eip-${N}" -type f \( -name '*.json' -o -name '*.md' -o -name '*.cjs' -o -name '*.sol' \) \
  -exec sed -i -e "s|eip-xxxx|eip-${N}|g" -e "s|erc-xxxx|erc-${N}|g" {} +

grep -q "REPLACE_WITH" "$OUT/ERCS/erc-${N}.md" && { echo "error: placeholder survived" >&2; exit 1; }
if grep -rq "eip-xxxx\|REPLACE_WITH\|eip: XXXX" "$OUT"; then
  echo "error: a placeholder survived in the generated tree:" >&2
  grep -rln "eip-xxxx\|REPLACE_WITH\|eip: XXXX" "$OUT" >&2
  exit 1
fi

echo "Submission tree written to: $OUT"
echo
echo "  ERCS/erc-${N}.md"
echo "  assets/eip-${N}/  ($(find "$OUT/assets/eip-${N}" -type f | wc -l | tr -d ' ') files)"
echo
echo "Next, and do not skip it — lint before opening the pull request:"
echo "  cargo install eipw --version 0.11.0"
echo "  # copy \$OUT/ERCS/erc-${N}.md and \$OUT/assets/eip-${N}/ into a fork of"
echo "  # ethereum/ERCs at the same paths, then from the fork root:"
echo "  eipw --config config/eipw.toml ERCS/erc-${N}.md"
echo "  (cd assets/eip-${N} && npm install && npm test)"
echo
echo "Then open the pull request titled:"
echo "  Add ERC: Asynchronous Register Projection for NFTs"

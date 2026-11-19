#!/usr/bin/env bash
# End-to-end demo on a local anvil chain:
#   a sponsor funds a PreimageBounty, Alice proves she knows the secret without
#   revealing it, Mallory copies her proof and fails to redirect the payout,
#   a relayer submits Alice's claim, and a second claim is refused.
#
# Needs: fe, anvil and cast (Foundry), jq, Node 18+, `npm ci`.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8548}
export ETH_RPC_URL=http://127.0.0.1:$PORT
WORK=$(mktemp -d)
anvil --port "$PORT" --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null; rm -rf "$WORK"' EXIT
for _ in $(seq 50); do cast chain-id >/dev/null 2>&1 && break; sleep 0.1; done

step() { printf '\n== %s\n' "$*"; }
eth() { cast from-wei "$(cast balance "$1")"; }

mapfile -t ACCOUNTS < <(cast rpc eth_accounts | jq -r '.[]')
SPONSOR=${ACCOUNTS[0]} ALICE=${ACCOUNTS[1]} MALLORY=${ACCOUNTS[2]} RELAYER=${ACCOUNTS[3]}

step "Build the Fe contracts"
fe build >/dev/null
echo "out/PreimageBounty.bin: $(($(wc -c < out/PreimageBounty.runtime.bin) / 2)) bytes of runtime code"

step "Alice picks a secret and proves she knows it, for her own address"
SECRET=$(node -e 'console.log(BigInt("0x" + require("crypto").randomBytes(31).toString("hex")).toString())')
echo "{\"secret\":\"$SECRET\",\"recipient\":\"$(cast to-dec "$ALICE")\"}" > "$WORK/input.json"
START=$(date +%s%N)
scripts/prove.sh preimage "$WORK/input.json" "$WORK/alice" >/dev/null
echo "proof generated and checked by snarkjs in $(( ($(date +%s%N) - START) / 1000000 )) ms"
HASH=$(jq -r '.[0]' "$WORK/alice/public.json")
echo "Poseidon(secret) = $HASH"
echo "public inputs: hash, recipient = $(jq -r '.[1]' "$WORK/alice/public.json") ($ALICE)"

step "The sponsor funds a bounty of 1 ETH for that hash"
INIT="$(cat out/PreimageBounty.bin)$(cast abi-encode 'constructor(uint256)' "$HASH" | cut -c3-)"
BOUNTY=$(cast send --unlocked --from "$SPONSOR" --value 1ether --create "$INIT" --json | jq -r .contractAddress)
echo "PreimageBounty at $BOUNTY, balance $(eth "$BOUNTY") ETH, hash() = $(cast call "$BOUNTY" 'hash()(uint256)')"

# Calldata for claim(a, b, c, recipient), with B in precompile order.
read -r A B C < <(node -e '
  const p = JSON.parse(require("fs").readFileSync(process.argv[1]));
  const a = `[${p.pi_a[0]},${p.pi_a[1]}]`;
  const b = `[[${p.pi_b[0][1]},${p.pi_b[0][0]}],[${p.pi_b[1][1]},${p.pi_b[1][0]}]]`;
  const c = `[${p.pi_c[0]},${p.pi_c[1]}]`;
  console.log(a, b, c);' "$WORK/alice/proof.json")
SIG='claim(uint256[2],uint256[2][2],uint256[2],address)'

step "Mallory copies Alice's proof from the mempool and claims it for herself"
if OUT=$(cast send --unlocked --from "$MALLORY" "$BOUNTY" "$SIG" "$A" "$B" "$C" "$MALLORY" 2>&1); then
  echo "UNEXPECTED: Mallory's claim went through"; exit 1
fi
echo "refused: $(grep -o 'Invalid proof' <<< "$OUT" | head -1)"
echo "bounty balance still $(eth "$BOUNTY") ETH, claimed() = $(cast call "$BOUNTY" 'claimed()(bool)')"

step "A relayer submits Alice's claim; the payout goes to the address in the proof"
BEFORE=$(cast balance "$ALICE")
TX=$(cast send --unlocked --from "$RELAYER" "$BOUNTY" "$SIG" "$A" "$B" "$C" "$ALICE" --json)
echo "status $(jq -r .status <<< "$TX"), gas used $(cast to-dec "$(jq -r .gasUsed <<< "$TX")")"
GAINED=$(node -e 'console.log((BigInt(process.argv[1]) - BigInt(process.argv[2])).toString())' "$(cast balance "$ALICE")" "$BEFORE")
echo "Alice received $(cast from-wei "$GAINED") ETH; bounty balance $(eth "$BOUNTY") ETH"
echo "BountyClaimed event topic: $(jq -r '.logs[0].topics[0]' <<< "$TX")"

step "The same proof cannot be used again"
if OUT=$(cast send --unlocked --from "$RELAYER" "$BOUNTY" "$SIG" "$A" "$B" "$C" "$ALICE" 2>&1); then
  echo "UNEXPECTED: second claim went through"; exit 1
fi
echo "refused: $(grep -o 'Already claimed' <<< "$OUT" | head -1)"

step "Done"

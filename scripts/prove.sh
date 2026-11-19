#!/usr/bin/env bash
# Usage: scripts/prove.sh <circuit> <input.json> <out_dir>
# Writes <out_dir>/proof.json and <out_dir>/public.json, and checks them with snarkjs.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=node_modules/.bin
c=$1; input=$2; out=$3
mkdir -p "$out"
[ -f build/$c/${c}_js/$c.wasm ] || $BIN/circom2 circuits/$c.circom --wasm -o build/$c >/dev/null
$BIN/snarkjs wtns calculate build/$c/${c}_js/$c.wasm "$input" "$out/witness.wtns"
$BIN/snarkjs groth16 prove vectors/$c/$c.zkey "$out/witness.wtns" "$out/proof.json" "$out/public.json"
rm "$out/witness.wtns"
$BIN/snarkjs groth16 verify vectors/$c/verification_key.json "$out/public.json" "$out/proof.json"

#!/usr/bin/env bash
# Builds both circuits, runs a local Groth16 setup and writes the verifying keys.
# Output goes to build/ (ignored) and vectors/<circuit>/verification_key.json (committed).
# The setup is a single local contribution: fine for tests and demos, not for production.
# The -e strings are extra entropy only: snarkjs mixes them with 64 random bytes, so
# reruns give new keys and the contribution randomness is never known or stored.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=node_modules/.bin
mkdir -p build vectors

if [ ! -f build/pot.ptau ]; then
  $BIN/snarkjs powersoftau new bn128 10 build/pot_0.ptau
  $BIN/snarkjs powersoftau contribute build/pot_0.ptau build/pot_1.ptau --name=local -e="fe-groth16 local ptau"
  $BIN/snarkjs powersoftau prepare phase2 build/pot_1.ptau build/pot.ptau
fi

for c in multiplier preimage; do
  mkdir -p build/$c vectors/$c
  $BIN/circom2 circuits/$c.circom --r1cs --wasm -o build/$c
  $BIN/snarkjs groth16 setup build/$c/$c.r1cs build/pot.ptau build/$c/${c}_0.zkey
  $BIN/snarkjs zkey contribute build/$c/${c}_0.zkey vectors/$c/$c.zkey --name=local -e="fe-groth16 $c"
  $BIN/snarkjs zkey export verificationkey vectors/$c/$c.zkey vectors/$c/verification_key.json
  $BIN/snarkjs zkey export solidityverifier vectors/$c/$c.zkey build/$c/Verifier.sol
done

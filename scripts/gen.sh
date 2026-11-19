#!/usr/bin/env bash
# Regenerates the Fe sources that come from snarkjs files in vectors/.
# CI runs this and fails if the committed sources differ.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/snarkjs2fe.mjs key multiplier vectors/multiplier/verification_key.json > src/multiplier_key.fe
node scripts/snarkjs2fe.mjs key preimage vectors/preimage/verification_key.json > src/preimage_key.fe
node scripts/snarkjs2fe.mjs proofs \
  MUL_1=vectors/multiplier/proof_1 \
  MUL_2=vectors/multiplier/proof_2 \
  BOB=vectors/preimage/proof_bob \
  BOB_2=vectors/preimage/proof_bob_2 \
  ALICE=vectors/preimage/proof_alice \
  > src/vectors.fe
for f in src/multiplier_key.fe src/preimage_key.fe src/vectors.fe; do fe fmt "$f"; done

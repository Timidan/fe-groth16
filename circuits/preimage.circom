// SPDX-License-Identifier: GPL-3.0
// This circuit includes circomlib's Poseidon (GPL-3.0), so it is distributed under GPL-3.0.
// The rest of the repository is Apache-2.0.
pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Public: hash, recipient. Private: secret.
// Proves knowledge of `secret` with Poseidon(secret) == hash, bound to `recipient`
// so a copied proof cannot redirect the payout.
template Preimage() {
    signal input secret;
    signal input recipient;
    signal output hash;

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    hash <== h.out;

    // Constrain recipient so it is part of the proof, not a free public input.
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main {public [recipient]} = Preimage();

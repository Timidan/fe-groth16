pragma circom 2.0.0;

// Public: c. Private: a, b with a * b = c in the scalar field. A test circuit:
// (1, c) is always a witness, so a proof says nothing about factoring c.
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main = Multiplier();

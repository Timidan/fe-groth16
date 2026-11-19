pragma circom 2.0.0;

// Public: c. Private: a, b. Proves knowledge of a factorisation of c.
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main = Multiplier();

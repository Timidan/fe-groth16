# Demo transcript

Output of `scripts/demo.sh` on a local anvil chain. Addresses are anvil's default accounts; the secret is random on every run.

```text

== Build the Fe contracts
out/PreimageBounty.bin: 3541 bytes of runtime code

== Alice picks a secret and proves she knows it, for her own address
proof generated and checked by snarkjs in 1958 ms
Poseidon(secret) = 9401046016500942214451758579402236512703443828088383225827932775685295994293
public inputs: hash, recipient = 642829559307850963015472508762062935916233390536 (0x70997970c51812dc3a010c7d01b50e0d17dc79c8)

== The sponsor funds a bounty of 1 ETH for that hash
PreimageBounty at 0x5fbdb2315678afecb367f032d93f642f64180aa3, balance 1.000000000000000000 ETH, hash() = 9401046016500942214451758579402236512703443828088383225827932775685295994293 [9.401e75]

== Mallory copies Alice's proof from the mempool and claims it for herself
refused: Invalid proof
bounty balance still 1.000000000000000000 ETH, claimed() = false

== A relayer submits Alice's claim; the payout goes to the address in the proof
status 0x1, gas used 257714
Alice received 1.000000000000000000 ETH; bounty balance 0.000000000000000000 ETH
BountyClaimed event topic: 0xac56e31790f51d5ee1fd63f4e99bd0bb5363ff7e23dd9005bdfb0bb52da5a4a6

== The same proof cannot be used again
refused: Already claimed

== Done
```

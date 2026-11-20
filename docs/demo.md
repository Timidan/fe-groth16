# Demo transcript

Output of `scripts/demo.sh` on a local anvil chain. Addresses are anvil's default accounts; the secret is random on every run.

```text

== Build the Fe contracts
out/PreimageBounty.bin: 3544 bytes of runtime code

== Alice deploys a wallet contract that records every payment in storage
wallet at 0x8464135c8f25da09e49bc8782676a84730c318bc

== Alice picks a secret and proves she knows it, for her wallet
proof generated and checked by snarkjs in 2104 ms
Poseidon(secret) = 18434297472762404197489885810490150442664474384069647054787214275696324057993
public inputs: hash, recipient = 755818542898286480414060217752168590440816384188 (0x8464135c8f25da09e49bc8782676a84730c318bc)

== The sponsor funds a bounty of 1 ETH for that hash
PreimageBounty at 0x5fbdb2315678afecb367f032d93f642f64180aa3, balance 1.000000000000000000 ETH, hash() = 18434297472762404197489885810490150442664474384069647054787214275696324057993 [1.843e76]

== Mallory copies Alice's proof from the mempool and claims it for herself
refused: Invalid proof
bounty balance still 1.000000000000000000 ETH, claimed() = false

== A relayer submits Alice's claim; the payout goes to the address in the proof
status 0x1, gas used 279825
Alice's wallet holds 1.000000000000000000 ETH and recorded 1.000000000000000000 ETH in storage; bounty balance 0.000000000000000000 ETH
BountyClaimed event topic: 0xac56e31790f51d5ee1fd63f4e99bd0bb5363ff7e23dd9005bdfb0bb52da5a4a6

== The same proof cannot be used again
refused: Already claimed

== Done
```

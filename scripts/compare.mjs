#!/usr/bin/env node
// Differential test and gas comparison: the Fe verifiers against the Solidity
// verifiers snarkjs exports for the same keys.
//
// Every case states what each contract must return: the same result, except
// for one non-canonical encoding of A.y that only Solidity accepts. Gas is the
// receipt's gasUsed for a transaction with a 1,000,000 gas limit, so a failed
// precompile call shows what it burns.
//
// Needs `fe build` output in out/, `npm ci`, and anvil and cast on PATH.
// Writes docs/compare.md.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { groth16 } from "snarkjs";
import solc from "solc";

const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PORT = Number(process.env.PORT ?? 8547);
const RPC = `http://127.0.0.1:${PORT}`;
const GAS = 1_000_000n;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

let rpcId = 0;
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function waitForAnvil() {
  for (let i = 0; i < 50; i++) {
    try {
      return await rpc("eth_chainId");
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("anvil did not start");
}

async function send(from, tx, gas = GAS) {
  const hash = await rpc("eth_sendTransaction", [{ from, gas: `0x${gas.toString(16)}`, ...tx }]);
  for (let i = 0; i < 100; i++) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function deploy(from, bytecode) {
  const receipt = await send(from, { data: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}` }, 10_000_000n);
  if (receipt.status !== "0x1") throw new Error("deployment failed");
  const code = await rpc("eth_getCode", [receipt.contractAddress, "latest"]);
  return { address: receipt.contractAddress, runtimeSize: (code.length - 2) / 2 };
}

function compileSolidity(path) {
  const input = {
    language: "Solidity",
    sources: { "Verifier.sol": { content: readFileSync(path, "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return out.contracts["Verifier.sol"].Groth16Verifier.evm.bytecode.object;
}

const word = (n) => BigInt(n).toString(16).padStart(64, "0");

// snarkjs proof.json -> [a, b, c] in calldata order (G2 halves swapped).
function calldata(proof) {
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

function encode(selector, p, inputs) {
  return selector + [...p.a, ...p.b.flat(), ...p.c, ...inputs].map(word).join("");
}

const load = (dir) => ({ proof: calldata(readJson(`${dir}/proof.json`)), inputs: readJson(`${dir}/public.json`).map(BigInt) });
const clone = (p) => ({ a: [...p.a], b: p.b.map((r) => [...r]), c: [...p.c] });
const tweak = (p, f) => {
  const q = clone(p);
  f(q);
  return q;
};

// Seeded fuzzing: single-word mutations of a valid proof and its inputs.
const FUZZ_RUNS = Number(process.env.FUZZ_RUNS ?? 250);
const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? 20261124);
const MASK = (1n << 256n) - 1n;

function prng(seed) {
  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  const word = () => {
    let w = 0n;
    for (let i = 0; i < 8; i++) w = (w << 32n) | BigInt(next());
    return w;
  };
  return { int: (n) => next() % n, word };
}

const MUTATIONS = [
  ["random word", (v, r) => r.word()],
  ["random field element", (v, r) => r.word() % Q],
  ["one bit flipped", (v, r) => v ^ (1n << BigInt(r.int(256)))],
  ["+ q", (v) => (v + Q) & MASK],
  ["+ r", (v) => (v + R) & MASK],
  ["- 1", (v) => (v - 1n) & MASK],
  ["zero", () => 0n],
];

// The words of a call in calldata order: a (2), b (4), c (2), inputs (N).
const words = (p, inputs) => [...p.a, ...p.b.flat(), ...p.c, ...inputs];

function cases(main, other, foreign) {
  const { proof: p, inputs } = main;
  const bumped = [...inputs];
  bumped[bumped.length - 1] += 1n;
  const plusR = [...inputs];
  plusR[0] += R;
  // snarkjs negates A.y as (q - y) mod q in 256-bit arithmetic, so y + (2^256 mod q)
  // (+ k * q) negates to the same point. Fe requires A.y < q and rejects it.
  const alias = (y) => {
    let v = y + (MASK + 1n) % Q;
    while (v <= Q) v += Q;
    return v;
  };
  const both = (b) => [b, b];
  return [
    ["valid proof", both(true), p, inputs],
    ["second valid proof, same statement", both(true), other.proof, other.inputs],
    ["last public input + 1", both(false), p, bumped],
    ["first public input + r", both(false), p, plusR],
    ["proof from another circuit", both(false), foreign.proof, inputs],
    ["A replaced by C", both(false), tweak(p, (q) => (q.a = [...q.c])), inputs],
    ["A negated", both(false), tweak(p, (q) => (q.a[1] = Q - q.a[1])), inputs],
    ["B and C from another proof", both(false), tweak(p, (q) => ((q.b = other.proof.b), (q.c = other.proof.c))), inputs],
    ["A.y + q", both(false), tweak(p, (q) => (q.a[1] += Q)), inputs],
    ["A off the curve", both(false), tweak(p, (q) => (q.a = [1n, 1n])), inputs],
    ["C off the curve", both(false), tweak(p, (q) => (q.c[1] += 1n)), inputs],
    ["B.x imaginary + q", both(false), tweak(p, (q) => (q.b[0][0] += Q)), inputs],
    ["B off the twist", both(false), tweak(p, (q) => (q.b[1][1] += 1n)), inputs],
    ["all-zero proof", both(false), { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] }, inputs],
    ["A.y written as y + (2^256 mod q), same point after snarkjs's negation", [true, false], tweak(p, (q) => (q.a[1] = alias(q.a[1]))), inputs],
  ];
}

async function main() {
  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  try {
    await waitForAnvil();
    const [from] = await rpc("eth_accounts");
    const rows = [];
    const fuzzed = [];
    const fresh = [];
    let failures = 0;

    // Fresh valid proofs, made here with snarkjs: both verifiers must accept every one.
    const rand = prng(FUZZ_SEED);
    const scalar = () => rand.word() % R;
    const circuits = [
      {
        name: "preimage", contract: "PreimageVerifier", main: "proof_bob", other: "proof_bob_2", foreign: "multiplier/proof_1",
        fresh: [
          { secret: "0", recipient: "0" },
          ...Array.from({ length: 3 }, () => ({ secret: scalar().toString(), recipient: (rand.word() >> 96n).toString() })),
        ],
      },
      {
        name: "multiplier", contract: "MultiplierVerifier", main: "proof_1", other: "proof_2", foreign: "preimage/proof_bob",
        fresh: [
          { a: "0", b: "7" },
          { a: "1", b: "1" },
          { a: (R - 1n).toString(), b: "1" },
          { a: (R - 1n).toString(), b: (R - 1n).toString() },
          ...Array.from({ length: 8 }, () => ({ a: scalar().toString(), b: scalar().toString() })),
        ],
      },
    ];
    for (const c of circuits) {
      mkdirSync(`build/${c.name}`, { recursive: true });
      run("node_modules/.bin/snarkjs", ["zkey", "export", "solidityverifier", `vectors/${c.name}/${c.name}.zkey`, `build/${c.name}/Verifier.sol`]);
      const sol = await deploy(from, compileSolidity(`build/${c.name}/Verifier.sol`));
      const fe = await deploy(from, readFileSync(`out/${c.contract}.bin`, "utf8").trim());

      const main = load(`vectors/${c.name}/${c.main}`);
      const other = load(`vectors/${c.name}/${c.other}`);
      const foreignRaw = load(`vectors/${c.foreign}`);
      const foreign = { proof: foreignRaw.proof, inputs: main.inputs };
      const selector = run("cast", ["sig", `verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[${main.inputs.length}])`]);

      rows.push({ circuit: c.name, label: "runtime bytecode (bytes)", sol: sol.runtimeSize, fe: fe.runtimeSize });
      for (const [label, expected, proof, inputs] of cases(main, other, foreign)) {
        const data = encode(selector, proof, inputs);
        const result = {};
        for (const [key, target] of [["sol", sol], ["fe", fe]]) {
          const ret = await rpc("eth_call", [{ from, to: target.address, data, gas: `0x${GAS.toString(16)}` }, "latest"]);
          const receipt = await send(from, { to: target.address, data });
          result[key] = { accepted: BigInt(ret) === 1n, gas: Number(BigInt(receipt.gasUsed)) };
        }
        const ok = result.sol.accepted === expected[0] && result.fe.accepted === expected[1];
        if (!ok) failures++;
        rows.push({ circuit: c.name, label, expected, ok, sol: result.sol, fe: result.fe });
      }

      // Every mutation must be rejected by both verifiers.
      const rand = prng(FUZZ_SEED + main.inputs.length);
      const base = words(main.proof, main.inputs);
      let tried = 0;
      while (tried < FUZZ_RUNS) {
        const at = rand.int(base.length);
        const [kind, mutate] = MUTATIONS[rand.int(MUTATIONS.length)];
        const mutated = [...base];
        mutated[at] = mutate(base[at], rand);
        if (mutated[at] === base[at]) continue;
        tried++;
        const data = selector + mutated.map(word).join("");
        const accepted = {};
        for (const [key, target] of [["sol", sol], ["fe", fe]]) {
          const ret = await rpc("eth_call", [{ from, to: target.address, data, gas: `0x${GAS.toString(16)}` }, "latest"]);
          accepted[key] = BigInt(ret) === 1n;
        }
        if (accepted.sol !== accepted.fe || accepted.fe) {
          failures++;
          console.error(`fuzz ${c.name}: word ${at} (${kind}) -> sol ${accepted.sol}, fe ${accepted.fe}`);
        }
      }
      fuzzed.push(`${c.name}: ${tried}`);

      const wasm = `build/${c.name}/${c.name}_js/${c.name}.wasm`;
      if (!existsSync(wasm)) run("node_modules/.bin/circom2", [`circuits/${c.name}.circom`, "--wasm", "-o", `build/${c.name}`]);
      for (const input of c.fresh) {
        const { proof, publicSignals } = await groth16.fullProve(input, wasm, `vectors/${c.name}/${c.name}.zkey`);
        const data = encode(selector, calldata(proof), publicSignals.map(BigInt));
        const accepted = {};
        for (const [key, target] of [["sol", sol], ["fe", fe]]) {
          const ret = await rpc("eth_call", [{ from, to: target.address, data, gas: `0x${GAS.toString(16)}` }, "latest"]);
          accepted[key] = BigInt(ret) === 1n;
        }
        if (!accepted.sol || !accepted.fe) {
          failures++;
          console.error(`fresh ${c.name} ${JSON.stringify(input)}: sol ${accepted.sol}, fe ${accepted.fe}`);
        }
      }
      fresh.push(`${c.name}: ${c.fresh.length}`);
    }

    const fmt = (r) => `${r.accepted ? "accept" : "reject"}, ${r.gas.toLocaleString("en-US")}`;
    const lines = [
      "# Fe verifier vs snarkjs Solidity verifier",
      "",
      "Generated by `scripts/compare.mjs`. Each case is sent to both contracts as a transaction with a 1,000,000 gas limit; gas is the receipt's `gasUsed`, including the 21,000 base cost and calldata. Solidity: snarkjs 0.7.6 template, solc 0.8.28, optimizer on (200 runs). Fe: 26.6.0, `fe build`.",
      "",
      "| Circuit | Case | Solidity | Fe | Expected |",
      "| --- | --- | --- | --- | --- |",
    ];
    for (const r of rows) {
      if (r.expected === undefined) lines.push(`| ${r.circuit} | ${r.label} | ${r.sol.toLocaleString("en-US")} | ${r.fe.toLocaleString("en-US")} | |`);
      else {
        const want = r.expected[0] === r.expected[1] ? `both ${r.expected[0] ? "accept" : "reject"}` : "Solidity accepts, Fe rejects";
        lines.push(`| ${r.circuit} | ${r.label} | ${fmt(r.sol)} | ${fmt(r.fe)} | ${want}${r.ok ? "" : " — **NOT MET**"} |`);
      }
    }
    lines.push(
      "",
      `Fresh proofs: ${fresh.join(", ")} valid proofs generated by snarkjs for random and edge-case inputs (public values 0, 1 and r - 1 among them), each sent to both verifiers with \`eth_call\`. ${failures ? "**Failures above.**" : "Both accepted every one."}`,
      "",
      `Fuzzing: ${fuzzed.join(", ")} single-word mutations of the valid proof and its inputs (seed ${FUZZ_SEED}; mutations: ${MUTATIONS.map(([k]) => k).join(", ")}), each sent to both verifiers with \`eth_call\`. ${failures ? "**Failures above.**" : "Both rejected every one."}`,
    );
    mkdirSync("docs", { recursive: true });
    writeFileSync("docs/compare.md", lines.join("\n") + "\n");
    console.log(lines.slice(4).join("\n"));
    if (failures) {
      console.error(`${failures} case(s) differ or have the wrong result`);
      process.exitCode = 1;
    }
  } finally {
    anvil.kill();
  }
}

await main();
// snarkjs keeps curve worker threads alive; exit explicitly.
process.exit(process.exitCode ?? 0);

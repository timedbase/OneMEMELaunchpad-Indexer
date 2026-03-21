/**
 * Salt mining worker — runs in a separate thread to avoid blocking the API.
 *
 * Mines a bytes32 userSalt value such that the CREATE2-predicted token address
 * (via LaunchpadFactory.predictTokenAddress) ends with 0x1111.
 *
 * Algorithm:
 *   CREATE2 address = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
 *   where:
 *     salt         = keccak256(abi.encode(creator, userSalt))
 *     initCodeHash = keccak256(EIP-1167 init code for impl)
 *
 * Uses a counter-based iteration (28 random base bytes + 4-byte counter)
 * for speed. Reseeds when the 32-bit counter overflows.
 *
 * Posts messages to parent:
 *   { type: 'progress', attempts: number }   — every 50 000 iterations
 *   { type: 'found', salt, predictedAddress, attempts }  — on success
 */

import { workerData, parentPort } from "worker_threads";
import { randomBytes }            from "crypto";
import { keccak256, hexToBytes, bytesToHex } from "viem";

interface WorkerInput {
  factoryAddress: `0x${string}`;
  implAddress:    `0x${string}`;
  creatorAddress: `0x${string}`;
}

const { factoryAddress, implAddress, creatorAddress }: WorkerInput = workerData;

// ── EIP-1167 init code (deploy prefix + clone template + impl address + suffix) ──
const initCodeHex = (
  "0x3d602d80600a3d3981f3"                 // deploy preamble (10 bytes)
  + "363d3d373d3d3d363d73"                 // clone prefix (10 bytes)
  + implAddress.slice(2).toLowerCase()     // impl address (20 bytes)
  + "5af43d82803e903d91602b57fd5bf3"       // clone suffix (15 bytes)
) as `0x${string}`;

// Pre-compute the init code hash once (32 bytes).
const initCodeHash = keccak256(hexToBytes(initCodeHex), "bytes");

// Factory bytes (20 bytes) — used in CREATE2 preimage.
const factoryBytes = hexToBytes(factoryAddress);

// Creator padded to 32 bytes for abi.encode(address, bytes32).
// Solidity abi.encode pads an address to 32 bytes (12 leading zero bytes).
const creatorRaw    = hexToBytes(creatorAddress);
const creatorPadded = new Uint8Array(32);
creatorPadded.set(creatorRaw, 12);

// ── Pre-allocated, reused buffers ──────────────────────────────────────────────

// Salt preimage: keccak256(abi.encode(creator, userSalt)) = keccak256(64 bytes)
//   [0..31]  = creatorPadded
//   [32..63] = userSalt
const saltPreimage = new Uint8Array(64);
saltPreimage.set(creatorPadded, 0);

// CREATE2 address preimage: keccak256(85 bytes)
//   [0]      = 0xff
//   [1..20]  = factory address
//   [21..52] = salt (filled each iteration)
//   [53..84] = initCodeHash
const addrPreimage = new Uint8Array(85);
addrPreimage[0] = 0xff;
addrPreimage.set(factoryBytes, 1);
addrPreimage.set(initCodeHash, 53);

// ── Mining loop ────────────────────────────────────────────────────────────────

const userSalt   = new Uint8Array(32);
const saltBase   = randomBytes(28);
userSalt.set(saltBase, 0);

let counter  = 0;
let attempts = 0;

while (true) {
  // Fill last 4 bytes of userSalt with counter (big-endian).
  userSalt[28] = (counter >>> 24) & 0xff;
  userSalt[29] = (counter >>> 16) & 0xff;
  userSalt[30] = (counter >>>  8) & 0xff;
  userSalt[31] =  counter         & 0xff;
  counter++;

  // CREATE2 salt = keccak256(abi.encode(creator, userSalt))
  saltPreimage.set(userSalt, 32);
  const salt = keccak256(saltPreimage, "bytes");

  // Compute CREATE2 address hash.
  addrPreimage.set(salt, 21);
  const addrHash = keccak256(addrPreimage, "bytes");

  // addrHash[12..31] = predicted address (20 bytes).
  // Last 2 bytes of address = addrHash[30] and addrHash[31].
  attempts++;

  if (addrHash[30] === 0x11 && addrHash[31] === 0x11) {
    parentPort!.postMessage({
      type:             "found",
      salt:             bytesToHex(userSalt),
      predictedAddress: ("0x" + Buffer.from(addrHash.slice(12)).toString("hex")),
      attempts,
    });
    process.exit(0);
  }

  if (attempts % 50_000 === 0) {
    parentPort!.postMessage({ type: "progress", attempts });
  }

  // Reseed when the 4-byte counter overflows (every 4 billion iterations).
  if (counter > 0xffffffff) {
    counter = 0;
    const newBase = randomBytes(28);
    userSalt.set(newBase, 0);
  }
}

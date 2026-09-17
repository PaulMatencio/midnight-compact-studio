# Technical Documentation & Client SDK: `fungible-token-v2-4`

---

## Part 1: Comprehensive SDK Documentation

### 1. Contract Overview & Architecture

The `fungible-token-v2-4` smart contract implements a privacy-preserving standard fungible token for the Midnight Network, featuring an **OpenZeppelin-inspired threshold multi-signature governance system** alongside zero-knowledge caller authentication, administrative recovery, and emergency stop controls.

In `v2-4`, sensitive administrative operations—specifically **token minting**, **account burning**, and **designating the emergency pauser**—are no longer governed by a single owner key. Instead, they require cryptographic authorization from a threshold of registered signers (2-of-3) verified inside a zero-knowledge circuit.

#### Public Ledger State Schema (`export ledger`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Token balances indexed by 32-byte derived account public identities |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Spending allowances mapped by `[owner, spender]` pairs |
| `_totalSupply` | `Uint<128>` | Total active token supply in circulation |
| `_maxSupply` | `Uint<128>` | Maximum cap for token supply (`2^128 - 1` if uncapped) |
| `_name` | `Opaque<"string">` | Token name descriptor |
| `_symbol` | `Opaque<"string">` | Token ticker symbol |
| `_decimals` | `Uint<8>` | Unit scale decimal precision |
| `owner` | `Bytes<32>` | Derived account identity of the contract deployer / administrator |
| `_contractSalt` | `Bytes<32>` | Unique deployment salt binding caller identity and signer derivation |
| `_paused` | `Boolean` | Circuit breaker status flag |
| `_emergencyPauser` | `Bytes<32>` | Designated secondary role authorized to trigger emergency pauses |
| `_multisigSigners` | `Set<Bytes<32>>` | Set of 32-byte cryptographic commitments of registered multi-sig signers |
| `_multisigThreshold` | `Uint<8>` | Number of required valid approvals (e.g. 2) |
| `_multisigSignerCount` | `Uint<8>` | Total number of authorized signers registered on the contract (e.g. 3) |
| `_multisigNonce` | `Counter` | Monotonically increasing counter preventing operation replay attacks |

#### Private State & Witness Specification

- **Witness `localSecretKey(): Bytes<32>`**: Supplies the caller's 32-byte private key for individual account authorization.
- **Witness `getSchnorrReduction(challengeHash: bigint): [bigint, bigint]`**: Decomposes the full 256-bit Fiat-Shamir challenge hash into quotient and remainder modulo $2^{248}$, allowing Jubjub scalar curve arithmetic:
  $$\text{challengeHash} = q \cdot 2^{248} + r, \quad r \in [0, 2^{248}-1]$$

#### Zero-Knowledge Circuits & Access Controls

| Circuit | Authorization Type | Description |
| :--- | :--- | :--- |
| `mint(to, value, pubkeys, sigs)` | **Threshold Multi-Sig (2-of-N)** | Mints new tokens up to `_maxSupply` |
| `burn(account, value, pubkeys, sigs)` | **Threshold Multi-Sig (2-of-N)** | Burns tokens from specified account |
| `setEmergencyPauser(newPauser, pubkeys, sigs)`| **Threshold Multi-Sig (2-of-N)** | Updates the emergency pauser role |
| `selfBurn(caller, value)` | `authenticate(caller)` | Voluntary token burning by token holder |
| `transfer(caller, to, value)` | `authenticate(caller)` | Transfers tokens to recipient |
| `approve(caller, spender, value)` | `authenticate(caller)` | Grants spender allowance over caller's balance |
| `transferFrom(caller, from, to, value)` | `authenticate(caller)` | Spends granted allowance to transfer tokens |
| `pause(caller)` | `onlyPauser` (owner or pauser) | Halts token transfers, minting, and burning |
| `unpause(caller)` | `onlyPauser` (owner or pauser) | Resumes token operations |
| `adminReallocate(caller, trapped, target, val)`| `onlyOwner` | Rescues tokens from locked/inaccessible accounts |
| `emergencyWithdraw(caller, token, amount)` | `onlyOwner`, `whenPaused` | Rescues contract-held balances during emergency |
| `getMultisigNonce()` | Public View | Queries current multi-sig operation nonce |
| `getMultisigThreshold()` | Public View | Queries required approval threshold |
| `getMultisigSignerCount()` | Public View | Queries total registered signers count |
| `isMultisigSigner(commitment)` | Public View | Verifies if a commitment is a registered signer |
| `calculateSignerCommitment(pk, salt)` | Pure Circuit | Computes signer commitment from Jubjub public key |

---

### 2. Privacy-Preserving Multi-Sig Architecture

#### The Paradigm Shift: Off-Chain Consensus with Zero On-Chain Voting Trail

Traditional EVM multi-signature contracts (e.g. Gnosis Safe) force signers to submit public on-chain transactions to propose and vote, exposing signer identities, timestamps, and voting behavior.

Midnight's privacy-preserving multi-sig preset replaces this with **off-chain consensus**:
1. Signers coordinate and produce Schnorr signatures over a domain-separated digest **off-chain**.
2. A single zero-knowledge transaction is submitted containing the action parameters, public keys, and signatures.
3. The zero-knowledge circuit verifies inside the ZK proof:
   - Each public key hashes to an active commitment in `_multisigSigners`.
   - Signers are distinct (duplicate signer attacks are prevented).
   - Signatures are mathematically valid over the canonical operation digest.
   - Required threshold ($\ge 2$) is met.
4. The operation executes atomically in one transaction with **zero intermediate on-chain voting trail**.

#### Operation Digests & Domain Separation

Every multi-sig operation digest binds strictly to the contract instance and the operation counter:

- **Mint Digest**:
  $$\text{msgHash} = \text{persistentHash}([\text{"multisig:mint:"}, \text{contractAddress}, \text{nonce}, \text{to}, \text{amount}])$$
- **Burn Digest**:
  $$\text{msgHash} = \text{persistentHash}([\text{"multisig:burn:"}, \text{contractAddress}, \text{nonce}, \text{account}, \text{amount}])$$
- **Set Pauser Digest**:
  $$\text{msgHash} = \text{persistentHash}([\text{"multisig:set-pauser:"}, \text{contractAddress}, \text{nonce}, \text{newPauser}])$$

Binding to `kernel.self().bytes` prevents cross-contract replay attacks, while `_multisigNonce` prevents replaying the same authorization payload.

---

### 3. Prerequisites & Installation

To install the required dependencies:

```bash
npm install @midnight-ntwrk/compact-runtime
npm install --save-dev typescript tsx @types/node vitest
```

Ensure your `tsconfig.json` targets `ES2022` or higher.

---

### 4. API Reference: `FungibleTokenV24Client`

The SDK provides the `FungibleTokenV24Client` class (also exported as `FungibleTokenV24SDK`).

#### Constructor & Initialization

```typescript
import { FungibleTokenV24Client } from '../src/client/fungible-token-v2-4-sdk.js';

const client = new FungibleTokenV24Client(
  defaultSecretKey,     // 32-byte secret key (Uint8Array or hex string)
  defaultContractSalt,  // 32-byte deployment salt
  customWitnesses       // Optional custom witnesses
);
```

#### Deploying with Multi-Sig Signers

```typescript
const initResult = client.initialState(
  constructorContext,
  salt,                 // 32-byte deployment salt
  initialOwner,         // Derived account of the deployer
  "Midnight Fungible Token",
  "MFT",
  8,                    // 8 decimals
  1_000_000_000_000n,   // Max supply
  [signerComm1, signerComm2, signerComm3], // Registered signer commitments
  2                     // Threshold: 2-of-3
);
```

#### Deriving Signer Commitments

```typescript
// Compute a signer's commitment from their Jubjub public key
const signerCommitment = FungibleTokenV24Client.calculateSignerCommitment(
  jubjubPublicKey,
  contractSalt
);
```

#### Multi-Sig Operation Digest Builders

```typescript
// Compute operation digests for off-chain signing:
const mintDigest = FungibleTokenV24Client.calculateMintDigest(
  contractAddress,
  nonce,
  recipientAccount,
  mintAmount
);

const burnDigest = FungibleTokenV24Client.calculateBurnDigest(
  contractAddress,
  nonce,
  targetAccount,
  burnAmount
);

const pauserDigest = FungibleTokenV24Client.calculateSetEmergencyPauserDigest(
  contractAddress,
  nonce,
  newPauserAccount
);
```

#### Executing Multi-Sig Mint

```typescript
const result = client.mint(
  circuitContext,
  recipientAccount,
  mintAmount,
  [signer1PubKey, signer2PubKey],    // 2 distinct signers
  [signer1Signature, signer2Signature] // 2 valid Schnorr signatures
);
```

---

### 5. Step-by-Step Quickstart Example

Save the following executable script to `examples/fungible-token-v2-4-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  createCircuitContext,
  createConstructorContext,
} from '@midnight-ntwrk/compact-runtime';

import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
  type SchnorrSignature,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('--- Initializing FungibleToken v2.4 SDK ---');

  const contractSalt = new Uint8Array(32).fill(1);
  const ownerSk = new Uint8Array(32).fill(7);
  const client = new FungibleTokenV24Client(ownerSk, contractSalt);

  const ownerAccount = client.getAuthenticatedCaller(ownerSk);
  console.log('Owner Account Commitment Derived:', Buffer.from(ownerAccount).toString('hex'));

  // Define 3 signer public keys (Jubjub points on curve)
  // For demonstration: using mock generator points
  const signer1Pk = { x: 100n, y: 200n };
  const signer2Pk = { x: 300n, y: 400n };
  const signer3Pk = { x: 500n, y: 600n };

  // Calculate commitments
  const comm1 = FungibleTokenV24Client.calculateSignerCommitment(signer1Pk, contractSalt);
  const comm2 = FungibleTokenV24Client.calculateSignerCommitment(signer2Pk, contractSalt);
  const comm3 = FungibleTokenV24Client.calculateSignerCommitment(signer3Pk, contractSalt);

  console.log('Signer 1 Commitment:', Buffer.from(comm1).toString('hex'));
  console.log('Signer 2 Commitment:', Buffer.from(comm2).toString('hex'));
  console.log('Signer 3 Commitment:', Buffer.from(comm3).toString('hex'));

  // Initialize contract state
  const constructorCtx = createConstructorContext<FungibleTokenV24PrivateState>({
    secretKey: ownerSk,
  });

  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    'Privacy MultiSig Token',
    'PMT',
    8,
    1_000_000_000n,
    [comm1, comm2, comm3],
    2 // Threshold: 2 of 3
  );

  let currentChargedState = initResult.currentContractState.data;
  let ledgerState = client.queryLedgerState(currentChargedState);

  console.log('Contract Initialized:');
  console.log(' - Name:', ledgerState._name);
  console.log(' - Symbol:', ledgerState._symbol);
  console.log(' - Total Supply:', ledgerState._totalSupply.toString());
  console.log(' - Multisig Threshold:', ledgerState._multisigThreshold.toString());
  console.log(' - Multisig Signer Count:', ledgerState._multisigSignerCount.toString());
  console.log(' - Multisig Nonce:', ledgerState._multisigNonce.toString());

  console.log('\n--- Quickstart Successfully Finished ---');
}

main().catch(console.error);
```

---

### 6. Security & Best Practices

1. **Keep Private Keys Strictly Off-Chain**:
   Never disclose `secretKey` or signer private scalars in public circuits or state. The SDK provides `localSecretKey` and `getSchnorrReduction` witnesses which execute entirely in local client memory.
2. **Prevent Replay Attacks**:
   Always query `getMultisigNonce()` prior to constructing an operation digest. Every successful execution of `mint`, `burn`, or `setEmergencyPauser` automatically increments `_multisigNonce`.
3. **Instance Salt Binding**:
   Always pass the contract's actual `_contractSalt` when deriving signer commitments with `calculateSignerCommitment(pk, salt)`.
4. **Distinct Signers Enforced**:
   The circuit asserts that `pubkeys[0] != pubkeys[1]`. Submitting signatures from the same public key twice will fail proof generation.

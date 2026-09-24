# Deliverable 1: Comprehensive Technical Documentation

## 1. Contract Overview & Architecture

The `fungible-token-v2-4` smart contract implements an OpenZeppelin-inspired fungible token specification enhanced with Zero-Knowledge (ZK) caller authentication, emergency circuit breakers, and an on-chain threshold multi-signature governance protocol.

Unlike account models in transparent blockchains where transactions publicly reveal the sender's public key or address, this contract uses zero-knowledge proofs over Jubjub elliptic curve primitives and Poseidon-based persistent hashing to hide caller keys while enforcing strict ledger-level access controls.

```
                      +-----------------------------------+
                      |   Client-Side ZK Circuit Prover   |
                      +-----------------------------------+
                                        |
                 [Private Inputs]       |       [Witness Query]
                 - Secret Key           |       - localSecretKey()
                 - Schnorr Signatures   |       - getSchnorrReduction()
                                        v
                      +-----------------------------------+
                      |   Zero-Knowledge Proof (Plonk)    |
                      +-----------------------------------+
                                        |
                       Public Broadcast | Compact Verifier
                                        v
+-------------------------------------------------------------------------------+
|                             Public On-Chain Ledger                            |
|                                                                               |
|  Balances & Allowances       Governance Engine           Emergency State      |
|  - _balances                 - _multisigSigners (Set)    - _paused            |
|  - _allowances               - _multisigThreshold        - _emergencyPauser   |
|  - _totalSupply              - _multisigNonce            - owner              |
|  - _maxSupply                                            - _contractSalt      |
+-------------------------------------------------------------------------------+
```

### Public Ledger State Schema

| Field | Compact Type | TypeScript / SDK Type | Description |
|---|---|---|---|
| `_balances` | `Map<Bytes<32>, Uint<128>>` | `Ledger["_balances"]` | Maps derived account identities to their token balance. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | `Ledger["_allowances"]` | Maps `[owner, spender]` identity pairs to approved spend limits. |
| `_totalSupply` | `Uint<128>` | `bigint` | Current circulating supply of tokens. |
| `_maxSupply` | `Uint<128>` | `bigint` | Supply cap ($2^{128} - 1$ denotes uncapped). |
| `_name` | `Opaque<"string">` | `string` | Human-readable token name. |
| `_symbol` | `Opaque<"string">` | `string` | Ticker symbol. |
| `_decimals` | `Uint<8>` | `bigint` | Token decimal precision. |
| `owner` | `Bytes<32>` | `Uint8Array` (32 bytes) | Administrative authority for recovery and pause controls. |
| `_contractSalt` | `Bytes<32>` | `Uint8Array` (32 bytes) | Deployment salt isolating derived accounts and replay attacks. |
| `_paused` | `Boolean` | `boolean` | Circuit-breaker toggle flag. |
| `_emergencyPauser` | `Bytes<32>` | `Uint8Array` (32 bytes) | Identity authorized to toggle pause state alongside the owner. |
| `_multisigSigners` | `Set<Bytes<32>>` | `Ledger["_multisigSigners"]` | Registered 32-byte commitments of authorized Jubjub signers. |
| `_multisigThreshold` | `Uint<8>` | `bigint` | Required distinct signatures for governed administrative actions. |
| `_multisigSignerCount` | `Uint<8>` | `bigint` | Number of initialized signers on the contract. |
| `_multisigNonce` | `Counter` | `bigint` | Replay protection counter for governed actions (`mint`, `burn`, etc.). |

---

### Private State & Witness Specification

1. **`witness localSecretKey(): Bytes<32>`**
   - **Purpose**: Retrieves the 32-byte private spending key of the active caller executing an authenticated circuit (`transfer`, `approve`, `transferFrom`, `pause`, etc.).
   - **Security Considerations**: The raw secret key is never leaked to the ledger. The circuit computes `persistentHash([pad(32, "fungible-token:auth"), _contractSalt, sk])` inside the ZK prover and only verifies that the derived hash equals the target account parameter.

2. **`witness getSchnorrReduction(challengeHash: Field): [Field, Uint<248>]`**
   - **Purpose**: Deconstructs the full 256-bit challenge hash into integer quotient `q` and 248-bit truncated remainder `cTruncated` such that:
     $$\text{challengeHash} = q \cdot 2^{248} + c_{\text{truncated}}$$
   - **Security Considerations**: Ensures Schnorr scalar arithmetic on the Jubjub curve fits within the Jubjub scalar subgroup order without field overflow.

---

### Zero-Knowledge Circuits & Execution Constraints

| Circuit | Access / Modifiers | Description & Assertions |
|---|---|---|
| `mint(to, value, pubkeys, signatures)` | Multi-Sig Governed, `whenNotPaused` | Verifies 2-of-N threshold Schnorr signatures over operation hash, increments `_multisigNonce`, increases balance and `_totalSupply`. |
| `burn(account, value, pubkeys, signatures)` | Multi-Sig Governed, `whenNotPaused` | Verifies threshold multi-sig, decrements target balance and `_totalSupply`. |
| `setEmergencyPauser(newPauser, pubkeys, signatures)` | Multi-Sig Governed | Verifies threshold multi-sig, updates `_emergencyPauser`. |
| `transfer(caller, to, value)` | `authenticate(caller)`, `whenNotPaused` | Verifies caller secret key, updates balances. |
| `approve(caller, spender, value)` | `authenticate(caller)`, `whenNotPaused` | Verifies caller secret key, sets allowance mapping. |
| `transferFrom(caller, fromAccount, to, value)` | `authenticate(caller)`, `whenNotPaused` | Decrements allowance granted by `fromAccount` to `caller`, executes transfer. |
| `selfBurn(caller, value)` | `authenticate(caller)`, `whenNotPaused` | Voluntary burn by token holder of their own tokens. |
| `pause(caller)` / `unpause(caller)` | `onlyPauser(caller)` | Toggles `_paused` flag. Permitted only to `owner` or `_emergencyPauser`. |
| `adminReallocate(caller, trappedAccount, targetSpendableAccount, amount)` | `onlyOwner(caller)` | Administrative balance transfer for account recovery. |
| `emergencyWithdraw(caller, token, amount)` | `onlyOwner(caller)`, `whenPaused` | Rescues contract-held balances when contract is paused. |

---

## 2. Prerequisites & Installation

To install dependencies and build the client SDK, execute:

```bash
# scripts/fungible-token-v2-4-install.sh
#!/usr/bin/env bash
set -euo pipefail

npm install \
  @midnight-ntwrk/compact-runtime@^0.8.1 \
  @midnight-ntwrk/ledger@^0.8.1 \
  tsx \
  typescript
```

Ensure the compiled Compact contract artifacts reside in:
`contracts/managed/fungible-token-v2-4/contract/index.js`

---

## 3. API Reference & Caller Authentication

### Caller Authentication & Identity Derivation

All token-holder circuits enforce caller identity using the internal circuit:

```compact
circuit authenticate(account: Bytes<32>): [] {
  const sk = localSecretKey();
  const domainTag = pad(32, "fungible-token:auth");
  const derivedAccount = persistentHash<[Bytes<32>, Bytes<32>, Bytes<32>]>([
    domainTag,
    _contractSalt,
    sk
  ]);
  assert(derivedAccount == account, "FungibleToken: caller authorization failed");
}
```

#### Replay Protection Architecture
The `_contractSalt` field binds an account's derived on-chain identity to the specific contract instance. Even if a user utilizes the same private key `sk` across multiple deployed contracts on Midnight, their derived identity `account` is cryptographically distinct on each contract, preventing cross-contract transaction replay.

#### Cryptographic Hash Function Warning
Compact's `persistentHash` does not use standard SHA-256; it uses an algebraic Poseidon-based hash over the Jubjub base field. Therefore, **never use Node.js `crypto.createHash('sha256')`** to calculate account commitments. The SDK dynamically leverages the runtime contract's underlying `_persistentHash_1` implementation to mirror on-chain calculation accurately.

#### Identity Utility API

```typescript
// Deriving an account commitment
const account = FungibleTokenV24Client.deriveAccount(userSecretKey, contractSalt);

// Verifying authorization
const isAuthorized = FungibleTokenV24Client.isAuthorized(userSecretKey, targetAccount, contractSalt);

// Assembling witness bindings
const witnesses = FungibleTokenV24Client.createWitnesses(userSecretKey);
```

> **Warning**: When initializing the contract via `initialState`, set `initialOwner` and `_emergencyPauser` to `deriveAccount(deployerSecretKey, contractSalt)`, **not** a raw public key or random hex string. Failure to do so will permanently lock administrative operations.

---

## 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following complete runnable script into `examples/fungible-token-v2-4-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import {
  CompactRuntime,
  type ConstructorContext,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('--- Initializing FungibleTokenV24 Contract ---');

  // 1. Mock context identifiers (32-byte hex strings in Midnight.js runtime)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  // 2. Secret keys and salt
  const ownerSk = new Uint8Array(32).fill(0xaa);
  const aliceSk = new Uint8Array(32).fill(0xbb);
  const contractSalt = new Uint8Array(32).fill(0x11);

  // 3. Derive on-chain identities using persistentHash
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSk, contractSalt);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSk, contractSalt);

  console.log('Owner Account Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // 4. Initial multi-sig signer commitments (mock)
  const mockSigners = [
    new Uint8Array(32).fill(0x01),
    new Uint8Array(32).fill(0x02),
    new Uint8Array(32).fill(0x03),
  ];

  // 5. Build constructor context and initialize state
  let privateState: FungibleTokenV24PrivateState = { secretKey: ownerSk };
  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);

  const client = new FungibleTokenV24Client({
    secretKey: ownerSk,
    defaultContractSalt: contractSalt,
    contractAddress,
    coinPublicKey,
  });

  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    'Privacy Midnight Token',
    'PMT',
    8n,
    1_000_000_00000000n, // Max supply
    mockSigners,
    2n // Threshold = 2
  );

  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;

  // 6. Inspect initialized ledger state
  let ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Token Name:', ledgerState._name);
  console.log('Token Symbol:', ledgerState._symbol);
  console.log('Total Supply:', ledgerState._totalSupply);
  console.log('Threshold:', client.getMultisigThreshold(ledgerState));

  // 7. Demonstrate Pause Circuit Execution
  console.log('\n--- Executing Pause Circuit ---');
  let circuitCtx: CircuitContext<FungibleTokenV24PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  const pauseResult = client.pause(circuitCtx, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;
  privateState = pauseResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Is Paused after pause():', ledgerState._paused);

  // 8. Demonstrate Unpause Circuit Execution
  console.log('\n--- Executing Unpause Circuit ---');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const unpauseResult = client.unpause(circuitCtx, ownerAccount);
  currentChargedState = unpauseResult.context.currentQueryContext.state;
  privateState = unpauseResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Is Paused after unpause():', ledgerState._paused);
  console.log('\nContract executed successfully!');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

## 5. Privacy & Security Notes

1. **Private State Immutability**: Witness functions must treat `privateState` as immutable, returning a new instance on state mutations to maintain deterministic proof generation.
2. **Side-Channel Disclosures**: Any parameter passed into a circuit and assigned to an `export ledger` field is wrapped in `disclose(...)`. Keep sensitive payloads (such as raw credentials or blinding factors) inside private witnesses or un-disclosed constraints.
3. **Threshold Replay Protection**: Multi-sig operations enforce strict replay defenses by binding the digest to `kernel.self().bytes` and the auto-incrementing `_multisigNonce`. Operations cannot be applied to alternate token deployments or executed more than once.

---

# Deliverable 2: Production TypeScript Client SDK Implementation

```typescript
// src/client/fungible-token-v2-4-sdk.ts

import {
  type CircuitContext,
  type QueryContext,
  type WitnessContext,
  type ConstructorContext,
  type ConstructorResult,
  type CircuitResults,
  type StateValue,
  type ChargedState,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  pureCircuits,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-4/contract/index.js';

/**
 * Jubjub Schnorr signature structure matching Compact contract definition.
 */
export type SchnorrSignature = {
  announcement: JubjubPoint;
  response: bigint;
};

/**
 * Client private state interface holding off-chain credentials.
 */
export interface FungibleTokenV24PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Public ledger state interface mapped from compiled Compact ledger.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Strictly-typed witness interface parameterized over private state PS.
 */
export interface FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
  getSchnorrReduction: (
    context: WitnessContext<ContractLedger, PS>,
    challengeHash: bigint
  ) => [PS, [bigint, bigint]];
}

/**
 * Client initialization configuration options.
 */
export interface FungibleTokenV24ClientConfig {
  secretKey?: Uint8Array | string;
  defaultContractSalt?: Uint8Array | string;
  contractAddress?: string;
  coinPublicKey?: string;
}

/**
 * Production TypeScript SDK Client for fungible-token-v2-4.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  private readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;
  public readonly contractAddress: string;
  public readonly coinPublicKey: string;

  public constructor(config: FungibleTokenV24ClientConfig = {}) {
    const skBytes = config.secretKey ? FungibleTokenV24Client.toBytes32(config.secretKey) : new Uint8Array(32);
    this.defaultContractSalt = config.defaultContractSalt
      ? FungibleTokenV24Client.toBytes32(config.defaultContractSalt)
      : new Uint8Array(32);
    this.contractAddress = config.contractAddress ?? '00'.repeat(32);
    this.coinPublicKey = config.coinPublicKey ?? '01'.repeat(32);

    const witnesses = FungibleTokenV24Client.createWitnesses<PS>(skBytes);
    this.contract = new ManagedContract(witnesses as unknown as ContractWitnesses<PS>);
  }

  // ==========================================
  // Cryptographic & Account Utilities
  // ==========================================

  /**
   * Converts a 32-byte hex string or Uint8Array into a strict Uint8Array of length 32.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (cleanHex.length !== 64) {
        throw new Error(`Invalid hex length for Bytes<32>: expected 64 characters, received ${cleanHex.length}`);
      }
      const buffer = Buffer.from(cleanHex, 'hex');
      const out = new Uint8Array(32);
      out.set(buffer);
      return out;
    }
    if (input.length !== 32) {
      throw new Error(`Invalid Uint8Array length for Bytes<32>: expected 32 bytes, received ${input.length}`);
    }
    return new Uint8Array(input);
  }

  /**
   * Derives the on-chain account commitment for a secret key bound to a contract salt.
   * Uses persistentHash([domainTag, salt, sk]) matching the Compact authenticate circuit.
   */
  public static deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt: string | Uint8Array = new Uint8Array(32)
  ): Uint8Array {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV24Client.toBytes32(contractSalt);
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
        getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
      } as any);

      if (typeof (dummy as any)._persistentHash_1 === 'function') {
        try {
          return (dummy as any)._persistentHash_1([domainTag, saltBytes, skBytes]);
        } catch {
          return (dummy as any)._persistentHash_1([domainTag, { bytes: saltBytes }, skBytes]);
        }
      }
      const proto = Object.getPrototypeOf(dummy);
      const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
      for (const m of hashMethods) {
        try {
          const r = (dummy as any)[m]([domainTag, saltBytes, skBytes]);
          if (r instanceof Uint8Array && r.length === 32) return r;
        } catch {}
        try {
          const r = (dummy as any)[m]([domainTag, { bytes: saltBytes }, skBytes]);
          if (r instanceof Uint8Array && r.length === 32) return r;
        } catch {}
      }
    } catch (err) {
      throw new Error(`Failed to resolve Compact persistentHash for account derivation: ${String(err)}`);
    }
    throw new Error('Failed to resolve Compact persistentHash for account derivation');
  }

  /**
   * Derives an account identity using this client instance's default contract salt.
   */
  public deriveAccount(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return FungibleTokenV24Client.deriveAccount(secretKey, contractSalt ?? this.defaultContractSalt);
  }

  /**
   * Returns the caller identity commitment derived from the provided secret key.
   */
  public getAuthenticatedCaller(secretKey: Uint8Array | string, contractSalt?: string | Uint8Array): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt ?? this.defaultContractSalt);
  }

  /**
   * Verifies if a private secret key produces the expected on-chain target account commitment.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array
  ): boolean {
    const derived = FungibleTokenV24Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV24Client.toBytes32(targetAccount);
    for (let i = 0; i < 32; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Builds default witnesses providing caller authentication and Schnorr 248-bit reduction.
   */
  public static createWitnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<PS> {
    const fallbackSk = FungibleTokenV24Client.toBytes32(secretKey);
    const TWO_248 = 1n << 248n;

    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const sk = context.privateState?.secretKey ?? fallbackSk;
        return [context.privateState, sk];
      },
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, PS>,
        challengeHash: bigint
      ): [PS, [bigint, bigint]] => {
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      },
    };
  }

  // ==========================================
  // Multi-Sig Helper & Digest Computations
  // ==========================================

  /**
   * Calculates signer commitment: persistentHash([pad(32, "multisig:signer:"), salt, pk_x, pk_y])
   */
  public calculateSignerCommitment(pk: JubjubPoint, salt?: Uint8Array | string): Uint8Array {
    const saltBytes = salt ? FungibleTokenV24Client.toBytes32(salt) : this.defaultContractSalt;
    return pureCircuits.calculateSignerCommitment(pk, saltBytes);
  }

  /**
   * Constructs the operation digest for multi-sig mint.
   */
  public calculateMintDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    to: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = this.contract as any;
    const tag = new Uint8Array(32);
    tag.set(Buffer.from('multisig:mint:', 'utf-8'));
    const addrBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const toBytes = FungibleTokenV24Client.toBytes32(to);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const vec = [tag, addrBytes, nonceBytes, toBytes, amountBytes];
    if (typeof dummy._persistentHash_0 === 'function') {
      return dummy._persistentHash_0(vec);
    }
    throw new Error('Compact runtime persistentHash for mint digest not available');
  }

  /**
   * Constructs the operation digest for multi-sig burn.
   */
  public calculateBurnDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    account: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = this.contract as any;
    const tag = new Uint8Array(32);
    tag.set(Buffer.from('multisig:burn:', 'utf-8'));
    const addrBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const accountBytes = FungibleTokenV24Client.toBytes32(account);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const vec = [tag, addrBytes, nonceBytes, accountBytes, amountBytes];
    if (typeof dummy._persistentHash_0 === 'function') {
      return dummy._persistentHash_0(vec);
    }
    throw new Error('Compact runtime persistentHash for burn digest not available');
  }

  /**
   * Constructs the operation digest for multi-sig setEmergencyPauser.
   */
  public calculateSetEmergencyPauserDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    newPauser: Uint8Array | string
  ): Uint8Array {
    const dummy = this.contract as any;
    const tag = new Uint8Array(32);
    tag.set(Buffer.from('multisig:set-pauser:', 'utf-8'));
    const addrBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const pauserBytes = FungibleTokenV24Client.toBytes32(newPauser);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const vec = [tag, addrBytes, nonceBytes, pauserBytes];
    if (typeof dummy._persistentHash_3 === 'function') {
      return dummy._persistentHash_3(vec);
    }
    throw new Error('Compact runtime persistentHash for setEmergencyPauser digest not available');
  }

  // ==========================================
  // Ledger State Queries
  // ==========================================

  /**
   * Decodes a raw Compact ledger state value into typed ledger state.
   */
  public queryLedgerState(rawState: StateValue | ChargedState | unknown): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Inspects multi-sig nonce from public ledger state.
   */
  public getMultisigNonce(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = 'currentQueryContext' in (ledgerState as any)
      ? this.queryLedgerState((ledgerState as any).currentQueryContext.state)
      : '_multisigNonce' in (ledgerState as any)
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerState(ledgerState);
    return state._multisigNonce;
  }

  /**
   * Inspects multi-sig threshold from public ledger state.
   */
  public getMultisigThreshold(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = '_multisigThreshold' in (ledgerState as any)
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerState(ledgerState);
    return state._multisigThreshold;
  }

  /**
   * Inspects multi-sig signer count from public ledger state.
   */
  public getMultisigSignerCount(ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown): bigint {
    const state = '_multisigSignerCount' in (ledgerState as any)
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerState(ledgerState);
    return state._multisigSignerCount;
  }

  /**
   * Checks whether a 32-byte commitment is registered in _multisigSigners.
   */
  public isMultisigSigner(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    commitment: Uint8Array | string
  ): boolean {
    const state = '_multisigSigners' in (ledgerState as any)
      ? (ledgerState as FungibleTokenV24LedgerState)
      : this.queryLedgerState(ledgerState);
    const commBytes = FungibleTokenV24Client.toBytes32(commitment);
    return state._multisigSigners.member(commBytes);
  }

  // ==========================================
  // Lifecycle & Circuit Execution
  // ==========================================

  /**
   * Executes contract initialization constructor.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: bigint | number,
    maxSupply: bigint | number,
    initialSigners: Array<Uint8Array | string>,
    threshold: bigint | number
  ): ConstructorResult<PS> {
    if (initialSigners.length !== 3) {
      throw new Error(`initialSigners must contain exactly 3 signers, got ${initialSigners.length}`);
    }

    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV24Client.toBytes32(initialOwner);
    const signersArray = initialSigners.map((s) => FungibleTokenV24Client.toBytes32(s));

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      signersArray,
      BigInt(threshold)
    );
  }

  /**
   * Governed mint authorized by threshold multi-sig.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('mint requires exactly 2 public keys and 2 signatures');
    }
    return this.contract.circuits.mint(
      context,
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Governed burn authorized by threshold multi-sig.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('burn requires exactly 2 public keys and 2 signatures');
    }
    return this.contract.circuits.burn(
      context,
      FungibleTokenV24Client.toBytes32(account),
      BigInt(value),
      pubkeys,
      signatures
    );
  }

  /**
   * Governed update of emergency pauser authorized by threshold multi-sig.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    newPauser: Uint8Array | string,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('setEmergencyPauser requires exactly 2 public keys and 2 signatures');
    }
    return this.contract.circuits.setEmergencyPauser(
      context,
      FungibleTokenV24Client.toBytes32(newPauser),
      pubkeys,
      signatures
    );
  }

  /**
   * Pauses all token operations. Caller must be owner or emergency pauser.
   */
  public pause(context: CircuitContext<PS>, caller: Uint8Array | string): CircuitResults<PS, boolean> {
    return this.contract.circuits.pause(context, FungibleTokenV24Client.toBytes32(caller));
  }

  /**
   * Unpauses token operations. Caller must be owner or emergency pauser.
   */
  public unpause(context: CircuitContext<PS>, caller: Uint8Array | string): CircuitResults<PS, boolean> {
    return this.contract.circuits.unpause(context, FungibleTokenV24Client.toBytes32(caller));
  }

  /**
   * Transfers tokens from caller to recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transfer(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Sets allowance for a spender.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.approve(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(spender),
      BigInt(value)
    );
  }

  /**
   * Spends delegated allowance to transfer tokens.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transferFrom(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(fromAccount),
      FungibleTokenV24Client.toBytes32(to),
      BigInt(value)
    );
  }

  /**
   * Holder self-burn for destroying their own tokens.
   */
  public selfBurn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.selfBurn(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      BigInt(value)
    );
  }

  /**
   * Administrative reallocation of trapped tokens. Caller must be owner.
   */
  public adminReallocate(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    trappedAccount: Uint8Array | string,
    targetSpendableAccount: Uint8Array | string,
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.adminReallocate(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      FungibleTokenV24Client.toBytes32(trappedAccount),
      FungibleTokenV24Client.toBytes32(targetSpendableAccount),
      BigInt(amount)
    );
  }

  /**
   * Emergency withdrawal of stuck balances when paused. Caller must be owner.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    token: { bytes: Uint8Array } | Uint8Array | string,
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    const tokenObj = typeof token === 'object' && token !== null && 'bytes' in token
      ? (token as { bytes: Uint8Array })
      : { bytes: FungibleTokenV24Client.toBytes32(token as string | Uint8Array) };

    return this.contract.circuits.emergencyWithdraw(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      tokenObj,
      BigInt(amount)
    );
  }
}

export { FungibleTokenV24Client as FungibleTokenV24SDK };
```
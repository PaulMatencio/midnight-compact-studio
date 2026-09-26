# Technical Documentation & Production Client SDK: FungibleToken v2.4

---

## Part 1: Comprehensive SDK Documentation

### 1. Contract Overview & Architecture

The `FungibleToken v2.4` smart contract is an enterprise-grade, privacy-preserving token standard with OpenZeppelin-style threshold governance implemented in the **Midnight Compact** smart contract language (version >= 0.23). 

Key architectural pillars:
- **Zero-Knowledge Caller Authentication**: Users authenticate ownership of an account using private off-chain witnesses rather than public addresses or explicit transaction signatures.
- **Cross-Contract Replay Isolation**: Accounts are bound to a 32-byte contract salt (`_contractSalt`), preventing signatures and authentication proofs from being reused across different deployments.
- **Schnorr Threshold Multi-Sig Governance**: Critical administrative actions (`mint`, `burn`, `setEmergencyPauser`) require $M$-of-$N$ Schnorr signatures over Jubjub curve points.
- **Emergency Circuit Breakers**: Granular pause/unpause controls with designated pauser and emergency asset reallocation.

```
+-----------------------------------------------------------------------------------------+
|                                FungibleToken v2.4 (Ledger)                              |
+-----------------------------------------------------------------------------------------+
|  Public State:                                                                          |
|    - _balances: Map<Bytes<32>, Uint<128>>      - _allowances: Map<[B32, B32], Uint<128>>|
|    - _totalSupply: Uint<128>                   - _maxSupply: Uint<128>                  |
|    - _paused: Boolean                          - _emergencyPauser: Bytes<32>            |
|    - _multisigSigners: Set<Bytes<32>>          - _multisigThreshold: Uint<8>            |
|    - _multisigNonce: Counter                   - _contractSalt: Bytes<32>               |
+-----------------------------------------------------------------------------------------+
                                   ▲
                                   │ Zero-Knowledge Verification
                                   │
+----------------------------------┴------------------------------------------------------+
|                                   Client Prover Runtime                                 |
+-----------------------------------------------------------------------------------------+
|  Private Witnesses:                                                                     |
|    - localSecretKey(): Bytes<32>                                                        |
|    - getSchnorrReduction(challengeHash: Field): [Field, Uint<248>]                      |
|                                                                                         |
|  Circuits:                                                                              |
|    - transfer / approve / transferFrom / selfBurn  (Individual authentication)          |
|    - mint / burn / setEmergencyPauser              (Schnorr Multi-Sig threshold)        |
|    - pause / unpause / adminReallocate             (Owner / Pauser authentication)       |
+-----------------------------------------------------------------------------------------+
```

#### Public Ledger State Schema (`export ledger`)

| Field Name | Type | Description |
|---|---|---|
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Account balances indexed by derived account commitments |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Delegated spending caps keyed by `[owner, spender]` |
| `_totalSupply` | `Uint<128>` | Current active circulating token supply |
| `_maxSupply` | `Uint<128>` | Hard cap on total mintable tokens |
| `_name` | `Opaque<"string">` | Token name descriptor |
| `_symbol` | `Opaque<"string">` | Token ticker descriptor |
| `_decimals` | `Uint<8>` | Decimal precision (typically `18`) |
| `owner` | `Bytes<32>` | Derived commitment of the primary contract administrator |
| `_contractSalt` | `Bytes<32>` | Contract deployment salt ensuring domain separation |
| `_paused` | `Boolean` | Circuit breaker flag |
| `_emergencyPauser` | `Bytes<32>` | Account authorized to pause or unpause the contract |
| `_multisigSigners` | `Set<Bytes<32>>` | Set of registered 32-byte Schnorr signer commitments |
| `_multisigThreshold`| `Uint<8>` | Minimum valid signatures required (must be $\le 2$ for 2-of-$N$) |
| `_multisigSignerCount`| `Uint<8>` | Total count of registered initial signers |
| `_multisigNonce` | `Counter` | Monotonically increasing replay protection counter |

#### Private State & Witness Specification

1. `witness localSecretKey(): Bytes<32>`:
   Supplies the caller's 32-byte secret key off-chain. In the client SDK, witnesses return a tuple `[PrivateState, ReturnValue]`. The secret key never appears on the public ledger.
2. `witness getSchnorrReduction(challengeHash: Field): [Field, Uint<248>]`:
   Schnorr verification on Jubjub truncates challenges to 248 bits to prevent field overflow. This witness provides the Euclidean quotient and remainder of $c_{full} \div 2^{248}$ off-chain. The circuit checks $q \cdot 2^{248} + r == c_{full}$ and $r < 2^{248}$ via `Uint<248>` type constraints.

#### Zero-Knowledge Circuits (`export circuit`)

- **Governance Circuits**:
  - `mint(to, value, pubkeys, signatures)`: Mints tokens after verifying threshold Schnorr signatures.
  - `burn(account, value, pubkeys, signatures)`: Burns tokens strictly from the treasury/owner balance.
  - `setEmergencyPauser(newPauser, pubkeys, signatures)`: Rotates the emergency pauser.
- **Token Circuits**:
  - `transfer(caller, to, value)`: Authenticates `caller` via secret key commitment, deducts balance, and credits `to`.
  - `approve(caller, spender, value)`: Sets allowance for `spender`.
  - `transferFrom(caller, fromAccount, to, value)`: Spends allowance authorized by `fromAccount` on behalf of `caller`.
  - `selfBurn(caller, value)`: Allows any token holder to burn their own tokens.
- **Admin & Safety Circuits**:
  - `pause(caller)` / `unpause(caller)`: Halts or resumes token transfers.
  - `adminReallocate(caller, trappedAccount, targetSpendableAccount, amount)`: Reallocates balances from inaccessible accounts (owner-only).
  - `emergencyWithdraw(caller, token, amount)`: Emergency recovery of assets when paused.

---

### 2. Prerequisites & Installation

To prepare your build environment, create the installation script `scripts/fungible-token-v2-4-install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Installing Midnight Compact runtime and SDK dependencies..."
npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js \
  rxjs

npm install --save-dev \
  typescript \
  tsx \
  vitest \
  @types/node
```

Ensure `tsconfig.json` contains:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

### 3. API Reference & Caller Authentication

#### Dedicated Guide: Caller Authentication & Identity Derivation

Traditional blockchains identity is defined by a public address derived from an ECDSA/Ed25519 public key. On Midnight, privacy requires decoupling user transactions from permanent identities.

1. **Authentication Circuit (`authenticate`)**:
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
2. **Cryptographic Algorithm**:
   The circuit uses Midnight's algebraic Poseidon hash function `persistentHash` across:
   - Domain Tag: `pad(32, "fungible-token:auth")`
   - Contract Salt: `_contractSalt` (prevents cross-contract replay)
   - Secret Key: `sk` (32-byte secret witness)
3. **CRITICAL WARNING**:
   **NEVER use SHA-256 (`createHash('sha256')`) for account derivation!** SHA-256 will produce a bit string that does NOT match the algebraic Poseidon hash generated by `persistentHash`, causing `caller authorization failed` errors on every transaction. Always use `FungibleTokenV24Client.deriveAccount(secretKey, contractSalt)`.
4. **Deployer Initialization Warning**:
   When deploying or calling constructor initialization, `initialOwner` and `initialSigners` must be initialized with the derived commitment `deriveAccount(deployerSecretKey, contractSalt)`, **not** a raw public key or random bytes.

---

### 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following complete runnable script as `examples/fungible-token-v2-4-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV24 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-4-example.ts
 */

import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV24Client,
  type FungibleTokenV24PrivateState,
} from '../src/client/fungible-token-v2-4-sdk.js';

async function main() {
  console.log('=== Initializing FungibleToken v2.4 SDK Demonstration ===');

  // 1. Setup deterministic 32-byte hex mock addresses and keys
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const salt = new Uint8Array(32).fill(7);

  // User 1 (Deployer / Owner)
  const ownerSk = new Uint8Array(32).fill(1);
  const ownerAccount = FungibleTokenV24Client.deriveAccount(ownerSk, salt);

  // User 2 (Alice)
  const aliceSk = new Uint8Array(32).fill(2);
  const aliceAccount = FungibleTokenV24Client.deriveAccount(aliceSk, salt);

  // Dummy Multi-Sig Signer Commitments
  const signer1 = new Uint8Array(32).fill(11);
  const signer2 = new Uint8Array(32).fill(22);
  const signer3 = new Uint8Array(32).fill(33);

  console.log('Derived Owner Commitment:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Derived Alice Commitment:', Buffer.from(aliceAccount).toString('hex'));

  // 2. Build Constructor Context
  const initialPrivateState: FungibleTokenV24PrivateState = { secretKey: ownerSk };
  const witnesses = FungibleTokenV24Client.createWitnesses(ownerSk);
  const client = new FungibleTokenV24Client(witnesses, salt);

  const constructorCtx = CompactRuntime.createConstructorContext(
    initialPrivateState,
    coinPublicKey
  );

  const constructorArgs = [
    salt,
    ownerAccount,
    'Midnight Sovereign Token',
    'MST',
    18n,
    1_000_000_000n * 10n ** 18n,
    [signer1, signer2, signer3],
    2n,
  ];

  console.log('Executing contract constructor...');
  const initResult = client.initialState(constructorCtx, ...constructorArgs);

  // 3. Track On-Chain Charged State
  let currentChargedState = initResult.currentContractState.data;
  let currentPrivateState = initResult.currentPrivateState;

  // 4. Query Initial Ledger State
  let ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Token Name:', ledgerState._name);
  console.log('Token Symbol:', ledgerState._symbol);
  console.log('Multi-Sig Threshold:', client.getMultisigThreshold(ledgerState));
  console.log('Multi-Sig Nonce:', client.getMultisigNonce(ledgerState));

  // 5. Simulate Transfer Execution (Owner transfers to Alice)
  console.log('Executing transfer circuit (Owner -> Alice)...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    currentPrivateState
  );

  // Authenticate owner and transfer 100 units
  const transferAmount = 100n;
  const transferResult = client.transfer(
    circuitCtx,
    ownerAccount,
    aliceAccount,
    transferAmount
  );

  // Update charged state
  currentChargedState = transferResult.context.currentQueryContext.state;
  currentPrivateState = transferResult.context.currentPrivateState;

  ledgerState = client.queryLedgerState(currentChargedState);
  console.log('Alice Balance after Transfer:', client.getBalance(ledgerState, aliceAccount));
  console.log('Transfer executed successfully.');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

### 5. Privacy & Security Notes

1. **Private State Lifecycle**: Private state (such as `secretKey`) lives exclusively inside memory in client-side runtime storage. Never serialize private keys into logs or public error traces.
2. **Context Synchronization**: In multi-party or multi-caller simulations, always synchronize `circuitContext.currentPrivateState` when switching active caller profiles to prevent stale witness lookups.
3. **Replay Protection Scope**: The `_contractSalt` ensures proofs constructed for contract deployment `A` cannot be relayed to contract `B`. Ensure every production contract deployment utilizes a cryptographically random, globally unique 32-byte salt.

---

## Part 2: Production TypeScript Client SDK Implementation

Below is the production-grade TypeScript client SDK implementation for `src/client/fungible-token-v2-4-sdk.ts`:

```typescript
// SPDX-License-Identifier: Apache-2.0
/**
 * Production TypeScript Client SDK for FungibleToken v2.4 (Midnight Network)
 *
 * Provides strongly-typed circuit invocations, cryptographic witness builders,
 * algebraic Poseidon identity derivations, and multi-sig digest utilities.
 */

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

// ============ Data Types & Interfaces ============

/**
 * Off-chain private state holding caller credentials.
 */
export interface FungibleTokenV24PrivateState {
  readonly secretKey: Uint8Array;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Jubjub curve Schnorr Signature structure matching Compact export struct.
 */
export interface SchnorrSignature {
  announcement: JubjubPoint;
  response: bigint;
}

/**
 * Re-export Contract Ledger matching on-chain storage.
 */
export type FungibleTokenV24LedgerState = ContractLedger;

/**
 * Witness interface parameterizing ContractWitnesses with private state PS.
 */
export type FungibleTokenV24Witnesses<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> =
  ContractWitnesses<PS>;

// ============ High-Level SDK Client ============

/**
 * Production client SDK for interacting with the FungibleToken v2.4 smart contract.
 */
export class FungibleTokenV24Client<PS extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState> {
  protected readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Initializes the FungibleToken v2.4 Client.
   *
   * @param witnesses Concrete witness implementation providing private data
   * @param defaultContractSalt 32-byte deployment salt for domain-separated account derivations
   */
  constructor(
    witnesses: FungibleTokenV24Witnesses<PS>,
    defaultContractSalt: Uint8Array | string = new Uint8Array(32)
  ) {
    this.contract = new ManagedContract(witnesses);
    this.defaultContractSalt = FungibleTokenV24Client.toBytes32(defaultContractSalt);
  }

  // ============ Identity & Cryptographic Helpers ============

  /**
   * Converts a hex string or byte array into a strictly validated 32-byte Uint8Array.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const sanitized = input.startsWith('0x') ? input.slice(2) : input;
      if (sanitized.length !== 64) {
        throw new Error(`Expected 32-byte hex string (64 characters), got length ${sanitized.length}`);
      }
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        out[i] = parseInt(sanitized.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    if (input.length !== 32) {
      throw new Error(`Expected 32-byte Uint8Array, received length ${input.length}`);
    }
    return new Uint8Array(input);
  }

  /**
   * Derives an on-chain account commitment using the algebraic Poseidon hash
   * computed inside the Compact circuit:
   * persistentHash([pad(32, "fungible-token:auth"), contractSalt, secretKey])
   *
   * @param secretKey 32-byte private secret key
   * @param contractSalt 32-byte contract deployment salt
   * @returns 32-byte derived public account commitment
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
      const hashMethods = Object.getOwnPropertyNames(proto).filter((k) =>
        k.startsWith('_persistentHash')
      );
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
   * Instance method deriving an account commitment using the configured default contract salt.
   */
  public deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return FungibleTokenV24Client.deriveAccount(
      secretKey,
      contractSalt ?? this.defaultContractSalt
    );
  }

  /**
   * Retrieves the on-chain account corresponding to the supplied secret key.
   */
  public getAuthenticatedCaller(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Verifies if a secret key matches a target on-chain account commitment.
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
   * Factory producing canonical witness implementations for FungibleToken v2.4.
   */
  public static createWitnesses<P extends FungibleTokenV24PrivateState = FungibleTokenV24PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV24Witnesses<P> {
    const skBytes = FungibleTokenV24Client.toBytes32(secretKey);

    return {
      localSecretKey: (context: WitnessContext<ContractLedger, P>): [P, Uint8Array] => {
        return [context.privateState, context.privateState?.secretKey ?? skBytes];
      },
      getSchnorrReduction: (
        context: WitnessContext<ContractLedger, P>,
        challengeHash: bigint
      ): [P, [bigint, bigint]] => {
        const TWO_248 = 1n << 248n;
        const q = challengeHash / TWO_248;
        const r = challengeHash % TWO_248;
        return [context.privateState, [q, r]];
      },
    };
  }

  // ============ Multi-Sig Domain Digest Helpers ============

  /**
   * Calculates a multi-sig signer commitment via pure circuit export:
   * persistentHash([pad(32, "multisig:signer:"), salt, pk_x, pk_y])
   */
  public calculateSignerCommitment(
    pk: JubjubPoint,
    salt: Uint8Array | string = this.defaultContractSalt
  ): Uint8Array {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    return pureCircuits.calculateSignerCommitment(pk, saltBytes);
  }

  /**
   * Computes the domain-separated message hash for multi-sig token minting:
   * persistentHash([pad(32, "multisig:mint:"), contractAddress, nonce, to, amount])
   */
  public static calculateMintDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    to: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:mint:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const toBytes = FungibleTokenV24Client.toBytes32(to);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const hashInput = [domainTag, contractBytes, nonceBytes, toBytes, amountBytes];
    return (dummy as any)._persistentHash_2
      ? (dummy as any)._persistentHash_2(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  /**
   * Computes the domain-separated message hash for multi-sig token burning:
   * persistentHash([pad(32, "multisig:burn:"), contractAddress, nonce, account, amount])
   */
  public static calculateBurnDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    account: Uint8Array | string,
    amount: bigint | number
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:burn:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const accountBytes = FungibleTokenV24Client.toBytes32(account);
    const amountBytes = new Uint8Array(32);
    new DataView(amountBytes.buffer).setBigUint64(24, BigInt(amount), false);

    const hashInput = [domainTag, contractBytes, nonceBytes, accountBytes, amountBytes];
    return (dummy as any)._persistentHash_2
      ? (dummy as any)._persistentHash_2(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  /**
   * Computes the domain-separated message hash for multi-sig pauser rotation:
   * persistentHash([pad(32, "multisig:set-pauser:"), contractAddress, nonce, newPauser])
   */
  public static calculateSetEmergencyPauserDigest(
    contractAddress: string | Uint8Array,
    nonce: bigint | number,
    newPauser: Uint8Array | string
  ): Uint8Array {
    const dummy = new ManagedContract({
      localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
      getSchnorrReduction: (ctx: any) => [ctx.privateState, [0n, 0n]],
    } as any);

    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('multisig:set-pauser:', 'utf-8'));

    const contractBytes = FungibleTokenV24Client.toBytes32(contractAddress);
    const nonceBytes = new Uint8Array(32);
    new DataView(nonceBytes.buffer).setBigUint64(24, BigInt(nonce), false);

    const pauserBytes = FungibleTokenV24Client.toBytes32(newPauser);

    const hashInput = [domainTag, contractBytes, nonceBytes, pauserBytes];
    return (dummy as any)._persistentHash_3
      ? (dummy as any)._persistentHash_3(hashInput)
      : (dummy as any)._persistentHash_0(hashInput);
  }

  // ============ Contract Construction ============

  /**
   * Evaluates the contract constructor and returns the initial state values.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: bigint | number,
    initialSigners: (Uint8Array | string)[],
    threshold: number | bigint
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV24Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV24Client.toBytes32(initialOwner);
    const signersBytes = initialSigners.map((s) => FungibleTokenV24Client.toBytes32(s));

    if (signersBytes.length !== 3) {
      throw new Error(`Constructor requires exactly 3 initial signers; got ${signersBytes.length}`);
    }

    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply),
      signersBytes,
      BigInt(threshold)
    );
  }

  // ============ Circuit Invocations ============

  /**
   * Executes standard token transfer.
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
   * Approves spending allowance for a third-party spender.
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
   * Transfers tokens on behalf of another account using prior allowance.
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
   * Voluntary self-burn for token holders destroying their own balance.
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
   * Governed mint operation authorized via 2-of-N Schnorr threshold signatures.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('mint requires exactly 2 signers and signatures for threshold verification');
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
   * Governed burn operation authorized via 2-of-N Schnorr threshold signatures.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array | string,
    value: bigint | number,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('burn requires exactly 2 signers and signatures for threshold verification');
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
   * Designates a new emergency pauser authorized by threshold multi-sig.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    newPauser: Uint8Array | string,
    pubkeys: JubjubPoint[],
    signatures: SchnorrSignature[]
  ): CircuitResults<PS, boolean> {
    if (pubkeys.length !== 2 || signatures.length !== 2) {
      throw new Error('setEmergencyPauser requires exactly 2 signers and signatures');
    }
    return this.contract.circuits.setEmergencyPauser(
      context,
      FungibleTokenV24Client.toBytes32(newPauser),
      pubkeys,
      signatures
    );
  }

  /**
   * Pauses all token transfers and operations (Owner or Pauser only).
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.pause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Resumes contract operations from paused state (Owner or Pauser only).
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.unpause(
      context,
      FungibleTokenV24Client.toBytes32(caller)
    );
  }

  /**
   * Reallocates blocked balances from an inaccessible account (Owner only).
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
   * Recovers trapped funds during emergency pause (Owner only).
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    token: { bytes: Uint8Array },
    amount: bigint | number
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.emergencyWithdraw(
      context,
      FungibleTokenV24Client.toBytes32(caller),
      token,
      BigInt(amount)
    );
  }

  // ============ Ledger State Query Helpers ============

  /**
   * Parses raw state into typed Ledger representation.
   */
  public queryLedgerState(rawState: StateValue | ChargedState | unknown): FungibleTokenV24LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Queries the token balance of an account from typed or raw ledger state.
   */
  public getBalance(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    account: Uint8Array | string
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    const key = FungibleTokenV24Client.toBytes32(account);
    return state._balances.member(key) ? state._balances.lookup(key) : 0n;
  }

  /**
   * Queries spending allowance between an owner and a spender.
   */
  public getAllowance(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    ownerAccount: Uint8Array | string,
    spender: Uint8Array | string
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    const key: [Uint8Array, Uint8Array] = [
      FungibleTokenV24Client.toBytes32(ownerAccount),
      FungibleTokenV24Client.toBytes32(spender),
    ];
    return state._allowances.member(key) ? state._allowances.lookup(key) : 0n;
  }

  /**
   * Retrieves current multi-sig operation replay nonce.
   */
  public getMultisigNonce(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigNonce;
  }

  /**
   * Retrieves current multi-sig required signer threshold.
   */
  public getMultisigThreshold(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigThreshold;
  }

  /**
   * Retrieves total count of initial registered multi-sig signers.
   */
  public getMultisigSignerCount(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): bigint {
    const state = this.ensureLedgerState(ledgerState);
    return state._multisigSignerCount;
  }

  /**
   * Checks if a signer commitment is registered in the on-chain multi-sig signers set.
   */
  public isMultisigSigner(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown,
    signerCommitment: Uint8Array | string
  ): boolean {
    const state = this.ensureLedgerState(ledgerState);
    const commitmentBytes = FungibleTokenV24Client.toBytes32(signerCommitment);
    return state._multisigSigners.member(commitmentBytes);
  }

  /**
   * Checks whether the contract is currently paused.
   */
  public isPaused(
    ledgerState: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): boolean {
    const state = this.ensureLedgerState(ledgerState);
    return state._paused;
  }

  /**
   * Helper extracting a typed Ledger state instance.
   */
  private ensureLedgerState(
    state: FungibleTokenV24LedgerState | StateValue | ChargedState | unknown
  ): FungibleTokenV24LedgerState {
    if (state && typeof state === 'object' && '_balances' in state) {
      return state as FungibleTokenV24LedgerState;
    }
    return ledger(state as StateValue | ChargedState);
  }
}

// SDK Alias Export
export { FungibleTokenV24Client as FungibleTokenV24SDK };
```
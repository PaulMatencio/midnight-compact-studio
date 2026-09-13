# Technical Documentation & Client SDK: `fungible-token-v2-3`

---

## Part 1: Comprehensive SDK Documentation

### 1. Contract Overview & Architecture

The `fungible-token-v2-3` smart contract is an optimized, privacy-preserving standard fungible token with zero-knowledge authorization, administrative recovery mechanisms, and an emergency stop system.

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
| `owner` | `Bytes<32>` | Derived account identity of the contract administrator |
| `_contractSalt` | `Bytes<32>` | Unique deployment salt binding caller identity derivation |
| `_paused` | `Boolean` | Circuit breaker status flag |
| `_emergencyPauser` | `Bytes<32>` | Optional secondary role authorized to trigger emergency pauses |

#### Private State & Witness Specification

- **Witness `localSecretKey(): Bytes<32>`**: Supplies the caller's 32-byte private key into the zero-knowledge execution environment.
- **Circuit Authentication**: The circuit verifies caller authorization by deriving the account commitment on-chain:
  $$\text{derivedAccount} = \text{persistentHash}([\text{"fungible-token:auth"}, \_contractSalt, \text{sk}])$$
  The witness value (`sk`) remains completely off-chain and hidden within the ZK proof.

#### Zero-Knowledge Circuits & State Invariants

| Circuit | Permissions / Modifiers | Description |
| :--- | :--- | :--- |
| `pause(caller)` | `onlyPauser`, `whenNotPaused` | Halts all transfers, approvals, mints, and burns |
| `unpause(caller)` | `onlyPauser`, `whenPaused` | Resumes normal operations |
| `setEmergencyPauser(caller, newPauser)` | `onlyOwner` | Updates the designated emergency pauser role |
| `adminReallocate(caller, trapped, target, amount)` | `onlyOwner` | Rescues tokens from locked/lost accounts |
| `transfer(caller, to, value)` | `authenticate(caller)`, `whenNotPaused` | Moves tokens from caller to recipient |
| `approve(caller, spender, value)` | `authenticate(caller)`, `whenNotPaused` | Grants spender allowance over caller's balance |
| `transferFrom(caller, from, to, value)` | `authenticate(caller)`, `whenNotPaused` | Spends granted allowance to transfer tokens |
| `mint(to, value)` | `authenticate(owner)`, `whenNotPaused` | Mints new tokens up to `_maxSupply` |
| `burn(caller, value)` | `authenticate(caller)`, `whenNotPaused` | Destroys tokens from caller's balance |
| `emergencyWithdraw(caller, token, amount)` | `onlyOwner`, `whenPaused` | Rescues contract-owned balances during emergency |

---

### 2. Prerequisites & Installation

To install the required dependencies, create and run `scripts/fungible-token-v2-3-install.sh`:

```bash
#!/usr/bin/env bash
# scripts/fungible-token-v2-3-install.sh
set -euo pipefail

npm install @midnight-ntwrk/compact-runtime
npm install --save-dev typescript tsx @types/node vitest
```

Ensure your `tsconfig.json` targets `ES2022` or `ESNext` with `NodeNext` module resolution.

---

### 3. API Reference & Caller Authentication

#### Authentication & Account Derivation Architecture

Midnight transactions utilize zero-knowledge proofs where the user proves possession of a secret key without revealing it on-chain.

```
+--------------------------+
|  User Secret Key (32B)   | (Kept off-chain in private state)
+--------------------------+
             |
             v
+--------------------------+     +--------------------------+
|   Contract Salt (32B)    | --> | persistentHash([tag, salt, sk]) |
+--------------------------+     +--------------------------+
                                               |
                                               v
                                 +--------------------------+
                                 |  Derived Account (32B)   | (Stored on public ledger)
                                 +--------------------------+
```

1. **Cross-Contract Replay Isolation**:
   Because account identifiers are computed via `persistentHash(["fungible-token:auth", _contractSalt, sk])`, user identities are mathematically isolated per token deployment. A signature or proof generated for token contract $A$ cannot be replayed on token contract $B$.
2. **Deterministic Account Derivation**:
   Use `FungibleTokenV23Client.deriveAccount(secretKey, contractSalt)` to obtain the on-chain account corresponding to any 32-byte secret key.
3. **Deployment Requirement**:
   When constructing the contract, `initialOwner` **MUST** be initialized with the derived account commitment (`deriveAccount(ownerSecretKey, salt)`), **NOT** with a raw public key or random hex string.

#### Circuit Error Codes Reference

- `"FungibleToken: caller authorization failed"`: The private key returned by the witness does not hash to the provided caller account.
- `"FungibleToken: contract is paused"`: The circuit was invoked while `_paused == true`.
- `"FungibleToken: contract is not paused"`: Attempted to call `unpause` or `emergencyWithdraw` while active.
- `"FungibleToken: only owner can call this"`: Caller does not match the stored `owner` ledger variable.
- `"FungibleToken: only pauser or owner can call this"`: Caller matches neither `owner` nor `_emergencyPauser`.
- `"FungibleToken: insufficient balance"`: Source account has fewer tokens than the requested amount.
- `"FungibleToken: insufficient allowance"`: Spender has exceeded the approved allowance from `fromAccount`.
- `"FungibleToken: supply overflow"`: Minting would cause total supply to exceed `_maxSupply`.

---

### 4. Step-by-Step Quickstart Walkthrough

Save the following executable script to `examples/fungible-token-v2-3-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV23 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-3-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV23Client,
  type FungibleTokenV23PrivateState
} from '../src/client/fungible-token-v2-3-sdk.js';

async function main() {
  console.log('--- Initializing FungibleToken V2.3 SDK Example ---');

  // 1. Setup Mock Identifiers (32-byte hex strings)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);
  const contractSalt = new Uint8Array(32).fill(7);

  // 2. Setup Secret Keys
  const ownerSk = new Uint8Array(32).fill(1);
  const aliceSk = new Uint8Array(32).fill(2);

  // 3. Derive Account Commitments using Contract Salt
  const ownerAccount = FungibleTokenV23Client.deriveAccount(ownerSk, contractSalt);
  const aliceAccount = FungibleTokenV23Client.deriveAccount(aliceSk, contractSalt);

  console.log('Owner Account:', Buffer.from(ownerAccount).toString('hex'));
  console.log('Alice Account:', Buffer.from(aliceAccount).toString('hex'));

  // 4. Initialize Contract State
  const client = new FungibleTokenV23Client(ownerSk, contractSalt);
  let privateState: FungibleTokenV23PrivateState = { secretKey: ownerSk };

  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);
  const initResult = client.initialState(
    constructorCtx,
    contractSalt,
    ownerAccount,
    'Midnight Shield Dollar',
    'MSD',
    6,
    1_000_000_000_000n // Max supply
  );

  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;
  console.log('Contract state initialized successfully.');

  // 5. Mint Tokens to Owner
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  console.log('Minting 500,000 tokens to Owner...');
  const mintResult = client.mint(circuitCtx, ownerAccount, 500_000n);
  currentChargedState = mintResult.context.currentQueryContext.state;
  privateState = mintResult.context.currentPrivateState;

  // 6. Query Initial Ledger State
  let state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Total Supply:', state._totalSupply);
  console.log('Owner Balance:', state._balances.lookup(ownerAccount));

  // 7. Transfer Tokens to Alice
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  console.log('Transferring 10,000 tokens from Owner to Alice...');
  const transferResult = client.transfer(circuitCtx, ownerAccount, aliceAccount, 10_000n);
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 8. Verify Balances
  state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Owner Balance after transfer:', state._balances.lookup(ownerAccount));
  console.log('Alice Balance after transfer:', state._balances.lookup(aliceAccount));

  // 9. Pause Contract
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  console.log('Triggering emergency pause...');
  const pauseResult = client.pause(circuitCtx, ownerAccount);
  currentChargedState = pauseResult.context.currentQueryContext.state;

  state = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('Is Contract Paused?:', state._paused);
  console.log('--- Example Completed Successfully ---');
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

### 5. Privacy & Security Notes

1. **Private State Isolation**: Caller secret keys must be isolated within the client storage runtime. Never transmit secret keys over public network boundaries.
2. **Salt Management**: Reusing an identity without salt across contracts risks cross-application linkability. Always pass the on-chain `_contractSalt` when deriving account commitments.
3. **Emergency Circuit Verification**: Only `owner` and `_emergencyPauser` can call `pause` / `unpause`. When the contract is paused, all user balances are frozen to prevent unauthorized drainage during upgrades or vulnerability containment.

---

## Part 2: Production TypeScript Client SDK Implementation

```typescript
// src/client/fungible-token-v2-3-sdk.ts
// SPDX-License-Identifier: MIT

import {
  type CircuitContext,
  type QueryContext,
  type WitnessContext,
  type ConstructorContext,
  type ConstructorResult,
  type CircuitResults,
  type StateValue,
  type ChargedState,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2-3/contract/index.js';

/**
 * Off-chain private state holding the caller's authentication secret key.
 */
export interface FungibleTokenV23PrivateState {
  readonly secretKey: Uint8Array;
}

/**
 * Contract ledger type definition.
 */
export type FungibleTokenV23LedgerState = ContractLedger;

/**
 * Type-safe witnesses matching the Compact witness declarations.
 */
export type FungibleTokenV23Witnesses<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState> = {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
};

/**
 * High-level, production-grade TypeScript Client SDK for the fungible-token-v2-3 Compact contract.
 */
export class FungibleTokenV23Client<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState> {
  protected readonly contract: ManagedContract<PS>;
  public readonly defaultContractSalt: Uint8Array;

  /**
   * Constructs an instance of the FungibleTokenV23Client.
   *
   * @param defaultSecretKey - Default 32-byte secret key for signing calls.
   * @param defaultContractSalt - Default 32-byte deployment salt.
   * @param customWitnesses - Optional customized witness implementations.
   */
  constructor(
    defaultSecretKey: Uint8Array | string = new Uint8Array(32),
    defaultContractSalt: Uint8Array | string = new Uint8Array(32),
    customWitnesses?: Partial<FungibleTokenV23Witnesses<PS>>
  ) {
    this.defaultContractSalt = FungibleTokenV23Client.toBytes32(defaultContractSalt);
    const standardWitnesses = FungibleTokenV23Client.createWitnesses<PS>(defaultSecretKey);
    const finalWitnesses = { ...standardWitnesses, ...customWitnesses } as ContractWitnesses<PS>;
    this.contract = new ManagedContract<PS>(finalWitnesses);
  }

  // ==========================================================================
  // Cryptographic Identity & Account Helpers
  // ==========================================================================

  /**
   * Helper utility to normalize strings or buffers into strict 32-byte Uint8Array arrays.
   */
  public static toBytes32(input: Uint8Array | string): Uint8Array {
    if (typeof input === 'string') {
      const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
      if (cleanHex.length === 64) {
        return new Uint8Array(Buffer.from(cleanHex, 'hex'));
      }
      const buffer = new Uint8Array(32);
      const encoded = Buffer.from(input, 'utf-8');
      buffer.set(encoded.subarray(0, Math.min(encoded.length, 32)));
      return buffer;
    }
    if (input instanceof Uint8Array) {
      if (input.length === 32) {
        return input;
      }
      const result = new Uint8Array(32);
      result.set(input.subarray(0, Math.min(input.length, 32)));
      return result;
    }
    throw new TypeError('Invalid input: expected Uint8Array or hex/utf-8 string');
  }

  /**
   * Derives the on-chain account commitment using the contract's authenticating Poseidon curve hash.
   * Bound to _contractSalt for cross-contract replay protection.
   *
   * @param secretKey - The 32-byte private key.
   * @param contractSalt - The 32-byte contract deployment salt.
   * @returns 32-byte derived on-chain public identity.
   */
  public static deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt: string | Uint8Array = new Uint8Array(32)
  ): Uint8Array {
    const skBytes = FungibleTokenV23Client.toBytes32(secretKey);
    const saltBytes = FungibleTokenV23Client.toBytes32(contractSalt);
    const domainTag = new Uint8Array(32);
    domainTag.set(Buffer.from('fungible-token:auth', 'utf-8'));

    try {
      const dummy = new ManagedContract({
        localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)],
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
    } catch {}

    throw new Error('Failed to resolve Compact persistentHash for account derivation');
  }

  /**
   * Instance method to derive an on-chain account using the instance default salt.
   */
  public deriveAccount(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return FungibleTokenV23Client.deriveAccount(
      secretKey,
      contractSalt ?? this.defaultContractSalt
    );
  }

  /**
   * Returns the authenticated on-chain identity for the given secret key.
   */
  public getAuthenticatedCaller(
    secretKey: Uint8Array | string,
    contractSalt?: string | Uint8Array
  ): Uint8Array {
    return this.deriveAccount(secretKey, contractSalt);
  }

  /**
   * Checks whether a private key corresponds to a given on-chain account identity under a salt.
   */
  public static isAuthorized(
    secretKey: Uint8Array | string,
    targetAccount: Uint8Array | string,
    contractSalt: string | Uint8Array
  ): boolean {
    const derived = FungibleTokenV23Client.deriveAccount(secretKey, contractSalt);
    const target = FungibleTokenV23Client.toBytes32(targetAccount);
    if (derived.length !== target.length) return false;
    for (let i = 0; i < derived.length; i++) {
      if (derived[i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Creates standard witness providers configured with a private key.
   */
  public static createWitnesses<PS extends FungibleTokenV23PrivateState = FungibleTokenV23PrivateState>(
    secretKey: Uint8Array | string
  ): FungibleTokenV23Witnesses<PS> {
    const skBytes = FungibleTokenV23Client.toBytes32(secretKey);
    return {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        const activeKey = context.privateState?.secretKey ?? skBytes;
        return [context.privateState, activeKey];
      },
    };
  }

  // ==========================================================================
  // Initialization & Construction
  // ==========================================================================

  /**
   * Initializes contract state using the Compact runtime constructor.
   */
  public initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array | string,
    initialOwner: Uint8Array | string,
    name: string,
    symbol: string,
    decimals: number | bigint,
    maxSupply: number | bigint
  ): ConstructorResult<PS> {
    const saltBytes = FungibleTokenV23Client.toBytes32(salt);
    const ownerBytes = FungibleTokenV23Client.toBytes32(initialOwner);
    return this.contract.initialState(
      context,
      saltBytes,
      ownerBytes,
      name,
      symbol,
      BigInt(decimals),
      BigInt(maxSupply)
    );
  }

  // ==========================================================================
  // Administrative & Emergency Circuits
  // ==========================================================================

  /**
   * Pauses all token transfers, approvals, and minting/burning.
   */
  public pause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.pause(context, callerBytes);
  }

  /**
   * Resumes contract operations when paused.
   */
  public unpause(
    context: CircuitContext<PS>,
    caller: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.unpause(context, callerBytes);
  }

  /**
   * Assigns a designated emergency pauser role.
   */
  public setEmergencyPauser(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    newPauser: Uint8Array | string
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const pauserBytes = FungibleTokenV23Client.toBytes32(newPauser);
    return this.contract.impureCircuits.setEmergencyPauser(context, callerBytes, pauserBytes);
  }

  /**
   * Rescues tokens from an inaccessible account and reallocates them to a spendable account.
   */
  public adminReallocate(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    trappedAccount: Uint8Array | string,
    targetSpendableAccount: Uint8Array | string,
    amount: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const trappedBytes = FungibleTokenV23Client.toBytes32(trappedAccount);
    const targetBytes = FungibleTokenV23Client.toBytes32(targetSpendableAccount);
    return this.contract.impureCircuits.adminReallocate(
      context,
      callerBytes,
      trappedBytes,
      targetBytes,
      BigInt(amount)
    );
  }

  /**
   * Emergency withdrawal of contract balances directly to the owner.
   */
  public emergencyWithdraw(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    tokenAddress: string,
    amount: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.emergencyWithdraw(
      context,
      callerBytes,
      tokenAddress,
      BigInt(amount)
    );
  }

  // ==========================================================================
  // Core Token Circuits
  // ==========================================================================

  /**
   * Transfers tokens from the caller to a recipient.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.transfer(context, callerBytes, toBytes, BigInt(value));
  }

  /**
   * Approves a spender to transfer tokens on caller's behalf.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    spender: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const spenderBytes = FungibleTokenV23Client.toBytes32(spender);
    return this.contract.impureCircuits.approve(context, callerBytes, spenderBytes, BigInt(value));
  }

  /**
   * Executes an allowance-backed transfer on behalf of another account.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    fromAccount: Uint8Array | string,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    const fromBytes = FungibleTokenV23Client.toBytes32(fromAccount);
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.transferFrom(
      context,
      callerBytes,
      fromBytes,
      toBytes,
      BigInt(value)
    );
  }

  /**
   * Mints new tokens to the target address (Owner only).
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const toBytes = FungibleTokenV23Client.toBytes32(to);
    return this.contract.impureCircuits.mint(context, toBytes, BigInt(value));
  }

  /**
   * Burns tokens from the caller's account.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array | string,
    value: number | bigint
  ): CircuitResults<PS, boolean> {
    const callerBytes = FungibleTokenV23Client.toBytes32(caller);
    return this.contract.impureCircuits.burn(context, callerBytes, BigInt(value));
  }

  // ==========================================================================
  // Ledger Queries
  // ==========================================================================

  /**
   * Decodes raw on-chain state into strongly typed ledger accessors.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV23LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Queries the typed ledger state from a circuit QueryContext.
   */
  public queryLedgerState(context: QueryContext): FungibleTokenV23LedgerState {
    return ledger(context.state);
  }
}

// SDK Class Export Alias
export { FungibleTokenV23Client as FungibleTokenV23SDK };
```
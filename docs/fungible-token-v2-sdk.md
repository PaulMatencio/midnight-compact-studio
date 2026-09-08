# FungibleTokenV2: Technical Documentation & Client SDK

---

## Part 1: Comprehensive SDK Documentation

### 1. Contract Overview & Architecture

The `fungible-token-v2` smart contract implements a high-integrity, ZK-provable fungible token standard on the Midnight blockchain using the Compact language (version `>= 0.23`). It provides standard ERC20-equivalent accounting (balances, allowances, minting, burning, and transfers) with deterministic zero-knowledge proofs.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FungibleTokenV2 (Compact)                       │
├────────────────────────────────┬───────────────────────────────────────┤
│       Public Ledger State      │          Private ZK Circuits          │
├────────────────────────────────┼───────────────────────────────────────┤
│  _isInitialized : Boolean      │  • initialize(...) : []               │
│  _balances      : Map<B32, U128│  • mint(...)       : Boolean          │
│  _allowances    : Map<...>     │  • burn(...)       : Boolean          │
│  _totalSupply   : Uint<128>    │  • transfer(...)   : Boolean          │
│  _name          : Opaque<"str">│  • approve(...)    : Boolean          │
│  _symbol        : Opaque<"str">│  • transferFrom(...) : Boolean        │
│  _decimals      : Uint<8>      │  • balanceOf(...)  : Uint<128>        │
│  owner          : Bytes<32>    │  • allowance(...)  : Uint<128>        │
└────────────────────────────────┴───────────────────────────────────────┘
```

#### Public Ledger State Schema

| State Field | Compact Type | Description |
|---|---|---|
| `_isInitialized` | `Boolean` | Flag indicating whether the token metadata and initial setup has occurred. |
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Ledger balance map keyed by 32-byte account public keys. |
| `_allowances` | `Map<Bytes<32>, Map<Bytes<32>, Uint<128>>>` | Two-tier map representing `owner -> spender -> allowance`. |
| `_totalSupply` | `Uint<128>` | Total circulating supply of the token. |
| `_name` | `Opaque<"string">` | Token name string. |
| `_symbol` | `Opaque<"string">` | Token symbol / ticker string. |
| `_decimals` | `Uint<8>` | Number of fractional decimal places. |
| `owner` | `Bytes<32>` | Immutable 32-byte public key of the contract owner. |

#### Private State & Witnesses

This contract executes circuits on client-provided inputs and updates the public ledger state after validating zero-knowledge proofs. All input parameters into circuits are private by default and explicitly revealed to public ledger variables via `disclose(...)`.

- **Private State Type (`PS`)**: Client runtime state maintained across circuit executions (e.g. signing keys, local transaction logs, user preferences).
- **Witnesses**: The contract relies on deterministic input proofs. The SDK provides a generic witness container `FungibleTokenV2Witnesses<PS>` enabling extensible client-side witness injection.

---

### 2. Prerequisites & Installation

To install the required dependencies, create and run `scripts/fungible-token-v2-install.sh`:

```bash
#!/usr/bin/env bash
# scripts/fungible-token-v2-install.sh

set -euo pipefail

echo "Installing Midnight Compact Runtime and TypeScript SDK dependencies..."

npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js

npm install --save-dev \
  typescript \
  tsx \
  @types/node
```

---

### 3. API Reference

#### Core Circuit Methods

All circuit invocations take a `CircuitContext<PS>` as the first argument and return a `CircuitResults<PS, R>`.

| Circuit Method | Arguments | Return Type | Description |
|---|---|---|---|
| `initialize` | `caller: Uint8Array`, `name: string`, `symbol: string`, `decimals: bigint` | `CircuitResults<PS, []>` | Initializes token parameters. Can only be called once by `owner`. |
| `name` | *(none)* | `CircuitResults<PS, string>` | Reads token name. |
| `symbol` | *(none)* | `CircuitResults<PS, string>` | Reads token symbol. |
| `decimals` | *(none)* | `CircuitResults<PS, bigint>` | Reads token decimals. |
| `totalSupply` | *(none)* | `CircuitResults<PS, bigint>` | Reads total circulating token supply. |
| `balanceOf` | `account: Uint8Array` | `CircuitResults<PS, bigint>` | Reads the balance of `account`. |
| `allowance` | `owner: Uint8Array`, `spender: Uint8Array` | `CircuitResults<PS, bigint>` | Reads the remaining allowance granted to `spender` by `owner`. |
| `transfer` | `caller: Uint8Array`, `to: Uint8Array`, `value: bigint` | `CircuitResults<PS, boolean>` | Transfers `value` tokens from `caller` to `to`. |
| `approve` | `caller: Uint8Array`, `spender: Uint8Array`, `value: bigint` | `CircuitResults<PS, boolean>` | Sets `spender` allowance for `caller` to `value`. |
| `transferFrom` | `caller: Uint8Array`, `fromAccount: Uint8Array`, `to: Uint8Array`, `value: bigint` | `CircuitResults<PS, boolean>` | Transfers `value` tokens from `fromAccount` to `to` using caller's allowance. |
| `mint` | `caller: Uint8Array`, `to: Uint8Array`, `value: bigint` | `CircuitResults<PS, boolean>` | Mints `value` tokens to `to`. Caller must be `owner`. |
| `burn` | `caller: Uint8Array`, `value: bigint` | `CircuitResults<PS, boolean>` | Burns `value` tokens from `caller`. Caller must be `owner`. |

#### Circuit Assertion Errors

| Assertion Message | Root Cause |
|---|---|
| `"FungibleToken: contract already initialized"` | `initialize()` called when `_isInitialized == true`. |
| `"FungibleToken: caller is not the owner"` | Caller address does not match `owner` in `initialize`, `mint`, or `burn`. |
| `"FungibleToken: contract not initialized"` | Circuit invoked before `initialize()` has been executed. |
| `"FungibleToken: invalid sender"` | Sender is zero address (`0x00...00`). |
| `"FungibleToken: invalid receiver"` | Receiver is zero address (`0x00...00`). |
| `"FungibleToken: invalid owner"` / `"invalid spender"` | Zero address supplied to approve. |
| `"FungibleToken: insufficient balance"` | Balance of `fromAccount` is less than transfer/burn amount. |
| `"FungibleToken: insufficient allowance"` | Spender allowance is less than `value` in `transferFrom`. |
| `"FungibleToken: arithmetic overflow"` | Minting causes total supply to exceed `2^128 - 1`. |

---

### 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following complete runnable TypeScript script in `examples/fungible-token-v2-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV2 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-example.ts
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV2Client,
  type FungibleTokenV2PrivateState,
  hexToUint8Array,
  uint8ArrayToHex,
} from '../src/client/fungible-token-v2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV2 SDK Walkthrough ===\n');

  // 1. Setup mock keys (32-byte hex strings for Midnight.js runtime contexts)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  // Setup account byte representations (Uint8Array for contract circuits)
  const ownerBytes = hexToUint8Array('aa'.repeat(32));
  const aliceBytes = hexToUint8Array('bb'.repeat(32));
  const bobBytes = hexToUint8Array('cc'.repeat(32));

  // 2. Initialize private state & instantiate SDK client
  let privateState: FungibleTokenV2PrivateState = {
    userSecretKey: hexToUint8Array('11'.repeat(32)),
  };

  const client = new FungibleTokenV2Client<FungibleTokenV2PrivateState>();

  // 3. Initialize Contract via Constructor Context
  console.log('1. Deploying / Initializing contract state...');
  const constructorCtx = CompactRuntime.createConstructorContext(privateState, coinPublicKey);
  const initResult = client.initialState(constructorCtx, ownerBytes);

  privateState = initResult.currentPrivateState;
  let currentChargedState = initResult.currentContractState.data;

  // Inspect initial ledger
  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`   Owner: 0x${uint8ArrayToHex(ledgerState.owner)}`);
  console.log(`   Initialized: ${ledgerState._isInitialized}`);

  // 4. Initialize token metadata (owner only)
  console.log('\n2. Initializing token metadata (Midnight DUST, Symbol: DUST, Decimals: 6)...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  
  let result = client.initialize(circuitCtx, ownerBytes, 'Midnight DUST', 'DUST', 6n);
  privateState = result.context.currentPrivateState;
  currentChargedState = result.context.currentQueryContext.state;

  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`   Token Name:     ${ledgerState._name}`);
  console.log(`   Token Symbol:   ${ledgerState._symbol}`);
  console.log(`   Token Decimals: ${ledgerState._decimals}`);

  // 5. Mint tokens to Alice
  console.log('\n3. Minting 1,000,000 DUST tokens to Alice...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const mintAmount = 1_000_000n;
  const mintResult = client.mint(circuitCtx, ownerBytes, aliceBytes, mintAmount);
  privateState = mintResult.context.currentPrivateState;
  currentChargedState = mintResult.context.currentQueryContext.state;

  // 6. Query Alice's Balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const aliceBalanceResult = client.balanceOf(circuitCtx, aliceBytes);
  console.log(`   Alice Balance: ${aliceBalanceResult.result} DUST`);

  // 7. Alice transfers 250,000 DUST to Bob
  console.log('\n4. Alice transfers 250,000 DUST to Bob...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );

  const transferAmount = 250_000n;
  const transferResult = client.transfer(circuitCtx, aliceBytes, bobBytes, transferAmount);
  privateState = transferResult.context.currentPrivateState;
  currentChargedState = transferResult.context.currentQueryContext.state;

  // 8. Bob approves Alice to spend 50,000 DUST
  console.log('\n5. Bob approves Alice for 50,000 DUST allowance...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const allowanceAmount = 50_000n;
  const approveResult = client.approve(circuitCtx, bobBytes, aliceBytes, allowanceAmount);
  privateState = approveResult.context.currentPrivateState;
  currentChargedState = approveResult.context.currentQueryContext.state;

  // 9. Alice transfers 20,000 DUST from Bob to Alice via transferFrom
  console.log('\n6. Alice executes transferFrom(Bob -> Alice, 20,000)...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const transferFromResult = client.transferFrom(circuitCtx, aliceBytes, bobBytes, aliceBytes, 20_000n);
  privateState = transferFromResult.context.currentPrivateState;
  currentChargedState = transferFromResult.context.currentQueryContext.state;

  // 10. Query final ledger state
  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('\n=== Final Token State ===');
  console.log(`Total Supply: ${ledgerState._totalSupply}`);
  console.log(`Alice Balance: ${ledgerState._balances.lookup(aliceBytes)}`);
  console.log(`Bob Balance:   ${ledgerState._balances.lookup(bobBytes)}`);
  console.log(`Bob -> Alice Remaining Allowance: ${ledgerState._allowances.lookup(bobBytes).lookup(aliceBytes)}`);
  console.log('\nWalkthrough completed successfully!');
}

main().catch((err) => {
  console.error('Walkthrough failed:', err);
  process.exit(1);
});
```

---

### 5. Privacy & Security Notes

1. **Disclosure Boundaries**:
   All parameters passed to `initialize`, `transfer`, `approve`, `mint`, and `burn` are disclosed explicitly when writing to the public ledger. Off-chain witness data remains strictly local to the prover.
2. **Context Continuity**:
   Always pass the updated `result.context.currentPrivateState` and updated query context `result.context.currentQueryContext.state` into subsequent circuit invocations to prevent state drift and invalid transition proofs.
3. **Key Management**:
   Never serialize unencrypted private keys into local storage. When integrating with wallet connectors (such as Midnight Lace), use the official DApp Connector API (`window.midnight.mnLace`) for signing and coin selection.

---

## Part 2: Production TypeScript Client SDK Implementation

Below is the complete implementation for `src/client/fungible-token-v2-sdk.ts`:

```typescript
/**
 * FungibleTokenV2 TypeScript Client SDK
 * 
 * Provides type-safe wrappers for circuit execution, constructor initial state setup,
 * and ledger state query deserialization for the fungible-token-v2 smart contract.
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
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract as ManagedContract,
  ledger,
  type Witnesses as ContractWitnesses,
  type Ledger as ContractLedger,
} from '../../contracts/managed/fungible-token-v2/contract/index.js';

/**
 * Standard private state structure maintained on the client.
 */
export interface FungibleTokenV2PrivateState {
  readonly userSecretKey?: Uint8Array;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Public ledger state mapping representing the on-chain contract state.
 */
export type FungibleTokenV2LedgerState = ContractLedger;

/**
 * Custom witness definitions interface for FungibleTokenV2.
 * Parameterized by the private state type `PS`.
 */
export type FungibleTokenV2Witnesses<PS> = ContractWitnesses<PS>;

/**
 * Helper to convert a hexadecimal string to Uint8Array (Bytes<32>).
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${cleanHex.length}`);
  }
  const array = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    array[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return array;
}

/**
 * Helper to convert a Uint8Array to a hex string.
 */
export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Production Client SDK for the FungibleTokenV2 Midnight smart contract.
 */
export class FungibleTokenV2Client<PS = FungibleTokenV2PrivateState> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Constructs an instance of the FungibleTokenV2Client.
   * @param witnesses Optional custom witness implementation dictionary.
   */
  constructor(witnesses: FungibleTokenV2Witnesses<PS> = {} as FungibleTokenV2Witnesses<PS>) {
    this.contract = new ManagedContract<PS>(witnesses);
  }

  /**
   * Initializes the initial contract state and constructor result.
   *
   * @param context Constructor context containing private state and public coin key.
   * @param initialOwner 32-byte public key of the initial contract owner.
   * @returns The initial ConstructorResult containing currentContractState and currentPrivateState.
   */
  public initialState(
    context: ConstructorContext<PS>,
    initialOwner: Uint8Array
  ): ConstructorResult<PS> {
    if (initialOwner.length !== 32) {
      throw new Error(`initialOwner must be 32 bytes, received ${initialOwner.length} bytes.`);
    }
    return this.contract.initialState(context, initialOwner);
  }

  /**
   * Initializes token metadata (name, symbol, decimals).
   * Callable only once by the contract owner.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte address of the caller (must match owner).
   * @param name Token name.
   * @param symbol Token symbol.
   * @param decimals Token decimal precision (Uint8).
   */
  public initialize(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint
  ): CircuitResults<PS, []> {
    this.assertBytes32(caller, 'caller');
    return this.contract.circuits.initialize(context, caller, name, symbol, decimals);
  }

  /**
   * Queries the token name via zero-knowledge circuit execution.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  /**
   * Queries the token symbol via zero-knowledge circuit execution.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  /**
   * Queries token decimals via zero-knowledge circuit execution.
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  /**
   * Queries the total token supply.
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  /**
   * Queries the token balance of a given 32-byte account address.
   */
  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array
  ): CircuitResults<PS, bigint> {
    this.assertBytes32(account, 'account');
    return this.contract.circuits.balanceOf(context, account);
  }

  /**
   * Queries the allowance granted by `owner` to `spender`.
   */
  public allowance(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array
  ): CircuitResults<PS, bigint> {
    this.assertBytes32(owner, 'owner');
    this.assertBytes32(spender, 'spender');
    return this.contract.circuits.allowance(context, owner, spender);
  }

  /**
   * Transfers `value` tokens from `caller` to `to`.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(to, 'to');
    return this.contract.circuits.transfer(context, caller, to, value);
  }

  /**
   * Approves `spender` to spend `value` tokens on behalf of `caller`.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(spender, 'spender');
    return this.contract.circuits.approve(context, caller, spender, value);
  }

  /**
   * Performs an allowance-based transfer from `fromAccount` to `to`.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(fromAccount, 'fromAccount');
    this.assertBytes32(to, 'to');
    return this.contract.circuits.transferFrom(context, caller, fromAccount, to, value);
  }

  /**
   * Mints `value` tokens to `to`. Requires `caller` to be the contract owner.
   */
  public mint(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    this.assertBytes32(caller, 'caller');
    this.assertBytes32(to, 'to');
    return this.contract.circuits.mint(context, caller, to, value);
  }

  /**
   * Burns `value` tokens from `caller`. Requires `caller` to be the contract owner.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    this.assertBytes32(caller, 'caller');
    return this.contract.circuits.burn(context, caller, value);
  }

  /**
   * Deserializes raw contract ledger state into a strongly-typed FungibleTokenV2LedgerState.
   *
   * @param rawState Raw state value or ChargedState object from the query context / indexer.
   * @returns Typed on-chain ledger representation.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV2LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Validates that an address parameter is exactly 32 bytes.
   */
  private assertBytes32(bytes: Uint8Array, fieldName: string): void {
    if (!bytes || bytes.length !== 32) {
      throw new Error(`Field '${fieldName}' must be a 32-byte Uint8Array. Received ${bytes?.length ?? 0} bytes.`);
    }
  }
}
```
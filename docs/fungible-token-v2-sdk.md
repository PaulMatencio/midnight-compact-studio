# Deliverable 1: Comprehensive SDK Documentation

## 1. Contract Overview & Architecture

The `fungible-token-v2` smart contract implements an ERC-20-style fungible token standard on the Midnight blockchain using the Compact smart contract language (v >= 0.23). It provides standard token operations—transfer, approval, transferFrom, minting, and burning—while enforcing access control and state transitions within zero-knowledge circuits.

### Public Ledger State Schema

On-chain state is defined via `export ledger` declarations. It is stored publicly and verified by the Midnight consensus layer:

| Ledger Field | Compact Type | TypeScript SDK Type | Description |
| :--- | :--- | :--- | :--- |
| `_isInitialized` | `Boolean` | `boolean` | Flag indicating whether the contract metadata has been initialized. |
| `_balances` | `Map<Bytes<32>, Uint<128>>` | `Map<Uint8Array, bigint>` (SDK Accessor) | Ledger map associating 32-byte account addresses to token balances. |
| `_allowances` | `Map<Bytes<32>, Map<Bytes<32>, Uint<128>>>` | Nested `Map` Accessor | Two-tier map representing `[owner][spender] -> allowance`. |
| `_totalSupply` | `Uint<128>` | `bigint` | Cumulative circulating supply of the token. |
| `_name` | `Opaque<"string">` | `string` | Human-readable token name (e.g., "Midnight USD"). |
| `_symbol` | `Opaque<"string">` | `string` | Token symbol/ticker (e.g., "MUSD"). |
| `_decimals` | `Uint<8>` | `bigint` | Decimal precision of the token (e.g., `18n` or `6n`). |
| `owner` | `Bytes<32>` | `Uint8Array` | 32-byte identifier for the contract administrative owner. |

### Private State & Witness Architecture

Because `fungible-token-v2.compact` operates primarily on disclosed ledger state and explicit public parameters, it requires no off-chain witness lookups (`witness ...`). However, client architectures running Midnight transactions operate through the `WitnessContext<Ledger, PS>` interface to manage off-chain session keys, transaction context, and local states.

- **Witness Function Protocol**: When implementing custom witnesses, functions must take `WitnessContext<ContractLedger, PS>` and return a 2-element tuple `[PS, ReturnValue]`.
- **Disclosure Controls**: Circuit parameters (`caller`, `to`, `value`, etc.) are private when passed into the circuit and are explicitly disclosed using `disclose(...)` to execute state updates and checks.

### Zero-Knowledge Circuit Specification

| Circuit | Inputs | Output | Assertions / Pre-conditions |
| :--- | :--- | :--- | :--- |
| `initialize` | `name: string`, `symbol: string`, `decimals: bigint` | `[]` | Must not be already initialized (`!_isInitialized`). |
| `name` | *(none)* | `string` | Must be initialized (`_isInitialized == true`). |
| `symbol` | *(none)* | `string` | Must be initialized (`_isInitialized == true`). |
| `decimals` | *(none)* | `bigint` | Must be initialized (`_isInitialized == true`). |
| `totalSupply` | *(none)* | `bigint` | Must be initialized (`_isInitialized == true`). |
| `balanceOf` | `account: Uint8Array` | `bigint` | Must be initialized; returns `0` if account not found. |
| `allowance` | `owner: Uint8Array`, `spender: Uint8Array` | `bigint` | Must be initialized; returns `0` if mapping entry does not exist. |
| `transfer` | `caller: Uint8Array`, `to: Uint8Array`, `value: bigint` | `boolean` | Must be initialized; `caller != 0x00...`; `to != 0x00...`; `balanceOf(caller) >= value`. |
| `approve` | `caller: Uint8Array`, `spender: Uint8Array`, `value: bigint` | `boolean` | Must be initialized; `caller != 0x00...`; `spender != 0x00...`. |
| `transferFrom` | `caller: Uint8Array`, `fromAccount: Uint8Array`, `to: Uint8Array`, `value: bigint` | `boolean` | Must be initialized; `allowance >= value`; `balanceOf(fromAccount) >= value`. |
| `mint` | `caller: Uint8Array`, `to: Uint8Array`, `value: bigint` | `boolean` | Must be initialized; `caller == owner`; `to != 0x00...`; `totalSupply + value <= MAX_UINT128`. |
| `burn` | `caller: Uint8Array`, `value: bigint` | `boolean` | Must be initialized; `caller == owner`; `caller != 0x00...`; `balanceOf(caller) >= value`. |

---

## 2. Prerequisites & Installation

To install all required runtime and development dependencies, save and run the following script:

```bash
# scripts/fungible-token-v2-install.sh
#!/usr/bin/env bash
set -euo pipefail

echo "Installing Midnight Compact Runtime and TypeScript dependencies..."
npm install @midnight-ntwrk/compact-runtime@^0.8.0
npm install --save-dev typescript@^5.6.0 tsx@^4.19.0 @types/node@^20.0.0
echo "Installation complete."
```

Make the script executable and execute:
```bash
chmod +x scripts/fungible-token-v2-install.sh
./scripts/fungible-token-v2-install.sh
```

---

## 3. API Reference

The `FungibleTokenV2Client` wraps the compiled `Contract` class and exposes strongly-typed methods:

### Constructor

```typescript
constructor(witnesses?: FungibleTokenV2Witnesses<PS>)
```
Initializes a new SDK client instance. If no witnesses are provided, an empty witness object is bound.

### Methods

- **`initialState(context: ConstructorContext<PS>): ConstructorResult<PS>`**
  Initializes contract ledger state with the `initialOwner`.
- **`initialize(context: CircuitContext<PS>, name: string, symbol: string, decimals: bigint): CircuitResults<PS, []>`**
  Sets token metadata (callable once).
- **`name(context: CircuitContext<PS>): CircuitResults<PS, string>`**
  Queries the token name.
- **`symbol(context: CircuitContext<PS>): CircuitResults<PS, string>`**
  Queries the token symbol.
- **`decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint>`**
  Queries the token decimal precision.
- **`totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint>`**
  Queries the total circulating supply.
- **`balanceOf(context: CircuitContext<PS>, account: Uint8Array): CircuitResults<PS, bigint>`**
  Queries the balance of the target account.
- **`allowance(context: CircuitContext<PS>, owner: Uint8Array, spender: Uint8Array): CircuitResults<PS, bigint>`**
  Queries the remaining allowance `spender` can withdraw from `owner`.
- **`transfer(context: CircuitContext<PS>, caller: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`**
  Executes a direct token transfer.
- **`approve(context: CircuitContext<PS>, caller: Uint8Array, spender: Uint8Array, value: bigint): CircuitResults<PS, boolean>`**
  Approves `spender` to withdraw `value` from `caller`.
- **`transferFrom(context: CircuitContext<PS>, caller: Uint8Array, fromAccount: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`**
  Transfers tokens on behalf of `fromAccount` spending prior allowance.
- **`mint(context: CircuitContext<PS>, caller: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`**
  Mints new tokens to `to` (owner only).
- **`burn(context: CircuitContext<PS>, caller: Uint8Array, value: bigint): CircuitResults<PS, boolean>`**
  Burns tokens from `caller` (owner only).
- **`queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV2LedgerState`**
  Parses raw on-chain state into typed ledger fields.

---

## 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following file to `examples/fungible-token-v2-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV2 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-example.ts
 */

import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV2Client,
  type FungibleTokenV2PrivateState,
} from '../src/client/fungible-token-v2-sdk.js';

function createMockBytes32(byteVal: number): Uint8Array {
  const arr = new Uint8Array(32);
  arr.fill(byteVal);
  return arr;
}

async function main(): Promise<void> {
  console.log('--- Initializing FungibleTokenV2 Client ---');

  // Initialize SDK Client
  const client = new FungibleTokenV2Client<FungibleTokenV2PrivateState>();

  // Setup mock addresses & keys (32-byte hex strings in Midnight.js runtime)
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const ownerBytes = createMockBytes32(1);
  const aliceBytes = createMockBytes32(2);
  const bobBytes = createMockBytes32(3);

  let privateState: FungibleTokenV2PrivateState = {};

  // 1. Initialize Contract State via ConstructorContext
  console.log('\n[1] Executing Contract Constructor...');
  const constructorCtx = CompactRuntime.createConstructorContext(
    ownerBytes,
    privateState,
    coinPublicKey,
  );

  const initResult = client.initialState(constructorCtx);
  let currentChargedState = initResult.currentContractState.data;
  privateState = initResult.currentPrivateState;

  console.log('Contract constructor successfully executed.');

  // 2. Initialize Token Metadata (initialize circuit)
  console.log('\n[2] Initializing Token Metadata...');
  let circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const initCircuitResult = client.initialize(
    circuitCtx,
    'Midnight Sample Token',
    'MST',
    18n,
  );
  currentChargedState = initCircuitResult.context.currentQueryContext.state;
  privateState = initCircuitResult.context.privateState;
  console.log('Token initialized: Midnight Sample Token (MST), 18 decimals');

  // 3. Mint Tokens to Alice (Caller = Owner)
  console.log('\n[3] Minting 1,000 MST to Alice...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const mintResult = client.mint(circuitCtx, ownerBytes, aliceBytes, 1000n * 10n ** 18n);
  currentChargedState = mintResult.context.currentQueryContext.state;
  privateState = mintResult.context.privateState;
  console.log(`Mint successful: ${mintResult.result}`);

  // 4. Alice Approves Bob to spend 250 MST
  console.log('\n[4] Alice Approving Bob for 250 MST...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const approveResult = client.approve(
    circuitCtx,
    aliceBytes,
    bobBytes,
    250n * 10n ** 18n,
  );
  currentChargedState = approveResult.context.currentQueryContext.state;
  privateState = approveResult.context.privateState;
  console.log(`Approve successful: ${approveResult.result}`);

  // 5. Bob transfers 100 MST from Alice to Owner
  console.log('\n[5] Bob Executing transferFrom(Alice -> Owner, 100 MST)...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState,
  );

  const transferFromResult = client.transferFrom(
    circuitCtx,
    bobBytes,
    aliceBytes,
    ownerBytes,
    100n * 10n ** 18n,
  );
  currentChargedState = transferFromResult.context.currentQueryContext.state;
  privateState = transferFromResult.context.privateState;
  console.log(`TransferFrom successful: ${transferFromResult.result}`);

  // 6. Query Ledger State and Verify Balances
  console.log('\n[6] Inspecting Final Ledger State...');
  const ledgerState = client.queryLedgerStateFromRaw(currentChargedState);

  console.log(`Token Name:         ${ledgerState._name}`);
  console.log(`Token Symbol:       ${ledgerState._symbol}`);
  console.log(`Decimals:           ${ledgerState._decimals.toString()}`);
  console.log(`Total Supply:       ${(ledgerState._totalSupply / 10n ** 18n).toString()} MST`);
  console.log(`Alice Balance:      ${(ledgerState._balances.lookup(aliceBytes) / 10n ** 18n).toString()} MST`);
  console.log(`Owner Balance:      ${(ledgerState._balances.lookup(ownerBytes) / 10n ** 18n).toString()} MST`);
  console.log(`Remaining Allowance (Alice -> Bob): ${(ledgerState._allowances.lookup(aliceBytes).lookup(bobBytes) / 10n ** 18n).toString()} MST`);

  console.log('\n--- Quickstart Run Completed Successfully ---');
}

main().catch((err) => {
  console.error('Error executing quickstart walkthrough:', err);
  process.exit(1);
});
```

---

## 5. Privacy & Security Notes

1. **Explicit Disclosures (`disclose`)**:
   Under Compact v >= 0.23, circuit arguments are inherently private. Public modifications on the ledger require explicit wrapping via `disclose(...)`. The SDK ensures typed parameters are passed in a way that aligns with circuit constraints.
2. **Key Formats & Zero Key Checks**:
   The contract strictly checks that accounts are not zero addresses (`0x00...00`). When constructing user addresses, ensure proper 32-byte arrays are allocated.
3. **Owner Access Controls**:
   `mint` and `burn` circuits assert `disclose(caller) == owner`. Supplying an unauthorized caller public key will fail ZK constraint validation.

---

# Deliverable 2: Production TypeScript Client SDK Implementation

```typescript
/**
 * FungibleTokenV2 TypeScript Client SDK
 *
 * Implements high-level bindings and type-safe circuit wrappers for
 * the fungible-token-v2 Midnight smart contract.
 *
 * File location: src/client/fungible-token-v2-sdk.ts
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
 * Base interface representing the client private state.
 */
export interface FungibleTokenV2PrivateState {
  readonly [key: string]: unknown;
}

/**
 * Type representing the on-chain ledger state of the Fungible Token contract.
 */
export type FungibleTokenV2LedgerState = ContractLedger;

/**
 * Type representing witness functions required by the contract.
 * Each witness returns a tuple [nextPrivateState, ReturnValue].
 */
export type FungibleTokenV2Witnesses<PS extends FungibleTokenV2PrivateState = FungibleTokenV2PrivateState> = {
  [K in keyof ContractWitnesses<PS>]: (
    context: WitnessContext<ContractLedger, PS>,
    ...args: any[]
  ) => [PS, any];
};

/**
 * Production Client SDK for interacting with the FungibleTokenV2 Compact smart contract.
 */
export class FungibleTokenV2Client<PS extends FungibleTokenV2PrivateState = FungibleTokenV2PrivateState> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Constructs a new FungibleTokenV2 client instance.
   *
   * @param witnesses Optional witness implementation object for off-chain execution.
   */
  constructor(witnesses: FungibleTokenV2Witnesses<PS> = {} as FungibleTokenV2Witnesses<PS>) {
    this.contract = new ManagedContract<PS>(witnesses as unknown as ContractWitnesses<PS>);
  }

  /**
   * Initializes the contract's constructor context and default ledger state.
   *
   * @param context The constructor context containing the initial owner and coin public key.
   * @returns The constructor result containing the initial state data and private state.
   */
  public initialState(context: ConstructorContext<PS>): ConstructorResult<PS> {
    return this.contract.initialState(context);
  }

  /**
   * Initializes token metadata: name, symbol, and decimal precision.
   *
   * @param context Circuit execution context.
   * @param name Token name string.
   * @param symbol Token ticker symbol string.
   * @param decimals Token precision (Uint8 represented as bigint).
   * @returns Circuit result with an empty tuple [] return value.
   */
  public initialize(
    context: CircuitContext<PS>,
    name: string,
    symbol: string,
    decimals: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits.initialize(context, name, symbol, decimals);
  }

  /**
   * Retrieves the token name from the contract state.
   *
   * @param context Circuit execution context.
   * @returns Circuit result containing the token name string.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  /**
   * Retrieves the token symbol from the contract state.
   *
   * @param context Circuit execution context.
   * @returns Circuit result containing the token symbol string.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  /**
   * Retrieves the token decimal precision from the contract state.
   *
   * @param context Circuit execution context.
   * @returns Circuit result containing the token decimals (bigint).
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  /**
   * Retrieves the total circulating supply from the contract state.
   *
   * @param context Circuit execution context.
   * @returns Circuit result containing the total supply (bigint).
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  /**
   * Queries the token balance for a specified account.
   *
   * @param context Circuit execution context.
   * @param account 32-byte account public key address.
   * @returns Circuit result containing the balance (bigint).
   */
  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array,
  ): CircuitResults<PS, bigint> {
    return this.contract.circuits.balanceOf(context, account);
  }

  /**
   * Queries the spending allowance granted to a spender by an owner.
   *
   * @param context Circuit execution context.
   * @param owner 32-byte owner account public key address.
   * @param spender 32-byte spender account public key address.
   * @returns Circuit result containing the allowance (bigint).
   */
  public allowance(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array,
  ): CircuitResults<PS, bigint> {
    return this.contract.circuits.allowance(context, owner, spender);
  }

  /**
   * Transfers tokens from caller to recipient.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte caller account public key address.
   * @param to 32-byte destination account public key address.
   * @param value Amount to transfer (Uint128 represented as bigint).
   * @returns Circuit result containing boolean success flag.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transfer(context, caller, to, value);
  }

  /**
   * Approves a spender to spend up to a maximum amount of tokens on behalf of caller.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte caller account public key address.
   * @param spender 32-byte spender account public key address.
   * @param value Amount approved (Uint128 represented as bigint).
   * @returns Circuit result containing boolean success flag.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.approve(context, caller, spender, value);
  }

  /**
   * Transfers tokens from fromAccount to to using caller's pre-approved allowance.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte spender/caller account public key address.
   * @param fromAccount 32-byte owner account public key address.
   * @param to 32-byte destination account public key address.
   * @param value Amount to transfer (Uint128 represented as bigint).
   * @returns Circuit result containing boolean success flag.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transferFrom(context, caller, fromAccount, to, value);
  }

  /**
   * Mints new tokens to the destination account (owner only).
   *
   * @param context Circuit execution context.
   * @param caller 32-byte caller account public key address (must match owner).
   * @param to 32-byte destination account public key address.
   * @param value Amount to mint (Uint128 represented as bigint).
   * @returns Circuit result containing boolean success flag.
   */
  public mint(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.mint(context, caller, to, value);
  }

  /**
   * Burns tokens from the caller's account and decreases total supply (owner only).
   *
   * @param context Circuit execution context.
   * @param caller 32-byte caller account public key address (must match owner).
   * @param value Amount to burn (Uint128 represented as bigint).
   * @returns Circuit result containing boolean success flag.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.burn(context, caller, value);
  }

  /**
   * Decodes and parses raw on-chain state data into the strongly-typed ledger state.
   *
   * @param rawState Raw state value or charged state returned by query or execution context.
   * @returns Strongly-typed FungibleTokenV2LedgerState object with Map accessors.
   */
  public queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV2LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}
```
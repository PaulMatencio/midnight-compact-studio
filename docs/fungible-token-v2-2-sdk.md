# Part 1: Comprehensive Technical Documentation

## 1. Contract Overview & Architecture

The `fungible-token-v2-2` smart contract implements a privacy-preserving, zero-knowledge authenticated fungible token standard on the Midnight blockchain. It allows token issuance, transfers, allowances, minting, and burning while leveraging off-chain witness proofs for caller authentication.

```
                      +------------------------------------------+
                      |       FungibleTokenV22 Architecture      |
                      +------------------------------------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
                   v                                               v
        +----------------------+                       +----------------------+
        | On-Chain State       |                       | Zero-Knowledge Proofs|
        +----------------------+                       +----------------------+
        | - _balances (Map)    |                       | - authenticate()     |
        | - _allowances (Map)  |                       |   * Witness: SK      |
        | - _totalSupply       |                       |   * Domain-sep hash  |
        | - _maxSupply         |                       |   * On-chain address |
        | - _name, _symbol     |                       | - transfer / mint /  |
        | - _decimals, owner   |                       |   burn / approve     |
        +----------------------+                       +----------------------+
```

### 1.1 Public Ledger State Schema

The public ledger state stores all global token metadata, supply constraints, account balances, and allowances:

| State Field | Compact Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `_balances` | `Map<Bytes<32>, Uint<128>>` | `ContractLedger['_balances']` | Mapping of 32-byte account addresses to balance amounts. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | `ContractLedger['_allowances']` | Flattened composite key `[owner, spender]` to authorized allowance. |
| `_totalSupply` | `Uint<128>` | `bigint` | Current circulating supply of tokens. |
| `_maxSupply` | `Uint<128>` | `bigint` | Maximum cap on token supply (`2^128 - 1` if uncapped). |
| `_name` | `Opaque<"string">` | `string` | Human-readable token name. |
| `_symbol` | `Opaque<"string">` | `string` | Ticker symbol of the token. |
| `_decimals` | `Uint<8>` | `bigint` / `number` | Token decimal precision. |
| `owner` | `Bytes<32>` | `Uint8Array` | 32-byte identifier of the contract administrator / minter. |

### 1.2 Private State & Witness Specification

Authentication relies on client-side zero-knowledge proofs rather than plaintext on-chain signatures.

- **Witness Declaration**: `witness localSecretKey(): Bytes<32>;`
- **Private State (`PS`)**: Contains `localSecretKey: Uint8Array` (32 bytes).
- **Authentication Derivation**:
  $$\text{derivedAccount} = \text{persistentHash}([\text{pad}(32, \text{"fungible-token:auth"}), \text{kernel.self}(), \text{sk}])$$
  The circuit checks `assert(derivedAccount == account)` to ensure the transaction submitter possesses the preimage secret key without publishing it.

### 1.3 Exported Circuits & Constraint Rules

1. `name(): Opaque<"string">`, `symbol(): Opaque<"string">`, `decimals(): Uint<8>`, `maxSupply(): Uint<128>`, `totalSupply(): Uint<128>`: Pure views over ledger parameters.
2. `balanceOf(account: Bytes<32>): Uint<128>`: Returns account balance or `0` if not present.
3. `allowance(ownerAccount: Bytes<32>, spender: Bytes<32>): Uint<128>`: Returns current allowance or `0` if not set.
4. `transfer(caller: Bytes<32>, to: Bytes<32>, value: Uint<128>): Boolean`:
   - Authenticates `caller`.
   - Checks non-zero destination and sender.
   - Enforces `balances[caller] >= value`.
5. `approve(caller: Bytes<32>, spender: Bytes<32>, value: Uint<128>): Boolean`:
   - Authenticates `caller`.
   - Sets `_allowances[[caller, spender]] = value`.
6. `transferFrom(caller: Bytes<32>, fromAccount: Bytes<32>, to: Bytes<32>, value: Uint<128>): Boolean`:
   - Authenticates `caller` (the spender).
   - Validates and decreases `_allowances[[fromAccount, caller]]` (unless max uint128).
   - Transfers `value` from `fromAccount` to `to`.
7. `mint(to: Bytes<32>, value: Uint<128>): Boolean`:
   - Authenticates `owner`.
   - Checks `_totalSupply + value <= _maxSupply`.
   - Increases `_totalSupply` and `_balances[to]`.
8. `burn(caller: Bytes<32>, value: Uint<128>): Boolean`:
   - Authenticates `caller`.
   - Decreases `_balances[caller]` and `_totalSupply`.

---

## 2. Prerequisites & Installation

To install dependencies and prepare the build environment, create and run `scripts/fungible-token-v2-2-install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

npm install --save \
  @midnight-ntwrk/compact-runtime \
  @midnight-ntwrk/compact-js

npm install --save-dev \
  typescript \
  tsx \
  @types/node
```

---

## 3. API Reference

### `FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState>`

#### `constructor(witnesses?: FungibleTokenV22Witnesses<PS>)`
Instantiates the client bound to witness implementations.

#### `initialState(context, initialOwner, name, symbol, decimals, maxSupply)`
Initializes state for contract deployment.
- **Parameters**:
  - `context: ConstructorContext<PS>`: Deployment context with initial private state.
  - `initialOwner: Uint8Array`: 32-byte public identifier of the owner.
  - `name: string`: Token name.
  - `symbol: string`: Token symbol.
  - `decimals: bigint | number`: Decimals (0 - 255).
  - `maxSupply: bigint`: Maximum supply limit (`0n` for max uint128).
- **Returns**: `ConstructorResult<PS>`.

#### `transfer(context, caller, to, value)`
Transfers tokens from `caller` to `to`.
- **Returns**: `CircuitResults<PS, boolean>`.
- **Errors**: `"FungibleToken: caller authorization failed"`, `"FungibleToken: insufficient balance"`.

#### `approve(context, caller, spender, value)`
Sets spender allowance for `caller`.
- **Returns**: `CircuitResults<PS, boolean>`.

#### `transferFrom(context, caller, fromAccount, to, value)`
Spends allowance to transfer tokens between accounts.
- **Returns**: `CircuitResults<PS, boolean>`.
- **Errors**: `"FungibleToken: insufficient allowance"`.

#### `mint(context, to, value)`
Mints tokens to `to` (owner only).
- **Returns**: `CircuitResults<PS, boolean>`.
- **Errors**: `"FungibleToken: supply overflow"`.

#### `burn(context, caller, value)`
Burns tokens from `caller`.
- **Returns**: `CircuitResults<PS, boolean>`.
- **Errors**: `"FungibleToken: supply underflow"`.

#### `queryLedgerStateFromRaw(rawState)`
Parses a raw runtime state or charged state into a typed `FungibleTokenV22LedgerState`.

---

## 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following runnable script as `examples/fungible-token-v2-2-example.ts`:

```typescript
/**
 * Quickstart Example: FungibleTokenV22 Client SDK
 *
 * How to run:
 *   npx tsx examples/fungible-token-v2-2-example.ts
 */

import {
  CompactRuntime,
  type ConstructorContext,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  FungibleTokenV22Client,
  type FungibleTokenV22PrivateState,
  createDefaultWitnesses,
} from '../src/client/fungible-token-v2-2-sdk.js';

async function main() {
  console.log('=== FungibleTokenV22 Client SDK Walkthrough ===\n');

  // 1. Setup mock keys and 32-byte addresses
  const coinPublicKey = '01'.repeat(32);
  const contractAddress = '00'.repeat(32);

  const ownerSecretKey = new Uint8Array(32).fill(0xaa);
  const userSecretKey = new Uint8Array(32).fill(0xbb);

  // In production, derive public identity using persistentHash([pad(32, "fungible-token:auth"), contractAddress, sk])
  // For simulation, we assign deterministic 32-byte account representations:
  const ownerAddress = new Uint8Array(32).fill(0x11);
  const userAddress = new Uint8Array(32).fill(0x22);

  // 2. Initialize private state and SDK Client
  let ownerPrivateState: FungibleTokenV22PrivateState = {
    localSecretKey: ownerSecretKey,
  };

  let userPrivateState: FungibleTokenV22PrivateState = {
    localSecretKey: userSecretKey,
  };

  const client = new FungibleTokenV22Client(createDefaultWitnesses());

  // 3. Initialize Contract (Constructor)
  console.log('1. Deploying contract...');
  const constructorCtx: ConstructorContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createConstructorContext(ownerPrivateState, coinPublicKey);

  const initResult = client.initialState(
    constructorCtx,
    ownerAddress,
    'Midnight Shield Token',
    'MST',
    18n,
    1_000_000_000n * 10n ** 18n // 1 Billion cap
  );

  let currentChargedState = initResult.currentContractState.data;
  ownerPrivateState = initResult.currentPrivateState;

  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('   Token Name    :', ledgerState._name);
  console.log('   Token Symbol  :', ledgerState._symbol);
  console.log('   Total Supply  :', ledgerState._totalSupply.toString());

  // 4. Mint Tokens as Owner
  console.log('\n2. Minting 1,000 MST to User...');
  let circuitCtx: CircuitContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      ownerPrivateState
    );

  const mintAmount = 1000n * 10n ** 18n;
  const mintResult = client.mint(circuitCtx, userAddress, mintAmount);

  currentChargedState = mintResult.context.currentQueryContext.state;
  ownerPrivateState = mintResult.context.currentPrivateState;

  ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log('   Total Supply After Mint:', ledgerState._totalSupply.toString());

  // 5. Transfer Tokens (User -> Owner)
  console.log('\n3. User transferring 250 MST back to Owner...');
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    userPrivateState
  );

  const transferAmount = 250n * 10n ** 18n;
  const transferResult = client.transfer(circuitCtx, userAddress, ownerAddress, transferAmount);

  currentChargedState = transferResult.context.currentQueryContext.state;
  userPrivateState = transferResult.context.currentPrivateState;

  // 6. Inspect Balances
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    userPrivateState
  );

  const userBalResult = client.balanceOf(circuitCtx, userAddress);
  const ownerBalResult = client.balanceOf(userBalResult.context, ownerAddress);

  console.log('   User Balance :', userBalResult.result.toString());
  console.log('   Owner Balance:', ownerBalResult.result.toString());
  console.log('\n=== Walkthrough completed successfully ===');
}

main().catch(console.error);
```

---

## 5. Privacy & Security Notes

1. **Witness Confidentiality**: The `localSecretKey` witness is never written to public ledger state or exposed on-chain. It stays in off-chain execution memory during zero-knowledge proof generation.
2. **Domain Separation**: Account authentication uses `pad(32, "fungible-token:auth")` combined with `kernel.self()` (the contract address) and `localSecretKey`. This prevents replay attacks across different contract deployments.
3. **State Updates & `disclose()`**: All values assigned to public ledger maps (`_balances`, `_allowances`) or aggregates (`_totalSupply`) must be explicitly disclosed in Compact circuits to allow validators to verify state transitions.

---

# Part 2: Production TypeScript Client SDK Implementation

```typescript
/**
 * Production TypeScript Client SDK for FungibleTokenV22 (fungible-token-v2-2.compact)
 * File: src/client/fungible-token-v2-2-sdk.ts
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
} from '../../contracts/managed/fungible-token-v2-2/contract/index.js';

/**
 * Off-chain private state interface required for witness generation.
 */
export interface FungibleTokenV22PrivateState {
  /** 32-byte secret key used to derive on-chain account address and authenticate operations */
  readonly localSecretKey: Uint8Array;
}

/**
 * Witness implementation mapping for FungibleTokenV22.
 * Each witness returns a tuple of [updatedPrivateState, witnessOutput].
 */
export type FungibleTokenV22Witnesses<PS extends FungibleTokenV22PrivateState> = {
  localSecretKey: (context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array];
};

/**
 * Strongly typed representation of the on-chain ledger state.
 */
export type FungibleTokenV22LedgerState = ContractLedger;

/**
 * Factory for creating default witness implementations.
 */
export function createDefaultWitnesses<
  PS extends FungibleTokenV22PrivateState
>(): FungibleTokenV22Witnesses<PS> {
  return {
    localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
      if (!context.privateState || !context.privateState.localSecretKey) {
        throw new Error('FungibleTokenV22Witnesses: localSecretKey missing in privateState');
      }
      return [context.privateState, context.privateState.localSecretKey];
    },
  };
}

/**
 * Production-grade client SDK for interacting with the FungibleTokenV22 smart contract.
 */
export class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  protected readonly contract: ManagedContract<PS>;

  /**
   * Initializes the FungibleTokenV22 client with witness providers.
   * @param witnesses Optional custom witness implementations.
   */
  constructor(witnesses: FungibleTokenV22Witnesses<PS> = createDefaultWitnesses<PS>()) {
    const witnessAdapter: ContractWitnesses<PS> = {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        return witnesses.localSecretKey(context);
      },
    };
    this.contract = new ManagedContract<PS>(witnessAdapter);
  }

  /**
   * Evaluates the contract constructor to produce initial ledger and private states.
   *
   * @param context Runtime constructor context containing deployer private state.
   * @param initialOwner 32-byte public identifier of the contract owner.
   * @param name Token name string.
   * @param symbol Token symbol string.
   * @param decimals Token decimal places (0-255).
   * @param maxSupply Maximum authorized token supply (0 for max uint128 cap).
   * @returns Constructor execution result with initial contract and private states.
   */
  public initialState(
    context: ConstructorContext<PS>,
    initialOwner: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint | number,
    maxSupply: bigint
  ): ConstructorResult<PS> {
    return this.contract.initialState(
      context,
      initialOwner,
      name,
      symbol,
      BigInt(decimals),
      maxSupply
    );
  }

  /**
   * Executes the `name` query circuit.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  /**
   * Executes the `symbol` query circuit.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  /**
   * Executes the `decimals` query circuit.
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  /**
   * Executes the `maxSupply` query circuit.
   */
  public maxSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.maxSupply(context);
  }

  /**
   * Executes the `totalSupply` query circuit.
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  /**
   * Queries balance of an account via ZK circuit.
   * @param context Circuit context.
   * @param account 32-byte account address.
   */
  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array
  ): CircuitResults<PS, bigint> {
    return this.contract.circuits.balanceOf(context, account);
  }

  /**
   * Queries allowance allocated by an owner to a spender.
   * @param context Circuit context.
   * @param ownerAccount 32-byte owner address.
   * @param spender 32-byte spender address.
   */
  public allowance(
    context: CircuitContext<PS>,
    ownerAccount: Uint8Array,
    spender: Uint8Array
  ): CircuitResults<PS, bigint> {
    return this.contract.circuits.allowance(context, ownerAccount, spender);
  }

  /**
   * Transfers tokens from caller to recipient.
   * @param context Circuit execution context.
   * @param caller 32-byte public address of caller.
   * @param to 32-byte recipient address.
   * @param value Amount to transfer.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transfer(context, caller, to, value);
  }

  /**
   * Sets token spending allowance for a designated spender.
   * @param context Circuit execution context.
   * @param caller 32-byte public address of caller.
   * @param spender 32-byte spender address.
   * @param value Amount to approve.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.approve(context, caller, spender, value);
  }

  /**
   * Transfers tokens using an approved allowance.
   * @param context Circuit execution context.
   * @param caller 32-byte spender caller address.
   * @param fromAccount 32-byte owner address whose tokens are being spent.
   * @param to 32-byte recipient address.
   * @param value Amount to transfer.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.transferFrom(context, caller, fromAccount, to, value);
  }

  /**
   * Mints new tokens (callable only by contract owner).
   * @param context Circuit execution context.
   * @param to 32-byte recipient address.
   * @param value Amount to mint.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.mint(context, to, value);
  }

  /**
   * Burns tokens from caller balance.
   * @param context Circuit execution context.
   * @param caller 32-byte caller address.
   * @param value Amount to burn.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    return this.contract.circuits.burn(context, caller, value);
  }

  /**
   * Decodes and parses raw contract state into a typed ledger representation.
   * @param rawState Raw StateValue, ChargedState, or query context state.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV22LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}
```
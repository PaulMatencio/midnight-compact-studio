# Part 1: Comprehensive SDK Documentation

## 1. Contract Overview & Architecture

The `fungible-token-v2-2` contract implements a privacy-preserving, zero-knowledge fungible token standard on the Midnight blockchain. It enforces caller authorization through zero-knowledge proofs derived from private secret keys, without disclosing private keys on the public ledger.

```
+-----------------------------------------------------------------------------------+
|                                 Zero-Knowledge Layer                              |
|                                                                                   |
|  [ Private Key (SK) ] ---> ( localSecretKey witness )                             |
|                                   |                                               |
|                                   v                                               |
|                    [ persistentHash(domain, self, SK) ] == caller account?        |
|                                   |                                               |
|                                   v                                               |
|                      assert( derived == caller )                                  |
+-----------------------------------+-----------------------------------------------+
                                    |
                                    v
+-----------------------------------+-----------------------------------------------+
|                                Ledger State                                       |
|                                                                                   |
|  - _balances: Map<Bytes<32>, Uint<128>>                                           |
|  - _allowances: Map<[Bytes<32>, Bytes<32>], Uint<128>>                            |
|  - _totalSupply: Uint<128>                                                        |
|  - _name: Opaque<"string">                                                        |
|  - _symbol: Opaque<"string">                                                      |
|  - _decimals: Uint<8>                                                             |
|  - owner: Bytes<32>                                                               |
+-----------------------------------------------------------------------------------+
```

### 1.1 Public Ledger State Schema

| Field | Compact Type | Description |
| :--- | :--- | :--- |
| `_balances` | `Map<Bytes<32>, Uint<128>>` | Ledger balance map keyed by 32-byte account identities. |
| `_allowances` | `Map<[Bytes<32>, Bytes<32>], Uint<128>>` | Composite key mapping `[owner, spender]` to authorized allowance. |
| `_totalSupply` | `Uint<128>` | Total circulating token supply. |
| `_name` | `Opaque<"string">` | Token descriptive name (e.g., `"Midnight USD"`). |
| `_symbol` | `Opaque<"string">` | Token ticker symbol (e.g., `"MUSD"`). |
| `_decimals` | `Uint<8>` | Token decimal precision (e.g., `18`). |
| `owner` | `Bytes<32>` | 32-byte identifier of the contract administrator/minter. |

### 1.2 Private State & Witness Specification

- **Witness Function**: `witness localSecretKey(): Bytes<32>;`
- **Witness Signature in TypeScript**: `(context: WitnessContext<ContractLedger, PS>) => [PS, Uint8Array]`
- **Authentication Mechanism**:
  The contract verifies that the prover possesses the private key corresponding to `caller` (or `owner`) by verifying:
  $$\text{derivedAccount} = \text{persistentHash}([\text{pad}(32, \text{"fungible-token:auth"}), \text{kernel.self}(), \text{sk}])$$
  The secret key never leaves the prover's local client runtime.

### 1.3 Available Circuits & Enforced Constraints

| Circuit | Arguments | Return | Invariant / Assertions |
| :--- | :--- | :--- | :--- |
| `name()` | `()` | `string` | Read-only access to `_name`. |
| `symbol()` | `()` | `string` | Read-only access to `_symbol`. |
| `decimals()` | `()` | `bigint` | Read-only access to `_decimals`. |
| `totalSupply()` | `()` | `bigint` | Read-only access to `_totalSupply`. |
| `balanceOf(account)` | `Bytes<32>` | `bigint` | Returns account balance, or `0` if unset. |
| `allowance(owner, spender)`| `Bytes<32>, Bytes<32>` | `bigint` | Returns approved spending allowance. |
| `transfer(caller, to, value)` | `Bytes<32>, Bytes<32>, Uint<128>` | `boolean` | Checks caller auth, non-zero addresses, sender balance $\ge \text{value}$. |
| `approve(caller, spender, value)`| `Bytes<32>, Bytes<32>, Uint<128>` | `boolean` | Checks caller auth, non-zero addresses, writes allowance. |
| `transferFrom(caller, from, to, value)` | `Bytes<32>, Bytes<32>, Bytes<32>, Uint<128>` | `boolean` | Checks caller auth, allowance $\ge \text{value}$, balance $\ge \text{value}$, decrements allowance. |
| `mint(to, value)` | `Bytes<32>, Uint<128>` | `boolean` | Authenticates contract `owner`, prevents $\text{supply} + \text{value} > 2^{128} - 1$. |
| `burn(caller, value)` | `Bytes<32>, Uint<128>` | `boolean` | Checks caller auth, balance $\ge \text{value}$, decrements supply. |

---

## 2. Prerequisites & Installation

To install all dependencies required by the SDK, create and execute `scripts/fungible-token-v2-2-install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Ensure package.json exists
if [ ! -f "package.json" ]; then
  npm init -y
fi

# Install runtime dependencies
npm install \
  @midnight-ntwrk/compact-runtime@^0.7.0 \
  @midnight-ntwrk/compact-js@^0.7.0

# Install development dependencies
npm install --save-dev \
  typescript@^5.4.0 \
  tsx@^4.7.0 \
  @types/node@^20.11.0
```

---

## 3. API Reference

### `FungibleTokenV22Client<PS>`

```typescript
class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState>
```

#### Constructor
- `new FungibleTokenV22Client(witnesses: FungibleTokenV22Witnesses<PS>)`
  Instantiates the managed contract wrapper with the specified witness handlers.

#### Lifecycle Methods
- `initialState(context: ConstructorContext<PS>, initialOwner: Uint8Array, name: string, symbol: string, decimals: number | bigint): ConstructorResult<PS>`
  Executes contract initialization and returns initial state and context.

#### Circuit Invocations
- `mint(context: CircuitContext<PS>, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`
- `burn(context: CircuitContext<PS>, caller: Uint8Array, value: bigint): CircuitResults<PS, boolean>`
- `transfer(context: CircuitContext<PS>, caller: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`
- `approve(context: CircuitContext<PS>, caller: Uint8Array, spender: Uint8Array, value: bigint): CircuitResults<PS, boolean>`
- `transferFrom(context: CircuitContext<PS>, caller: Uint8Array, fromAccount: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>`
- `balanceOf(context: CircuitContext<PS>, account: Uint8Array): CircuitResults<PS, bigint>`
- `allowance(context: CircuitContext<PS>, ownerAccount: Uint8Array, spender: Uint8Array): CircuitResults<PS, bigint>`
- `totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint>`
- `name(context: CircuitContext<PS>): CircuitResults<PS, string>`
- `symbol(context: CircuitContext<PS>): CircuitResults<PS, string>`
- `decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint>`

#### Ledger Query
- `queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV22LedgerState`
  Decodes raw on-chain state into typed ledger fields.

---

## 4. Step-by-Step Quickstart & Usage Walkthrough

Save the following code as `examples/fungible-token-v2-2-example.ts`:

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
  type FungibleTokenV22Witnesses,
} from '../src/client/fungible-token-v2-2-sdk.js';

// Setup Mock Addresses and Keys (32-byte hex strings)
const coinPublicKey = '01'.repeat(32);
const contractAddress = '00'.repeat(32);

// Mock private state holding caller secret keys
const ownerSecretKey = new Uint8Array(32).fill(0xaa);
const aliceSecretKey = new Uint8Array(32).fill(0xbb);

let privateState: FungibleTokenV22PrivateState = {
  secretKey: ownerSecretKey,
};

// Implement witnesses
const witnesses: FungibleTokenV22Witnesses<FungibleTokenV22PrivateState> = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secretKey],
};

async function main() {
  console.log('--- Initializing FungibleTokenV22 Contract ---');
  const client = new FungibleTokenV22Client(witnesses);

  // 1. Initialize Contract State
  const initialOwnerAddress = new Uint8Array(32).fill(0x11);
  const constructorCtx: ConstructorContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createConstructorContext(privateState, coinPublicKey);

  const initResult = client.initialState(
    constructorCtx,
    initialOwnerAddress,
    'Midnight USD',
    'MUSD',
    18n
  );

  privateState = initResult.currentPrivateState;
  let currentChargedState = initResult.currentContractState.data;

  console.log('Contract successfully initialized.');
  let ledgerState = client.queryLedgerStateFromRaw(currentChargedState);
  console.log(`Token Name: ${ledgerState._name}`);
  console.log(`Token Symbol: ${ledgerState._symbol}`);
  console.log(`Decimals: ${ledgerState._decimals}`);
  console.log(`Initial Total Supply: ${ledgerState._totalSupply}`);

  // 2. Query Metadata Circuit
  let circuitCtx: CircuitContext<FungibleTokenV22PrivateState> =
    CompactRuntime.createCircuitContext(
      contractAddress,
      coinPublicKey,
      currentChargedState,
      privateState
    );

  const nameResult = client.name(circuitCtx);
  currentChargedState = nameResult.context.currentQueryContext.state;
  console.log(`Queried name() circuit: ${nameResult.result}`);

  // 3. Query Balance
  circuitCtx = CompactRuntime.createCircuitContext(
    contractAddress,
    coinPublicKey,
    currentChargedState,
    privateState
  );
  const aliceAddress = new Uint8Array(32).fill(0x22);
  const balResult = client.balanceOf(circuitCtx, aliceAddress);
  currentChargedState = balResult.context.currentQueryContext.state;
  console.log(`Alice Balance: ${balResult.result}`);
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
```

---

## 5. Privacy & Security Notes

1. **Secret Key Isolation**: The `localSecretKey` witness returns a private `Uint8Array`. Ensure it is held solely in volatile memory and is never logged, exported, or persisted in unencrypted client storage.
2. **Domain Separation**: Account authentication uses a fixed 32-byte domain tag (`"fungible-token:auth"`) combined with `kernel.self()`. This ensures secret keys cannot be reused across different contracts or networks.
3. **Public Disclosures**: The `disclose(...)` operations in the Compact contract reveal transfer amounts, balances, and public addresses on the public ledger. Keep this in mind when designing high-privacy workflows.

---

# Part 2: Production TypeScript Client SDK Implementation

```typescript
/**
 * Production TypeScript Client SDK for `fungible-token-v2-2` Compact Smart Contract.
 *
 * @packageDocumentation
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
 * Ledger state structure mirroring the on-chain storage.
 */
export type FungibleTokenV22LedgerState = ContractLedger;

/**
 * Base private state interface for the Fungible Token client.
 */
export interface FungibleTokenV22PrivateState {
  /** 32-byte caller private secret key used for account authentication */
  readonly secretKey: Uint8Array;
  /** Optional extensible properties */
  readonly [key: string]: unknown;
}

/**
 * Strongly typed witness declarations for `fungible-token-v2-2`.
 *
 * Each witness receives a `WitnessContext` and must return a tuple `[PS, T]`.
 */
export interface FungibleTokenV22Witnesses<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  /**
   * Retrieves the caller's private 32-byte secret key for ZK authentication.
   *
   * @param context - The execution witness context containing private state and query context.
   * @returns A tuple containing `[updatedPrivateState, secretKeyBytes]`.
   */
  readonly localSecretKey: (
    context: WitnessContext<ContractLedger, PS>
  ) => [PS, Uint8Array];
}

/**
 * Production-grade Client SDK for interacting with the `fungible-token-v2-2` smart contract.
 */
export class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Constructs an instance of the `FungibleTokenV22Client`.
   *
   * @param witnesses - The witness implementation object.
   */
  constructor(witnesses: FungibleTokenV22Witnesses<PS>) {
    // Map to the generated compiler contract witnesses interface
    const contractWitnesses: ContractWitnesses<PS> = {
      localSecretKey: (context: WitnessContext<ContractLedger, PS>): [PS, Uint8Array] => {
        return witnesses.localSecretKey(context);
      },
    };

    this.contract = new ManagedContract<PS>(contractWitnesses);
  }

  /**
   * Initializes the contract state with constructor arguments.
   *
   * @param context - The constructor initialization context.
   * @param initialOwner - The 32-byte address of the contract administrator/owner.
   * @param name - The descriptive token name.
   * @param symbol - The token symbol / ticker.
   * @param decimals - The decimal precision (0 - 255).
   * @returns The constructor execution result containing initial ledger and private states.
   */
  public initialState(
    context: ConstructorContext<PS>,
    initialOwner: Uint8Array,
    name: string,
    symbol: string,
    decimals: number | bigint
  ): ConstructorResult<PS> {
    if (initialOwner.length !== 32) {
      throw new Error(`Invalid initialOwner length: expected 32 bytes, got ${initialOwner.length}`);
    }
    const decBigInt = BigInt(decimals);
    if (decBigInt < 0n || decBigInt > 255n) {
      throw new Error(`Invalid decimals: must be between 0 and 255, got ${decimals}`);
    }

    return this.contract.initialState(
      context,
      initialOwner,
      name,
      symbol,
      decBigInt
    );
  }

  /**
   * Retrieves the token name via circuit execution.
   *
   * @param context - The current circuit execution context.
   * @returns CircuitResults containing updated context and the string token name.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  /**
   * Retrieves the token symbol via circuit execution.
   *
   * @param context - The current circuit execution context.
   * @returns CircuitResults containing updated context and the string token symbol.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  /**
   * Retrieves the token decimals precision via circuit execution.
   *
   * @param context - The current circuit execution context.
   * @returns CircuitResults containing updated context and the token decimal count.
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  /**
   * Retrieves the current circulating total token supply.
   *
   * @param context - The current circuit execution context.
   * @returns CircuitResults containing updated context and total supply as a bigint.
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  /**
   * Queries the token balance for a specific account identity.
   *
   * @param context - The current circuit execution context.
   * @param account - The 32-byte account public identifier.
   * @returns CircuitResults containing updated context and account balance.
   */
  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array
  ): CircuitResults<PS, bigint> {
    if (account.length !== 32) {
      throw new Error(`Invalid account length: expected 32 bytes, got ${account.length}`);
    }
    return this.contract.circuits.balanceOf(context, account);
  }

  /**
   * Queries the spending allowance granted by an owner to a spender.
   *
   * @param context - The current circuit execution context.
   * @param ownerAccount - The 32-byte owner account identity.
   * @param spender - The 32-byte spender account identity.
   * @returns CircuitResults containing updated context and remaining allowance.
   */
  public allowance(
    context: CircuitContext<PS>,
    ownerAccount: Uint8Array,
    spender: Uint8Array
  ): CircuitResults<PS, bigint> {
    if (ownerAccount.length !== 32) {
      throw new Error(`Invalid ownerAccount length: expected 32 bytes, got ${ownerAccount.length}`);
    }
    if (spender.length !== 32) {
      throw new Error(`Invalid spender length: expected 32 bytes, got ${spender.length}`);
    }
    return this.contract.circuits.allowance(context, ownerAccount, spender);
  }

  /**
   * Transfers tokens from the authenticated caller to a recipient.
   *
   * @param context - The current circuit execution context.
   * @param caller - The 32-byte account identity of the caller.
   * @param to - The 32-byte account identity of the recipient.
   * @param value - The token amount to transfer.
   * @returns CircuitResults containing updated context and boolean success indicator.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    if (caller.length !== 32) {
      throw new Error(`Invalid caller length: expected 32 bytes, got ${caller.length}`);
    }
    if (to.length !== 32) {
      throw new Error(`Invalid to length: expected 32 bytes, got ${to.length}`);
    }
    if (value < 0n) {
      throw new Error(`Transfer value must be non-negative, got ${value}`);
    }
    return this.contract.circuits.transfer(context, caller, to, value);
  }

  /**
   * Approves a spender to spend a specified amount of tokens on behalf of the caller.
   *
   * @param context - The current circuit execution context.
   * @param caller - The 32-byte account identity of the approving owner.
   * @param spender - The 32-byte account identity of the authorized spender.
   * @param value - The maximum amount the spender is permitted to withdraw.
   * @returns CircuitResults containing updated context and boolean success indicator.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    if (caller.length !== 32) {
      throw new Error(`Invalid caller length: expected 32 bytes, got ${caller.length}`);
    }
    if (spender.length !== 32) {
      throw new Error(`Invalid spender length: expected 32 bytes, got ${spender.length}`);
    }
    if (value < 0n) {
      throw new Error(`Approval value must be non-negative, got ${value}`);
    }
    return this.contract.circuits.approve(context, caller, spender, value);
  }

  /**
   * Transfers tokens on behalf of an owner using a pre-approved allowance.
   *
   * @param context - The current circuit execution context.
   * @param caller - The 32-byte account identity of the authorized caller (spender).
   * @param fromAccount - The 32-byte account identity of the token owner.
   * @param to - The 32-byte recipient account identity.
   * @param value - The token amount to transfer.
   * @returns CircuitResults containing updated context and boolean success indicator.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    if (caller.length !== 32) {
      throw new Error(`Invalid caller length: expected 32 bytes, got ${caller.length}`);
    }
    if (fromAccount.length !== 32) {
      throw new Error(`Invalid fromAccount length: expected 32 bytes, got ${fromAccount.length}`);
    }
    if (to.length !== 32) {
      throw new Error(`Invalid to length: expected 32 bytes, got ${to.length}`);
    }
    if (value < 0n) {
      throw new Error(`Transfer value must be non-negative, got ${value}`);
    }
    return this.contract.circuits.transferFrom(context, caller, fromAccount, to, value);
  }

  /**
   * Mints new tokens to the target recipient. Can only be invoked by the contract owner.
   *
   * @param context - The current circuit execution context.
   * @param to - The 32-byte recipient account identity.
   * @param value - The token amount to mint.
   * @returns CircuitResults containing updated context and boolean success indicator.
   */
  public mint(
    context: CircuitContext<PS>,
    to: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    if (to.length !== 32) {
      throw new Error(`Invalid to length: expected 32 bytes, got ${to.length}`);
    }
    if (value < 0n) {
      throw new Error(`Mint value must be non-negative, got ${value}`);
    }
    return this.contract.circuits.mint(context, to, value);
  }

  /**
   * Burns tokens from the authenticated caller's balance, reducing the total supply.
   *
   * @param context - The current circuit execution context.
   * @param caller - The 32-byte account identity of the caller burning tokens.
   * @param value - The token amount to burn.
   * @returns CircuitResults containing updated context and boolean success indicator.
   */
  public burn(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    value: bigint
  ): CircuitResults<PS, boolean> {
    if (caller.length !== 32) {
      throw new Error(`Invalid caller length: expected 32 bytes, got ${caller.length}`);
    }
    if (value < 0n) {
      throw new Error(`Burn value must be non-negative, got ${value}`);
    }
    return this.contract.circuits.burn(context, caller, value);
  }

  /**
   * Decodes and reads the typed ledger state from raw contract state bytes or query objects.
   *
   * @param rawState - The raw state or state value returned from the Midnight query context.
   * @returns The decoded strongly-typed ledger state.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenV22LedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}
```
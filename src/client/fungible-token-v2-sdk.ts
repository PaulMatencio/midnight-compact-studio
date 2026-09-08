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
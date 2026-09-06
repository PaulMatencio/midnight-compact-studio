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
  public initialState(context: ConstructorContext<PS>, initialOwner: Uint8Array = new Uint8Array(32)): ConstructorResult<PS> {
    return this.contract.initialState(context, initialOwner);
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
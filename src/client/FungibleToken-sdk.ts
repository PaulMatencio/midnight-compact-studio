// SPDX-License-Identifier: MIT
/**
 * @file FungibleToken-sdk.ts
 * Production-grade TypeScript Client SDK for the Midnight FungibleToken Compact smart contract.
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
} from '../../contracts/managed/fungible-token/contract/index.js';

/**
 * Client-side private state interface for FungibleToken operations.
 */
export interface FungibleTokenPrivateState {
  /** Optional off-chain signing key or identity identifier */
  readonly localAccountKey?: Uint8Array;
  /** Custom extensible off-chain metadata */
  readonly [key: string]: unknown;
}

/**
 * Witness context type mapping for the FungibleToken contract.
 */
export type FungibleTokenWitnessContext<PS extends FungibleTokenPrivateState> = WitnessContext<
  ContractLedger,
  PS
>;

/**
 * Strongly-typed witness implementations for FungibleToken.
 */
export interface FungibleTokenWitnesses<PS extends FungibleTokenPrivateState = FungibleTokenPrivateState>
  extends ContractWitnesses<PS> {}

/**
 * Typed on-chain ledger state representation.
 */
export type FungibleTokenLedgerState = ContractLedger;

/**
 * High-level client SDK for interacting with the Midnight FungibleToken smart contract.
 */
export class FungibleTokenClient<PS extends FungibleTokenPrivateState = FungibleTokenPrivateState> {
  private readonly contract: ManagedContract<PS>;

  /**
   * Initializes a new instance of the FungibleTokenClient.
   * @param witnesses Optional witness implementations.
   */
  public constructor(witnesses: FungibleTokenWitnesses<PS> = {} as FungibleTokenWitnesses<PS>) {
    this.contract = new ManagedContract<PS>(witnesses);
  }

  /**
   * Builds the initial contract state using the provided constructor context.
   * @param context Constructor context containing initial private state and coin public key.
   * @returns ConstructorResult containing the initial contract state and private state.
   */
  public initialState(context: ConstructorContext<PS>, initialOwner: Uint8Array = new Uint8Array(32)): ConstructorResult<PS> {
    return this.contract.initialState(context, initialOwner);
  }

  /**
   * Initializes token metadata and parameters.
   * @param context Circuit execution context.
   * @param name Human-readable token name.
   * @param symbol Token ticker symbol.
   * @param decimals Decimal precision.
   */
  public initialize(
    context: CircuitContext<PS>,
    name: string,
    symbol: string,
    decimals: bigint | number,
  ): CircuitResults<PS, []> {
    return this.contract.circuits.initialize(context, name, symbol, BigInt(decimals));
  }

  /**
   * Retrieves the token name from ledger state.
   * @param context Circuit execution context.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.name(context);
  }

  /**
   * Retrieves the token symbol from ledger state.
   * @param context Circuit execution context.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contract.circuits.symbol(context);
  }

  /**
   * Retrieves the token decimal precision from ledger state.
   * @param context Circuit execution context.
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.decimals(context);
  }

  /**
   * Retrieves the total circulating token supply.
   * @param context Circuit execution context.
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contract.circuits.totalSupply(context);
  }

  /**
   * Queries the token balance for a specified 32-byte account address.
   * @param context Circuit execution context.
   * @param account 32-byte account address.
   */
  public balanceOf(context: CircuitContext<PS>, account: Uint8Array): CircuitResults<PS, bigint> {
    return this.contract.circuits.balanceOf(context, account);
  }

  /**
   * Queries the spending allowance granted by owner to spender.
   * @param context Circuit execution context.
   * @param owner 32-byte owner account address.
   * @param spender 32-byte spender account address.
   */
  public allowance(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array,
  ): CircuitResults<PS, bigint> {
    return this.contract.circuits.allowance(context, owner, spender);
  }

  /**
   * Transfers tokens from caller to the recipient address.
   * @param context Circuit execution context.
   * @param caller 32-byte sender account address.
   * @param to 32-byte recipient account address.
   * @param value Amount of tokens to transfer.
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
   * Approves a spender to withdraw up to value tokens from caller account.
   * @param context Circuit execution context.
   * @param caller 32-byte owner account address.
   * @param spender 32-byte spender account address.
   * @param value Max allowance granted.
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
   * Executes a transfer on behalf of fromAccount using pre-approved allowance.
   * @param context Circuit execution context.
   * @param caller 32-byte spender account address invoking the circuit.
   * @param fromAccount 32-byte source account address.
   * @param to 32-byte destination account address.
   * @param value Amount of tokens to transfer.
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
   * Low-level transfer circuit execution.
   * @param context Circuit execution context.
   * @param fromAccount 32-byte sender address.
   * @param to 32-byte receiver address.
   * @param value Amount to transfer.
   */
  public _transfer(
    context: CircuitContext<PS>,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits._transfer(context, fromAccount, to, value);
  }

  /**
   * Mints new tokens to the destination account, increasing total supply.
   * @param context Circuit execution context.
   * @param account 32-byte receiver address.
   * @param value Amount of tokens to mint.
   */
  public mint(
    context: CircuitContext<PS>,
    account: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits._mint(context, account, value);
  }

  /**
   * Burns tokens from the specified account, decreasing total supply.
   * @param context Circuit execution context.
   * @param account 32-byte sender address to burn tokens from.
   * @param value Amount of tokens to burn.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits._burn(context, account, value);
  }

  /**
   * Internal approval circuit execution updating the allowances map directly.
   * @param context Circuit execution context.
   * @param owner 32-byte owner address.
   * @param spender 32-byte spender address.
   * @param value Allowance amount.
   */
  public _approve(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits._approve(context, owner, spender, value);
  }

  /**
   * Deducts allowance spent by spender from owner's allowance limit.
   * @param context Circuit execution context.
   * @param owner 32-byte owner address.
   * @param spender 32-byte spender address.
   * @param value Amount deducted.
   */
  public _spendAllowance(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array,
    value: bigint,
  ): CircuitResults<PS, []> {
    return this.contract.circuits._spendAllowance(context, owner, spender, value);
  }

  /**
   * Parses raw on-chain state into a strongly-typed FungibleTokenLedgerState object.
   * @param rawState The raw state object from contract query context or indexer.
   * @returns Typed on-chain ledger state accessor.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown,
  ): FungibleTokenLedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }
}
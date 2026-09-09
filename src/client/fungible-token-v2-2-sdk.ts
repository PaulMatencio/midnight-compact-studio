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
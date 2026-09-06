/**
 * Production Client SDK for FungibleToken Compact Smart Contract
 * Filename: src/client/fungible-token-sdk.ts
 *
 * Provides strongly typed interfaces, context management, and circuit wrappers
 * for interacting with the fungible-token contract on the Midnight blockchain.
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
 * Interface representing the off-chain private state for the caller session.
 */
export interface FungibleTokenPrivateState {
  readonly signingKey?: Uint8Array;
  readonly [customKey: string]: unknown;
}

/**
 * Strongly typed ledger state representing public on-chain storage.
 */
export type FungibleTokenLedgerState = ContractLedger;

/**
 * Generic witness function signature adhering to Midnight runtime conventions.
 */
export type WitnessFn<PS, TReturn = void, TArgs extends unknown[] = unknown[]> = (
  context: WitnessContext<ContractLedger, PS>,
  ...args: TArgs
) => [PS, TReturn];

/**
 * Strongly typed witnesses container for off-chain computation callbacks.
 */
export type FungibleTokenWitnesses<PS> = Partial<ContractWitnesses<PS>> & {
  readonly [witnessName: string]: WitnessFn<PS, any, any[]> | undefined;
};

/**
 * Production-ready TypeScript Client SDK Adapter for FungibleToken.
 */
export class FungibleTokenClient<PS extends FungibleTokenPrivateState = FungibleTokenPrivateState> {
  private readonly contractInstance: ManagedContract<PS>;

  /**
   * Initializes the FungibleToken SDK client with required witness bindings.
   *
   * @param witnesses Optional implementation of off-chain witness functions.
   */
  constructor(witnesses: FungibleTokenWitnesses<PS> = {}) {
    this.contractInstance = new ManagedContract<PS>(witnesses as ContractWitnesses<PS>);
  }

  /**
   * Generates the initial contract and runtime states for deployment.
   *
   * @param context Constructor context containing initial private state and coin public key.
   * @returns ConstructorResult containing initial contract and private states.
   */
  public initialState(context: ConstructorContext<PS>, initialOwner: Uint8Array = new Uint8Array(32)): ConstructorResult<PS> {
    return this.contractInstance.initialState(context, initialOwner);
  }

  /**
   * Invokes the `initialize` circuit to set metadata on the token.
   *
   * @param context Circuit execution context.
   * @param name Token name string.
   * @param symbol Token symbol ticker.
   * @param decimals Token decimal places (0 to 255).
   * @returns Circuit execution results containing updated context and empty tuple `[]`.
   */
  public initialize(
    context: CircuitContext<PS>,
    name: string,
    symbol: string,
    decimals: bigint | number
  ): CircuitResults<PS, []> {
    const decimalsBigInt = typeof decimals === 'number' ? BigInt(decimals) : decimals;
    return this.contractInstance.circuits.initialize(context, name, symbol, decimalsBigInt);
  }

  /**
   * Invokes the `name` circuit to query the on-chain token name.
   *
   * @param context Circuit execution context.
   * @returns Circuit execution results containing token name string.
   */
  public name(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contractInstance.circuits.name(context);
  }

  /**
   * Invokes the `symbol` circuit to query the on-chain token symbol.
   *
   * @param context Circuit execution context.
   * @returns Circuit execution results containing token symbol string.
   */
  public symbol(context: CircuitContext<PS>): CircuitResults<PS, string> {
    return this.contractInstance.circuits.symbol(context);
  }

  /**
   * Invokes the `decimals` circuit to query the token decimals.
   *
   * @param context Circuit execution context.
   * @returns Circuit execution results containing decimals as bigint.
   */
  public decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contractInstance.circuits.decimals(context);
  }

  /**
   * Invokes the `totalSupply` circuit to query the total token supply.
   *
   * @param context Circuit execution context.
   * @returns Circuit execution results containing total supply as bigint.
   */
  public totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint> {
    return this.contractInstance.circuits.totalSupply(context);
  }

  /**
   * Invokes the `balanceOf` circuit to retrieve the balance for an account.
   *
   * @param context Circuit execution context.
   * @param account 32-byte address public key.
   * @returns Circuit execution results containing the balance as bigint.
   */
  public balanceOf(
    context: CircuitContext<PS>,
    account: Uint8Array
  ): CircuitResults<PS, bigint> {
    this.assertValidAddress(account, 'account');
    return this.contractInstance.circuits.balanceOf(context, account);
  }

  /**
   * Invokes the `allowance` circuit to query the approved spend limit for a spender.
   *
   * @param context Circuit execution context.
   * @param owner 32-byte token owner address.
   * @param spender 32-byte authorized spender address.
   * @returns Circuit execution results containing approved allowance.
   */
  public allowance(
    context: CircuitContext<PS>,
    owner: Uint8Array,
    spender: Uint8Array
  ): CircuitResults<PS, bigint> {
    this.assertValidAddress(owner, 'owner');
    this.assertValidAddress(spender, 'spender');
    return this.contractInstance.circuits.allowance(context, owner, spender);
  }

  /**
   * Executes a direct transfer of token units from caller to recipient.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte sender address.
   * @param to 32-byte recipient address.
   * @param value Amount of tokens to transfer.
   * @returns Circuit execution results returning true on success.
   */
  public transfer(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    to: Uint8Array,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    this.assertValidAddress(caller, 'caller');
    this.assertValidAddress(to, 'to');
    const valueBigInt = typeof value === 'number' ? BigInt(value) : value;
    return this.contractInstance.circuits.transfer(context, caller, to, valueBigInt);
  }

  /**
   * Approves a spender to transfer up to a specified allowance from the caller's account.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte owner address granting allowance.
   * @param spender 32-byte spender address.
   * @param value Max amount approved for spending.
   * @returns Circuit execution results returning true on success.
   */
  public approve(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    spender: Uint8Array,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    this.assertValidAddress(caller, 'caller');
    this.assertValidAddress(spender, 'spender');
    const valueBigInt = typeof value === 'number' ? BigInt(value) : value;
    return this.contractInstance.circuits.approve(context, caller, spender, valueBigInt);
  }

  /**
   * Transfers tokens on behalf of an owner using a pre-approved allowance.
   *
   * @param context Circuit execution context.
   * @param caller 32-byte authorized spender address initiating the transfer.
   * @param fromAccount 32-byte owner address whose tokens will be transferred.
   * @param to 32-byte recipient address.
   * @param value Amount of tokens to transfer.
   * @returns Circuit execution results returning true on success.
   */
  public transferFrom(
    context: CircuitContext<PS>,
    caller: Uint8Array,
    fromAccount: Uint8Array,
    to: Uint8Array,
    value: bigint | number
  ): CircuitResults<PS, boolean> {
    this.assertValidAddress(caller, 'caller');
    this.assertValidAddress(fromAccount, 'fromAccount');
    this.assertValidAddress(to, 'to');
    const valueBigInt = typeof value === 'number' ? BigInt(value) : value;
    return this.contractInstance.circuits.transferFrom(
      context,
      caller,
      fromAccount,
      to,
      valueBigInt
    );
  }

  /**
   * Mints tokens to a designated account.
   *
   * @param context Circuit execution context.
   * @param account 32-byte destination address.
   * @param value Amount of tokens to mint.
   * @returns Circuit execution results returning empty tuple `[]`.
   */
  public mint(
    context: CircuitContext<PS>,
    account: Uint8Array,
    value: bigint | number
  ): CircuitResults<PS, []> {
    this.assertValidAddress(account, 'account');
    const valueBigInt = typeof value === 'number' ? BigInt(value) : value;
    return this.contractInstance.circuits._mint(context, account, valueBigInt);
  }

  /**
   * Burns tokens from a designated account.
   *
   * @param context Circuit execution context.
   * @param account 32-byte account address from which tokens are burned.
   * @param value Amount of tokens to burn.
   * @returns Circuit execution results returning empty tuple `[]`.
   */
  public burn(
    context: CircuitContext<PS>,
    account: Uint8Array,
    value: bigint | number
  ): CircuitResults<PS, []> {
    this.assertValidAddress(account, 'account');
    const valueBigInt = typeof value === 'number' ? BigInt(value) : value;
    return this.contractInstance.circuits._burn(context, account, valueBigInt);
  }

  /**
   * Parses raw serialized on-chain ledger state into a strongly typed FungibleTokenLedgerState.
   *
   * @param rawState Raw StateValue, ChargedState, or state byte object from the indexer or query context.
   * @returns Parsed and typed contract ledger state.
   */
  public queryLedgerStateFromRaw(
    rawState: StateValue | ChargedState | unknown
  ): FungibleTokenLedgerState {
    return ledger(rawState as StateValue | ChargedState);
  }

  /**
   * Helper validator to ensure address bytes match Compact 32-byte key specifications.
   */
  private assertValidAddress(address: Uint8Array, fieldName: string): void {
    if (!address || address.length !== 32) {
      throw new Error(
        `Invalid address length for '${fieldName}'. Expected exactly 32 bytes, received ${
          address ? address.length : 0
        } bytes.`
      );
    }
  }
}
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
import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             caller_0: Uint8Array,
             name__0: string,
             symbol__0: string,
             decimals__0: bigint): __compactRuntime.CircuitResults<PS, []>;
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            owner_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           caller_0: Uint8Array,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          caller_0: Uint8Array,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               caller_0: Uint8Array,
               fromAccount_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       to_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type ProvableCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             caller_0: Uint8Array,
             name__0: string,
             symbol__0: string,
             decimals__0: bigint): __compactRuntime.CircuitResults<PS, []>;
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            owner_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           caller_0: Uint8Array,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          caller_0: Uint8Array,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               caller_0: Uint8Array,
               fromAccount_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       to_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             caller_0: Uint8Array,
             name__0: string,
             symbol__0: string,
             decimals__0: bigint): __compactRuntime.CircuitResults<PS, []>;
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            owner_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           caller_0: Uint8Array,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          caller_0: Uint8Array,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               caller_0: Uint8Array,
               fromAccount_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       to_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       caller_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type Ledger = {
  readonly _isInitialized: boolean;
  _balances: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  _allowances: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): {
      isEmpty(): boolean;
      size(): bigint;
      member(key_1: Uint8Array): boolean;
      lookup(key_1: Uint8Array): bigint;
      [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
    }
  };
  readonly _totalSupply: bigint;
  readonly _name: string;
  readonly _symbol: string;
  readonly _decimals: bigint;
  readonly owner: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initialOwner_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

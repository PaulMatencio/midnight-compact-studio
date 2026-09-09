class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  constructor(witnesses: FungibleTokenV22Witnesses<PS>);
  initialState(context: ConstructorContext<PS>): ConstructorResult<PS>;
  initialize(context: CircuitContext<PS>, name: string, symbol: string, decimals: bigint | number): CircuitResults<PS, []>;
  name(context: CircuitContext<PS>): CircuitResults<PS, string>;
  symbol(context: CircuitContext<PS>): CircuitResults<PS, string>;
  decimals(context: CircuitContext<PS>): CircuitResults<PS, bigint>;
  totalSupply(context: CircuitContext<PS>): CircuitResults<PS, bigint>;
  balanceOf(context: CircuitContext<PS>, account: Uint8Array): CircuitResults<PS, bigint>;
  allowance(context: CircuitContext<PS>, ownerAccount: Uint8Array, spender: Uint8Array): CircuitResults<PS, bigint>;
  transfer(context: CircuitContext<PS>, caller: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>;
  approve(context: CircuitContext<PS>, caller: Uint8Array, spender: Uint8Array, value: bigint): CircuitResults<PS, boolean>;
  transferFrom(context: CircuitContext<PS>, caller: Uint8Array, fromAccount: Uint8Array, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>;
  mint(context: CircuitContext<PS>, to: Uint8Array, value: bigint): CircuitResults<PS, boolean>;
  burn(context: CircuitContext<PS>, caller: Uint8Array, value: bigint): CircuitResults<PS, boolean>;
  queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV22LedgerState;
}
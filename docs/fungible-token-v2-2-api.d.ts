class FungibleTokenV22Client<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState> {
  constructor(witnesses: FungibleTokenV22Witnesses<PS>);

  // Account Identity & Authentication Helpers (Bound to contractSalt for replay protection)
  deriveAccount(secretKey: Uint8Array, contractSalt?: string | Uint8Array): Uint8Array;
  static deriveAccount(secretKey: Uint8Array, contractSalt?: string | Uint8Array): Uint8Array;
  getAuthenticatedCaller(secretKey: Uint8Array, contractSalt?: string | Uint8Array): Uint8Array;
  static isAuthorized(secretKey: Uint8Array, targetAccount: Uint8Array, contractSalt?: string | Uint8Array): boolean;
  static createWitnesses<PS extends FungibleTokenV22PrivateState = FungibleTokenV22PrivateState>(secretKey: Uint8Array): FungibleTokenV22Witnesses<PS>;

  // Contract Initialization
  initialState(
    context: ConstructorContext<PS>,
    salt: Uint8Array,
    initialOwner: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint | number,
    maxSupply: bigint | number
  ): ConstructorResult<PS>;

  // Zero-Cost Ledger State Queries (from Node / Indexer state)
  getLedger(state: StateValue | ChargedState): Ledger;
  getBalance(state: StateValue | ChargedState, account: Uint8Array | string): bigint;
  getAllowance(state: StateValue | ChargedState, ownerAccount: Uint8Array | string, spender: Uint8Array | string): bigint;
  isPaused(state: StateValue | ChargedState): boolean;
  getEmergencyPauser(state: StateValue | ChargedState): Uint8Array;
  getOwner(state: StateValue | ChargedState): Uint8Array;
  getTotalSupply(state: StateValue | ChargedState): bigint;
  getMaxSupply(state: StateValue | ChargedState): bigint;
  getName(state: StateValue | ChargedState): string;
  getSymbol(state: StateValue | ChargedState): string;
  getDecimals(state: StateValue | ChargedState): bigint;
  getContractSalt(state: StateValue | ChargedState): Uint8Array;

  // State-Modifying Circuits
  pause(context: CircuitContext<PS>, caller: Uint8Array): CircuitResults<PS, boolean>;
  unpause(context: CircuitContext<PS>, caller: Uint8Array): CircuitResults<PS, boolean>;
  setEmergencyPauser(context: CircuitContext<PS>, caller: Uint8Array, newPauser: Uint8Array): CircuitResults<PS, boolean>;
  transfer(context: CircuitContext<PS>, caller: Uint8Array, to: Uint8Array, value: bigint | number): CircuitResults<PS, boolean>;
  approve(context: CircuitContext<PS>, caller: Uint8Array, spender: Uint8Array, value: bigint | number): CircuitResults<PS, boolean>;
  transferFrom(context: CircuitContext<PS>, caller: Uint8Array, fromAccount: Uint8Array, to: Uint8Array, value: bigint | number): CircuitResults<PS, boolean>;
  mint(context: CircuitContext<PS>, to: Uint8Array, value: bigint | number): CircuitResults<PS, boolean>;
  burn(context: CircuitContext<PS>, caller: Uint8Array, value: bigint | number): CircuitResults<PS, boolean>;
  emergencyWithdraw(context: CircuitContext<PS>, caller: Uint8Array, token: Uint8Array, amount: bigint | number): CircuitResults<PS, boolean>;

  // Ledger Query Helper
  queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): FungibleTokenV22LedgerState;
}
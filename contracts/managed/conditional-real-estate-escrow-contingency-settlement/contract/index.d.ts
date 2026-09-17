import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  getCallerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly _contractSalt: Uint8Array;
  readonly buyerPk: Uint8Array;
  readonly sellerPk: Uint8Array;
  readonly inspectorPk: Uint8Array;
  readonly titleAgentPk: Uint8Array;
  readonly propertyHash: Uint8Array;
  readonly purchasePrice: bigint;
  readonly escrowDeposit: bigint;
  readonly inspectionSubmitted: boolean;
  readonly inspectionPassed: boolean;
  readonly financingSubmitted: boolean;
  readonly financingApproved: boolean;
  readonly titleSubmitted: boolean;
  readonly titleCleared: boolean;
  readonly status: number;
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
               _buyerPk_0: Uint8Array,
               _sellerPk_0: Uint8Array,
               _inspectorPk_0: Uint8Array,
               _titleAgentPk_0: Uint8Array,
               _propertyHash_0: Uint8Array,
               _purchasePrice_0: bigint,
               _escrowDeposit_0: bigint,
               _salt_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum EscrowStatus { Created = 0,
                           Funded = 1,
                           ContingenciesPending = 2,
                           ReadyToClose = 3,
                           Disputed = 4,
                           Expired = 5,
                           Settled = 6,
                           Refunded = 7
}

export type Witnesses<PS> = {
  getCallerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  beginContingencyReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  markReadyToClose(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  releaseFunds(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expireEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openDispute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeSettlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  beginContingencyReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  markReadyToClose(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  releaseFunds(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expireEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openDispute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeSettlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  depositEarnestMoney(context: __compactRuntime.CircuitContext<PS>,
                      amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  beginContingencyReview(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  submitInspectionReport(context: __compactRuntime.CircuitContext<PS>,
                         passed_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  confirmFinancingApproval(context: __compactRuntime.CircuitContext<PS>,
                           approved_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  submitTitleClearance(context: __compactRuntime.CircuitContext<PS>,
                       cleared_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  markReadyToClose(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  releaseFunds(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settleEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelAndRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expireEscrow(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openDispute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeRefund(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  resolveDisputeSettlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly contractSalt: Uint8Array;
  readonly buyerPk: Uint8Array;
  readonly sellerPk: Uint8Array;
  readonly inspectorPk: Uint8Array;
  readonly lenderPk: Uint8Array;
  readonly titleAgentPk: Uint8Array;
  readonly escrowAgentPk: Uint8Array;
  readonly disputeResolverPk: Uint8Array;
  readonly propertyHash: Uint8Array;
  readonly purchasePrice: bigint;
  readonly requiredDeposit: bigint;
  readonly depositedAmount: bigint;
  readonly inspectionSubmitted: boolean;
  readonly inspectionPassed: boolean;
  readonly financingSubmitted: boolean;
  readonly financingApproved: boolean;
  readonly titleSubmitted: boolean;
  readonly titleCleared: boolean;
  readonly inspectionDeadline: bigint;
  readonly financingDeadline: bigint;
  readonly titleDeadline: bigint;
  readonly closingDeadline: bigint;
  readonly status: EscrowStatus;
  readonly lifecycleRound: bigint;
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
               _lenderPk_0: Uint8Array,
               _titleAgentPk_0: Uint8Array,
               _escrowAgentPk_0: Uint8Array,
               _disputeResolverPk_0: Uint8Array,
               _propertyHash_0: Uint8Array,
               _purchasePrice_0: bigint,
               _requiredDeposit_0: bigint,
               _inspectionDeadline_0: bigint,
               _financingDeadline_0: bigint,
               _titleDeadline_0: bigint,
               _closingDeadline_0: bigint,
               _salt_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

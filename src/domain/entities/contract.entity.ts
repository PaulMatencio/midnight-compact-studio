/**
 * Domain Entities: Contract & Transactions
 */

export interface ContractDeploymentRecord {
    contractAddress: string;
    deployedAt?: string;
    deployerSeed?: string;
    seed?: string;
    network?: string;
    owner?: string;
    deployerSecretKey?: string;
    deployerAddress?: string;
}

export interface ContractMessageSnapshot {
    contractAddress: string;
    found: boolean;
    message: string;
    raw?: any;
    lastChecked: string;
}

export interface TransactionExecutionReceipt {
    success: boolean;
    message?: string;
    contractAddress?: string;
    txHash: string;
    blockHeight?: number;
    dustPaid: string;
    durationMs: number;
    timestamp: string;
}

export interface DeploymentExecutionReceipt {
    success: boolean;
    contractAddress: string;
    contractType?: string;
    txHash?: string;
    blockHeight?: number | null;
    dustPaid: string;
    durationMs: number;
    network: string;
    deployedAt: string;
}

export interface PreparedDeployData {
    unsealedTxHex: string;
    contractAddress: string;
    contractSalt?: string;
    contractType: string;
    durationMs: number;
}

export interface TransferExecutionReceipt {
    txHash: string;
    dustPaid: string;
    amount: string;
    amountUnits: string;
    receiver: string;
    durationMs: number;
    network: string;
    timestamp: string;
}

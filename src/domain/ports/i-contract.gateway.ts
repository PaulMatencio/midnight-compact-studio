import type {
    TransactionExecutionReceipt,
    DeploymentExecutionReceipt,
    PreparedDeployData,
    ContractMessageSnapshot,
} from '../entities/contract.entity';

export interface DeployContractOptions {
    contractType?: string;
    privateStatePassword?: string;
    constructorArgs?: Record<string, any> | any[];
    deployerAddress?: string;
}

export interface PrepareDeployOptions {
    contractType?: string;
    privateStatePassword?: string;
    constructorArgs?: Record<string, any> | any[];
    deployerAddress?: string;
    shieldedCoinPublicKey?: string;
    shieldedEncryptionPublicKey?: string;
    seed?: string;
}

export interface RecordDeploymentOptions {
    contractAddress: string;
    contractType: string;
    txHash?: string;
    blockHeight?: number | null;
    deployerAddress?: string;
    contractSalt?: string;
    owner?: string;
    dustPaid?: string;
    durationMs?: number;
}

export interface IContractGateway {
    storeMessage(seed: string, message: string, contractAddress?: string): Promise<TransactionExecutionReceipt>;
    executeCircuit(
        seed: string,
        contractAddress: string,
        circuitName: string,
        args?: any[],
        contractType?: string
    ): Promise<TransactionExecutionReceipt>;
    deployContract(seed: string, options?: DeployContractOptions): Promise<DeploymentExecutionReceipt>;
    prepareDeploy(options: PrepareDeployOptions): Promise<PreparedDeployData>;
    recordDeployment(options: RecordDeploymentOptions): Promise<DeploymentExecutionReceipt>;
    getContractState(contractAddress?: string): Promise<ContractMessageSnapshot>;
}

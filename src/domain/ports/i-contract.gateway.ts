import type {
    TransactionExecutionReceipt,
    DeploymentExecutionReceipt,
    ContractMessageSnapshot,
} from '../entities/contract.entity';

export interface DeployContractOptions {
    contractType?: string;
    privateStatePassword?: string;
    constructorArgs?: Record<string, any> | any[];
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
    getContractState(contractAddress?: string): Promise<ContractMessageSnapshot>;
}

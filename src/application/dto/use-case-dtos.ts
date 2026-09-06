import type {
    WalletSnapshot,
    KeyDerivationResult,
    TransferExecutionReceipt,
} from '@/src/domain/entities/wallet.entity';
import type {
    TransactionExecutionReceipt,
    DeploymentExecutionReceipt,
    ContractMessageSnapshot,
} from '@/src/domain/entities/contract.entity';
import type { SystemHealthReport } from '@/src/domain/entities/system.entity';
import type { RegisterDustResult } from '@/src/domain/ports/i-wallet.gateway';

export interface StoreMessageInput {
    seed: string;
    message: string;
    contractAddress?: string;
}

export interface StoreMessageOutput extends TransactionExecutionReceipt {}

export interface DeployContractInput {
    seed: string;
    contractType?: string;
    privateStatePassword?: string;
    constructorArgs?: Record<string, any> | any[];
}

export interface DeployContractOutput extends DeploymentExecutionReceipt {}

export interface GetContractStateInput {
    contractAddress?: string;
}

export interface GetContractStateOutput extends ContractMessageSnapshot {}

export interface GetWalletStatusInput {
    seed: string;
}

export interface GetWalletStatusOutput extends WalletSnapshot {}

export interface RegisterDustInput {
    seed: string;
}

export interface RegisterDustOutput extends RegisterDustResult {}

export interface SendUnshieldedTNightInput {
    seed: string;
    receiver: string;
    amount: string;
}

export interface SendUnshieldedTNightOutput extends TransferExecutionReceipt {}

export interface GetSystemHealthOutput extends SystemHealthReport {}

export interface DeriveKeysInput {
    seed: string;
}

export interface DeriveKeysOutput extends KeyDerivationResult {}

// --- Bulletin Board DTOs ---
export interface GetBulletinBoardStateInput {
    sessionId?: string;
}

export interface ResetBulletinBoardStateInput {
    sessionId?: string;
}

export interface RunBulletinBoardShowcaseInput {
    sessionId?: string;
}

export interface ExecuteBulletinBoardCircuitInput {
    sessionId?: string;
    action: 'post' | 'postMessage' | 'takeDown';
    identity?: string;
    message?: string;
    secretKeyHex?: string;
}


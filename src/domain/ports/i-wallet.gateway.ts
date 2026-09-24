import type { WalletSnapshot, KeyDerivationResult, TransferExecutionReceipt } from '../entities/wallet.entity';

export interface RegisterDustResult {
    success: boolean;
    alreadyRegistered: boolean;
    dustBalance?: string;
    message: string;
}

export interface IWalletGateway {
    getOrCreateWalletContext(seed: string): Promise<any>;
    getWalletStatus(seed: string): Promise<WalletSnapshot>;
    registerForDust(seed: string): Promise<RegisterDustResult>;
    sendUnshieldedTransfer(seed: string, receiver: string, amount: string): Promise<TransferExecutionReceipt>;
    deriveKeys(seed: string): Promise<KeyDerivationResult>;
    evictWallet(seed: string): void;
    clearStoredState(seed: string, target?: 'all' | 'dust'): Promise<void>;
}

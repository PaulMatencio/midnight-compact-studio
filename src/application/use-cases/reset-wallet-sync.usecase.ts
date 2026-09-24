import type { IWalletGateway } from '@/src/domain/ports/i-wallet.gateway';
import type { WalletSnapshot } from '@/src/domain/entities/wallet.entity';

export interface ResetWalletSyncCommand {
    seed: string;
    target?: 'all' | 'dust';
}

export interface ResetWalletSyncResult {
    success: boolean;
    target: 'all' | 'dust';
    message: string;
    snapshot?: WalletSnapshot;
}

export class ResetWalletSyncUseCase {
    constructor(private readonly walletGateway: IWalletGateway) {}

    async execute(command: ResetWalletSyncCommand): Promise<ResetWalletSyncResult> {
        const target = command.target || 'dust';
        const seed = command.seed.trim();

        await this.walletGateway.clearStoredState(seed, target);

        // Immediately trigger background wallet re-instantiation so indexer connection begins right away
        let snapshot: WalletSnapshot | undefined;
        try {
            // Kick off background wallet connection
            void this.walletGateway.getOrCreateWalletContext(seed);
            snapshot = await this.walletGateway.getWalletStatus(seed);
        } catch (e) {
            console.warn('[ResetWalletSyncUseCase] Wallet re-init deferred:', e);
        }

        const message = target === 'dust'
            ? 'DUST engine cached checkpoint cleared. Re-indexing DUST state from indexer stream.'
            : 'All sub-wallet checkpoints cleared. Full synchronization restarted from genesis.';

        return {
            success: true,
            target,
            message,
            snapshot,
        };
    }
}

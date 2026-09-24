import { describe, it, expect, vi } from 'vitest';
import { ResetWalletSyncUseCase } from '@/src/application/use-cases/reset-wallet-sync.usecase';
import type { IWalletGateway } from '@/src/domain/ports/i-wallet.gateway';

describe('ResetWalletSyncUseCase', () => {
    const mockWalletGateway: IWalletGateway = {
        getOrCreateWalletContext: vi.fn().mockResolvedValue({}),
        getWalletStatus: vi.fn().mockResolvedValue({
            isSynced: false,
            syncProgress: {
                isSynced: false,
                percentage: 0,
                appliedId: '0',
                highestTransactionId: '100',
                isConnected: true,
                dust: { applied: '0', highest: '100', percentage: 0 },
            },
            tNightBalance: '10000000',
            tNightDisplay: '10.0',
            dustBalance: '0',
            unshieldedAddress: 'mn_addr_test123',
        }),
        registerForDust: vi.fn(),
        sendUnshieldedTransfer: vi.fn(),
        deriveKeys: vi.fn(),
        evictWallet: vi.fn(),
        clearStoredState: vi.fn().mockResolvedValue(undefined),
    };

    it('clears dust cached state when target is dust', async () => {
        const useCase = new ResetWalletSyncUseCase(mockWalletGateway);
        const seed = '0000000000000000000000000000000000000000000000000000000000000001';

        const result = await useCase.execute({ seed, target: 'dust' });

        expect(mockWalletGateway.clearStoredState).toHaveBeenCalledWith(seed, 'dust');
        expect(mockWalletGateway.getOrCreateWalletContext).toHaveBeenCalledWith(seed);
        expect(result.success).toBe(true);
        expect(result.target).toBe('dust');
        expect(result.message).toContain('DUST');
    });

    it('clears all cached state when target is all', async () => {
        const useCase = new ResetWalletSyncUseCase(mockWalletGateway);
        const seed = '0000000000000000000000000000000000000000000000000000000000000002';

        const result = await useCase.execute({ seed, target: 'all' });

        expect(mockWalletGateway.clearStoredState).toHaveBeenCalledWith(seed, 'all');
        expect(result.success).toBe(true);
        expect(result.target).toBe('all');
        expect(result.message).toContain('All sub-wallet');
    });
});

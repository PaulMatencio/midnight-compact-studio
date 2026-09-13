import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MidnightContractAdapter } from '@/src/infrastructure/midnight/midnight-contract.adapter';
import { balanceAndSubmitLaceTx } from '@/src/infrastructure/midnight/midnight-dapp-connector';

describe('Lace Browser Deployment Architecture', () => {
    describe('MidnightContractAdapter.recordDeployment', () => {
        let adapter: MidnightContractAdapter;
        let mockWalletGateway: any;
        let mockDeploymentStorage: any;
        let mockTxHistoryStorage: any;

        beforeEach(() => {
            mockWalletGateway = {};
            mockDeploymentStorage = {
                saveDeployment: vi.fn().mockResolvedValue(undefined),
                loadDeployment: vi.fn().mockResolvedValue(null),
            };
            mockTxHistoryStorage = {
                storeTxRecord: vi.fn().mockResolvedValue(undefined),
            };

            adapter = new MidnightContractAdapter(
                mockWalletGateway,
                mockDeploymentStorage,
                mockTxHistoryStorage
            );
        });

        it('records deployment and stores tx record with formatted fees', async () => {
            const receipt = await adapter.recordDeployment({
                contractAddress: '0200112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
                contractType: 'counter',
                txHash: 'tx-hash-1234567890',
                blockHeight: 42,
                deployerAddress: 'mn_addr_preprod1mockaddress',
                dustPaid: '300000000000001',
                durationMs: 450,
            });

            expect(receipt.success).toBe(true);
            expect(receipt.contractAddress).toBe('0200112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
            expect(receipt.txHash).toBe('tx-hash-1234567890');
            expect(receipt.blockHeight).toBe(42);
            expect(receipt.dustPaid).toBe('300000000000001');

            // Verify deployment storage called
            expect(mockDeploymentStorage.saveDeployment).toHaveBeenCalledTimes(1);
            const savedDeploy = mockDeploymentStorage.saveDeployment.mock.calls[0][0];
            expect(savedDeploy.contractAddress).toBe('0200112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
            expect(savedDeploy.contractType).toBe('counter');
            expect(savedDeploy.deployerAddress).toBe('mn_addr_preprod1mockaddress');

            // Verify tx history storage called
            expect(mockTxHistoryStorage.storeTxRecord).toHaveBeenCalledTimes(1);
            const savedTx = mockTxHistoryStorage.storeTxRecord.mock.calls[0][0];
            expect(savedTx.contractType).toBe('counter');
            expect(savedTx.txType).toBe('contract_deploy');
            expect(savedTx.dustPaid).toBe('300000000000001');
        });
    });

    describe('balanceAndSubmitLaceTx', () => {
        it('calls balanceUnsealedTransaction and submitTransaction on Lace API', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-tx-hex-string'),
                submitTransaction: vi.fn().mockResolvedValue('submitted-tx-id-777'),
            };

            const progressLogs: string[] = [];
            const result = await balanceAndSubmitLaceTx(
                mockApi as any,
                'unsealed-tx-hex-data',
                (msg) => progressLogs.push(msg)
            );

            expect(result.txHash).toBe('submitted-tx-id-777');
            expect(result.balancedTxHex).toBe('balanced-tx-hex-string');
            expect(mockApi.balanceUnsealedTransaction).toHaveBeenCalledWith('unsealed-tx-hex-data', {});
            expect(mockApi.submitTransaction).toHaveBeenCalledWith('balanced-tx-hex-string');
            expect(progressLogs.some(p => p.includes('Prompting Lace'))).toBe(true);
        });

        it('handles user cancellation gracefully', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockRejectedValue(new Error('User rejected the transaction')),
                submitTransaction: vi.fn(),
            };

            await expect(
                balanceAndSubmitLaceTx(mockApi as any, 'hex', () => {})
            ).rejects.toThrow('Transaction was canceled or rejected in Lace wallet.');
        });

        it('handles DAppConnectorAPIError cleanly without collapsing to generic Error', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockRejectedValue({
                    type: 'DAppConnectorAPIError',
                    code: 'InvalidRequest',
                    reason: 'Unsealed transaction missing fee inputs',
                }),
                submitTransaction: vi.fn(),
            };

            await expect(
                balanceAndSubmitLaceTx(mockApi as any, 'hex', () => {})
            ).rejects.toThrow('Lace failed to balance and sign transaction: [InvalidRequest] Unsealed transaction missing fee inputs');
        });

        it('unwraps Effect-TS FiberFailure and provides helpful DUST fee guidance', async () => {
            const fiberFailure = {
                _id: 'FiberFailure',
                name: 'Error',
                message: '',
                cause: {
                    _id: 'Cause',
                    _tag: 'Fail',
                    failure: {
                        _tag: 'Wallet.InsufficientFunds',
                        tokenType: 'DUST',
                        available: 0n,
                        needed: 300000000000001n,
                    },
                },
            };

            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockRejectedValue(fiberFailure),
                submitTransaction: vi.fn(),
            };

            await expect(
                balanceAndSubmitLaceTx(mockApi as any, 'hex', () => {})
            ).rejects.toThrow(/insufficient DUST.*Wallet\.InsufficientFunds.*available: 0.*required: 300000000000001/);
        });
    });
});


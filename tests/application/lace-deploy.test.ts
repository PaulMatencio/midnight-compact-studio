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
        it('calls balanceUnsealedTransaction and handles void-returning submitTransaction (DApp Connector spec)', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-tx-hex-string'),
                // Midnight DApp Connector API spec: submitTransaction(tx: string): Promise<void>
                submitTransaction: vi.fn().mockResolvedValue(undefined),
            };

            const fetchSpy = vi.fn();
            const originalFetch = global.fetch;
            global.fetch = fetchSpy as any;

            try {
                const progressLogs: string[] = [];
                const result = await balanceAndSubmitLaceTx(
                    mockApi as any,
                    'unsealed-tx-hex-data',
                    (msg) => progressLogs.push(msg)
                );

                expect(result.txHash).toBeDefined();
                expect(typeof result.txHash).toBe('string');
                expect(result.balancedTxHex).toBe('balanced-tx-hex-string');
                expect(mockApi.balanceUnsealedTransaction).toHaveBeenCalledWith('unsealed-tx-hex-data', {});
                expect(mockApi.submitTransaction).toHaveBeenCalledWith('balanced-tx-hex-string');
                // Crucial: Fallback broadcast to /api/contract/broadcast must NOT be called when Lace submitTransaction resolves!
                expect(fetchSpy).not.toHaveBeenCalled();
                expect(progressLogs.some(p => p.includes('Prompting Lace'))).toBe(true);
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('preserves string txId if submitTransaction returns a non-empty string', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-tx-hex-string'),
                submitTransaction: vi.fn().mockResolvedValue('submitted-tx-id-777'),
            };

            const result = await balanceAndSubmitLaceTx(
                mockApi as any,
                'unsealed-tx-hex-data',
                () => {}
            );

            expect(result.txHash).toBe('submitted-tx-id-777');
            expect(result.balancedTxHex).toBe('balanced-tx-hex-string');
        });

        it('recognizes 1012 temporarily banned (in mempool) as already submitted without triggering fallback', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-tx-hex-string'),
                submitTransaction: vi.fn().mockRejectedValue(new Error('Substrate Node Error 1012: Transaction is temporarily banned')),
            };

            const fetchSpy = vi.fn();
            const originalFetch = global.fetch;
            global.fetch = fetchSpy as any;

            try {
                const result = await balanceAndSubmitLaceTx(
                    mockApi as any,
                    'unsealed-tx-hex-data',
                    () => {}
                );

                expect(result.txHash).toBeDefined();
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                global.fetch = originalFetch;
            }
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

        it('falls back to backend node broadcast when Lace submitTransaction fails', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-tx-hex-string'),
                submitTransaction: vi.fn().mockRejectedValue(new Error('Lace submit failed')),
            };

            const originalFetch = global.fetch;
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { txHash: 'node-broadcast-tx-hash-999' },
                }),
            } as any);

            try {
                const result = await balanceAndSubmitLaceTx(
                    mockApi as any,
                    'unsealed-hex',
                    () => {}
                );

                expect(result.txHash).toBe('node-broadcast-tx-hash-999');
                expect(global.fetch).toHaveBeenCalledWith('/api/contract/broadcast', expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ balancedTxHex: 'balanced-tx-hex-string' }),
                }));
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('MidnightContractAdapter.resolveConstructorArgs', () => {
        it('resolves all 8 parameters for fungible-token-v2-4 correctly', async () => {
            const { Contract } = await import('@/contracts/managed/fungible-token-v2-4/contract/index.js');
            const adapter = new MidnightContractAdapter({} as any, {} as any);
            const { resolvedArgs, activeContractSalt } = (adapter as any).resolveConstructorArgs(
                'fungible-token-v2-4',
                Contract,
                undefined,
                'mn_addr_preprod1qz6q9e728h9cvd5zgvh4x55wzgvh4x55wzgvh4x55wzgvh4x55wsqqqq8uphvcv'
            );

            expect(resolvedArgs.length).toBe(8);
            // 0: salt_
            expect(resolvedArgs[0]).toBeInstanceOf(Uint8Array);
            expect(resolvedArgs[0].length).toBe(32);
            // 1: initialOwner
            expect(resolvedArgs[1]).toBeInstanceOf(Uint8Array);
            expect(resolvedArgs[1].length).toBe(32);
            // 2: name_
            expect(typeof resolvedArgs[2]).toBe('string');
            // 3: symbol_
            expect(typeof resolvedArgs[3]).toBe('string');
            // 4: decimals_
            expect(typeof resolvedArgs[4]).toBe('bigint');
            // 5: maxSupply_
            expect(typeof resolvedArgs[5]).toBe('bigint');
            // 6: initialSigners (Vector<3, Bytes<32>>)
            expect(Array.isArray(resolvedArgs[6])).toBe(true);
            expect(resolvedArgs[6].length).toBe(3);
            for (const s of resolvedArgs[6]) {
                expect(s).toBeInstanceOf(Uint8Array);
                expect(s.length).toBe(32);
            }
            // Verify all 3 initial signers are unique
            const hexSet = new Set(resolvedArgs[6].map((s: Uint8Array) => Buffer.from(s).toString('hex')));
            expect(hexSet.size).toBe(3);

            // 7: threshold_
            expect(typeof resolvedArgs[7]).toBe('bigint');
            expect(resolvedArgs[7]).toBe(2n);
        });
    });
});


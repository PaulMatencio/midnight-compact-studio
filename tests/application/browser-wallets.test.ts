import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    SUPPORTED_BROWSER_WALLETS,
    getDetectedWallets,
    getMidnightConnector,
    connectMidnightBrowserWallet,
    connectMidnightLaceWallet,
    connect1AmWallet,
    queryExtensionAddresses,
    extractAddressString,
    balanceAndSubmitBrowserWalletTx,
    formatBrowserWalletError,
} from '@/src/infrastructure/midnight/midnight-dapp-connector';

describe('Browser Wallets (Lace & 1AM)', () => {
    let originalWindowMidnight: any;

    beforeEach(() => {
        originalWindowMidnight = (global as any).window?.midnight;
        if (!(global as any).window) {
            (global as any).window = {};
        }
        (global as any).window.midnight = {};
    });

    afterEach(() => {
        if (originalWindowMidnight !== undefined) {
            (global as any).window.midnight = originalWindowMidnight;
        } else {
            delete (global as any).window.midnight;
        }
    });

    describe('SUPPORTED_BROWSER_WALLETS configuration', () => {
        it('defines Lace and 1AM with correct metadata and download URLs', () => {
            expect(SUPPORTED_BROWSER_WALLETS.lace).toBeDefined();
            expect(SUPPORTED_BROWSER_WALLETS.lace.name).toBe('Midnight Lace');
            expect(SUPPORTED_BROWSER_WALLETS.lace.shortName).toBe('Lace');
            expect(SUPPORTED_BROWSER_WALLETS.lace.downloadUrl).toContain('midnight.network');

            expect(SUPPORTED_BROWSER_WALLETS['1am']).toBeDefined();
            expect(SUPPORTED_BROWSER_WALLETS['1am'].name).toBe('1AM Wallet');
            expect(SUPPORTED_BROWSER_WALLETS['1am'].shortName).toBe('1AM');
            expect(SUPPORTED_BROWSER_WALLETS['1am'].downloadUrl).toBe('https://1am.xyz');
        });
    });

    describe('getDetectedWallets', () => {
        it('returns false for both when window.midnight is empty', () => {
            const detected = getDetectedWallets();
            expect(detected.lace).toBe(false);
            expect(detected['1am']).toBe(false);
        });

        it('detects Lace when window.midnight.mnLace is present', () => {
            (global as any).window.midnight = {
                mnLace: { connect: vi.fn(), name: 'Midnight Lace' }
            };
            const detected = getDetectedWallets();
            expect(detected.lace).toBe(true);
            expect(detected['1am']).toBe(false);
        });

        it('detects 1AM when window.midnight["1am"] is present', () => {
            (global as any).window.midnight = {
                '1am': { connect: vi.fn(), name: '1AM Wallet', rdns: 'xyz.1am.wallet' }
            };
            const detected = getDetectedWallets();
            expect(detected.lace).toBe(false);
            expect(detected['1am']).toBe(true);
        });

        it('detects both Lace and 1AM when both are injected', () => {
            (global as any).window.midnight = {
                mnLace: { connect: vi.fn(), name: 'Midnight Lace' },
                '1am': { connect: vi.fn(), name: '1AM Wallet', rdns: 'xyz.1am.wallet' }
            };
            const detected = getDetectedWallets();
            expect(detected.lace).toBe(true);
            expect(detected['1am']).toBe(true);
        });
    });

    describe('getMidnightConnector resolution', () => {
        const mockLace = { name: 'Midnight Lace', rdns: 'io.lace.wallet', connect: vi.fn() };
        const mock1Am = { name: '1AM Wallet', rdns: 'xyz.1am.wallet', connect: vi.fn() };

        it('returns 1AM connector when requested and available', () => {
            (global as any).window.midnight = {
                mnLace: mockLace,
                '1am': mock1Am,
            };

            const connector = getMidnightConnector('1am');
            expect(connector).toBe(mock1Am);
        });

        it('returns Lace connector when requested and available', () => {
            (global as any).window.midnight = {
                mnLace: mockLace,
                '1am': mock1Am,
            };

            const connector = getMidnightConnector('lace');
            expect(connector).toBe(mockLace);
        });

        it('returns null when requested wallet is not installed', () => {
            (global as any).window.midnight = {
                '1am': mock1Am,
            };

            const connector = getMidnightConnector('lace');
            expect(connector).toBeNull();
        });

        it('falls back to any available connector when no specific wallet is requested', () => {
            (global as any).window.midnight = {
                '1am': mock1Am,
            };

            const connector = getMidnightConnector();
            expect(connector).toBe(mock1Am);
        });

        it('returns null if no midnight extension is injected', () => {
            (global as any).window.midnight = {};
            const connector = getMidnightConnector('1am');
            expect(connector).toBeNull();
        });
    });

    describe('connectMidnightBrowserWallet', () => {
        it('connects to 1AM and extracts unshielded & shielded addresses', async () => {
            const mockConnectedApi = {
                getConfiguration: vi.fn().mockResolvedValue({ networkId: 'preprod' }),
                getUnshieldedAddress: vi.fn().mockResolvedValue('mn_addr_test_1am_unshielded'),
                getShieldedAddress: vi.fn().mockResolvedValue('mn_shielded_1am_shielded'),
                getDustBalance: vi.fn().mockResolvedValue(2500000n),
            };

            const mock1Am = {
                name: '1AM Wallet',
                connect: vi.fn().mockResolvedValue(mockConnectedApi),
            };

            (global as any).window.midnight = {
                '1am': mock1Am,
            };

            const progressLogs: string[] = [];
            const result = await connectMidnightBrowserWallet(
                '1am',
                'preprod',
                (step) => progressLogs.push(step)
            );

            expect(mock1Am.connect).toHaveBeenCalledWith('preprod');
            expect(result.connected).toBe(true);
            expect(result.walletType).toBe('1am');
            expect(result.walletName).toBe('1AM Wallet');
            expect(result.address).toBe('mn_addr_test_1am_unshielded');
            expect(result.shieldedAddress).toBe('mn_shielded_1am_shielded');
            expect(progressLogs.some(msg => msg.includes('1AM Wallet'))).toBe(true);
        });

        it('throws appropriate error when 1AM is not installed', async () => {
            (global as any).window.midnight = {};

            await expect(
                connectMidnightBrowserWallet('1am', 'devnet')
            ).rejects.toThrow(/1AM Wallet.*not detected/);
        });

        it('connect1AmWallet alias works identically to connectMidnightBrowserWallet("1am")', async () => {
            const mockConnectedApi = {
                getUnshieldedAddress: vi.fn().mockResolvedValue('mn_addr_1am_simple_string'),
                getShieldedAddress: vi.fn().mockResolvedValue('mn_shielded_1am_simple_string'),
            };

            (global as any).window.midnight = {
                '1am': {
                    name: '1AM Wallet',
                    connect: vi.fn().mockResolvedValue(mockConnectedApi),
                },
            };

            const result = await connect1AmWallet('testnet');
            expect(result.connected).toBe(true);
            expect(result.walletType).toBe('1am');
            expect(result.address).toBe('mn_addr_1am_simple_string');
        });

        it('connectMidnightLaceWallet alias works identically to connectMidnightBrowserWallet("lace")', async () => {
            const mockConnectedApi = {
                getUnshieldedAddress: vi.fn().mockResolvedValue('mn_addr_lace_test'),
                getShieldedAddress: vi.fn().mockResolvedValue('mn_shielded_lace_test'),
            };

            (global as any).window.midnight = {
                mnLace: {
                    name: 'Midnight Lace',
                    connect: vi.fn().mockResolvedValue(mockConnectedApi),
                },
            };

            const result = await connectMidnightLaceWallet('preview');
            expect(result.connected).toBe(true);
            expect(result.walletType).toBe('lace');
            expect(result.address).toBe('mn_addr_lace_test');
        });
    });

    describe('formatBrowserWalletError', () => {
        it('formats user rejection for 1AM properly', () => {
            const err = new Error('User rejected the connection request');
            const msg = formatBrowserWalletError(err, '1am');
            expect(msg).toContain('Connection request was declined in 1AM Wallet');
        });

        it('formats user rejection for Lace properly', () => {
            const err = new Error('User rejected the connection request');
            const msg = formatBrowserWalletError(err, 'lace');
            expect(msg).toContain('Connection request was declined in Midnight Lace');
        });

        it('preserves generic error messages when not rejection', () => {
            const err = new Error('Network timeout occurred');
            const msg = formatBrowserWalletError(err, '1am');
            expect(msg).toBe('Network timeout occurred');
        });
    });

    describe('balanceAndSubmitBrowserWalletTx', () => {
        it('works with custom walletName in progress messages', async () => {
            const mockApi = {
                balanceUnsealedTransaction: vi.fn().mockResolvedValue('balanced-1am-hex'),
                submitTransaction: vi.fn().mockResolvedValue('tx-hash-1am-999'),
            };

            const progressLogs: string[] = [];
            const result = await balanceAndSubmitBrowserWalletTx(
                mockApi as any,
                'unsealed-hex-payload',
                (step) => progressLogs.push(step),
                '1AM Wallet'
            );

            expect(result.txHash).toBe('tx-hash-1am-999');
            expect(progressLogs.some(log => log.includes('Prompting 1AM Wallet'))).toBe(true);
            expect(progressLogs.some(log => log.includes('Submitting balanced transaction via 1AM Wallet'))).toBe(true);
        });
    });

    describe('queryExtensionAddresses & extractAddressString', () => {
        it('extracts addresses from strings and objects correctly', () => {
            expect(extractAddressString('mn_addr_direct')).toBe('mn_addr_direct');
            expect(extractAddressString({ unshieldedAddress: 'mn_addr_unshielded' })).toBe('mn_addr_unshielded');
            expect(extractAddressString({ address: 'mn_addr_obj' })).toBe('mn_addr_obj');
            expect(extractAddressString({ shieldedAddress: 'mn_shielded_obj' })).toBe('mn_shielded_obj');
            expect(extractAddressString(['mn_addr_in_array'])).toBe('mn_addr_in_array');
            expect(extractAddressString(null)).toBe('');
        });

        it('queries unshielded and shielded addresses dynamically for 1AM / Lace', async () => {
            const mockApi = {
                getUnshieldedAddress: vi.fn().mockResolvedValue('mn_addr_account_1'),
                getShieldedAddresses: vi.fn().mockResolvedValue([
                    {
                        shieldedAddress: 'mn_shielded_1',
                        shieldedCoinPublicKey: 'coin_pub_1',
                        shieldedEncryptionPublicKey: 'enc_pub_1',
                    },
                ]),
            };

            const result1 = await queryExtensionAddresses(mockApi);
            expect(result1.unshieldedAddress).toBe('mn_addr_account_1');
            expect(result1.shieldedAddress).toBe('mn_shielded_1');
            expect(result1.shieldedCoinPublicKey).toBe('coin_pub_1');
            expect(result1.shieldedEncryptionPublicKey).toBe('enc_pub_1');

            // Simulate user switching to Wallet 2 in the 1AM extension
            mockApi.getUnshieldedAddress.mockResolvedValue('mn_addr_account_2');
            mockApi.getShieldedAddresses.mockResolvedValue([
                {
                    shieldedAddress: 'mn_shielded_2',
                    shieldedCoinPublicKey: 'coin_pub_2',
                    shieldedEncryptionPublicKey: 'enc_pub_2',
                },
            ]);

            const result2 = await queryExtensionAddresses(mockApi);
            expect(result2.unshieldedAddress).toBe('mn_addr_account_2');
            expect(result2.shieldedAddress).toBe('mn_shielded_2');
            expect(result2.shieldedCoinPublicKey).toBe('coin_pub_2');
            expect(result2.shieldedEncryptionPublicKey).toBe('enc_pub_2');
        });

        it('gracefully handles null API or missing methods without throwing', async () => {
            const nullResult = await queryExtensionAddresses(null);
            expect(nullResult.unshieldedAddress).toBe('');
            expect(nullResult.shieldedAddress).toBe('');

            const emptyApi = {};
            const emptyResult = await queryExtensionAddresses(emptyApi);
            expect(emptyResult.unshieldedAddress).toBe('');
            expect(emptyResult.shieldedAddress).toBe('');
        });
    });
});

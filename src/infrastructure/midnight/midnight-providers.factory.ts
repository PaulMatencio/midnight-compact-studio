import * as path from 'node:path';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { FilePrivateStateProvider } from '@/src/lib/file-private-state-provider';
import { MIDNIGHT_CONFIG } from '../config/midnight.config';
import { formatDustFee } from '@/src/lib/dust-utils';

// Ensure WebSocket is globally available for GraphQL subscriptions
if (typeof (globalThis as any).WebSocket === 'undefined') {
    (globalThis as any).WebSocket = WebSocket;
}

export interface ProviderOptions {
    privateStatePassword?: string;
    zkConfigPath?: string;
    accountId?: string;
    shieldedCoinPublicKey?: string;
    shieldedEncryptionPublicKey?: string;
}

function normalizeKeyToHex(input?: string): string | undefined {
    if (!input) return undefined;
    const clean = input.trim();
    const cleanHex = clean.replace(/^0x/, '');
    if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
        return cleanHex.toLowerCase();
    }
    if (clean.startsWith('mn_') || clean.startsWith('midnight')) {
        try {
            const { MidnightBech32m } = require('@midnight-ntwrk/wallet-sdk-address-format');
            const parsed = MidnightBech32m.parse(clean);
            if (parsed?.data && parsed.data.length === 32) {
                return Buffer.from(parsed.data).toString('hex').toLowerCase();
            }
        } catch {}
    }
    return undefined;
}

export function createProviders(walletCtx: any, options?: ProviderOptions) {
    const projectRoot = process.cwd();
    const zkConfigPath = options?.zkConfigPath || path.resolve(projectRoot, 'contracts', 'managed', 'hello-world');
    const password = options?.privateStatePassword?.trim() || MIDNIGHT_CONFIG.privateStatePassword;

    const walletProvider = {
        getCoinPublicKey: () => {
            const normalized = normalizeKeyToHex(options?.shieldedCoinPublicKey);
            if (normalized) {
                return normalized;
            }
            return walletCtx?.shieldedSecretKeys?.coinPublicKey ?? '00'.repeat(32);
        },
        getEncryptionPublicKey: () => {
            const normalized = normalizeKeyToHex(options?.shieldedEncryptionPublicKey);
            if (normalized) {
                return normalized;
            }
            return walletCtx?.shieldedSecretKeys?.encryptionPublicKey ?? '00'.repeat(32);
        },
        async balanceTx(tx: any, ttl?: Date) {
            console.log('[Midnight Providers] Balancing transaction and gas fees...');
            const preState: any = await Rx.firstValueFrom(walletCtx.wallet.state()).catch(() => null);
            const preDust = BigInt(preState?.dust?.balance?.(new Date()) ?? 0);

            const recipe = await walletCtx.wallet.balanceUnboundTransaction(
                tx,
                { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
                { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
            );
            const finalized = await walletCtx.wallet.finalizeRecipe(recipe);

            try {
                const fee = await walletCtx.wallet.calculateTransactionFee(finalized);
                if (fee && typeof fee === 'bigint' && fee > 0n) {
                    walletCtx.lastDustFee = fee;
                }
            } catch {
                try {
                    const postState: any = await Rx.firstValueFrom(walletCtx.wallet.state()).catch(() => null);
                    const postDust = BigInt(postState?.dust?.balance?.(new Date()) ?? 0);
                    if (preDust > postDust) {
                        walletCtx.lastDustFee = preDust - postDust;
                    }
                } catch {
                    // Fallback
                }
            }

            console.log(`[Midnight Providers] Transaction balanced. Estimated fee: ${formatDustFee(walletCtx.lastDustFee)} (${walletCtx.lastDustFee?.toString() ?? '0'} SPECK)`);
            return finalized;
        },
        async submitTx(tx: any) {
            console.log('[Midnight Providers] Broadcasting transaction to Midnight node RPC...');
            const txId = await walletCtx.wallet.submitTransaction(tx);
            console.log(`[Midnight Providers] Transaction accepted by node! ID: ${txId}`);
            return txId;
        },
    };

    const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
    const accountId = walletCtx?.unshieldedKeystore?.getBech32Address
        ? walletCtx.unshieldedKeystore.getBech32Address().toString()
        : (options?.accountId || 'studio-deployer');

    // Persistent file-based private state provider
    const privateStateProvider = new FilePrivateStateProvider({
        accountId,
        privateStoragePasswordProvider: () => password,
    });

    const basePublicDataProvider = indexerPublicDataProvider(MIDNIGHT_CONFIG.indexer, MIDNIGHT_CONFIG.indexerWS);
    const publicDataProvider = {
        ...basePublicDataProvider,
        async watchForTxData(txId: string) {
            console.log(`[Midnight Providers] Waiting for transaction ${txId} to be indexed on Preprod...`);
            const timeoutMs = 180000;
            let timeoutHandle: any;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`Transaction indexing timed out after 180s. Tx ID: ${txId}. It may still be processed by the network: check ${MIDNIGHT_CONFIG.explorer}`));
                }, timeoutMs);
            });
            try {
                const res = await Promise.race([
                    basePublicDataProvider.watchForTxData(txId),
                    timeoutPromise,
                ]);
                clearTimeout(timeoutHandle);
                console.log(`[Midnight Providers] Transaction ${txId} confirmed in block ${(res as any)?.blockHeight}!`);
                return res;
            } catch (err) {
                clearTimeout(timeoutHandle);
                throw err;
            }
        },
    };

    return {
        privateStateProvider,
        publicDataProvider,
        zkConfigProvider,
        proofProvider: httpClientProofProvider(MIDNIGHT_CONFIG.proofServer, zkConfigProvider),
        walletProvider,
        midnightProvider: walletProvider,
    };
}

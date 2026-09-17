import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import {
    WalletFacade,
    DustWallet,
    HDWallet,
    Roles,
    ShieldedWallet,
    UnshieldedWallet,
    createKeystore,
    NoOpTransactionHistoryStorage,
    PublicKey,
} from '@midnight-ntwrk/wallet-sdk';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { FileTransactionHistoryStorage } from '@/src/lib/file-transaction-history-storage';
import type { IWalletStateStorage } from '@/src/domain/ports/i-wallet-state.storage';
import { FileWalletStateStorage } from '../persistence/file-wallet-state.storage';
import type { IWalletGateway, RegisterDustResult } from '@/src/domain/ports/i-wallet.gateway';
import type {
    WalletSnapshot,
    KeyDerivationResult,
    TransferExecutionReceipt,
} from '@/src/domain/entities/wallet.entity';
import {
    WalletNotSyncedError,
    InsufficientDustError,
    InsufficientBalanceError,
    InvalidInputError,
} from '@/src/domain/errors/domain-errors';
import { MIDNIGHT_CONFIG } from '../config/midnight.config';

// Polyfill WebSocket
if (typeof (globalThis as any).WebSocket === 'undefined') {
    (globalThis as any).WebSocket = WebSocket;
}

setNetworkId(MIDNIGHT_CONFIG.networkId);

export interface CachedWalletContext {
    wallet: WalletFacade;
    shieldedSecretKeys: any;
    dustSecretKey: any;
    unshieldedKeystore: any;
    seed: string;
    createdAt: number;
    lastDustFee?: bigint;
    latestState?: any;
}

// Global in-memory cache to persist wallet synchronization stream across HTTP requests
const globalCache = globalThis as unknown as { __midnightWalletCache?: Map<string, CachedWalletContext> };
if (!globalCache.__midnightWalletCache) {
    globalCache.__midnightWalletCache = new Map<string, CachedWalletContext>();
}

function deriveKeysInternal(seed: string) {
    const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
    if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
    const result = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
    if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
    hdWallet.hdWallet.clear();
    return result.keys;
}

export class MidnightWalletAdapter implements IWalletGateway {
    private readonly walletCache = globalCache.__midnightWalletCache!;
    private readonly cacheFilePath = path.resolve(process.cwd(), 'wallet-cache.json');
    private readonly walletStateStorage: IWalletStateStorage;

    constructor(
        private readonly txHistoryStorage?: FileTransactionHistoryStorage,
        walletStateStorage?: IWalletStateStorage,
    ) {
        this.walletStateStorage = walletStateStorage || new FileWalletStateStorage();
    }

    async getOrCreateWalletContext(seed: string): Promise<CachedWalletContext> {
        const trimmedSeed = seed.trim();
        if (!trimmedSeed) {
            throw new InvalidInputError('Wallet seed cannot be empty.');
        }

        if (this.walletCache.has(trimmedSeed)) {
            return this.walletCache.get(trimmedSeed)!;
        }

        const keys = deriveKeysInternal(trimmedSeed);
        const networkId = getNetworkId();
        const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
        const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
        const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);
        const bech32Address = unshieldedKeystore.getBech32Address().toString();

        let txHistoryStorage: any = this.txHistoryStorage;
        if (!txHistoryStorage) {
            try {
                txHistoryStorage = new FileTransactionHistoryStorage();
            } catch {
                txHistoryStorage = new NoOpTransactionHistoryStorage();
            }
        }

        const walletConfig = {
            networkId,
            indexerClientConnection: { indexerHttpUrl: MIDNIGHT_CONFIG.indexer, indexerWsUrl: MIDNIGHT_CONFIG.indexerWS },
            provingServerUrl: new URL(MIDNIGHT_CONFIG.proofServer),
            relayURL: new URL(MIDNIGHT_CONFIG.nodeRpc.replace(/^http/, 'ws')),
            txHistoryStorage,
            costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
        };

        let savedState = await this.walletStateStorage.loadState(bech32Address).catch(() => null);
        if (savedState?.updatedAt) {
            const ageMs = Date.now() - new Date(savedState.updatedAt).getTime();
            const MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
            if (isNaN(ageMs) || ageMs > MAX_CHECKPOINT_AGE_MS || process.env.WALLET_FORCE_FRESH_SYNC === 'true') {
                console.warn(`[MidnightWalletAdapter] Stored wallet checkpoint for ${bech32Address} is stale or reset requested (${savedState.updatedAt}). Discarding to prevent testnet tree divergence.`);
                await this.walletStateStorage.clearState(bech32Address).catch(() => {});
                savedState = null;
            }
        }

        const wallet = await WalletFacade.init({
            configuration: walletConfig,
            shielded: (cfg: any) => {
                if (savedState?.shielded) {
                    try {
                        return ShieldedWallet(cfg).restore(savedState.shielded);
                    } catch (e) {
                        console.warn('Failed to restore shielded wallet state, falling back to secret keys:', e);
                    }
                }
                return ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys);
            },
            unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
            dust: (cfg: any) => {
                if (savedState?.dust) {
                    try {
                        return DustWallet(cfg).restore(savedState.dust);
                    } catch (e) {
                        console.warn('Failed to restore dust wallet state, falling back to secret key:', e);
                    }
                }
                return DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);
            },
        });

        await wallet.start(shieldedSecretKeys, dustSecretKey);

        // Periodically serialize and save wallet state to disk (throttled to at most once every 60s)
        let lastPersistTime = 0;
        let isSaving = false;
        wallet.state().pipe(
            Rx.filter((s: any) => Boolean(s?.isSynced && s?.shielded && s?.dust)),
        ).subscribe(async (s: any) => {
            const now = Date.now();
            if (now - lastPersistTime < 60000 || isSaving) {
                return;
            }
            lastPersistTime = now;
            isSaving = true;
            try {
                const serializedShielded = typeof s.shielded?.serialize === 'function' ? s.shielded.serialize() : undefined;
                const serializedDust = typeof s.dust?.serialize === 'function' ? s.dust.serialize() : undefined;
                if (serializedShielded || serializedDust) {
                    await this.walletStateStorage.saveState(bech32Address, {
                        shielded: serializedShielded,
                        dust: serializedDust,
                        updatedAt: new Date().toISOString(),
                    });
                }
            } catch (err) {
                console.warn('[WalletAdapter] Transient error saving serialized wallet state:', err);
            } finally {
                isSaving = false;
            }
        });

        const ctx: CachedWalletContext = {
            wallet,
            shieldedSecretKeys,
            dustSecretKey,
            unshieldedKeystore,
            seed: trimmedSeed,
            createdAt: Date.now(),
        };

        // Continually track live latest state in memory for non-blocking instant status queries
        wallet.state().subscribe({
            next: (s: any) => {
                ctx.latestState = s;
            },
            error: async (err: any) => {
                const msg = err?.message || String(err);
                console.warn('[MidnightWalletAdapter] Wallet state stream warning:', msg);
                if (msg.includes('non-linearly') || msg.includes('commitment tree')) {
                    console.error('[MidnightWalletAdapter] Detected non-linear tree insertion error. Auto-healing by clearing stale checkpoint and cache.');
                    await this.clearStoredState(trimmedSeed).catch(() => {});
                }
            },
        });

        this.walletCache.set(trimmedSeed, ctx);
        return ctx;
    }

    evictWallet(seed: string): void {
        const trimmedSeed = seed.trim();
        this.walletCache.delete(trimmedSeed);
    }

    async clearStoredState(seed: string): Promise<void> {
        const trimmedSeed = seed.trim();
        this.evictWallet(trimmedSeed);
        try {
            const keys = deriveKeysInternal(trimmedSeed);
            const networkId = getNetworkId();
            const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);
            const bech32Address = unshieldedKeystore.getBech32Address().toString();
            await this.walletStateStorage.clearState(bech32Address);
            if (fs.existsSync(this.cacheFilePath)) {
                try {
                    fs.unlinkSync(this.cacheFilePath);
                } catch {}
            }
        } catch (e) {
            console.warn('[MidnightWalletAdapter] Error clearing stored state:', e);
        }
    }

    async getWalletStatus(seed: string): Promise<WalletSnapshot> {
        const walletCtx = await this.getOrCreateWalletContext(seed);

        let state: any = walletCtx.latestState;
        if (!state) {
            state = await Rx.firstValueFrom(
                walletCtx.wallet.state().pipe(
                    Rx.timeout({
                        each: 1500,
                        with: () => Rx.of(null),
                    }),
                ),
            ).catch(() => null);
        }

        const isSynced = state?.isSynced ?? false;

        const unshieldedBalance = state?.unshielded?.balances?.[unshieldedToken().raw] ?? 0n;
        const dustBalance = state?.dust?.balance?.(new Date()) ?? 0n;

        const unshieldedProgress = (state as any)?.unshielded?.progress;
        const shieldedProgress = (state as any)?.shielded?.progress;
        const dustProgress = (state as any)?.dust?.progress;

        const unshieldedApplied = BigInt((unshieldedProgress?.appliedIndex ?? unshieldedProgress?.appliedId ?? unshieldedProgress?.appliedTransactionId ?? 0).toString());
        const unshieldedHighest = BigInt((unshieldedProgress?.highestRelevantIndex ?? unshieldedProgress?.highestIndex ?? unshieldedProgress?.highestTransactionId ?? 0).toString());
        const isUnshieldedStrictlyComplete = typeof unshieldedProgress?.isStrictlyComplete === 'function' ? unshieldedProgress.isStrictlyComplete() : false;

        const shieldedApplied = BigInt((shieldedProgress?.appliedIndex ?? shieldedProgress?.appliedId ?? shieldedProgress?.appliedTransactionId ?? 0).toString());
        const shieldedHighest = BigInt((shieldedProgress?.highestRelevantIndex ?? shieldedProgress?.highestIndex ?? shieldedProgress?.highestRelevantWalletIndex ?? shieldedProgress?.highestTransactionId ?? 0).toString());
        const isShieldedStrictlyComplete = typeof shieldedProgress?.isStrictlyComplete === 'function' ? shieldedProgress.isStrictlyComplete() : false;

        const dustApplied = BigInt((dustProgress?.appliedIndex ?? dustProgress?.appliedId ?? dustProgress?.appliedTransactionId ?? 0).toString());
        const dustHighest = BigInt((dustProgress?.highestRelevantIndex ?? dustProgress?.highestIndex ?? dustProgress?.highestRelevantWalletIndex ?? dustProgress?.highestTransactionId ?? 0).toString());
        const isDustStrictlyComplete = typeof dustProgress?.isStrictlyComplete === 'function' ? dustProgress.isStrictlyComplete() : false;

        const isConnected = unshieldedProgress?.isConnected ?? shieldedProgress?.isConnected ?? dustProgress?.isConnected ?? true;

        const calcPercentage = (applied: bigint, highest: bigint, isStrictlyComplete: boolean): number => {
            if (isStrictlyComplete) return 100;
            if (highest <= 0n) {
                return isStrictlyComplete ? 100 : 0;
            }
            if (applied >= highest) return 100;
            return Math.min(99, Math.max(0, Math.round((Number(applied) / Number(highest)) * 100)));
        };

        const pUnshielded = calcPercentage(unshieldedApplied, unshieldedHighest, isUnshieldedStrictlyComplete);
        const pShielded = calcPercentage(shieldedApplied, shieldedHighest, isShieldedStrictlyComplete);
        const pDust = calcPercentage(dustApplied, dustHighest, isDustStrictlyComplete);

        const isFullySynced = Boolean(isSynced) || (
            (isUnshieldedStrictlyComplete || (unshieldedHighest > 0n && unshieldedApplied >= unshieldedHighest)) &&
            (isShieldedStrictlyComplete || (shieldedHighest > 0n && shieldedApplied >= shieldedHighest)) &&
            (isDustStrictlyComplete || (dustHighest > 0n && dustApplied >= dustHighest))
        );

        let overallPercentage = isFullySynced ? 100 : Math.min(99, Math.floor((pUnshielded + pShielded + pDust) / 3));
        if (overallPercentage >= 100 && !isFullySynced) {
            overallPercentage = 99;
        }

        const effectiveSynced = isFullySynced;

        const bech32Address = walletCtx.unshieldedKeystore.getBech32Address().toString();
        const coinPublicKey = walletCtx.shieldedSecretKeys.coinPublicKey;
        const encryptionPublicKey = walletCtx.shieldedSecretKeys.encryptionPublicKey;

        const tNightDisplay = (Number(unshieldedBalance) / 1_000_000).toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 6,
        });

        const snapshot: WalletSnapshot = {
            isSynced: effectiveSynced,
            syncProgress: {
                isSynced: effectiveSynced,
                percentage: overallPercentage,
                appliedId: unshieldedApplied.toString(),
                highestTransactionId: unshieldedHighest.toString(),
                isConnected,
                unshielded: {
                    applied: unshieldedApplied.toString(),
                    highest: unshieldedHighest.toString(),
                    percentage: pUnshielded,
                },
                shielded: {
                    applied: shieldedApplied.toString(),
                    highest: shieldedHighest.toString(),
                    percentage: pShielded,
                },
                dust: {
                    applied: dustApplied.toString(),
                    highest: dustHighest.toString(),
                    percentage: pDust,
                },
            },
            tNightBalance: unshieldedBalance.toString(),
            tNightDisplay,
            dustBalance: dustBalance.toString(),
            unshieldedAddress: bech32Address,
            coinPublicKey,
            encryptionPublicKey,
            lastDustFee: walletCtx.lastDustFee ? walletCtx.lastDustFee.toString() : undefined,
        };

        try {
            fs.writeFileSync(this.cacheFilePath, JSON.stringify(snapshot, null, 2), 'utf-8');
        } catch {
            // Ignore file write error in serverless environments
        }

        return snapshot;
    }

    async registerForDust(seed: string): Promise<RegisterDustResult> {
        const walletCtx = await this.getOrCreateWalletContext(seed);
        await Promise.race([
            walletCtx.wallet.waitForSyncedState(),
            new Promise((r) => setTimeout(r, 3000)),
        ]);

        const state: any = await Rx.firstValueFrom(
            walletCtx.wallet.state().pipe(
                Rx.filter((s: any) => (s.unshielded?.availableCoins && s.unshielded.availableCoins.length > 0) || s.isSynced),
                Rx.timeout({ each: 10000, with: () => walletCtx.wallet.state() }),
            ),
        ).catch(() => null);

        if (!state || !state.unshielded?.availableCoins || state.unshielded.availableCoins.length === 0) {
            throw new InvalidInputError('No unshielded tNIGHT coins detected yet. Please ensure your wallet has funds from the Nethermind faucet.');
        }

        const currentDust = state.dust?.balance?.(new Date()) ?? 0n;
        if (currentDust > 0n) {
            return {
                success: true,
                alreadyRegistered: true,
                dustBalance: currentDust.toString(),
                message: 'DUST is already active and available for transactions.',
            };
        }

        const nightUtxos = state.unshielded.availableCoins.filter((c: any) => !c.meta?.registeredForDustGeneration);
        if (nightUtxos.length === 0) {
            return {
                success: true,
                alreadyRegistered: true,
                message: 'All available tNIGHT UTXOs are already registered for DUST generation. DUST generation is pending epoch distribution.',
            };
        }

        const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
            nightUtxos,
            walletCtx.unshieldedKeystore.getPublicKey(),
            (payload: any) => walletCtx.unshieldedKeystore.signData(payload),
        );
        const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
        await walletCtx.wallet.submitTransaction(finalized);

        return {
            success: true,
            alreadyRegistered: false,
            message: 'Successfully registered tNIGHT coins for DUST generation. DUST balance will begin accruing.',
        };
    }

    async sendUnshieldedTransfer(seed: string, receiver: string, amount: string): Promise<TransferExecutionReceipt> {
        if (!receiver) {
            throw new InvalidInputError('Receiver address is required');
        }
        const amtNum = Number(amount);
        if (isNaN(amtNum) || amtNum <= 0) {
            throw new InvalidInputError('Amount must be a positive number');
        }
        const amountUnits = BigInt(Math.floor(amtNum * 1_000_000));

        const status = await this.getWalletStatus(seed);
        const isSynced = Boolean(status.isSynced) || (status.syncProgress?.percentage ?? 0) >= 100;
        if (!isSynced) {
            throw new WalletNotSyncedError(status.syncProgress?.percentage);
        }

        const balance = BigInt(status.tNightBalance);
        if (amountUnits > balance) {
            throw new InsufficientBalanceError(status.tNightBalance, amountUnits.toString());
        }

        const walletCtx = await this.getOrCreateWalletContext(seed);
        const wallet = walletCtx.wallet;
        await Promise.race([
            wallet.waitForSyncedState(),
            new Promise((r) => setTimeout(r, 3000)),
        ]);

        const networkId = getNetworkId();
        let receiverAddress: UnshieldedAddress;
        try {
            receiverAddress = MidnightBech32m.parse(receiver.trim()).decode(UnshieldedAddress, networkId);
        } catch {
            if (/^[0-9a-fA-F]{64}$/.test(receiver.trim())) {
                receiverAddress = new UnshieldedAddress(Buffer.from(receiver.trim(), 'hex'));
            } else {
                throw new InvalidInputError(`Invalid receiver unshielded address for network '${networkId}': ${receiver}`);
            }
        }

        const startTime = Date.now();
        const recipe = await wallet.transferTransaction(
            [
                {
                    type: 'unshielded',
                    outputs: [
                        {
                            type: unshieldedToken().raw,
                            receiverAddress,
                            amount: amountUnits,
                        },
                    ],
                },
            ],
            {
                shieldedSecretKeys: walletCtx.shieldedSecretKeys,
                dustSecretKey: walletCtx.dustSecretKey,
            },
            {
                ttl: new Date(Date.now() + 30 * 60 * 1000),
            },
        );

        const signedRecipe = await wallet.signRecipe(recipe, (payload) => walletCtx.unshieldedKeystore.signData(payload));
        const finalized = await wallet.finalizeRecipe(signedRecipe);

        try {
            const fee = await wallet.calculateTransactionFee(finalized);
            if (fee && typeof fee === 'bigint' && fee > 0n) {
                walletCtx.lastDustFee = fee;
            }
        } catch {
            // Ignore fee calculation fallback
        }

        const txId = await wallet.submitTransaction(finalized);
        const durationMs = Date.now() - startTime;
        const dustPaid = walletCtx.lastDustFee ? walletCtx.lastDustFee.toString() : '0';
        const txHash = typeof txId === 'string' ? txId : String(txId || 'submitted');

        const receipt: TransferExecutionReceipt = {
            txHash,
            dustPaid,
            amount,
            amountUnits: amountUnits.toString(),
            receiver: receiver.trim(),
            durationMs,
            network: networkId,
            timestamp: new Date().toISOString(),
        };

        if (this.txHistoryStorage) {
            try {
                await this.txHistoryStorage.storeTxRecord({
                    id: `transfer-${Date.now()}`,
                    txHash,
                    blockHeight: null,
                    message: `Sent ${amount} tNIGHT to ${receiver.slice(0, 10)}...`,
                    txType: 'token_transfer',
                    timestamp: receipt.timestamp,
                    dustPaid,
                    durationMs,
                });
            } catch (e) {
                console.warn('Failed to persist transfer tx record:', e);
            }
        }

        return receipt;
    }

    async deriveKeys(seed: string): Promise<KeyDerivationResult> {
        const trimmedSeed = seed.trim();
        const keys = deriveKeysInternal(trimmedSeed);
        const networkId = getNetworkId();
        const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);
        const bech32Address = unshieldedKeystore.getBech32Address().toString();
        const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);

        return {
            seed: trimmedSeed,
            unshieldedAddress: bech32Address,
            coinPublicKey: shieldedSecretKeys.coinPublicKey,
            encryptionPublicKey: shieldedSecretKeys.encryptionPublicKey,
        };
    }
}

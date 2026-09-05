/**
 * Midnight DApp Connector Adapter
 *
 * Implements client-side detection and connection to Midnight browser wallet extensions
 * (Midnight Lace / Midnight CIP-30 DApp connector) without seed or private key exposure.
 */

export interface MidnightConnectedApi {
    getUnshieldedAddress: () => Promise<string>;
    getShieldedAddress?: () => Promise<string>;
    getShieldedAddresses?: () => Promise<any>;
    getDustAddress?: () => Promise<string>;
    getBalances?: () => Promise<{ tNight?: bigint; dust?: bigint } | any>;
    getBalance?: () => Promise<bigint | number | string>;
    getUnshieldedBalances?: () => Promise<Record<string, bigint> | bigint | any>;
    getShieldedBalances?: () => Promise<Record<string, bigint> | bigint | any>;
    getDustBalance?: () => Promise<bigint | number | string>;
    getNetworkId?: () => Promise<string | number>;
    state?: () => Promise<any>;
    signTransaction?: (tx: any) => Promise<any>;
    submitTransaction?: (tx: any) => Promise<string>;
}

export interface ExtensionBalances {
    tNightBalance: string;
    tNightDisplay: string;
    dustBalance: string;
    dustDisplay?: string;
    dustCap?: string;
    dustCapDisplay?: string;
    shieldedBalance?: string;
    isSynced: boolean;
}

export interface MidnightDAppConnector {
    name?: string;
    icon?: string;
    apiVersion?: string;
    isEnabled: () => Promise<boolean>;
    enable: (networkOrOptions?: string | { networkId?: string } | any) => Promise<MidnightConnectedApi>;
}

export interface ExtensionWalletState {
    isInstalled: boolean;
    isConnected: boolean;
    name: string;
    address: string;
    shieldedAddress?: string;
    networkId?: string;
    tNightBalance?: string;
    dustBalance?: string;
}

/**
 * Checks whether a compatible Midnight browser extension is detected.
 * Inspects all known Midnight & Lace injection points on `window.midnight` and `window.cardano`.
 */
/**
 * Helper to prevent hung promises from blocking wallet connection.
 */
function withTimeout<T = any>(promise: Promise<any>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]).catch(() => fallback);
}

/**
 * Checks whether a compatible Midnight browser extension is detected.
 * Inspects all known Midnight & Lace injection points on `window.midnight`.
 */
export function isMidnightExtensionInstalled(): boolean {
    return getMidnightConnector() !== null;
}

/**
 * Retrieves the detected Midnight wallet connector descriptor.
 */
export function getMidnightConnector(): MidnightDAppConnector | null {
    if (typeof window === 'undefined') return null;

    const w = window as any;

    if (w.midnight && typeof w.midnight === 'object') {
        const allWallets = Object.values(w.midnight) as any[];

        // 1. Official Midnight DApp Connector specification:
        // Prioritize Lace wallet implementing InitialAPI with connect(networkId)
        const laceWallet = allWallets.find(
            (p) => p && typeof p.connect === 'function' && (p.rdns === 'io.lace.wallet' || p.name?.toLowerCase?.().includes('lace'))
        );
        if (laceWallet) return laceWallet;

        // 2. Any other injected Midnight wallet implementing InitialAPI with connect()
        const anyConnectWallet = allWallets.find((p) => p && typeof p.connect === 'function');
        if (anyConnectWallet) return anyConnectWallet;

        // 3. Named keys fallback
        if (w.midnight.mnLace && (typeof w.midnight.mnLace.connect === 'function' || typeof w.midnight.mnLace.enable === 'function')) {
            return w.midnight.mnLace;
        }
        if (w.midnight.lace && (typeof w.midnight.lace.connect === 'function' || typeof w.midnight.lace.enable === 'function')) {
            return w.midnight.lace;
        }

        // 4. Any wallet with enable()
        const anyEnableWallet = allWallets.find((p) => p && typeof p.enable === 'function');
        if (anyEnableWallet) return anyEnableWallet;
    }

    // Cardano Lace multi-chain namespace fallback if explicitly marked for midnight
    if (w.cardano && typeof w.cardano === 'object') {
        if (w.cardano.lace?.midnight) {
            return w.cardano.lace.midnight;
        }
        if (w.cardano.mnLace) {
            return w.cardano.mnLace;
        }
    }

    return null;
}

/**
 * Inspects all wallet provider keys currently present in `window` for diagnostics.
 */
export function getDetectedWalletKeys(): { midnightKeys: string[]; cardanoKeys: string[] } {
    if (typeof window === 'undefined') return { midnightKeys: [], cardanoKeys: [] };
    const w = window as any;
    return {
        midnightKeys: w.midnight && typeof w.midnight === 'object' ? Object.keys(w.midnight) : [],
        cardanoKeys: w.cardano && typeof w.cardano === 'object' ? Object.keys(w.cardano) : [],
    };
}

const VALID_MIDNIGHT_NETWORKS = ['mainnet', 'testnet', 'devnet', 'qanet', 'undeployed', 'preview', 'preprod'];

export function normalizeMidnightNetworkId(net?: string): string {
    if (!net || net === 'active') return 'preprod';
    const lower = net.toLowerCase().trim();
    if (VALID_MIDNIGHT_NETWORKS.includes(lower)) return lower;
    if (lower.includes('preprod')) return 'preprod';
    if (lower.includes('preview')) return 'preview';
    if (lower.includes('dev')) return 'devnet';
    if (lower.includes('test')) return 'testnet';
    if (lower.includes('main')) return 'mainnet';
    return 'preprod';
}

/**
 * Checks whether the current DApp origin is already authorized in Lace.
 */
export async function checkExtensionAuthorization(targetNetwork?: string): Promise<boolean> {
    const connector = getMidnightConnector();
    if (!connector) return false;
    const connectArg = normalizeMidnightNetworkId(targetNetwork);
    try {
        if (typeof (connector as any).isAuthorized === 'function') {
            return await withTimeout((connector as any).isAuthorized(connectArg), 1500, false);
        }
        if (typeof (connector as any).isEnabled === 'function') {
            return await withTimeout((connector as any).isEnabled(connectArg), 1500, false);
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Connects to the Midnight Lace Extension (prompts user approval in extension without exposing seed).
 */
export async function connectMidnightLaceWallet(
    targetNetwork: string = 'preprod',
    onProgress?: (status: string) => void
): Promise<{
    api: MidnightConnectedApi;
    address: string;
    shieldedAddress?: string;
    networkId?: string;
    balances: ExtensionBalances;
}> {
    const connector = getMidnightConnector();
    if (!connector) {
        const keys = getDetectedWalletKeys();
        throw new Error(
            `Midnight Lace browser extension was not detected on window.midnight. (Found window.midnight: [${keys.midnightKeys.join(', ')}], window.cardano: [${keys.cardanoKeys.join(', ')}]). If you just installed Lace, please reload this page.`
        );
    }

    const normalizedNetwork = normalizeMidnightNetworkId(targetNetwork);

    const w = typeof window !== 'undefined' ? (window as any) : null;
    const detectedWallets = w?.midnight ? Object.entries(w.midnight).map(([k, v]: [string, any]) => ({
        key: k,
        name: v?.name,
        apiVersion: v?.apiVersion,
        rdns: v?.rdns,
        hasConnect: typeof v?.connect === 'function',
        hasIsAuthorized: typeof v?.isAuthorized === 'function',
    })) : [];

    console.log('[Midnight Lace Connector] Diagnostics:', {
        requestedNetwork: targetNetwork,
        normalizedNetwork,
        detectedWallets,
        selectedWallet: {
            name: connector.name,
            apiVersion: connector.apiVersion,
            rdns: (connector as any).rdns,
        },
    });

    onProgress?.(`Contacting ${connector.name || 'Lace'} on ${normalizedNetwork} network...`);

    let api: any;
    try {
        // Prioritize Midnight standard connector.connect(networkId)
        if (typeof (connector as any).connect === 'function') {
            console.log(`[Midnight Lace Connector] Authorizing via connector.connect('${normalizedNetwork}')...`);
            onProgress?.('Lace authorization requested: please enter your password if locked, then click Authorize.');
            const connectPromise = (connector as any).connect(normalizedNetwork);

            api = await Promise.race([
                connectPromise,
                new Promise((_, reject) =>
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `Connection request timed out after 3 minutes on network "${normalizedNetwork}". Please check if Lace is unlocked and approve the connection prompt.`
                                )
                            ),
                        180000
                    )
                ),
            ]);
        } else if (typeof connector.enable === 'function') {
            console.log('[Midnight Lace Connector] Authorizing via connector.enable()...');
            onProgress?.('Lace authorization requested: please enter your password if locked, then click Authorize.');
            api = await Promise.race([
                connector.enable(),
                new Promise((_, reject) =>
                    setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `Connection request timed out after 3 minutes. Please check if Lace is unlocked and approve the connection prompt.`
                                )
                            ),
                        180000
                    )
                ),
            ]);
        } else {
            api = connector;
        }
    } catch (err: any) {
        const errMsg = err?.message || err?.reason || String(err);
        const errCode = err?.code || '';

        console.error('[Midnight Lace Connector] Connect error:', err);

        if (
            errCode === 'PermissionRejected' ||
            errMsg.includes('PermissionRejected') ||
            errMsg.includes('rejected') ||
            errMsg.includes('denied') ||
            errMsg.includes('Access to wallet api denied')
        ) {
            throw new Error(
                'Access to Lace wallet was denied or canceled in the extension prompt.'
            );
        }
        if (errMsg.includes('Invalid network ID') || errMsg.includes('Unsupported network ID')) {
            throw new Error(
                `Lace wallet network issue: ${errMsg}. Please ensure your Lace extension is set to the '${normalizedNetwork}' network.`
            );
        }
        if (errMsg.includes('RemoteApiShutdownError') || errMsg.includes('shutdown') || errMsg.includes('can no longer be used') || errMsg.includes('midnight-authenticator')) {
            throw new Error(
                'The Lace extension channel was closed because the previous session was interrupted. Please refresh this browser tab (F5) so Lace establishes a fresh connection channel.'
            );
        }
        throw err;
    }

    console.log('[Midnight Lace Connector] Successfully authorized by Lace! API:', api);
    onProgress?.('Authorized! Reading account addresses and configuration...');

    // 1. Batch hint usage permissions if supported by Lace (CAIP-372 / v4 standard)
    if (typeof api.hintUsage === 'function') {
        try {
            await withTimeout(
                api.hintUsage([
                    'getConfiguration',
                    'getUnshieldedAddress',
                    'getShieldedAddresses',
                    'getDustAddress',
                    'getUnshieldedBalances',
                    'getDustBalance',
                    'getShieldedBalances',
                ]),
                1500,
                undefined
            );
        } catch (hintErr) {
            console.warn('[Midnight Lace Connector] hintUsage note (non-fatal):', hintErr);
        }
    }

    function extractAddressString(val: any): string {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object') {
            if (typeof val.unshieldedAddress === 'string') return val.unshieldedAddress;
            if (typeof val.address === 'string') return val.address;
            if (typeof val.shieldedAddress === 'string') return val.shieldedAddress;
            if (Array.isArray(val) && val.length > 0) return extractAddressString(val[0]);
            try {
                if (typeof val.toString === 'function') {
                    const str = val.toString();
                    if (str && str !== '[object Object]') return str;
                }
            } catch {}
        }
        return '';
    }

    let unshieldedAddress = '';
    let shieldedAddress = '';
    let networkId = targetNetwork;

    // 2. Query configuration and addresses concurrently in parallel
    try {
        const [configRes, netIdRes, unshieldedRes, shieldedRes, multiShieldedRes] = await Promise.allSettled([
            typeof api.getConfiguration === 'function'
                ? withTimeout(api.getConfiguration(), 2000, null)
                : Promise.resolve(null),
            typeof api.getNetworkId === 'function'
                ? withTimeout(api.getNetworkId(), 2000, null)
                : Promise.resolve(null),
            typeof api.getUnshieldedAddress === 'function'
                ? withTimeout(api.getUnshieldedAddress(), 2000, null)
                : Promise.resolve(null),
            typeof api.getShieldedAddress === 'function'
                ? withTimeout(api.getShieldedAddress(), 2000, null)
                : Promise.resolve(null),
            typeof api.getShieldedAddresses === 'function'
                ? withTimeout(api.getShieldedAddresses(), 2000, null)
                : Promise.resolve(null),
        ]);

        if (configRes.status === 'fulfilled' && (configRes.value as any)?.networkId) {
            networkId = (configRes.value as any).networkId;
        } else if (netIdRes.status === 'fulfilled' && netIdRes.value) {
            networkId = String(netIdRes.value);
        }

        if (unshieldedRes.status === 'fulfilled' && unshieldedRes.value) {
            unshieldedAddress = extractAddressString(unshieldedRes.value);
        }

        if (shieldedRes.status === 'fulfilled' && shieldedRes.value) {
            shieldedAddress = extractAddressString(shieldedRes.value);
        } else if (multiShieldedRes.status === 'fulfilled' && multiShieldedRes.value) {
            shieldedAddress = extractAddressString(multiShieldedRes.value);
        }

        // Quick fallback for legacy mock/object format
        if (!unshieldedAddress && (api.address || api.unshieldedAddress)) {
            unshieldedAddress = extractAddressString(api.unshieldedAddress || api.address);
        }
    } catch (err) {
        console.warn('[Midnight Lace Connector] Parallel property inspection warning:', err);
    }

    const finalAddress = unshieldedAddress || shieldedAddress || 'Connected via Midnight Lace';
    let balances: ExtensionBalances = {
        tNightBalance: '0',
        tNightDisplay: '0',
        dustBalance: '0',
        isSynced: true,
    };

    // 3. Query balances in parallel with quick timeout
    try {
        balances = await withTimeout(fetchExtensionWalletBalances(api), 2500, balances);
    } catch (balErr) {
        console.warn('[Midnight Lace Connector] Non-fatal balance fetch warning:', balErr);
    }

    console.log('[Midnight Lace Connector] Connected successfully as:', finalAddress, 'Network:', networkId);

    return {
        api,
        address: finalAddress,
        shieldedAddress,
        networkId,
        balances,
    };
}

/**
 * Fetches token balances directly from the connected Midnight browser wallet extension.
 * Supports @midnight-ntwrk/dapp-connector-api v4 granular methods (getUnshieldedBalances, getDustBalance, getShieldedBalances)
 * executed in parallel for instant responsiveness.
 */
export async function fetchExtensionWalletBalances(api: any): Promise<ExtensionBalances> {
    let tNightBigInt = 0n;
    let dustBigInt = 0n;
    let dustCapBigInt: bigint | undefined = undefined;
    let shieldedBigInt = 0n;

    if (!api) {
        return {
            tNightBalance: '0',
            tNightDisplay: '0',
            dustBalance: '0',
            isSynced: true,
        };
    }

    // Execute standard v4 balance queries in parallel
    try {
        const [unshieldedBalRes, dustBalRes, shieldedBalRes] = await Promise.allSettled([
            typeof api.getUnshieldedBalances === 'function'
                ? withTimeout(api.getUnshieldedBalances(), 2000, null)
                : Promise.resolve(null),
            typeof api.getDustBalance === 'function'
                ? withTimeout(api.getDustBalance(), 2000, null)
                : Promise.resolve(null),
            typeof api.getShieldedBalances === 'function'
                ? withTimeout(api.getShieldedBalances(), 2000, null)
                : Promise.resolve(null),
        ]);

        // 1. Process getUnshieldedBalances
        if (unshieldedBalRes.status === 'fulfilled' && unshieldedBalRes.value != null) {
            const raw: any = unshieldedBalRes.value;
            if (typeof raw === 'bigint') {
                tNightBigInt = raw;
            } else if (typeof raw === 'number' || typeof raw === 'string') {
                try { tNightBigInt = BigInt(raw); } catch {}
            } else if (typeof raw === 'object') {
                const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
                for (const [, val] of entries) {
                    if (typeof val === 'bigint') {
                        tNightBigInt += val;
                    } else if (typeof val === 'number' || typeof val === 'string') {
                        try { tNightBigInt += BigInt(val as any); } catch {}
                    }
                }
            }
        }

        // 2. Process getDustBalance
        if (dustBalRes.status === 'fulfilled' && dustBalRes.value != null) {
            const raw: any = dustBalRes.value;
            if (typeof raw === 'bigint') {
                dustBigInt = raw;
            } else if (typeof raw === 'number' || typeof raw === 'string') {
                try { dustBigInt = BigInt(raw); } catch {}
            } else if (typeof raw === 'object') {
                if (raw.balance !== undefined && raw.balance !== null) {
                    dustBigInt = typeof raw.balance === 'bigint' ? raw.balance : BigInt(raw.balance.toString());
                } else if (raw.dust !== undefined && raw.dust !== null) {
                    dustBigInt = typeof raw.dust === 'bigint' ? raw.dust : BigInt(raw.dust.toString());
                } else if (raw.value !== undefined && raw.value !== null) {
                    dustBigInt = typeof raw.value === 'bigint' ? raw.value : BigInt(raw.value.toString());
                } else if (raw.amount !== undefined && raw.amount !== null) {
                    dustBigInt = typeof raw.amount === 'bigint' ? raw.amount : BigInt(raw.amount.toString());
                }

                if (raw.cap !== undefined && raw.cap !== null) {
                    dustCapBigInt = typeof raw.cap === 'bigint' ? raw.cap : BigInt(raw.cap.toString());
                }
            }
        }

        // 3. Process getShieldedBalances
        if (shieldedBalRes.status === 'fulfilled' && shieldedBalRes.value != null) {
            const raw: any = shieldedBalRes.value;
            if (typeof raw === 'bigint') {
                shieldedBigInt = raw;
            } else if (typeof raw === 'object') {
                const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
                for (const [, val] of entries) {
                    if (typeof val === 'bigint') {
                        shieldedBigInt += val;
                    } else if (typeof val === 'number' || typeof val === 'string') {
                        try { shieldedBigInt += BigInt(val as any); } catch {}
                    }
                }
            }
        }
    } catch (err) {
        console.warn('[Midnight Lace Connector] Parallel balances error:', err);
    }

    // Quick fallback to getBalances() if unshielded was not found
    if (tNightBigInt === 0n && typeof api.getBalances === 'function') {
        try {
            const raw: any = await withTimeout(api.getBalances(), 1500, null);
            if (raw) {
                if (raw.tNight !== undefined) tNightBigInt = BigInt(raw.tNight.toString());
                if (raw.unshielded !== undefined) tNightBigInt = BigInt(raw.unshielded.toString());
                if (raw.dust !== undefined && dustBigInt === 0n) dustBigInt = BigInt(raw.dust.toString());
            }
        } catch (err) {
            console.warn('[Midnight Lace Connector] getBalances fallback error:', err);
        }
    }

    const formattedTNight = (Number(tNightBigInt) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
    });

    // In Midnight, 1 DUST = 10^15 SPECK. If the balance is in base units (SPECK >= 10^9),
    // convert it to human-readable DUST units (divide by 10^15).
    const dustUnits = dustBigInt >= 1_000_000_000n ? Number(dustBigInt) / 1e15 : Number(dustBigInt);
    const formattedDust = dustUnits.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });

    const dustCapUnits = dustCapBigInt !== undefined
        ? (dustCapBigInt >= 1_000_000_000n ? Number(dustCapBigInt) / 1e15 : Number(dustCapBigInt))
        : undefined;
    const formattedDustCap = dustCapUnits !== undefined
        ? dustCapUnits.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        })
        : undefined;

    return {
        tNightBalance: tNightBigInt.toString(),
        tNightDisplay: formattedTNight,
        dustBalance: dustBigInt.toString(),
        dustDisplay: formattedDust,
        dustCap: dustCapBigInt !== undefined ? dustCapBigInt.toString() : undefined,
        dustCapDisplay: formattedDustCap,
        shieldedBalance: shieldedBigInt.toString(),
        isSynced: true,
    };
}


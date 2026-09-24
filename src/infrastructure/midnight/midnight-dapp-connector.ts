/**
 * Midnight DApp Connector Adapter
 *
 * Implements client-side detection and connection to Midnight browser wallet extensions
 * (Midnight Lace / Midnight CIP-30 DApp connector) without seed or private key exposure.
 */

// Polyfill BigInt.prototype.toJSON so JSON.stringify and Effect inspectables never crash on BigInt values
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
    (BigInt.prototype as any).toJSON = function () {
        return this.toString();
    };
}

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
    submitTransaction?: (tx: any) => Promise<string | void>;
    balanceUnsealedTransaction?: (txHex: string, options?: { payFees?: boolean }) => Promise<{ tx: string } | string>;
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
    isLocked?: boolean;
    isChannelShutdown?: boolean;
    errorMessage?: string | null;
}

export function isWalletLockedError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || err?.reason || err?.code || err).toLowerCase();
    return (
        msg.includes('locked') ||
        msg.includes('unlock') ||
        msg.includes('passphrase') ||
        msg.includes('password') ||
        msg.includes('wallet is locked')
    );
}

export function isChannelShutdownError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || err?.reason || err?.code || err).toLowerCase();
    return (
        msg.includes('shutdown') ||
        msg.includes('closed') ||
        msg.includes('channel') ||
        msg.includes('object can no longer be used') ||
        msg.includes('disconnected') ||
        msg.includes('port closed')
    );
}

// Module-level single-flight promise locks to prevent duplicate extension IPC calls
let activeConnectPromise: Promise<any> | null = null;
let activeFetchBalancesPromise: Promise<ExtensionBalances> | null = null;

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
    shieldedCoinPublicKey?: string;
    shieldedEncryptionPublicKey?: string;
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

export type BrowserWalletType = 'lace' | '1am';

export interface BrowserWalletDescriptor {
    id: BrowserWalletType;
    name: string;
    shortName: string;
    description: string;
    website: string;
    downloadUrl: string;
    rdns: string;
    keys: string[];
}

export const SUPPORTED_BROWSER_WALLETS: Record<BrowserWalletType, BrowserWalletDescriptor> = {
    lace: {
        id: 'lace',
        name: 'Midnight Lace',
        shortName: 'Lace',
        description: 'Official Midnight Lace browser extension by IOG',
        website: 'https://midnight.network',
        downloadUrl: 'https://midnight.network',
        rdns: 'io.lace.wallet',
        keys: ['mnLace', 'lace'],
    },
    '1am': {
        id: '1am',
        name: '1AM Wallet',
        shortName: '1AM',
        description: 'Privacy-first Midnight browser extension by 1am.xyz',
        website: 'https://1am.xyz',
        downloadUrl: 'https://1am.xyz',
        rdns: 'xyz.1am.wallet',
        keys: ['1am', 'oneAm', '1AM'],
    },
};

/**
 * Checks whether a compatible Midnight browser extension is detected.
 * If walletType is specified, checks specifically for that wallet ('lace' | '1am').
 */
export function isMidnightExtensionInstalled(walletType?: BrowserWalletType): boolean {
    return getMidnightConnector(walletType) !== null;
}

/**
 * Returns detection status for each supported browser wallet.
 */
export function getDetectedWallets(): Record<BrowserWalletType, boolean> {
    return {
        lace: getMidnightConnector('lace') !== null,
        '1am': getMidnightConnector('1am') !== null,
    };
}

/**
 * Retrieves the detected Midnight wallet connector descriptor.
 * Supports preferring a specific wallet ('lace' | '1am') or discovering any available connector.
 */
export function getMidnightConnector(preferredWallet?: BrowserWalletType): MidnightDAppConnector | null {
    if (typeof window === 'undefined') return null;

    const w = window as any;

    if (w.midnight && typeof w.midnight === 'object') {
        const allWallets = Object.values(w.midnight) as any[];

        // 1. Explicit 1AM Wallet request
        if (preferredWallet === '1am') {
            if (w.midnight['1am'] && (typeof w.midnight['1am'].connect === 'function' || typeof w.midnight['1am'].enable === 'function')) {
                return w.midnight['1am'];
            }
            if (w.midnight.oneAm && (typeof w.midnight.oneAm.connect === 'function' || typeof w.midnight.oneAm.enable === 'function')) {
                return w.midnight.oneAm;
            }
            if (w.midnight['1AM'] && (typeof w.midnight['1AM'].connect === 'function' || typeof w.midnight['1AM'].enable === 'function')) {
                return w.midnight['1AM'];
            }
            const oneAmWallet = allWallets.find(
                (p) =>
                    p &&
                    (typeof p.connect === 'function' || typeof p.enable === 'function') &&
                    (p.rdns?.toLowerCase?.().includes('1am') || p.name?.toLowerCase?.().includes('1am'))
            );
            if (oneAmWallet) return oneAmWallet;
            return null;
        }

        // 2. Explicit Lace Wallet request
        if (preferredWallet === 'lace') {
            const laceWallet = allWallets.find(
                (p) =>
                    p &&
                    typeof p.connect === 'function' &&
                    (p.rdns === 'io.lace.wallet' || p.name?.toLowerCase?.().includes('lace'))
            );
            if (laceWallet) return laceWallet;

            if (w.midnight.mnLace && (typeof w.midnight.mnLace.connect === 'function' || typeof w.midnight.mnLace.enable === 'function')) {
                return w.midnight.mnLace;
            }
            if (w.midnight.lace && (typeof w.midnight.lace.connect === 'function' || typeof w.midnight.lace.enable === 'function')) {
                return w.midnight.lace;
            }
            if (w.cardano?.lace?.midnight) return w.cardano.lace.midnight;
            if (w.cardano?.mnLace) return w.cardano.mnLace;
            return null;
        }

        // 3. No specific preference: look for Lace, then 1AM, then any InitialAPI
        const laceWallet = allWallets.find(
            (p) => p && typeof p.connect === 'function' && (p.rdns === 'io.lace.wallet' || p.name?.toLowerCase?.().includes('lace'))
        );
        if (laceWallet) return laceWallet;

        if (w.midnight['1am'] && (typeof w.midnight['1am'].connect === 'function' || typeof w.midnight['1am'].enable === 'function')) {
            return w.midnight['1am'];
        }
        if (w.midnight.oneAm && (typeof w.midnight.oneAm.connect === 'function' || typeof w.midnight.oneAm.enable === 'function')) {
            return w.midnight.oneAm;
        }
        const oneAmWallet = allWallets.find(
            (p) =>
                p &&
                (typeof p.connect === 'function' || typeof p.enable === 'function') &&
                (p.rdns?.toLowerCase?.().includes('1am') || p.name?.toLowerCase?.().includes('1am'))
        );
        if (oneAmWallet) return oneAmWallet;

        // Named keys fallback
        if (w.midnight.mnLace && (typeof w.midnight.mnLace.connect === 'function' || typeof w.midnight.mnLace.enable === 'function')) {
            return w.midnight.mnLace;
        }
        if (w.midnight.lace && (typeof w.midnight.lace.connect === 'function' || typeof w.midnight.lace.enable === 'function')) {
            return w.midnight.lace;
        }

        // Any other wallet with connect()
        const anyConnectWallet = allWallets.find((p) => p && typeof p.connect === 'function');
        if (anyConnectWallet) return anyConnectWallet;

        // Any wallet with enable()
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
 * Checks whether the current DApp origin is already authorized in the wallet extension.
 */
export async function checkExtensionAuthorization(targetNetwork?: string, walletType?: BrowserWalletType): Promise<boolean> {
    const connector = getMidnightConnector(walletType);
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
 * Connects to a Midnight browser wallet extension (Midnight Lace or 1AM Wallet).
 * Prompts user approval in extension without exposing seed or private keys.
 */
export interface ConnectBrowserWalletResult {
    api: MidnightConnectedApi;
    address: string;
    shieldedAddress?: string;
    shieldedCoinPublicKey?: string;
    shieldedEncryptionPublicKey?: string;
    networkId?: string;
    balances: ExtensionBalances;
    walletType: BrowserWalletType;
    walletName: string;
    connected: boolean;
}

export function extractAddressString(val: any): string {
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

export async function queryExtensionAddresses(api: any): Promise<{
    unshieldedAddress: string;
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
}> {
    let unshieldedAddress = '';
    let shieldedAddress = '';
    let shieldedCoinPublicKey = '';
    let shieldedEncryptionPublicKey = '';

    if (!api) return { unshieldedAddress, shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey };

    try {
        if (typeof api.getUnshieldedAddress === 'function') {
            const unshieldedRes = await withTimeout<any>(api.getUnshieldedAddress(), 2000, null);
            if (unshieldedRes) unshieldedAddress = extractAddressString(unshieldedRes);
        }
        if (typeof api.getShieldedAddresses === 'function') {
            const sAddrs = await withTimeout<any>(api.getShieldedAddresses(), 2000, null);
            const val: any = Array.isArray(sAddrs) ? sAddrs[0] : sAddrs;
            if (val) {
                if (val.shieldedAddress) shieldedAddress = extractAddressString(val.shieldedAddress);
                if (val.shieldedCoinPublicKey) shieldedCoinPublicKey = String(val.shieldedCoinPublicKey);
                if (val.coinPublicKey && !shieldedCoinPublicKey) shieldedCoinPublicKey = String(val.coinPublicKey);
                if (val.shieldedEncryptionPublicKey) shieldedEncryptionPublicKey = String(val.shieldedEncryptionPublicKey);
                if (val.encryptionPublicKey && !shieldedEncryptionPublicKey) shieldedEncryptionPublicKey = String(val.encryptionPublicKey);
            }
        } else if (typeof api.getShieldedAddress === 'function') {
            const sRes = await withTimeout<any>(api.getShieldedAddress(), 2000, null);
            if (sRes) shieldedAddress = extractAddressString(sRes);
        }

        if (!unshieldedAddress && (api.address || api.unshieldedAddress)) {
            unshieldedAddress = extractAddressString(api.unshieldedAddress || api.address);
        }
    } catch (err) {
        console.warn(`[Midnight Browser Wallet Connector] Address query warning:`, err);
    }

    return { unshieldedAddress, shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey };
}

export async function connectMidnightBrowserWallet(
    walletType: BrowserWalletType = 'lace',
    targetNetwork: string = 'preprod',
    onProgress?: (status: string) => void
): Promise<ConnectBrowserWalletResult> {
    const descriptor = SUPPORTED_BROWSER_WALLETS[walletType] || SUPPORTED_BROWSER_WALLETS.lace;
    const friendlyName = descriptor.name;

    if (activeConnectPromise) {
        console.log(`[Midnight Browser Wallet Connector] Connection already in progress; reusing active promise for ${friendlyName}.`);
        onProgress?.(`Connecting to ${friendlyName} extension (reusing active request)...`);
        return activeConnectPromise;
    }

    const connectExecution = async () => {
        const connector = getMidnightConnector(walletType);
        if (!connector) {
            const keys = getDetectedWalletKeys();
            throw new Error(
                `${friendlyName} browser extension was not detected on window.midnight. (Found window.midnight keys: [${keys.midnightKeys.join(', ')}]). If you just installed ${friendlyName}, please reload this page.`
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

        console.log(`[Midnight Browser Wallet Connector] Diagnostics for ${friendlyName}:`, {
            requestedWallet: walletType,
            requestedNetwork: targetNetwork,
            normalizedNetwork,
            detectedWallets,
            selectedWallet: {
                name: connector.name || friendlyName,
                apiVersion: connector.apiVersion,
                rdns: (connector as any).rdns,
            },
        });

        const activeName = connector.name || friendlyName;
        onProgress?.(`Contacting ${activeName} on ${normalizedNetwork} network...`);

        let api: any;
        const callConnect = async (netArg?: string) => {
            if (typeof (connector as any).connect === 'function') {
                return (connector as any).connect(netArg);
            } else if (typeof connector.enable === 'function') {
                return connector.enable();
            } else {
                return connector;
            }
        };

        try {
            console.log(`[Midnight Browser Wallet Connector] Authorizing via connector.connect('${normalizedNetwork}')...`);
            onProgress?.(`${activeName} authorization requested: please enter your password if locked, then click Authorize.`);

            try {
                api = await Promise.race([
                    callConnect(normalizedNetwork),
                    new Promise((_, reject) =>
                        setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        `Connection request timed out after 3 minutes on network "${normalizedNetwork}". Please check if ${activeName} is unlocked and approve the connection prompt.`
                                    )
                                ),
                            180000
                        )
                    ),
                ]);
            } catch (firstErr: any) {
                const firstMsg = firstErr?.message || firstErr?.reason || String(firstErr);
                // 1AM can return "Request failed" when its background worker is cold or "Network mismatch"
                if (
                    walletType === '1am' &&
                    (firstMsg.includes('Request failed') ||
                        firstMsg.includes('Network mismatch') ||
                        firstMsg.includes('Unknown network'))
                ) {
                    console.warn(`[Midnight Browser Wallet Connector] First 1AM connect attempt failed (${firstMsg}). Pausing 500ms and retrying with flexible network...`);
                    onProgress?.(`Contacting 1AM Wallet background worker (waking up extension)...`);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    // 1AM allows omitting networkId to match its active network
                    api = await callConnect(undefined);
                } else {
                    throw firstErr;
                }
            }
        } catch (err: any) {
            const errMsg = err?.message || err?.reason || String(err);
            const errCode = err?.code || '';

            console.error(`[Midnight Browser Wallet Connector] Connect error (${activeName}):`, err);

            if (
                errCode === 'PermissionRejected' ||
                errMsg.includes('PermissionRejected') ||
                errMsg.includes('rejected') ||
                errMsg.includes('denied') ||
                errMsg.includes('Access to wallet api denied')
            ) {
                throw new Error(
                    `Access to ${activeName} wallet was denied or canceled in the extension prompt.`
                );
            }
            if (isWalletLockedError(err)) {
                throw new Error(
                    `Your ${activeName} wallet is locked. Please click the ${activeName} extension icon in your browser toolbar to unlock it with your password, then try connecting again.`
                );
            }
            if (
                errMsg.includes('Request failed') ||
                errMsg.includes('Error forwarding message') ||
                errMsg.includes('No response from wallet background script') ||
                errCode === 'InternalError'
            ) {
                throw new Error(
                    `Could not establish communication with ${activeName} (${errMsg}). ` +
                    `The 1AM extension service worker is either asleep, locked, or this tab needs a reload. ` +
                    `Please click the 1AM icon in your browser toolbar to unlock/wake it, then refresh this page (F5) and click Connect.`
                );
            }
            if (errMsg.includes('Invalid network ID') || errMsg.includes('Unsupported network ID') || errMsg.includes('Network mismatch')) {
                throw new Error(
                    `${activeName} wallet network issue: ${errMsg}. Please ensure your ${activeName} extension is set to the '${normalizedNetwork}' network.`
                );
            }
            if (isChannelShutdownError(err) || errMsg.includes('RemoteApiShutdownError') || errMsg.includes('midnight-authenticator')) {
                throw new Error(
                    `The ${activeName} extension channel was closed because the previous session was interrupted. Please click the ${activeName} extension icon in your browser toolbar to wake or unlock it, then refresh this page.`
                );
            }
            throw err;
        }

        console.log(`[Midnight Browser Wallet Connector] Successfully authorized by ${activeName}! API:`, api);
        onProgress?.('Authorized! Initializing account...');

        // Allow popup window 800ms to cleanly close and finalize internal authorization state before querying
        await new Promise((resolve) => setTimeout(resolve, 800));

        // 1. Batch hint usage permissions if supported (CAIP-372 / v4 standard)
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
                console.warn(`[Midnight Browser Wallet Connector] hintUsage note (non-fatal):`, hintErr);
            }
        }

        const queried = await queryExtensionAddresses(api);
        const unshieldedAddress = queried.unshieldedAddress;
        const shieldedAddress = queried.shieldedAddress;
        const shieldedCoinPublicKey = queried.shieldedCoinPublicKey;
        const shieldedEncryptionPublicKey = queried.shieldedEncryptionPublicKey;

        let networkId = targetNetwork;
        try {
            if (typeof api.getConfiguration === 'function') {
                const configRes = await withTimeout<any>(api.getConfiguration(), 2000, null);
                if (configRes?.networkId) networkId = String(configRes.networkId);
            }
        } catch (err) {
            console.warn(`[Midnight Browser Wallet Connector] Config query warning:`, err);
        }

        const finalAddress = unshieldedAddress || shieldedAddress || `Connected via ${activeName}`;
        let balances: ExtensionBalances = {
            tNightBalance: '0',
            tNightDisplay: '0',
            dustBalance: '0',
            isSynced: true,
        };

        // 3. Query initial balances sequentially
        try {
            balances = await withTimeout(fetchExtensionWalletBalances(api), 3500, balances);
        } catch (balErr) {
            console.warn(`[Midnight Browser Wallet Connector] Non-fatal initial balance fetch warning:`, balErr);
        }

        console.log(`[Midnight Browser Wallet Connector] Connected successfully as:`, finalAddress, 'Network:', networkId, {
            walletType,
            walletName: activeName,
            hasShieldedCoinKey: Boolean(shieldedCoinPublicKey),
            hasShieldedEncKey: Boolean(shieldedEncryptionPublicKey),
        });

        return {
            api,
            address: finalAddress,
            shieldedAddress,
            shieldedCoinPublicKey,
            shieldedEncryptionPublicKey,
            networkId,
            balances,
            walletType,
            walletName: activeName,
            connected: true,
        };
    };

    activeConnectPromise = connectExecution();
    try {
        return await activeConnectPromise;
    } finally {
        activeConnectPromise = null;
    }
}

/**
 * Backwards compatibility alias for connecting to Midnight Lace wallet.
 */
export async function connectMidnightLaceWallet(
    targetNetwork: string = 'preprod',
    onProgress?: (status: string) => void
): Promise<ConnectBrowserWalletResult> {
    return connectMidnightBrowserWallet('lace', targetNetwork, onProgress);
}

/**
 * Connects specifically to 1AM Midnight wallet extension.
 */
export async function connect1AmWallet(
    targetNetwork: string = 'preprod',
    onProgress?: (status: string) => void
): Promise<ConnectBrowserWalletResult> {
    return connectMidnightBrowserWallet('1am', targetNetwork, onProgress);
}

/**
 * Fetches token balances directly from the connected Midnight browser wallet extension.
 * Supports @midnight-ntwrk/dapp-connector-api v4 granular methods (getUnshieldedBalances, getDustBalance, getShieldedBalances)
 * executed sequentially with fast bailout on locked keystore.
 */
export async function fetchExtensionWalletBalances(api: any): Promise<ExtensionBalances> {
    if (!api) {
        return {
            tNightBalance: '0',
            tNightDisplay: '0',
            dustBalance: '0',
            isSynced: false,
            isLocked: false,
            isChannelShutdown: false,
            errorMessage: 'Extension API not connected',
        };
    }

    if (activeFetchBalancesPromise) {
        return activeFetchBalancesPromise;
    }

    const fetchExecution = async (): Promise<ExtensionBalances> => {
        let tNightBigInt = 0n;
        let dustBigInt = 0n;
        let dustCapBigInt: bigint | undefined = undefined;
        let shieldedBigInt = 0n;

        const queryErrors: any[] = [];
        const safeQuery = async <T>(
            fn: () => Promise<T> | T,
            ms: number,
            opName: string
        ): Promise<T | null> => {
            try {
                const p = Promise.resolve().then(() => fn());
                let timer: any = null;
                const timeoutP = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`${opName} timed out after ${ms}ms.`));
                    }, ms);
                });
                const res = await Promise.race([p, timeoutP]);
                clearTimeout(timer);
                return res;
            } catch (err: any) {
                queryErrors.push(err);
                if (isChannelShutdownError(err)) {
                    console.warn(`[Midnight Lace Connector] ${opName} channel shutdown detected:`, err?.message || err);
                } else if (isWalletLockedError(err)) {
                    console.warn(`[Midnight Lace Connector] ${opName} detected wallet lock:`, err?.message || err);
                } else {
                    console.warn(`[Midnight Lace Connector] ${opName} error:`, err);
                }
                return null;
            }
        };

        // 1. Process getUnshieldedBalances sequentially
        let unshieldedRaw = null;
        if (typeof api.getUnshieldedBalances === 'function') {
            unshieldedRaw = await safeQuery(() => api.getUnshieldedBalances(), 4000, 'getUnshieldedBalances');
        } else if (typeof api.getUnshieldedBalance === 'function') {
            unshieldedRaw = await safeQuery(() => api.getUnshieldedBalance(), 4000, 'getUnshieldedBalance');
        }

        // Fast bailout if wallet is locked or channel is shut down - do NOT continue hammering extension
        if (queryErrors.some(isWalletLockedError)) {
            console.warn('[Midnight Lace Connector] Aborting remaining balance queries: wallet is locked.');
            return {
                tNightBalance: '0',
                tNightDisplay: '0',
                dustBalance: '0',
                isSynced: false,
                isLocked: true,
                isChannelShutdown: false,
                errorMessage: 'Your Lace wallet is locked. Please unlock it in the Lace extension toolbar.',
            };
        }
        if (queryErrors.some(isChannelShutdownError)) {
            console.warn('[Midnight Lace Connector] Aborting remaining balance queries: channel is shutdown.');
            return {
                tNightBalance: '0',
                tNightDisplay: '0',
                dustBalance: '0',
                isSynced: false,
                isLocked: false,
                isChannelShutdown: true,
                errorMessage: 'Lace extension background channel was shutdown: object can no longer be used. Please refresh session.',
            };
        }

        if (unshieldedRaw != null) {
            if (typeof unshieldedRaw === 'bigint') {
                tNightBigInt = unshieldedRaw;
            } else if (typeof unshieldedRaw === 'number' || typeof unshieldedRaw === 'string') {
                try { tNightBigInt = BigInt(unshieldedRaw); } catch {}
            } else if (typeof unshieldedRaw === 'object') {
                const entries = unshieldedRaw instanceof Map ? Array.from(unshieldedRaw.entries()) : Object.entries(unshieldedRaw);
                for (const [, val] of entries) {
                    if (typeof val === 'bigint') {
                        tNightBigInt += val;
                    } else if (typeof val === 'number' || typeof val === 'string') {
                        try { tNightBigInt += BigInt(val as any); } catch {}
                    }
                }
            }
        }

        // 2. Process getDustBalance sequentially
        let dustRaw = null;
        if (typeof api.getDustBalance === 'function') {
            dustRaw = await safeQuery(() => api.getDustBalance(), 4000, 'getDustBalance');
        } else if (typeof api.getDustBalances === 'function') {
            dustRaw = await safeQuery(() => api.getDustBalances(), 4000, 'getDustBalances');
        }

        if (queryErrors.some(isWalletLockedError)) {
            console.warn('[Midnight Lace Connector] Aborting remaining balance queries: wallet is locked.');
            return {
                tNightBalance: '0',
                tNightDisplay: '0',
                dustBalance: '0',
                isSynced: false,
                isLocked: true,
                isChannelShutdown: false,
                errorMessage: 'Your Lace wallet is locked. Please unlock it in the Lace extension toolbar.',
            };
        }

        if (dustRaw != null) {
            if (typeof dustRaw === 'bigint') {
                dustBigInt = dustRaw;
            } else if (typeof dustRaw === 'number' || typeof dustRaw === 'string') {
                try { dustBigInt = BigInt(dustRaw); } catch {}
            } else if (typeof dustRaw === 'object') {
                if (dustRaw.balance !== undefined && dustRaw.balance !== null) {
                    dustBigInt = typeof dustRaw.balance === 'bigint' ? dustRaw.balance : BigInt(dustRaw.balance.toString());
                } else if (dustRaw.dust !== undefined && dustRaw.dust !== null) {
                    dustBigInt = typeof dustRaw.dust === 'bigint' ? dustRaw.dust : BigInt(dustRaw.dust.toString());
                } else if (dustRaw.value !== undefined && dustRaw.value !== null) {
                    dustBigInt = typeof dustRaw.value === 'bigint' ? dustRaw.value : BigInt(dustRaw.value.toString());
                } else if (dustRaw.amount !== undefined && dustRaw.amount !== null) {
                    dustBigInt = typeof dustRaw.amount === 'bigint' ? dustRaw.amount : BigInt(dustRaw.amount.toString());
                }

                if (dustRaw.cap !== undefined && dustRaw.cap !== null) {
                    dustCapBigInt = typeof dustRaw.cap === 'bigint' ? dustRaw.cap : BigInt(dustRaw.cap.toString());
                }
            }
        }

        // 3. Process getShieldedBalances sequentially
        let shieldedRaw = null;
        if (typeof api.getShieldedBalances === 'function') {
            shieldedRaw = await safeQuery(() => api.getShieldedBalances(), 4000, 'getShieldedBalances');
        } else if (typeof api.getShieldedBalance === 'function') {
            shieldedRaw = await safeQuery(() => api.getShieldedBalance(), 4000, 'getShieldedBalance');
        }

        if (shieldedRaw != null) {
            if (typeof shieldedRaw === 'bigint') {
                shieldedBigInt = shieldedRaw;
            } else if (typeof shieldedRaw === 'object') {
                const entries = shieldedRaw instanceof Map ? Array.from(shieldedRaw.entries()) : Object.entries(shieldedRaw);
                for (const [, val] of entries) {
                    if (typeof val === 'bigint') {
                        shieldedBigInt += val;
                    } else if (typeof val === 'number' || typeof val === 'string') {
                        try { shieldedBigInt += BigInt(val as any); } catch {}
                    }
                }
            }
        }

        // Quick fallback to getBalances() if unshielded was not found and no error occurred
        if (queryErrors.length === 0 && tNightBigInt === 0n && typeof api.getBalances === 'function') {
            try {
                const raw: any = await safeQuery(() => api.getBalances(), 2000, 'getBalances');
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

        const isLocked = queryErrors.some(isWalletLockedError);
        const isChannelShutdown = queryErrors.some(isChannelShutdownError);

        return {
            tNightBalance: tNightBigInt.toString(),
            tNightDisplay: formattedTNight,
            dustBalance: dustBigInt.toString(),
            dustDisplay: formattedDust,
            dustCap: dustCapBigInt !== undefined ? dustCapBigInt.toString() : undefined,
            dustCapDisplay: formattedDustCap,
            shieldedBalance: shieldedBigInt.toString(),
            isSynced: !isLocked && !isChannelShutdown,
            isLocked,
            isChannelShutdown,
            errorMessage: isLocked
                ? 'Your Lace wallet is locked. Please unlock it in the Lace extension toolbar.'
                : isChannelShutdown
                ? 'Lace extension background channel was shutdown: object can no longer be used. Please refresh session.'
                : null,
        };
    };

    activeFetchBalancesPromise = fetchExecution();
    try {
        return await activeFetchBalancesPromise;
    } finally {
        activeFetchBalancesPromise = null;
    }
}

/**
 * Formats rich error objects thrown by Midnight Lace / DApp Connector into clear human-readable messages.
 * Deeply unwraps Effect-TS FiberFailure and Cause objects to prevent opaque [object Object] errors.
 */
export function formatLaceError(err: any): string {
    if (!err) return 'Unknown wallet error';
    if (typeof err === 'string') return err;

    if (err.type === 'DAppConnectorAPIError') {
        const code = err.code ? `[${err.code}] ` : '';
        const reason = err.reason || err.message || 'Request was rejected by wallet';
        return `${code}${reason}`;
    }

    // Deeply inspect Effect-TS FiberFailure and Cause trees
    if (
        err &&
        (err._id === 'FiberFailure' ||
            err.name === 'FiberFailure' ||
            err[Symbol.for('effect/Runtime/FiberFailure')] ||
            err[Symbol.for('effect/Runtime/FiberFailure/Cause')] ||
            err.cause?._id === 'Cause')
    ) {
        const causeSym = Symbol.for('effect/Runtime/FiberFailure/Cause');
        const cause = err[causeSym] || err.cause;

        const unwrapCause = (c: any): any => {
            if (!c) return null;
            if (c.failure !== undefined) return unwrapCause(c.failure);
            if (c.error !== undefined) return unwrapCause(c.error);
            if (c.defect !== undefined) return unwrapCause(c.defect);
            if (c.cause !== undefined) return unwrapCause(c.cause);
            if (c.left !== undefined) return unwrapCause(c.left) || unwrapCause(c.right);
            if (c.right !== undefined) return unwrapCause(c.right);
            return c;
        };

        const inner = unwrapCause(cause);
        if (inner) {
            if (typeof inner === 'string' && inner.trim()) return inner.trim();
            // If inner is SubmissionError with a deeper cause, extract the deep cause
            let rootMsg = '';
            if (inner.cause) {
                const subCause = unwrapCause(inner.cause);
                if (typeof subCause === 'string' && subCause.trim()) rootMsg = subCause.trim();
                else if (subCause?.message && typeof subCause.message === 'string') rootMsg = subCause.message.trim();
                else if (subCause?.reason && typeof subCause.reason === 'string') rootMsg = subCause.reason.trim();
            }
            if (rootMsg && rootMsg !== 'Transaction submission error') {
                const tag = inner._tag ? `[${inner._tag}] ` : '';
                return `${tag}${inner.message ? `${inner.message}: ` : ''}${rootMsg}`;
            }
            if (inner.message && typeof inner.message === 'string' && inner.message.trim()) {
                const tag = inner._tag ? `[${inner._tag}] ` : '';
                return `${tag}${inner.message.trim()}`;
            }
            if (inner.reason && typeof inner.reason === 'string' && inner.reason.trim()) {
                const tag = inner._tag ? `[${inner._tag}] ` : '';
                return `${tag}${inner.reason.trim()}`;
            }
            if (inner._tag) {
                const details: string[] = [];
                if (inner.tokenType) details.push(`token: ${inner.tokenType}`);
                if (inner.available !== undefined) details.push(`available: ${inner.available}`);
                if (inner.needed !== undefined || inner.required !== undefined) {
                    details.push(`required: ${inner.needed ?? inner.required}`);
                }
                const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
                return `${inner._tag}${detailStr}`;
            }
            try {
                return JSON.stringify(inner, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
            } catch {}
        }

        // Check if toString() produces a formatted error message
        if (typeof err.toString === 'function') {
            try {
                const str = err.toString();
                if (str && str !== '[object Object]' && str !== 'Error' && str !== 'FiberFailure') {
                    const cleaned = str.replace(/^\(FiberFailure\)\s*/, '').trim();
                    if (cleaned) return cleaned;
                }
            } catch {}
        }
    }

    if (err.reason && err.reason !== 'Error') return err.reason;
    if (err.message && err.message !== 'Error') return err.message;
    if (err.code) return `Error ${err.code}: ${err.reason || err.message || 'Operation failed'}`;
    if (err.data && typeof err.data === 'string') return err.data;
    if (err.info && typeof err.info === 'string') return err.info;
    if (err.stack && typeof err.stack === 'string') {
        const firstLine = err.stack.split('\n')[0]?.trim();
        if (firstLine && firstLine !== 'Error' && firstLine !== 'FiberFailure') return firstLine;
    }

    try {
        const plain: Record<string, any> = {};
        for (const key of Object.getOwnPropertyNames(err)) {
            try { plain[key] = err[key]; } catch {}
        }
        for (const sym of Object.getOwnPropertySymbols(err)) {
            try { plain[sym.toString()] = err[sym]; } catch {}
        }
        const json = JSON.stringify(plain, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
        if (json && json !== '{}') return json;
    } catch {}

    return String(err);
}

function hexToUint8Array(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const len = Math.floor(clean.length / 2);
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        arr[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return arr;
}

/**
 * Balances an unsealed transaction hex using the connected Lace extension, prompts
 * the user to authorize spending their own DUST, signs the transaction, and broadcasts it.
 */
export async function balanceAndSubmitLaceTx(
    api: MidnightConnectedApi,
    unsealedTxHex: string,
    onProgress?: (msg: string) => void,
    walletName: string = 'Lace'
): Promise<{ txHash: string; balancedTxHex: string }> {
    if (!api) {
        throw new Error(`Midnight ${walletName} wallet extension is not connected.`);
    }

    if (typeof api.balanceUnsealedTransaction !== 'function') {
        throw new Error(`Connected wallet does not support balanceUnsealedTransaction. Please update your ${walletName} extension to the latest version.`);
    }

    onProgress?.(`Prompting ${walletName} for DUST fee payment and transaction signature...`);
    console.log(`[Midnight ${walletName} Connector] Calling api.balanceUnsealedTransaction...`);

    let balancedResult: any;
    let balanceError: any = null;

    try {
        // 1. Primary standard call per @midnight-ntwrk/dapp-connector-api v4
        balancedResult = await api.balanceUnsealedTransaction(unsealedTxHex, {});
    } catch (err: any) {
        balanceError = err;
        // 2. Fallback attempt with { payFees: true } in case wallet expects explicit flag
        try {
            if (typeof api.balanceUnsealedTransaction === 'function') {
                balancedResult = await api.balanceUnsealedTransaction(unsealedTxHex, { payFees: true });
                balanceError = null;
            }
        } catch (fallbackErr: any) {
            balanceError = fallbackErr || err;
        }
    }

    if (!balancedResult && balanceError) {
        console.error('[Midnight Lace Connector] Error during balanceUnsealedTransaction:', {
            err: balanceError,
            name: balanceError?.name,
            message: balanceError?.message,
            reason: balanceError?.reason,
            code: balanceError?.code,
            cause: balanceError?.cause,
            stack: balanceError?.stack,
        });

        const formatted = formatLaceError(balanceError);
        const lower = formatted.toLowerCase();
        if (
            lower.includes('reject') ||
            lower.includes('cancel') ||
            lower.includes('denied') ||
            lower.includes('declined')
        ) {
            throw new Error('Transaction was canceled or rejected in Lace wallet.');
        }

        if (lower.includes('insufficient') || lower.includes('dust') || lower.includes('funds')) {
            throw new Error(
                `Lace wallet has insufficient DUST to balance this transaction: ${formatted}. ` +
                `Please verify that your connected Lace wallet has tNight tokens on Preprod and has registered for DUST generation.`
            );
        }

        if (lower.includes('unexpected error') || lower.includes('unknown error')) {
            throw new Error(
                `Lace internal balancing error: ${formatted}. ` +
                `Midnight Lace extension v0.1.x background worker encountered an internal error while querying block data to balance this deploy intent. ` +
                `Tip: Select "Pay Gas with Studio Wallet" to deploy immediately on-chain with your Lace wallet set as the contract Owner!`
            );
        }

        throw new Error(`Lace failed to balance and sign transaction: ${formatted}`);
    }

    const balancedTxHex = typeof balancedResult === 'string' ? balancedResult : balancedResult?.tx;
    if (!balancedTxHex) {
        throw new Error('Lace returned an empty balanced transaction.');
    }

    // Step 1: Extract transaction identifier directly from balanced transaction bytes
    let txHash: string | undefined;
    try {
        const cleanHex = balancedTxHex.replace(/^0x/, '').trim();
        const bytes = typeof Buffer !== 'undefined'
            ? Buffer.from(cleanHex, 'hex')
            : hexToUint8Array(cleanHex);
        const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
        const txObj = Transaction.deserialize('signature', 'proof', 'binding', bytes);
        const ids = txObj.identifiers();
        if (ids && ids.length > 0) {
            txHash = ids[0];
        } else if (typeof txObj.transactionHash === 'function') {
            txHash = String(txObj.transactionHash());
        }
    } catch (extractErr) {
        console.warn('[Midnight Lace Connector] Could not extract txHash from balanced tx:', extractErr);
    }

    onProgress?.(`Broadcasting balanced transaction to Midnight network via ${walletName}...`);
    console.log(`[Midnight ${walletName} Connector] Calling api.submitTransaction...`);

    let laceSubmitted = false;
    let laceBroadcastErr: any = null;

    if (typeof api.submitTransaction === 'function') {
        try {
            onProgress?.(`Submitting balanced transaction via ${walletName}...`);
            const res = await api.submitTransaction(balancedTxHex);
            // In Midnight DApp Connector spec, submitTransaction returns Promise<void>.
            // If it returned a custom string id, preserve it.
            if (typeof res === 'string' && res.trim()) {
                txHash = res.trim();
            }
            laceSubmitted = true;
            console.log(`[Midnight ${walletName} Connector] Transaction successfully submitted via ${walletName}! TxHash:`, txHash);
        } catch (submitErr: any) {
            laceBroadcastErr = submitErr;
            const errStr = formatLaceError(submitErr) || String(submitErr?.message || submitErr);
            const isAlreadySubmitted =
                errStr.includes('1012') || // Substrate 1012: temporarily banned (already in mempool)
                errStr.includes('193') ||  // ReplayProtectionViolation / intent already on-chain
                errStr.toLowerCase().includes('temporarily banned') ||
                errStr.toLowerCase().includes('already in pool') ||
                errStr.toLowerCase().includes('duplicate');

            if (isAlreadySubmitted) {
                console.log(`[Midnight ${walletName} Connector] Transaction was already accepted by the node:`, errStr);
                laceSubmitted = true;
            } else {
                console.warn(`[Midnight ${walletName} Connector] ${walletName} api.submitTransaction failed, checking fallback...`, {
                    err: submitErr,
                    formatted: errStr,
                });
            }
        }
    }

    // Fallback: If Lace submitTransaction failed or was unavailable, broadcast via Studio backend Midnight Node RPC
    if (!laceSubmitted) {
        onProgress?.('Broadcasting transaction via Studio Node RPC fallback...');
        console.log(`[Midnight ${walletName} Connector] Broadcasting balanced transaction via /api/contract/broadcast...`);
        try {
            const broadcastRes = await fetch('/api/contract/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balancedTxHex }),
            });
            const broadcastJson = await broadcastRes.json();
            if (broadcastRes.ok && broadcastJson.success && broadcastJson.data?.txHash) {
                txHash = broadcastJson.data.txHash;
                laceSubmitted = true;
                console.log(`[Midnight ${walletName} Connector] Transaction successfully broadcasted via backend Node RPC! TxHash:`, txHash);
            } else {
                const nodeMsg = broadcastJson.error || '';
                console.error(`[Midnight ${walletName} Connector] Backend Node broadcast also rejected transaction:`, nodeMsg);
                if (laceBroadcastErr) {
                    throw new Error(`Broadcast failed via ${walletName} (${formatLaceError(laceBroadcastErr)}) and Node RPC: ${nodeMsg}`);
                }
                throw new Error(`Failed to broadcast transaction: ${nodeMsg || 'Node rejected extrinsic'}`);
            }
        } catch (fbErr: any) {
            if (fbErr?.message?.includes('Broadcast failed') || fbErr?.message?.includes('Failed to broadcast transaction')) {
                throw fbErr;
            }
            if (laceBroadcastErr) {
                throw new Error(`Failed to broadcast transaction via ${walletName}: ${formatLaceError(laceBroadcastErr)}`);
            }
            throw fbErr;
        }
    }

    return { txHash: txHash || `tx-${Date.now()}`, balancedTxHex };
}

export const balanceAndSubmitBrowserWalletTx = balanceAndSubmitLaceTx;

export function formatBrowserWalletError(err: any, wallet?: BrowserWalletType | string): string {
    const raw = formatLaceError(err);
    const friendlyName = wallet === '1am' ? '1AM Wallet' : wallet === 'lace' ? 'Midnight Lace' : (wallet || 'wallet');
    const lower = raw.toLowerCase();
    if (
        lower.includes('reject') ||
        lower.includes('denied') ||
        lower.includes('canceled') ||
        lower.includes('permissionrejected')
    ) {
        return `Connection request was declined in ${friendlyName}.`;
    }
    if (lower.includes('request failed') || lower.includes('error forwarding message')) {
        return `Could not communicate with ${friendlyName}. Please click the ${friendlyName} icon in your browser toolbar to unlock or wake it, then refresh this page (F5).`;
    }
    return raw;
}



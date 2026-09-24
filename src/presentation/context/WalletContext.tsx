'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useSystem } from './SystemContext';
import {
    isMidnightExtensionInstalled,
    getDetectedWallets,
    connectMidnightBrowserWallet,
    connectMidnightLaceWallet,
    fetchExtensionWalletBalances,
    queryExtensionAddresses,
    isWalletLockedError,
    isChannelShutdownError,
    MidnightConnectedApi,
    BrowserWalletType,
    SUPPORTED_BROWSER_WALLETS,
} from '@/src/infrastructure/midnight/midnight-dapp-connector';

export type WalletConnectionMode = 'extension' | 'seed';

export interface WalletStatus {
    unshieldedAddress: string;
    shieldedAddress?: string;
    coinPublicKey?: string;
    encryptionPublicKey?: string;
    tNightBalance: string;
    tNightDisplay: string;
    dustBalance: string;
    dustDisplay?: string;
    dustCap?: string;
    dustCapDisplay?: string;
    isSynced: boolean;
    syncProgress?: {
        isSynced: boolean;
        percentage: number;
        appliedId: string;
        highestTransactionId: string;
        isConnected: boolean;
        unshielded?: { applied: string; highest: string; percentage: number };
        shielded?: { applied: string; highest: string; percentage: number };
        dust?: { applied: string; highest: string; percentage: number };
    };
}

interface WalletContextType {
    connectionMode: WalletConnectionMode;
    setConnectionMode: (mode: WalletConnectionMode) => void;
    selectedBrowserWallet: BrowserWalletType;
    setSelectedBrowserWallet: (type: BrowserWalletType) => void;
    connectedWalletType: BrowserWalletType | null;
    connectedWalletName: string;
    isLaceInstalled: boolean;
    is1AmInstalled: boolean;
    isExtensionInstalled: boolean;
    isExtensionConnected: boolean;
    isWalletLocked: boolean;
    walletError: string | null;
    extensionAddress: string;
    extensionShieldedAddress: string;
    extensionShieldedCoinPublicKey: string;
    extensionShieldedEncryptionPublicKey: string;
    extensionNetworkId: string;
    extensionApi: MidnightConnectedApi | null;
    targetNetwork: string;
    setTargetNetwork: (net: string) => void;
    connectionProgress: string;
    connectExtension: (overrideNetwork?: string, overrideWallet?: BrowserWalletType) => Promise<boolean>;
    disconnectExtension: () => void;
    recheckExtension: () => boolean;
    refreshExtensionAccount: () => Promise<{ changed: boolean; address: string }>;
    seed: string;
    setSeed: (seed: string) => void;
    defaultSeed: string;
    walletStatus: WalletStatus | null;
    backendWalletStatus: WalletStatus | null;
    isLoadingWallet: boolean;
    isRegisteringDust: boolean;
    fetchWalletStatus: (overrideSeed?: string) => Promise<void>;
    registerDust: () => Promise<{ success: boolean; txHash?: string; message?: string }>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { systemHealth } = useSystem();
    const fallbackSeed = 'bfddeea52c8e16ebc8b278f4bb5a76604982046d690e7c6f3139831c6888861d';
    const [seed, setSeed] = useState<string>(fallbackSeed);
    const [defaultSeed, setDefaultSeed] = useState<string>(fallbackSeed);
    const [seedWalletStatus, setSeedWalletStatus] = useState<WalletStatus | null>(null);
    const [extensionWalletStatus, setExtensionWalletStatus] = useState<WalletStatus | null>(null);
    const [isLoadingWallet, setIsLoadingWallet] = useState<boolean>(false);
    const [isRegisteringDust, setIsRegisteringDust] = useState<boolean>(false);
    const isFetchingRef = useRef(false);

    // Extension Connection State
    const [connectionMode, setConnectionMode] = useState<WalletConnectionMode>('seed');
    const [selectedBrowserWallet, setSelectedBrowserWalletState] = useState<BrowserWalletType>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('midnight_selected_browser_wallet');
                if (saved === '1am' || saved === 'lace') return saved;
            } catch {}
        }
        return 'lace';
    });
    const [connectedWalletType, setConnectedWalletType] = useState<BrowserWalletType | null>(null);
    const [connectedWalletName, setConnectedWalletName] = useState<string>('Midnight Lace');
    const [isLaceInstalled, setIsLaceInstalled] = useState<boolean>(false);
    const [is1AmInstalled, setIs1AmInstalled] = useState<boolean>(false);
    const [isExtensionInstalled, setIsExtensionInstalled] = useState<boolean>(false);
    const [isExtensionConnected, setIsExtensionConnected] = useState<boolean>(false);
    const [isWalletLocked, setIsWalletLocked] = useState<boolean>(false);
    const [walletError, setWalletError] = useState<string | null>(null);
    const [extensionAddress, setExtensionAddress] = useState<string>('');
    const [extensionShieldedAddress, setExtensionShieldedAddress] = useState<string>('');
    const [extensionShieldedCoinPublicKey, setExtensionShieldedCoinPublicKey] = useState<string>('');
    const [extensionShieldedEncryptionPublicKey, setExtensionShieldedEncryptionPublicKey] = useState<string>('');
    const [extensionNetworkId, setExtensionNetworkId] = useState<string>('preprod');
    const [targetNetwork, setTargetNetworkState] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('midnight_target_network');
                if (saved && saved !== 'active') return saved;
            } catch {}
        }
        return 'preprod';
    });
    const [connectionProgress, setConnectionProgress] = useState<string>('');
    const [extensionApi, setExtensionApi] = useState<MidnightConnectedApi | null>(null);
    const extensionApiRef = useRef<MidnightConnectedApi | null>(null);
    const isWalletLockedRef = useRef<boolean>(false);
    const isFetchingBalancesRef = useRef<boolean>(false);
    const lastFocusRecheckTimeRef = useRef<number>(0);

    const setSelectedBrowserWallet = useCallback((type: BrowserWalletType) => {
        setSelectedBrowserWalletState(type);
        try {
            localStorage.setItem('midnight_selected_browser_wallet', type);
        } catch {}
    }, []);

    const setWalletLockedState = useCallback((locked: boolean, errorMsg?: string | null) => {
        setIsWalletLocked(locked);
        isWalletLockedRef.current = locked;
        if (locked && errorMsg) {
            setWalletError(errorMsg);
        } else if (!locked && isWalletLockedRef.current) {
            setWalletError(null);
        }
    }, []);

    const setTargetNetwork = useCallback((net: string) => {
        const cleanNet = !net || net === 'active' ? 'preprod' : net;
        setTargetNetworkState(cleanNet);
        try {
            localStorage.setItem('midnight_target_network', cleanNet);
        } catch {}
    }, []);

    // Active walletStatus depending on current mode
    const walletStatus =
        connectionMode === 'extension' && isExtensionConnected && extensionWalletStatus
            ? extensionWalletStatus
            : seedWalletStatus;

    const isConnectingRef = useRef(false);

    // Recheck extension helper across both Lace and 1AM
    const recheckExtension = useCallback((): boolean => {
        const detected = getDetectedWallets();
        setIsLaceInstalled(detected.lace);
        setIs1AmInstalled(detected['1am']);
        const anyInstalled = detected.lace || detected['1am'];
        setIsExtensionInstalled((prev) => (prev !== anyInstalled ? anyInstalled : prev));
        return anyInstalled;
    }, []);

    // Check extension detection on client mount and with progressive timeouts
    useEffect(() => {
        recheckExtension();

        const intervals = [100, 300, 800, 1500, 3000, 5000];
        const timers = intervals.map((delay) => setTimeout(recheckExtension, delay));

        const handleFocus = () => recheckExtension();
        window.addEventListener('focus', handleFocus);
        window.addEventListener('load', handleFocus);

        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('load', handleFocus);
        };
    }, [recheckExtension]);

    // Window-level guard against unhandled promise rejections from Lace extension background internals
    // (e.g. "Remote API with channel 'activity-channel' was shutdown: object can no longer be used.")
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event?.reason;
            if (isChannelShutdownError(reason)) {
                console.warn(
                    '[WalletContext] Intercepted benign Lace background channel shutdown. Suppressing uncaught rejection.'
                );
                try {
                    event.preventDefault();
                } catch {}

                extensionApiRef.current = null;
                setIsExtensionConnected(false);
                setWalletError(
                    'Lace extension background channel was closed. Click the Lace extension icon in your browser toolbar to wake or unlock it, then click Connect.'
                );
            }
        };

        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    // Connect to Midnight Browser Extension (Lace or 1AM, Zero-Seed)
    const connectExtension = useCallback(async (overrideNetwork?: string, overrideWallet?: BrowserWalletType): Promise<boolean> => {
        if (isConnectingRef.current) {
            console.log('[WalletContext] Connection attempt already in flight, skipping duplicate request.');
            return false;
        }
        isConnectingRef.current = true;
        setWalletLockedState(false);
        setWalletError(null);

        const targetWallet = overrideWallet || selectedBrowserWallet || 'lace';
        const descriptor = SUPPORTED_BROWSER_WALLETS[targetWallet] || SUPPORTED_BROWSER_WALLETS.lace;

        try {
            recheckExtension();
            const activeNet = overrideNetwork || targetNetwork || 'preprod';
            const cleanNet = activeNet === 'active' ? 'preprod' : activeNet;
            setConnectionProgress(`Connecting to ${descriptor.name} on ${cleanNet}...`);
            const res = await connectMidnightBrowserWallet(targetWallet, cleanNet, (msg) => setConnectionProgress(msg));
            extensionApiRef.current = res.api;
            setExtensionApi(res.api);
            setExtensionAddress(res.address);
            setExtensionShieldedAddress(res.shieldedAddress || '');
            setExtensionShieldedCoinPublicKey(res.shieldedCoinPublicKey || '');
            setExtensionShieldedEncryptionPublicKey(res.shieldedEncryptionPublicKey || '');
            setExtensionNetworkId(res.networkId || cleanNet);
            setConnectedWalletType(res.walletType);
            setConnectedWalletName(res.walletName);
            setSelectedBrowserWalletState(res.walletType);
            setIsExtensionConnected(true);
            setIsExtensionInstalled(true);
            setConnectionMode('extension');
            setConnectionProgress('');

            try {
                localStorage.setItem('midnight_wallet_connection_mode', 'extension');
                localStorage.setItem('midnight_selected_browser_wallet', res.walletType);
            } catch {}

            const locked = Boolean(res.balances.isLocked);
            setWalletLockedState(
                locked,
                locked
                    ? res.balances.errorMessage || `Your ${res.walletName} is locked. Please unlock it in the extension toolbar.`
                    : null
            );

            // Set the extension wallet status with live balances
            const extStatus: WalletStatus = {
                unshieldedAddress: res.address,
                shieldedAddress: res.shieldedAddress,
                coinPublicKey: res.shieldedCoinPublicKey,
                encryptionPublicKey: res.shieldedEncryptionPublicKey,
                tNightBalance: res.balances.tNightBalance,
                tNightDisplay: res.balances.tNightDisplay,
                dustBalance: res.balances.dustBalance,
                dustDisplay: res.balances.dustDisplay,
                dustCap: res.balances.dustCap,
                dustCapDisplay: res.balances.dustCapDisplay,
                isSynced: true,
                syncProgress: {
                    isSynced: true,
                    percentage: 100,
                    appliedId: `${res.walletName} Synced`,
                    highestTransactionId: `${res.walletName} Connected`,
                    isConnected: true,
                    unshielded: { applied: '1', highest: '1', percentage: 100 },
                    shielded: { applied: '1', highest: '1', percentage: 100 },
                    dust: { applied: '1', highest: '1', percentage: 100 },
                },
            };
            setExtensionWalletStatus(extStatus);
            return true;
        } catch (err: any) {
            console.error(`Failed to connect ${descriptor.name} extension:`, err);
            setConnectionProgress('');
            if (isWalletLockedError(err)) {
                setWalletLockedState(
                    true,
                    err.message ||
                    `Your ${descriptor.name} is locked. Please click the ${descriptor.name} extension icon in your browser toolbar to unlock it with your password, then try connecting again.`
                );
            } else if (isChannelShutdownError(err)) {
                setWalletError(
                    `${descriptor.name} background channel was closed. Please click the extension icon in your browser toolbar to wake or unlock it, then click Connect.`
                );
            } else {
                setWalletError(err.message || `Failed to connect to ${descriptor.name}.`);
            }
            throw err;
        } finally {
            isConnectingRef.current = false;
        }
    }, [recheckExtension, targetNetwork, selectedBrowserWallet, setWalletLockedState]);

    const disconnectExtension = useCallback(() => {
        extensionApiRef.current = null;
        setExtensionApi(null);
        setExtensionAddress('');
        setExtensionShieldedAddress('');
        setExtensionShieldedCoinPublicKey('');
        setExtensionShieldedEncryptionPublicKey('');
        setConnectedWalletType(null);
        setIsExtensionConnected(false);
        setExtensionWalletStatus(null);
        setIsWalletLocked(false);
        isWalletLockedRef.current = false;
        setWalletError(null);
        setConnectionMode('seed');
        try {
            localStorage.setItem('midnight_wallet_connection_mode', 'seed');
        } catch {}
    }, []);

    const handleSetConnectionMode = useCallback((mode: WalletConnectionMode) => {
        setConnectionMode(mode);
        try {
            localStorage.setItem('midnight_wallet_connection_mode', mode);
        } catch {}
    }, []);

    const handleSetSeed = useCallback((newSeed: string) => {
        setSeed(newSeed);
        try {
            localStorage.setItem('midnight_wallet_seed', newSeed);
        } catch {}
    }, []);

    // Restore saved connectionMode and seed on initial mount ONCE
    useEffect(() => {
        try {
            const savedMode = localStorage.getItem('midnight_wallet_connection_mode') as WalletConnectionMode | null;
            const savedSeed = localStorage.getItem('midnight_wallet_seed');
            const savedNet = localStorage.getItem('midnight_target_network');

            if (savedSeed) {
                setSeed(savedSeed);
            }

            if (savedNet) {
                setTargetNetworkState(savedNet);
            }

            if (savedMode === 'extension') {
                setConnectionMode('extension');
                // Do not auto-call connectExtension on mount to avoid interrupting Lace session.
                // User clicks 'Connect Midnight Wallet' to initiate authorization with a user gesture.
            } else if (savedMode === 'seed') {
                setConnectionMode('seed');
            }
        } catch {}
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync seed from default deployment when available ONLY if user has not set their own saved seed
    useEffect(() => {
        const foundSeed = systemHealth?.deployment?.deployerSeed || systemHealth?.deployment?.seed;
        if (foundSeed) {
            setDefaultSeed(foundSeed);
            try {
                const savedSeed = localStorage.getItem('midnight_wallet_seed');
                if (!savedSeed && foundSeed !== seed) {
                    setSeed(foundSeed);
                }
            } catch {}
        }
    }, [systemHealth, seed]);

    const fetchWalletStatus = useCallback(async (overrideSeed?: string) => {
        // If in extension mode and connected, query extension balances
        if (connectionMode === 'extension' && isExtensionConnected && extensionApiRef.current) {
            if (isWalletLockedRef.current) {
                return;
            }
            if (isFetchingBalancesRef.current) {
                return;
            }
            isFetchingBalancesRef.current = true;
            try {
                const balances = await fetchExtensionWalletBalances(extensionApiRef.current);
                if (balances.isChannelShutdown) {
                    console.warn('[WalletContext] Detected extension channel shutdown during balance query.');
                    extensionApiRef.current = null;
                    setIsExtensionConnected(false);
                    setWalletError(`${connectedWalletName || 'Extension'} background connection was closed. Please click Connect to reconnect.`);
                    return;
                }
                const locked = Boolean(balances.isLocked);
                setWalletLockedState(
                    locked,
                    locked
                        ? balances.errorMessage || `Your ${connectedWalletName || 'wallet'} is locked. Please unlock it in the extension toolbar.`
                        : null
                );
                if (!locked) {
                    setWalletError(null);
                    let latestAddrs = {
                        unshieldedAddress: extensionAddress,
                        shieldedAddress: extensionShieldedAddress,
                        shieldedCoinPublicKey: extensionShieldedCoinPublicKey,
                        shieldedEncryptionPublicKey: extensionShieldedEncryptionPublicKey,
                    };
                    try {
                        latestAddrs = await queryExtensionAddresses(extensionApiRef.current);
                        if (latestAddrs.unshieldedAddress && latestAddrs.unshieldedAddress !== extensionAddress) {
                            setExtensionAddress(latestAddrs.unshieldedAddress);
                        }
                        if (latestAddrs.shieldedAddress && latestAddrs.shieldedAddress !== extensionShieldedAddress) {
                            setExtensionShieldedAddress(latestAddrs.shieldedAddress);
                        }
                        if (latestAddrs.shieldedCoinPublicKey && latestAddrs.shieldedCoinPublicKey !== extensionShieldedCoinPublicKey) {
                            setExtensionShieldedCoinPublicKey(latestAddrs.shieldedCoinPublicKey);
                        }
                        if (latestAddrs.shieldedEncryptionPublicKey && latestAddrs.shieldedEncryptionPublicKey !== extensionShieldedEncryptionPublicKey) {
                            setExtensionShieldedEncryptionPublicKey(latestAddrs.shieldedEncryptionPublicKey);
                        }
                    } catch (addrErr) {
                        console.warn('[WalletContext] Error re-checking active address:', addrErr);
                    }

                    setExtensionWalletStatus((prev) => {
                        const activeAddr = latestAddrs.unshieldedAddress || extensionAddress || prev?.unshieldedAddress || '';
                        return {
                            unshieldedAddress: activeAddr,
                            shieldedAddress: latestAddrs.shieldedAddress || extensionShieldedAddress || prev?.shieldedAddress,
                            coinPublicKey: latestAddrs.shieldedCoinPublicKey || extensionShieldedCoinPublicKey || prev?.coinPublicKey,
                            encryptionPublicKey: latestAddrs.shieldedEncryptionPublicKey || extensionShieldedEncryptionPublicKey || prev?.encryptionPublicKey,
                            tNightBalance: balances.tNightBalance,
                            tNightDisplay: balances.tNightDisplay,
                            dustBalance: balances.dustBalance,
                            dustDisplay: balances.dustDisplay,
                            dustCap: balances.dustCap ?? prev?.dustCap,
                            dustCapDisplay: balances.dustCapDisplay ?? prev?.dustCapDisplay,
                            isSynced: true,
                            syncProgress: prev?.syncProgress || {
                                isSynced: true,
                                percentage: 100,
                                appliedId: `${connectedWalletName || 'Wallet'} Synced`,
                                highestTransactionId: `${connectedWalletName || 'Wallet'} Connected`,
                                isConnected: true,
                                unshielded: { applied: '1', highest: '1', percentage: 100 },
                                shielded: { applied: '1', highest: '1', percentage: 100 },
                                dust: { applied: '1', highest: '1', percentage: 100 },
                            },
                        };
                    });
                }
            } catch (err: any) {
                console.warn(`[${connectedWalletName || 'Browser Wallet'}] Failed to refresh extension balances:`, err);
                if (isChannelShutdownError(err)) {
                    extensionApiRef.current = null;
                    setIsExtensionConnected(false);
                    setWalletError(`${connectedWalletName || 'Extension'} background connection was closed. Please click Connect to reconnect.`);
                } else if (isWalletLockedError(err)) {
                    setWalletLockedState(true, `Your ${connectedWalletName || 'wallet'} is locked. Please unlock it in the extension toolbar.`);
                }
            } finally {
                isFetchingBalancesRef.current = false;
            }
        }

        // Fetch backend deployer seed status
        if (connectionMode === 'seed') {
            const targetSeed = overrideSeed || seed || fallbackSeed;
            if (!targetSeed || isFetchingRef.current) {
                setIsLoadingWallet(false);
                return;
            }

            isFetchingRef.current = true;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            try {
                const res = await fetch('/api/wallet/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ seed: targetSeed }),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!res.ok) return;
                const text = await res.text();
                if (!text.trim()) return;
                const data = JSON.parse(text);
                if (data.success && data.data) {
                    setSeedWalletStatus(data.data);
                }
            } catch (err: any) {
                if (err.name !== 'AbortError' && !(err instanceof SyntaxError)) {
                    console.warn('Wallet status sync issue:', err.message || err);
                }
            } finally {
                clearTimeout(timeoutId);
                isFetchingRef.current = false;
                setIsLoadingWallet(false);
            }
        }
    }, [
        connectionMode,
        isExtensionConnected,
        extensionAddress,
        extensionShieldedAddress,
        extensionShieldedCoinPublicKey,
        extensionShieldedEncryptionPublicKey,
        seed,
        setWalletLockedState,
    ]);

    // Initial load when seed changes
    useEffect(() => {
        if (seed && connectionMode === 'seed') {
            setIsLoadingWallet(true);
            fetchWalletStatus(seed);
        }
    }, [seed, connectionMode, fetchWalletStatus]);

    // Mode switch trigger
    useEffect(() => {
        fetchWalletStatus();
    }, [connectionMode, fetchWalletStatus]);

    // Polling for backend Seed mode (every 6 seconds when tab is active)
    useEffect(() => {
        if (connectionMode !== 'seed') return;
        const interval = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            fetchWalletStatus();
        }, 6000);
        return () => clearInterval(interval);
    }, [connectionMode, fetchWalletStatus]);

    // Polling for Lace Extension mode (every 30 seconds when visible and not locked)
    useEffect(() => {
        if (connectionMode !== 'extension' || !isExtensionConnected || isWalletLocked) return;
        const interval = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            if (extensionApiRef.current && !isWalletLockedRef.current && !isFetchingBalancesRef.current) {
                fetchWalletStatus();
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [connectionMode, isExtensionConnected, isWalletLocked, fetchWalletStatus]);

    // Throttled recheck when user returns/focuses the window (at most once every 20s)
    useEffect(() => {
        const handleFocusRecheck = () => {
            const now = Date.now();
            if (now - lastFocusRecheckTimeRef.current < 20000) return;
            lastFocusRecheckTimeRef.current = now;

            recheckExtension();
            if (connectionMode === 'extension' && isExtensionConnected && extensionApiRef.current && !isWalletLockedRef.current) {
                fetchWalletStatus();
            }
        };

        window.addEventListener('focus', handleFocusRecheck);
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                handleFocusRecheck();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.removeEventListener('focus', handleFocusRecheck);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [recheckExtension, connectionMode, isExtensionConnected, fetchWalletStatus]);

    const registerDust = async () => {
        if (connectionMode === 'extension') {
            const walletTitle = connectedWalletName || 'browser wallet';
            return {
                success: true,
                message: `DUST registration for your ${walletTitle} extension is managed natively inside the extension window. DUST accrues gradually over epochs once registered.`,
            };
        }
        if (!seed) return { success: false, message: 'No seed selected' };
        setIsRegisteringDust(true);
        try {
            const res = await fetch('/api/wallet/register-dust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seed }),
            });
            const text = await res.text();
            const data = text ? JSON.parse(text) : {};
            if (data.success) {
                await fetchWalletStatus(seed);
                return { success: true, txHash: data.data?.txHash };
            } else {
                return { success: false, message: data.error || 'Failed to register DUST' };
            }
        } catch (err: any) {
            return { success: false, message: err?.message || 'Network error registering DUST' };
        } finally {
            setIsRegisteringDust(false);
        }
    };

    const refreshExtensionAccount = useCallback(async (): Promise<{ changed: boolean; address: string }> => {
        if (!extensionApiRef.current) {
            return { changed: false, address: extensionAddress };
        }
        try {
            const addrs = await queryExtensionAddresses(extensionApiRef.current);
            const changed = Boolean(addrs.unshieldedAddress && addrs.unshieldedAddress !== extensionAddress);
            if (addrs.unshieldedAddress) {
                setExtensionAddress(addrs.unshieldedAddress);
            }
            if (addrs.shieldedAddress) {
                setExtensionShieldedAddress(addrs.shieldedAddress);
            }
            if (addrs.shieldedCoinPublicKey) {
                setExtensionShieldedCoinPublicKey(addrs.shieldedCoinPublicKey);
            }
            if (addrs.shieldedEncryptionPublicKey) {
                setExtensionShieldedEncryptionPublicKey(addrs.shieldedEncryptionPublicKey);
            }

            await fetchWalletStatus();
            return { changed, address: addrs.unshieldedAddress || extensionAddress };
        } catch (err) {
            console.warn('[WalletContext] Failed to refresh extension account:', err);
            return { changed: false, address: extensionAddress };
        }
    }, [extensionAddress, fetchWalletStatus]);

    // Automatically check for account changes in 1AM or Lace when user switches back to this tab
    useEffect(() => {
        if (!isExtensionConnected) return;

        const handleWindowFocus = () => {
            if (extensionApiRef.current) {
                const now = Date.now();
                if (now - lastFocusRecheckTimeRef.current > 1500) {
                    lastFocusRecheckTimeRef.current = now;
                    refreshExtensionAccount();
                }
            }
        };

        window.addEventListener('focus', handleWindowFocus);
        return () => {
            window.removeEventListener('focus', handleWindowFocus);
        };
    }, [isExtensionConnected, refreshExtensionAccount]);

    return (
        <WalletContext.Provider
            value={{
                connectionMode,
                setConnectionMode: handleSetConnectionMode,
                selectedBrowserWallet,
                setSelectedBrowserWallet,
                connectedWalletType,
                connectedWalletName,
                isLaceInstalled,
                is1AmInstalled,
                isExtensionInstalled,
                isExtensionConnected,
                isWalletLocked,
                walletError,
                extensionAddress,
                extensionShieldedAddress,
                extensionShieldedCoinPublicKey,
                extensionShieldedEncryptionPublicKey,
                extensionNetworkId,
                targetNetwork,
                setTargetNetwork,
                connectionProgress,
                extensionApi,
                connectExtension,
                disconnectExtension,
                recheckExtension,
                refreshExtensionAccount,
                seed,
                setSeed: handleSetSeed,
                defaultSeed,
                walletStatus,
                backendWalletStatus: seedWalletStatus,
                isLoadingWallet,
                isRegisteringDust,
                fetchWalletStatus,
                registerDust,
            }}
        >
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = (): WalletContextType => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};


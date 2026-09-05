'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useSystem } from './SystemContext';
import {
    isMidnightExtensionInstalled,
    connectMidnightLaceWallet,
    fetchExtensionWalletBalances,
    MidnightConnectedApi,
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
    isExtensionInstalled: boolean;
    isExtensionConnected: boolean;
    extensionAddress: string;
    extensionShieldedAddress: string;
    extensionNetworkId: string;
    extensionApi: MidnightConnectedApi | null;
    targetNetwork: string;
    setTargetNetwork: (net: string) => void;
    connectionProgress: string;
    connectExtension: (overrideNetwork?: string) => Promise<boolean>;
    disconnectExtension: () => void;
    recheckExtension: () => boolean;
    seed: string;
    setSeed: (seed: string) => void;
    defaultSeed: string;
    walletStatus: WalletStatus | null;
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
    const [isExtensionInstalled, setIsExtensionInstalled] = useState<boolean>(false);
    const [isExtensionConnected, setIsExtensionConnected] = useState<boolean>(false);
    const [extensionAddress, setExtensionAddress] = useState<string>('');
    const [extensionShieldedAddress, setExtensionShieldedAddress] = useState<string>('');
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

    // Recheck extension helper
    const recheckExtension = useCallback((): boolean => {
        const installed = isMidnightExtensionInstalled();
        setIsExtensionInstalled((prev) => (prev !== installed ? installed : prev));
        return installed;
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

    // Connect to Midnight Lace Browser Extension (Zero-Seed)
    const connectExtension = useCallback(async (overrideNetwork?: string): Promise<boolean> => {
        if (isConnectingRef.current) {
            console.log('[WalletContext] Connection attempt already in flight, skipping duplicate request.');
            return false;
        }
        isConnectingRef.current = true;

        try {
            recheckExtension();
            const activeNet = overrideNetwork || targetNetwork || 'preprod';
            const cleanNet = activeNet === 'active' ? 'preprod' : activeNet;
            setConnectionProgress(`Connecting to Lace on ${cleanNet}...`);
            const res = await connectMidnightLaceWallet(cleanNet, (msg) => setConnectionProgress(msg));
            extensionApiRef.current = res.api;
            setExtensionApi(res.api);
            setExtensionAddress(res.address);
            setExtensionShieldedAddress(res.shieldedAddress || '');
            setExtensionNetworkId(res.networkId || cleanNet);
            setIsExtensionConnected(true);
            setIsExtensionInstalled(true);
            setConnectionMode('extension');
            setConnectionProgress('');

            try {
                localStorage.setItem('midnight_wallet_connection_mode', 'extension');
            } catch {}

            // Immediately set the extension wallet status with live balances
            const extStatus: WalletStatus = {
                unshieldedAddress: res.address,
                shieldedAddress: res.shieldedAddress,
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
                    appliedId: 'Lace Synced',
                    highestTransactionId: 'Lace Connected',
                    isConnected: true,
                    unshielded: { applied: '1', highest: '1', percentage: 100 },
                    shielded: { applied: '1', highest: '1', percentage: 100 },
                    dust: { applied: '1', highest: '1', percentage: 100 },
                },
            };
            setExtensionWalletStatus(extStatus);
            return true;
        } catch (err: any) {
            console.error('Failed to connect Midnight extension:', err);
            setConnectionProgress('');
            throw err;
        } finally {
            isConnectingRef.current = false;
        }
    }, [recheckExtension, targetNetwork, systemHealth?.network]);

    const disconnectExtension = useCallback(() => {
        extensionApiRef.current = null;
        setExtensionApi(null);
        setExtensionAddress('');
        setExtensionShieldedAddress('');
        setIsExtensionConnected(false);
        setExtensionWalletStatus(null);
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
            try {
                const balances = await fetchExtensionWalletBalances(extensionApiRef.current);
                setExtensionWalletStatus((prev) => {
                    const activeAddr = extensionAddress || prev?.unshieldedAddress || '';
                    return {
                        unshieldedAddress: activeAddr,
                        shieldedAddress: extensionShieldedAddress || prev?.shieldedAddress,
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
                            appliedId: 'Lace Preprod',
                            highestTransactionId: 'Preprod Synced',
                            isConnected: true,
                            unshielded: { applied: '1', highest: '1', percentage: 100 },
                            shielded: { applied: '1', highest: '1', percentage: 100 },
                            dust: { applied: '1', highest: '1', percentage: 100 },
                        },
                    };
                });
            } catch (err) {
                console.warn('[Midnight Lace] Failed to refresh extension balances:', err);
            }
            setIsLoadingWallet(false);
            return;
        }

        // Otherwise fetch headless seed status
        const targetSeed = overrideSeed || seed;
        if (!targetSeed || isFetchingRef.current) return;

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
    }, [connectionMode, isExtensionConnected, extensionAddress, extensionShieldedAddress, seed]);

    // Initial load when seed changes
    useEffect(() => {
        if (seed) {
            setIsLoadingWallet(true);
            fetchWalletStatus(seed);
        }
    }, [seed, fetchWalletStatus]);

    // Mode switch trigger
    useEffect(() => {
        fetchWalletStatus();
    }, [connectionMode, fetchWalletStatus]);

    // Continuous background sync polling (every 3 seconds)
    useEffect(() => {
        const interval = setInterval(() => {
            fetchWalletStatus();
        }, 3000);
        return () => clearInterval(interval);
    }, [fetchWalletStatus]);

    const registerDust = async () => {
        if (connectionMode === 'extension') {
            return {
                success: true,
                message: 'DUST registration for your Lace browser extension is managed natively inside the Lace extension window. DUST accrues gradually over epochs once registered.',
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

    return (
        <WalletContext.Provider
            value={{
                connectionMode,
                setConnectionMode: handleSetConnectionMode,
                isExtensionInstalled,
                isExtensionConnected,
                extensionAddress,
                extensionShieldedAddress,
                extensionNetworkId,
                targetNetwork,
                setTargetNetwork,
                connectionProgress,
                extensionApi,
                connectExtension,
                disconnectExtension,
                recheckExtension,
                seed,
                setSeed: handleSetSeed,
                defaultSeed,
                walletStatus,
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


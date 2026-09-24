'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface SystemHealth {
    proofServer: { url: string; status: 'online' | 'offline' };
    indexer: { url: string; status: 'online' | 'offline'; blockHeight: number | null };
    network: string;
    deployment?: {
        contractAddress: string;
        seed?: string;
        deployerSeed?: string;
        network?: string;
        deployedAt?: string;
    } | null;
    faucetUrl?: string;
}

interface SystemContextType {
    systemHealth: SystemHealth | null;
    isLoadingHealth: boolean;
    fetchSystemHealth: () => Promise<void>;
    isSyncDashboardOpen: boolean;
    setIsSyncDashboardOpen: (open: boolean) => void;
    isSettingsOpen: boolean;
    setIsSettingsOpen: (open: boolean) => void;
    activeContractAddress: string;
    setActiveContractAddress: (address: string) => void;
}

const SystemContext = createContext<SystemContextType | undefined>(undefined);

export const SystemProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
    const [isLoadingHealth, setIsLoadingHealth] = useState<boolean>(true);
    const [isSyncDashboardOpen, setIsSyncDashboardOpen] = useState<boolean>(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [activeContractAddress, setActiveContractAddress] = useState<string>('');

    const fetchSystemHealth = useCallback(async () => {
        try {
            const res = await fetch('/api/system/status');
            if (!res.ok) return;
            const text = await res.text();
            if (!text.trim()) return;
            const data = JSON.parse(text);
            if (data.success && data.data) {
                if (data.data.proofServer?.status !== 'online') {
                    try {
                        const proverUrl = data.data.proofServer?.url || 'http://127.0.0.1:6300';
                        const probeRes = await fetch(proverUrl, {
                            method: 'GET',
                            signal: AbortSignal.timeout(1500),
                        });
                        if (probeRes.status === 200 || probeRes.status === 404 || probeRes.status === 405) {
                            data.data.proofServer.status = 'online';
                        }
                    } catch {
                        // Keep server-reported offline status
                    }
                }
                setSystemHealth(data.data);
                if (data.data.deployment?.contractAddress && !activeContractAddress) {
                    setActiveContractAddress(data.data.deployment.contractAddress);
                }
            }
        } catch (err) {
            // Silently ignore transient errors
        } finally {
            setIsLoadingHealth(false);
        }
    }, [activeContractAddress]);

    useEffect(() => {
        fetchSystemHealth();
        const interval = setInterval(fetchSystemHealth, 15000);
        return () => clearInterval(interval);
    }, [fetchSystemHealth]);

    return (
        <SystemContext.Provider
            value={{
                systemHealth,
                isLoadingHealth,
                fetchSystemHealth,
                isSyncDashboardOpen,
                setIsSyncDashboardOpen,
                isSettingsOpen,
                setIsSettingsOpen,
                activeContractAddress,
                setActiveContractAddress,
            }}
        >
            {children}
        </SystemContext.Provider>
    );
};

export const useSystem = (): SystemContextType => {
    const context = useContext(SystemContext);
    if (!context) {
        throw new Error('useSystem must be used within a SystemProvider');
    }
    return context;
};

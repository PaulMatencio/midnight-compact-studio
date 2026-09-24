'use client';

import React, { useState, useCallback } from 'react';
import { ThemeProvider } from '@/src/presentation/context/ThemeContext';
import { SystemProvider, useSystem } from '@/src/presentation/context/SystemContext';
import { WalletProvider, useWallet } from '@/src/presentation/context/WalletContext';
import { TransactionProvider } from '@/src/presentation/context/TransactionContext';
import { ToastProvider } from '@/src/presentation/context/ToastContext';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { SyncDashboardModal } from './SyncDashboardModal';
import { InfrastructureSettingsModal } from './InfrastructureSettingsModal';

const Modals: React.FC = () => {
    const { isSyncDashboardOpen, setIsSyncDashboardOpen, isSettingsOpen, setIsSettingsOpen } = useSystem();
    const { seed, walletStatus, fetchWalletStatus } = useWallet();
    return (
        <>
            <SyncDashboardModal
                isOpen={isSyncDashboardOpen}
                onClose={() => setIsSyncDashboardOpen(false)}
                seed={seed}
                initialData={walletStatus?.syncProgress}
                isSynced={walletStatus?.isSynced ?? false}
                onResyncSuccess={() => fetchWalletStatus()}
            />
            <InfrastructureSettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </>
    );
};

export const GlobalShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

    const handleOpenMobileNav = useCallback(() => {
        setIsMobileNavOpen(true);
    }, []);

    const handleCloseMobileNav = useCallback(() => {
        setIsMobileNavOpen(false);
    }, []);

    return (
        <ThemeProvider>
            <SystemProvider>
                <WalletProvider>
                    <TransactionProvider>
                        <ToastProvider>
                            <div className="min-h-screen flex bg-midnight-950 text-slate-100 antialiased">
                                {/* Responsive Left Navigation Side Panel */}
                                <Sidebar
                                    isMobileOpen={isMobileNavOpen}
                                    onCloseMobile={handleCloseMobileNav}
                                />

                                {/* Main Application Area (Header + Main Page View) */}
                                <div className="flex-1 flex flex-col min-w-0">
                                    <Navbar onOpenMobileNav={handleOpenMobileNav} />
                                    <main className="flex-1 min-w-0">
                                        {children}
                                    </main>
                                </div>

                                {/* Modals & Telemetry Overlays */}
                                <Modals />
                            </div>
                        </ToastProvider>
                    </TransactionProvider>
                </WalletProvider>
            </SystemProvider>
        </ThemeProvider>
    );
};

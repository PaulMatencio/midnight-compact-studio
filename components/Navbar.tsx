'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  Cpu,
  Activity,
  Copy,
  Check,
  Shield,
  Layers,
  Code2,
  FileCode2,
  Wallet,
  Terminal,
  SlidersHorizontal,
  Sun,
  Moon,
  Stethoscope,
} from 'lucide-react';
import { useSystem } from '@/src/presentation/context/SystemContext';
import { useWallet } from '@/src/presentation/context/WalletContext';
import { useTheme } from '@/src/presentation/context/ThemeContext';

interface NavbarProps {
  onOpenMobileNav?: () => void;
}

const routeTitles: Record<string, { title: string; subtitle: string; icon: React.ElementType }> = {
  '/': { title: 'Dashboard', subtitle: 'Live Preprod Ledger Feed', icon: Layers },
  '/ide': { title: 'Studio IDE', subtitle: 'Compact Smart Contract Studio & Gemini Copilot', icon: Code2 },
  '/contracts': { title: 'Contracts', subtitle: 'Managed Contracts & ZK Workbench', icon: FileCode2 },
  '/wallet': { title: 'Wallet', subtitle: 'Midnight DUST & Shielded State', icon: Wallet },
  '/terminal': { title: 'Web CLI', subtitle: 'Interactive Midnight Node Shell', icon: Terminal },
  '/tools': { title: 'Tools & Diagnostics', subtitle: 'Midnight Expert Suite & Network Doctor', icon: Stethoscope },
};

export const Navbar: React.FC<NavbarProps> = ({ onOpenMobileNav }) => {
  const pathname = usePathname();
  const { systemHealth, setIsSyncDashboardOpen, setIsSettingsOpen } = useSystem();
  const { walletStatus } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const [copied, setCopied] = React.useState(false);

  const isProofOnline = systemHealth?.proofServer.status === 'online';
  const isIndexerOnline = systemHealth?.indexer.status === 'online';
  const syncPercentage = walletStatus?.syncProgress?.percentage ?? 0;
  const isSynced = (walletStatus?.isSynced ?? false) || syncPercentage >= 100;
  const walletAddress = walletStatus?.unshieldedAddress;

  const currentRouteMeta = routeTitles[pathname] || {
    title: pathname.replace('/', '').toUpperCase(),
    subtitle: 'Midnight Preprod Network',
    icon: Shield,
  };
  const CurrentIcon = currentRouteMeta.icon;

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-indigo-500/20 bg-midnight-950/80 backdrop-blur-xl shrink-0">
      <div className="mx-auto flex w-full items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Left: Mobile Drawer Trigger & Current Page Indicator */}
        <div className="flex items-center space-x-3">
          {/* Mobile Hamburger Button */}
          <button
            onClick={onOpenMobileNav}
            className="md:hidden flex h-9 w-9 items-center justify-center rounded-xl bg-midnight-900 border border-white/10 text-slate-300 hover:text-white hover:border-indigo-500/40 transition-all cursor-pointer"
            aria-label="Open Navigation Menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb / Page Title */}
          <div className="flex items-center space-x-2.5">
            <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
              <CurrentIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white leading-tight">
                {currentRouteMeta.title}
              </h2>
              <p className="hidden sm:block text-[11px] text-slate-400">
                {currentRouteMeta.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Status Pills & Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Proof Server Status */}
          <div
            title={`Proof Server: ${isProofOnline ? 'Online' : 'Offline'}`}
            className="hidden lg:flex items-center space-x-1.5 rounded-full bg-midnight-900/90 px-2.5 py-1 text-xs border border-white/5"
          >
            <Cpu className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] text-slate-400">Prover:</span>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isProofOnline ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-500'
              }`}
            />
          </div>

          {/* Indexer Status */}
          <div
            title={`Indexer: ${isIndexerOnline ? `Online (Block #${systemHealth?.indexer.blockHeight || 'N/A'})` : 'Offline'}`}
            className="hidden lg:flex items-center space-x-1.5 rounded-full bg-midnight-900/90 px-2.5 py-1 text-xs border border-white/5"
          >
            <Activity className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] text-slate-400">Indexer:</span>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isIndexerOnline ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-500'
              }`}
            />
          </div>

          {/* Sync Status Button (Opens Modal) */}
          <button
            onClick={() => setIsSyncDashboardOpen(true)}
            title="Click to view detailed sync telemetry"
            className={`flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer ${
              isSynced
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 animate-pulse'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                isSynced ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
              }`}
            />
            <span className="text-[11px]">{isSynced ? '✓ Synced' : `Syncing ${syncPercentage}%`}</span>
          </button>

          {/* Infrastructure Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            title="Configure Midnight Infrastructure (Prover, Indexer, Redis, Files)"
            className="flex items-center space-x-1.5 rounded-full bg-midnight-900/90 hover:bg-midnight-800 border border-white/10 hover:border-indigo-500/40 px-2.5 py-1 text-xs text-slate-300 hover:text-white transition-all cursor-pointer shadow-sm"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline text-[11px] font-medium">Settings</span>
          </button>

          {/* Theme Toggle: Bright Daytime vs Eye-Friendly Dark Mode */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Bright Daytime Theme' : 'Switch to Eye-Friendly Dark Mode'}
            className={`
              flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-xs border transition-all cursor-pointer shadow-sm
              ${
                theme === 'dark'
                  ? 'bg-midnight-900/90 hover:bg-midnight-800 border-white/10 text-amber-300 hover:text-amber-200 hover:border-amber-500/40'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-700 hover:text-amber-900'
              }
            `}
            aria-label="Toggle Daytime / Dark Mode"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5 text-amber-400 transition-transform duration-300 hover:rotate-45" />
                <span className="hidden sm:inline text-[11px] font-medium">Day</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-indigo-600 transition-transform duration-300 hover:-rotate-12" />
                <span className="hidden sm:inline text-[11px] font-medium">Night</span>
              </>
            )}
          </button>

          {/* Wallet Address Pill */}
          {walletAddress && (
            <button
              onClick={copyAddress}
              title="Click to copy Bech32 address"
              className="flex items-center space-x-1.5 rounded-full bg-indigo-950/60 px-2.5 py-1 text-xs text-indigo-200 border border-indigo-500/30 hover:bg-indigo-900/60 transition-colors cursor-pointer"
            >
              <span className="font-mono text-[11px]">
                {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
              </span>
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-indigo-400" />}
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

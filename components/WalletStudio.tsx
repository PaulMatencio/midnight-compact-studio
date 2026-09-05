import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Coins,
  Flame,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Key,
  ShieldCheck,
  Zap,
  AlertTriangle,
  Eye,
  EyeOff,
  PlusCircle,
  Activity,
  Send,
  Shield,
} from 'lucide-react';
import { useWallet } from '@/src/presentation/context/WalletContext';
import { useToast } from '@/src/presentation/context/ToastContext';

interface WalletStudioProps {
  seed: string;
  setSeed: (seed: string) => void;
  walletStatus: {
    address?: string;
    unshieldedAddress?: string;
    isSynced: boolean;
    tNightBalance: string;
    dustBalance: string;
    dustDisplay?: string;
    dustCap?: string;
    dustCapDisplay?: string;
    faucetUrl?: string;
    syncProgress?: {
      appliedId: string;
      highestTransactionId: string;
      isConnected: boolean;
      percentage: number;
      unshielded?: { applied: string; highest: string; percentage: number };
      shielded?: { applied: string; highest: string; percentage: number };
      dust?: { applied: string; highest: string; percentage: number };
    };
  } | null;
  isLoading: boolean;
  onRefresh: () => void;
  onRegisterDust: () => Promise<any>;
  isRegisteringDust: boolean;
  defaultSeed?: string;
  onOpenSyncDashboard?: () => void;
}

export const WalletStudio: React.FC<WalletStudioProps> = ({
  seed,
  setSeed,
  walletStatus,
  isLoading,
  onRefresh,
  onRegisterDust,
  isRegisteringDust,
  defaultSeed,
  onOpenSyncDashboard,
}) => {
  const toast = useToast();
  const {
    connectionMode,
    setConnectionMode,
    isExtensionInstalled,
    isExtensionConnected,
    extensionAddress,
    extensionShieldedAddress,
    extensionNetworkId,
    targetNetwork,
    setTargetNetwork,
    connectionProgress,
    connectExtension,
    disconnectExtension,
    recheckExtension,
  } = useWallet();

  const [showSeed, setShowSeed] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const [inputSeed, setInputSeed] = useState(seed);
  const [isConnectingExtension, setIsConnectingExtension] = useState(false);
  const [extensionError, setExtensionError] = useState<string>('');
  const [showSendModal, setShowSendModal] = useState(false);
  const [successToast, setSuccessToast] = useState('');
  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => setSuccessToast(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [successToast]);
  const [receiverAddress, setReceiverAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendStep, setSendStep] = useState<number>(1);
  const [sendReceipt, setSendReceipt] = useState<{
    txHash?: string;
    amount?: string;
    amountUnits?: string;
    receiver?: string;
    dustPaid?: string;
    durationMs?: number;
    network?: string;
  } | null>(null);

  useEffect(() => {
    setInputSeed(seed);
  }, [seed]);

  const rawDisplayAddress =
    connectionMode === 'extension' && isExtensionConnected
      ? extensionAddress || walletStatus?.unshieldedAddress || walletStatus?.address
      : walletStatus?.unshieldedAddress || walletStatus?.address;

  const activeDisplayAddress: string =
    typeof rawDisplayAddress === 'string'
      ? rawDisplayAddress
      : typeof rawDisplayAddress === 'object' && rawDisplayAddress !== null
      ? (rawDisplayAddress as any).unshieldedAddress || (rawDisplayAddress as any).address || ''
      : '';

  const handleCopyAddr = () => {
    if (!activeDisplayAddress) return;
    navigator.clipboard.writeText(activeDisplayAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  const handleCopySeed = () => {
    if (!seed) return;
    navigator.clipboard.writeText(seed);
    setCopiedSeed(true);
    setTimeout(() => setCopiedSeed(false), 2000);
  };

  const handleGenerateSeed = () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const newSeed = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
    setSeed(newSeed);
    setInputSeed(newSeed);
  };

  const handleSaveSeed = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputSeed.trim()) {
      setSeed(inputSeed.trim());
      toast.success('Seed Applied', 'Wallet identity updated');
    }
  };

  const handleLoadDefaultSeed = () => {
    if (defaultSeed) {
      setSeed(defaultSeed);
      setInputSeed(defaultSeed);
      toast.info('Default Seed', 'Loaded deployment seed');
    }
  };

  const handleConnectExtension = async (overrideNet?: string) => {
    setIsConnectingExtension(true);
    setExtensionError('');
    try {
      const connected = await connectExtension(overrideNet);
      if (connected) {
        toast.success('Wallet Connected', 'Connected to Midnight Lace Extension');
      }
    } catch (err: any) {
      const msg = err.message || 'Could not connect to extension';
      setExtensionError(msg);
      toast.error('Connection Failed', msg);
    } finally {
      setIsConnectingExtension(false);
    }
  };

  const rawNight = walletStatus?.tNightBalance ? BigInt(walletStatus.tNightBalance) : 0n;
  const formattedTNight = (Number(rawNight) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
  const rawDust = walletStatus?.dustBalance ? BigInt(walletStatus.dustBalance) : 0n;
  const dustInUnits = rawDust >= 1_000_000_000n ? Number(rawDust) / 1e15 : Number(rawDust);
  const formattedDust = walletStatus?.dustDisplay || dustInUnits.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  const rawDustCap = walletStatus?.dustCap ? BigInt(walletStatus.dustCap) : 0n;
  const dustCapInUnits = rawDustCap >= 1_000_000_000n ? Number(rawDustCap) / 1e15 : Number(rawDustCap);
  const formattedDustCap = walletStatus?.dustCapDisplay || (dustCapInUnits > 0 ? dustCapInUnits.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) : '');

  const fillPercentage = dustCapInUnits > 0
    ? Math.min(100, Math.max(dustInUnits > 0 ? 1 : 0, Math.round((dustInUnits / dustCapInUnits) * 100)))
    : 0;

  return (
    <div className="glass-panel p-6 sm:p-8 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/30">
            <Wallet className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Wallet Studio
              {!walletStatus && !isExtensionConnected ? (
                <span className="flex items-center space-x-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 border border-white/10">
                  <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
                  <span>Connecting...</span>
                </span>
              ) : walletStatus?.isSynced || isExtensionConnected ? (
                <button
                  onClick={onOpenSyncDashboard}
                  className="flex items-center space-x-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all cursor-pointer"
                  title="Click to open Live Sync Telemetry Monitor"
                >
                  <ShieldCheck className="h-3 w-3" />
                  <span>Synced</span>
                </button>
              ) : (
                <button
                  onClick={onOpenSyncDashboard}
                  className="flex items-center space-x-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-pointer"
                  title="Click to open Live Sync Telemetry Monitor"
                >
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>
                    Syncing... {walletStatus?.syncProgress?.percentage !== undefined ? `${walletStatus.syncProgress.percentage}%` : ''}
                  </span>
                </button>
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span>{connectionMode === 'extension' ? 'Midnight Lace Browser Extension (Zero-Seed)' : 'Midnight Multi-Role HD Wallet'}</span>
              {!walletStatus?.isSynced && walletStatus?.syncProgress?.unshielded && (
                <span className="text-[11px] text-slate-500 font-mono">
                  [Unshielded: {walletStatus.syncProgress.unshielded.percentage}% | Shielded: {walletStatus.syncProgress.shielded?.percentage ?? 0}% | DUST: {walletStatus.syncProgress.dust?.percentage ?? 0}%]
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
            {/* Send tNIGHT Button */}
            <button
              onClick={() => setShowSendModal(true)}
              className="flex items-center space-x-1.5 rounded-lg bg-midnight-900/80 px-3 py-1.5 text-xs font-medium text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-200 transition-all"
              title="Send tNIGHT to an unshielded address"
            >
              <Send className="h-3.5 w-3.5 text-cyan-400" />
              <span>Send</span>
            </button>
          {onOpenSyncDashboard && (
            <button
              onClick={onOpenSyncDashboard}
              className="flex items-center space-x-1.5 rounded-lg bg-midnight-900/80 px-3 py-1.5 text-xs font-medium text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-200 transition-all"
            >
              <Activity className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
              <span>Sync Monitor</span>
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={isLoading || (!seed && !isExtensionConnected)}
            className="flex items-center space-x-1.5 rounded-lg bg-midnight-900/80 px-3 py-1.5 text-xs font-medium text-slate-300 border border-white/10 hover:border-purple-500/40 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
            <span>{isLoading ? 'Updating...' : 'Refresh Balance'}</span>
          </button>
        </div>
      </div>

      {/* Wallet Connection Mode Selector */}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-midnight-950/90 p-2 rounded-2xl border border-white/10">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setConnectionMode('extension')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              connectionMode === 'extension'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-950/40 border border-purple-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <span>Browser Wallet (Lace Extension)</span>
            {isExtensionConnected && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping ml-1" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setConnectionMode('seed')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              connectionMode === 'seed'
                ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg shadow-indigo-950/40 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Key className="h-4 w-4 text-indigo-400" />
            <span>Dev Seed Keyring</span>
          </button>
        </div>

        <div className="flex items-center space-x-2 px-2">
          {connectionMode === 'extension' ? (
            <span className="text-[11px] text-emerald-400 flex items-center space-x-1 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Zero-Seed Security (Extension Isolated)</span>
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 flex items-center space-x-1 font-medium">
              <Key className="h-3.5 w-3.5 text-indigo-400" />
              <span>Headless / Multi-Role Development Mode</span>
            </span>
          )}
        </div>
      </div>

      {/* Mode 1: Browser Wallet (Lace Extension) Panel */}
      {connectionMode === 'extension' ? (
        <div className="mt-4 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-midnight-950 to-purple-950/40 border border-indigo-500/30 p-6 space-y-5 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-inner">
                <Shield className="h-6 w-6 text-cyan-300" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h4 className="text-base font-bold text-white">Midnight Browser Wallet</h4>
                  {isExtensionConnected ? (
                    <span className="rounded-full bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 text-xs font-semibold border border-emerald-500/40 flex items-center space-x-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Connected</span>
                    </span>
                  ) : isExtensionInstalled ? (
                    <span className="rounded-full bg-cyan-500/20 text-cyan-300 px-2.5 py-0.5 text-xs font-semibold border border-cyan-500/40">
                      Lace Detected
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/20 text-amber-300 px-2.5 py-0.5 text-xs font-semibold border border-amber-500/40">
                      Extension Not Detected
                    </span>
                  )}
                </div>
                {isConnectingExtension ? (
                  <p className="text-xs text-cyan-300 animate-pulse mt-0.5 font-medium flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                    Approval requested: check your Lace extension popup or browser toolbar icon to confirm.
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sign transactions securely via browser popups. Your seed phrase never leaves your wallet extension.
                  </p>
                )}
              </div>
            </div>

            <div>
              {isExtensionConnected ? (
                <button
                  type="button"
                  onClick={disconnectExtension}
                  className="inline-flex items-center space-x-2 rounded-xl bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold px-4 py-2.5 transition-all cursor-pointer"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Disconnect Wallet</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnectExtension()}
                  disabled={isConnectingExtension}
                  className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 text-white text-xs font-bold px-5 py-2.5 shadow-lg shadow-purple-950/50 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-75"
                >
                  <Zap className={`h-4 w-4 text-cyan-200 ${isConnectingExtension ? 'animate-spin' : ''}`} />
                  <span>{isConnectingExtension ? 'Authorizing in Lace...' : 'Connect Midnight Wallet'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Network Selection for Browser Wallet */}
          {!isExtensionConnected && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
              <span className="text-xs font-semibold text-slate-400">Target Network:</span>
              {[
                { id: 'preprod', label: 'Preprod (Recommended)', desc: 'Midnight Preprod Testnet' },
                { id: 'preview', label: 'Preview', desc: 'Midnight Preview Testnet' },
                { id: 'undeployed', label: 'DevNet', desc: 'Local / DevNet (Undeployed)' },
              ].map((net) => (
                <button
                  key={net.id}
                  type="button"
                  onClick={() => {
                    setTargetNetwork(net.id);
                    setExtensionError('');
                  }}
                  disabled={isConnectingExtension}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    targetNetwork === net.id
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40 border border-purple-400/50'
                      : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5'
                  }`}
                  title={net.desc}
                >
                  {net.label}
                </button>
              ))}
            </div>
          )}

          {/* Real-time Connection Progress & Reload Tip */}
          {isConnectingExtension && (
            <div className="rounded-xl bg-cyan-950/40 border border-cyan-500/30 p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                <Zap className="h-4 w-4 animate-spin text-cyan-400" />
                <span>{connectionProgress || 'Authorizing with Lace browser extension...'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-300 pt-1 border-t border-cyan-500/20">
                <p className="text-[11px] leading-relaxed">
                  Please approve the connection prompt in your Lace extension window. If Lace is locked, enter your wallet password when prompted.
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-[11px] font-semibold cursor-pointer transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          )}

          {/* Connection Error Notice Card */}
          {extensionError && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-4 space-y-3 text-xs shadow-lg">
              <div className="flex items-start gap-2.5 text-rose-200">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-100">Connection Handshake Notice</p>
                  <p className="text-rose-300 mt-0.5 leading-relaxed">{extensionError}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-rose-500/20">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Reload Page & Reconnect</span>
                </button>
                {targetNetwork !== 'preprod' && (
                  <button
                    type="button"
                    onClick={() => {
                      setTargetNetwork('preprod');
                      handleConnectExtension('preprod');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-purple-600/40 hover:bg-purple-600/60 text-purple-200 border border-purple-400/40 font-semibold text-xs cursor-pointer transition-all"
                  >
                    Connect with Preprod Network
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExtensionError('')}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 text-xs cursor-pointer ml-auto"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Connected Info */}
          {isExtensionConnected ? (
            <div className="rounded-xl bg-midnight-950/80 p-4 border border-white/10 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Connected Preprod Account
                </span>
                <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Network: {extensionNetworkId.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 bg-midnight-900/90 p-3 rounded-lg border border-white/5">
                <p className="font-mono text-xs text-cyan-300 break-all select-all">
                  {extensionAddress || activeDisplayAddress}
                </p>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(extensionAddress || activeDisplayAddress || '');
                      setCopiedAddr(true);
                      setTimeout(() => setCopiedAddr(false), 2000);
                    }}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Copy Address"
                  >
                    {copiedAddr ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <a
                    href={`https://explorer.1am.xyz/contract/${extensionAddress || activeDisplayAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="View in Explorer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-indigo-400" />
                  </a>
                </div>
              </div>
            </div>
          ) : !isExtensionInstalled ? (
            <div className="rounded-xl bg-amber-950/30 p-5 border border-amber-500/20 text-xs text-slate-300 flex items-start space-x-3.5">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-2.5 flex-1">
                <div>
                  <p className="font-semibold text-amber-200 text-sm">Midnight Lace Extension Not Detected</p>
                  <p className="text-slate-400 leading-relaxed mt-1">
                    If you just installed or pinned the <strong>Midnight Lace</strong> extension in Chrome, Chrome requires a <strong>quick page reload</strong> to inject the <code className="font-mono text-cyan-300">window.midnight</code> connector into this tab.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const found = recheckExtension();
                      if (found) {
                        toast.success('Extension Found', 'Midnight Lace detected!');
                      } else {
                        toast.info('Detection Check', 'No provider detected yet. Please reload tab.');
                      }
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-slate-200 hover:bg-white/20 font-semibold transition-colors cursor-pointer border border-white/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Re-scan Extension</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors cursor-pointer shadow"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Reload Page</span>
                  </button>
                  <a
                    href="https://midnight.network"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold hover:bg-amber-500/30 transition-colors"
                  >
                    <span>Download Midnight Lace</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        /* Mode 2: Seed Configuration Bar */
        <div className="mt-4">
          <form onSubmit={handleSaveSeed} className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-indigo-400" />
                <span>Wallet Seed (64 hex characters)</span>
              </label>
              <div className="flex items-center space-x-2 text-xs">
                {defaultSeed && (
                  <button
                    type="button"
                    onClick={handleLoadDefaultSeed}
                    className="text-indigo-400 hover:text-indigo-300 hover:underline"
                  >
                    Use Deployment Seed
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleGenerateSeed}
                  className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
                >
                  <PlusCircle className="h-3 w-3" />
                  <span>Generate New</span>
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showSeed ? 'text' : 'password'}
                  value={inputSeed}
                  onChange={(e) => setInputSeed(e.target.value)}
                  placeholder="Paste 64-character hex seed..."
                  className="w-full rounded-xl bg-midnight-950/80 px-4 py-2.5 text-xs font-mono text-slate-200 border border-white/10 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowSeed(!showSeed)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showSeed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={inputSeed === seed}
                className="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40 transition-all cursor-pointer"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={handleCopySeed}
                className="rounded-xl bg-white/5 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white border border-white/5 cursor-pointer"
                title="Copy Seed"
              >
                {copiedSeed ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Address & Balances Grid */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bech32 Address Card */}
        <div className="rounded-xl bg-midnight-950/80 p-4 border border-white/5 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 block mb-1">
              {connectionMode === 'extension' ? 'Connected Preprod Address' : 'Unshielded Address (Bech32)'}
            </span>
            <p className="font-mono text-xs text-slate-200 break-all line-clamp-2">
              {activeDisplayAddress || (seed ? 'Deriving address...' : 'No wallet connected')}
            </p>
          </div>
          {activeDisplayAddress && (
            <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
              <button
                onClick={handleCopyAddr}
                className="inline-flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
              >
                {copiedAddr ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedAddr ? 'Copied to Clipboard' : 'Copy Address'}</span>
              </button>
              <a
                href={`https://explorer.1am.xyz/contract/${activeDisplayAddress}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-white transition-colors"
                title="View in Explorer"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* tNIGHT Balance */}
        <div className="rounded-xl bg-midnight-950/80 p-4 border border-white/5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                tNIGHT Balance
              </span>
              <Coins className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-1">
              <div className="flex items-baseline space-x-1.5">
                <p className="text-2xl font-bold text-white tracking-tight">{formattedTNight}</p>
                <span className="text-xs text-cyan-400 font-semibold">tNIGHT</span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {rawNight > 0n ? `${rawNight.toLocaleString()} base units` : 'Unshielded Native Token'}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5">
            <a
              href="https://midnight-tmnight-preprod.nethermind.dev/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              <span>Get Free tNIGHT</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* DUST Balance */}
        <div className="rounded-xl bg-midnight-950/80 p-4 border border-white/5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                DUST Balance
              </span>
              <Flame className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-1">
              <div className="flex items-baseline space-x-1.5">
                <p className="text-2xl font-bold text-amber-300 tracking-tight">{formattedDust}</p>
                <span className="text-xs text-amber-400 font-semibold">DUST</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {formattedDustCap
                  ? `Tank Capacity: ${formattedDustCap} DUST`
                  : 'Zero-Knowledge Gas Token'}
              </p>
              {dustCapInUnits > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-midnight-900 border border-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500"
                      style={{
                        width: `${fillPercentage}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono block">
                    Tank Fill: {fillPercentage}%
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between">
            {connectionMode === 'extension' ? (
              <span
                className="inline-flex items-center space-x-1.5 text-xs text-amber-300/90 font-medium"
                title="DUST generation for your Lace account is managed directly in the Lace extension. Accrual occurs continuously over network epochs."
              >
                <Zap className="h-3 w-3 text-amber-400" />
                <span>Managed in Lace Extension</span>
              </span>
            ) : (
              <button
                onClick={onRegisterDust}
                disabled={isRegisteringDust || !walletStatus || BigInt(walletStatus.tNightBalance || 0) === 0n}
                className="inline-flex items-center space-x-1 text-xs text-amber-400 hover:text-amber-300 font-medium disabled:opacity-40 disabled:hover:text-amber-400 cursor-pointer"
              >
                <Zap className={`h-3 w-3 ${isRegisteringDust ? 'animate-bounce' : ''}`} />
                <span>{isRegisteringDust ? 'Registering...' : 'Register for DUST'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Nethermind Faucet Notice Alert */}
      <div className="mt-5 rounded-xl bg-indigo-950/30 p-4 border border-indigo-500/20 text-xs text-slate-300 flex items-start space-x-3">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-200">
            Preprod Faucet Notice
          </p>
          <p className="text-slate-400 leading-relaxed">
            Need test tokens? Copy your Bech32 address above and request tNIGHT from the active Nethermind Preprod Faucet at{' '}
            <a
              href="https://midnight-tmnight-preprod.nethermind.dev/"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 underline font-mono hover:text-cyan-300"
            >
              midnight-tmnight-preprod.nethermind.dev
            </a>
            . Once received, register for DUST (or check your Lace Dust Tank) to start generating fuel. Note that DUST behaves like a battery and accrues gradually over network epochs based on your registered tNIGHT balance.
          </p>
        </div>
      </div>


        {/* Redesigned Modern Web3 Send Modal */}
        {showSendModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-midnight-950/95 border border-indigo-500/30 rounded-2xl w-full max-w-lg shadow-2xl shadow-purple-950/50 overflow-hidden relative">
              {/* Modal Top Glowing Accent */}
              <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500" />

              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/5">
                <div className="flex items-center space-x-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30">
                    <Send className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Send Unshielded tNIGHT
                      <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20">
                        Preprod
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Transparent on-chain transfer to any Midnight unshielded address
                    </p>
                  </div>
                </div>
                {!isSending && (
                  <button
                    onClick={() => {
                      setShowSendModal(false);
                      setReceiverAddress('');
                      setSendAmount('');
                      setSendError('');
                      setSendReceipt(null);
                      setSendStep(1);
                    }}
                    className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                  >
                    <span className="text-sm font-bold">✕</span>
                  </button>
                )}
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-5">
                {/* Send Error Notice */}
                {sendError && (
                  <div className="p-3.5 bg-rose-950/40 border border-rose-500/30 text-rose-200 rounded-xl text-xs flex items-start space-x-2.5 animate-shake">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-rose-300">Transfer Failed</p>
                      <p className="text-rose-200/80 mt-0.5 break-all">{sendError}</p>
                    </div>
                  </div>
                )}

                {/* State 1: Input Form (when not sending and no receipt) */}
                {!isSending && !sendReceipt && (
                  <div className="space-y-4">
                    {/* Available Balance Helper */}
                    <div className="flex items-center justify-between rounded-xl bg-midnight-900/60 p-3 border border-white/5 text-xs">
                      <div className="flex items-center space-x-2 text-slate-400">
                        <Coins className="h-4 w-4 text-cyan-400" />
                        <span>Available Balance:</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white font-mono">{formattedTNight} tNIGHT</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (walletStatus?.tNightBalance) {
                              const maxAmt = (Number(rawNight) / 1_000_000).toString();
                              setSendAmount(maxAmt);
                            }
                          }}
                          className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/30 transition-all"
                        >
                          MAX
                        </button>
                      </div>
                    </div>

                    {/* Receiver Address Field */}
                    <div>
                      <label className="text-xs font-semibold text-slate-300 flex items-center justify-between mb-1.5">
                        <span>Recipient Address</span>
                        <span className="text-[10px] text-slate-400 font-normal">Bech32m or 64-char Hex</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="mn_addr_preprod1... or hex address"
                          value={receiverAddress}
                          onChange={(e) => setReceiverAddress(e.target.value)}
                          className="w-full rounded-xl bg-midnight-900/90 px-3.5 py-2.5 text-xs font-mono text-slate-200 border border-white/10 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 placeholder:text-slate-600"
                        />
                      </div>
                    </div>

                    {/* Amount Field */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-300">
                          Amount to Send
                        </label>
                        {sendAmount && !isNaN(Number(sendAmount)) && Number(sendAmount) > 0 && (
                          <span className="text-[11px] font-mono text-cyan-400">
                            ≈ {Math.floor(Number(sendAmount) * 1_000_000).toLocaleString()} base units
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.000001"
                          min="0"
                          placeholder="0.00"
                          value={sendAmount}
                          onChange={(e) => setSendAmount(e.target.value)}
                          className="w-full rounded-xl bg-midnight-900/90 px-3.5 py-2.5 text-xs font-mono text-slate-200 border border-white/10 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 placeholder:text-slate-600 pr-16"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-cyan-400">
                          tNIGHT
                        </div>
                      </div>
                    </div>

                    {/* Gas Fee & Network Notice */}
                    <div className="rounded-xl bg-indigo-950/30 p-3 border border-indigo-500/20 text-[11px] text-slate-400 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Flame className="h-3.5 w-3.5 text-amber-400" />
                        <span>Estimated Gas Fee:</span>
                      </div>
                      <div className="flex items-center space-x-1 font-mono text-amber-300 font-semibold">
                        <span>Paid in DUST</span>
                        <span className="text-slate-500 font-normal">(auto-balanced)</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowSendModal(false);
                          setReceiverAddress('');
                          setSendAmount('');
                          setSendError('');
                        }}
                        className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setSendError('');
                          if (!receiverAddress.trim()) {
                            setSendError('Please enter a recipient unshielded address');
                            return;
                          }
                          const amtNum = Number(sendAmount);
                          if (isNaN(amtNum) || amtNum <= 0) {
                            setSendError('Please enter a valid positive transfer amount');
                            return;
                          }
                          if (amtNum * 1_000_000 > Number(rawNight)) {
                            setSendError(`Insufficient balance. You have ${formattedTNight} tNIGHT.`);
                            return;
                          }

                          setIsSending(true);
                          setSendStep(1);

                          // Step simulation timers for rich UI progression feedback
                          const timer1 = setTimeout(() => setSendStep(2), 1200);
                          const timer2 = setTimeout(() => setSendStep(3), 3200);
                          const timer3 = setTimeout(() => setSendStep(4), 5800);

                          try {
                            const response = await fetch('/api/wallet/send', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                seed,
                                receiver: receiverAddress.trim(),
                                amount: sendAmount.trim(),
                              }),
                            });
                            const result = await response.json();
                            clearTimeout(timer1);
                            clearTimeout(timer2);
                            clearTimeout(timer3);

                            if (!response.ok || !result.success) {
                              throw new Error(result.error || 'Transaction submission failed');
                            }

                            setSendStep(5);
                            const receiptData = typeof result.data === 'string'
                              ? { txHash: result.data }
                              : (result.data?.txHash && typeof result.data.txHash === 'object'
                                  ? result.data.txHash
                                  : result.data);
                            setSendReceipt(receiptData);
                            setSuccessToast(`Transfer of ${sendAmount} tNIGHT sent successfully!`);
                            // Refresh wallet balances
                            onRefresh();
                          } catch (e: any) {
                            clearTimeout(timer1);
                            clearTimeout(timer2);
                            clearTimeout(timer3);
                            setSendError(e.message || 'Transaction submission failed');
                          } finally {
                            setIsSending(false);
                          }
                        }}
                        disabled={!receiverAddress.trim() || !sendAmount || isNaN(Number(sendAmount)) || Number(sendAmount) <= 0}
                        className="flex items-center space-x-2 px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 rounded-xl shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Confirm & Send</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* State 2: Transaction In-Progress Stepper View */}
                {isSending && (
                  <div className="space-y-6 py-2">
                    <div className="text-center space-y-1">
                      <h4 className="text-sm font-bold text-white">Processing Unshielded Transfer</h4>
                      <p className="text-xs text-slate-400">
                        Sending <span className="text-cyan-300 font-mono font-bold">{sendAmount} tNIGHT</span> to{' '}
                        <span className="text-slate-300 font-mono">
                          {receiverAddress.slice(0, 10)}...{receiverAddress.slice(-8)}
                        </span>
                      </p>
                    </div>

                    {/* Visual 4-Step Pipeline */}
                    <div className="space-y-3 relative before:absolute before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-white/10">
                      {/* Step 1: Create Recipe */}
                      <div className="flex items-start space-x-3 relative">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-all z-10 ${
                            sendStep > 1
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : sendStep === 1
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 ring-4 ring-cyan-500/10 animate-pulse'
                              : 'bg-midnight-900 border-white/10 text-slate-500'
                          }`}
                        >
                          {sendStep > 1 ? <Check className="h-4 w-4" /> : <RefreshCw className={`h-4 w-4 ${sendStep === 1 ? 'animate-spin' : ''}`} />}
                        </div>
                        <div className="pt-1">
                          <p className={`text-xs font-semibold ${sendStep >= 1 ? 'text-white' : 'text-slate-500'}`}>
                            1. Create Transfer Recipe
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {sendStep === 1 ? 'Selecting unshielded coins & balancing outputs...' : 'UTXO inputs and outputs prepared.'}
                          </p>
                        </div>
                      </div>

                      {/* Step 2: Sign Keystore */}
                      <div className="flex items-start space-x-3 relative">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-all z-10 ${
                            sendStep > 2
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : sendStep === 2
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 ring-4 ring-cyan-500/10 animate-pulse'
                              : 'bg-midnight-900 border-white/10 text-slate-500'
                          }`}
                        >
                          {sendStep > 2 ? <Check className="h-4 w-4" /> : <Key className={`h-4 w-4 ${sendStep === 2 ? 'animate-spin' : ''}`} />}
                        </div>
                        <div className="pt-1">
                          <p className={`text-xs font-semibold ${sendStep >= 2 ? 'text-white' : 'text-slate-500'}`}>
                            2. Sign with Keystore
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {sendStep === 2 ? 'Authorizing unshielded UTXOs with private keys...' : sendStep > 2 ? 'Cryptographically signed.' : 'Awaiting signature.'}
                          </p>
                        </div>
                      </div>

                      {/* Step 3: ZK Proof & Finalize */}
                      <div className="flex items-start space-x-3 relative">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-all z-10 ${
                            sendStep > 3
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : sendStep === 3
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 ring-4 ring-cyan-500/10 animate-pulse'
                              : 'bg-midnight-900 border-white/10 text-slate-500'
                          }`}
                        >
                          {sendStep > 3 ? <Check className="h-4 w-4" /> : <Zap className={`h-4 w-4 ${sendStep === 3 ? 'animate-spin' : ''}`} />}
                        </div>
                        <div className="pt-1">
                          <p className={`text-xs font-semibold ${sendStep >= 3 ? 'text-white' : 'text-slate-500'}`}>
                            3. Prove & Finalize
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {sendStep === 3 ? 'Generating ZK proofs and binding DUST gas fee...' : sendStep > 3 ? 'Proof finalized.' : 'Awaiting proof generation.'}
                          </p>
                        </div>
                      </div>

                      {/* Step 4: Network Broadcast */}
                      <div className="flex items-start space-x-3 relative">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-all z-10 ${
                            sendStep >= 4
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 ring-4 ring-cyan-500/10 animate-pulse'
                              : 'bg-midnight-900 border-white/10 text-slate-500'
                          }`}
                        >
                          <Send className={`h-4 w-4 ${sendStep === 4 ? 'animate-bounce' : ''}`} />
                        </div>
                        <div className="pt-1">
                          <p className={`text-xs font-semibold ${sendStep >= 4 ? 'text-white' : 'text-slate-500'}`}>
                            4. Submit to Midnight Network
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {sendStep === 4 ? 'Broadcasting transaction to Midnight node relay...' : 'Awaiting broadcast.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* State 3: Completed Success Receipt View */}
                {!isSending && sendReceipt && (
                  <div className="space-y-4 py-1 animate-fade-in">
                    {/* Success Header Badge */}
                    <div className="flex flex-col items-center justify-center text-center p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-400 mb-2">
                        <Check className="h-6 w-6 text-emerald-400" />
                      </div>
                      <h4 className="text-sm font-bold text-emerald-300">Transfer Completed Successfully</h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Your unshielded transfer has been finalized and submitted to the network.
                      </p>
                    </div>

                    {/* Receipt Details Card */}
                    <div className="rounded-xl bg-midnight-900/80 p-4 border border-white/5 space-y-3">
                      {/* Amount & Gas Cost Row */}
                      <div className="grid grid-cols-2 gap-3 pb-3 border-b border-white/5">
                        <div>
                          <span className="text-[11px] text-slate-400 uppercase tracking-wider block mb-0.5">
                            Amount Sent
                          </span>
                          <span className="text-base font-bold text-white font-mono">
                            {sendReceipt.amount || sendAmount} <span className="text-xs text-cyan-400 font-semibold">tNIGHT</span>
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 uppercase tracking-wider block mb-0.5 flex items-center gap-1">
                            <Flame className="h-3 w-3 text-amber-400" />
                            <span>DUST Gas Paid</span>
                          </span>
                          <span className="text-base font-bold text-amber-300 font-mono">
                            {sendReceipt.dustPaid && sendReceipt.dustPaid !== '0'
                              ? Number(sendReceipt.dustPaid).toLocaleString()
                              : '< 1'}{' '}
                            <span className="text-xs text-amber-400 font-semibold">DUST</span>
                          </span>
                        </div>
                      </div>

                      {/* Recipient Address */}
                      <div>
                        <span className="text-[11px] text-slate-400 uppercase tracking-wider block mb-0.5">
                          Recipient Address
                        </span>
                        <p className="text-xs font-mono text-slate-300 break-all bg-midnight-950/60 p-2 rounded-lg border border-white/5">
                          {sendReceipt.receiver || receiverAddress}
                        </p>
                      </div>

                      {/* Transaction Hash */}
                      {sendReceipt.txHash && (
                        <div>
                          <span className="text-[11px] text-slate-400 uppercase tracking-wider block mb-0.5">
                            Transaction Hash
                          </span>
                          <div className="flex items-center justify-between bg-midnight-950/60 p-2 rounded-lg border border-white/5">
                            <p className="text-xs font-mono text-cyan-300 truncate mr-2">
                              {sendReceipt.txHash}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (sendReceipt?.txHash) {
                                  navigator.clipboard.writeText(sendReceipt.txHash);
                                  setSuccessToast('Transaction hash copied to clipboard!');
                                }
                              }}
                              className="text-slate-400 hover:text-white p-1 hover:bg-white/5 rounded"
                              title="Copy Tx Hash"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Network & Duration */}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>Network: <strong className="text-slate-400 uppercase">Preprod</strong></span>
                        {sendReceipt.durationMs && (
                          <span>Settlement time: <strong className="text-slate-400 font-mono">{(sendReceipt.durationMs / 1000).toFixed(1)}s</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Receipt Action Buttons */}
                    <div className="flex justify-end space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSendReceipt(null);
                          setReceiverAddress('');
                          setSendAmount('');
                          setSendError('');
                          setSendStep(1);
                        }}
                        className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 transition-all"
                      >
                        Send Another
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSendModal(false);
                          setSendReceipt(null);
                          setReceiverAddress('');
                          setSendAmount('');
                          setSendError('');
                          setSendStep(1);
                        }}
                        className="px-5 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-xl transition-all shadow-lg shadow-purple-500/20"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      {/* Success Toast */}
      {successToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600/90 text-white px-4 py-2.5 rounded-xl shadow-xl shadow-emerald-950/50 backdrop-blur-md border border-emerald-400/30 text-xs font-medium animate-fade-in flex items-center space-x-2">
          <Check className="h-4 w-4 text-emerald-300" />
          <span>{successToast}</span>
        </div>
      )}
    </div>
  );
};

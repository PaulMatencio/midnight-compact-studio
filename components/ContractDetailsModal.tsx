'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    X,
    FileCode2,
    Copy,
    Check,
    ExternalLink,
    Play,
    Shield,
    Clock,
    RefreshCw,
    Globe,
    Code2,
    Layers,
    Coins,
    Hash,
    CheckCircle2,
    AlertCircle,
    Info,
    Terminal,
    PackageCheck,
} from 'lucide-react';
import { ExportDappModal } from './ExportDappModal';
import { useToast } from '@/src/presentation/context/ToastContext';
import type { DeployedContractRecord } from '@/src/domain/entities/contract-registry.entity';

interface ContractDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    contract: DeployedContractRecord | null;
    liveOwner?: string;
}

const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.1am.xyz';

export function ContractDetailsModal({
    isOpen,
    onClose,
    contract,
    liveOwner,
}: ContractDetailsModalProps) {
    const toast = useToast();
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'json'>('overview');
    const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

    // On-chain state fetching
    const [stateData, setStateData] = useState<any>(null);
    const [isLoadingState, setIsLoadingState] = useState<boolean>(true);
    const [stateError, setStateError] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

    const fetchLiveState = useCallback(async (address: string) => {
        setIsLoadingState(true);
        setStateError(null);
        try {
            const res = await fetch(`/api/contract/state?address=${encodeURIComponent(address)}`);
            const json = await res.json();
            if (json.success && json.data) {
                setStateData(json.data);
                setLastRefreshed(new Date());
            } else {
                setStateError(json.error || 'Failed to query live contract state');
            }
        } catch (err: any) {
            console.error('Failed to query contract state:', err);
            setStateError(err.message || 'Network error querying contract state');
        } finally {
            setIsLoadingState(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen && contract?.contractAddress) {
            fetchLiveState(contract.contractAddress);
        } else {
            setStateData(null);
            setStateError(null);
            setActiveTab('overview');
        }
    }, [isOpen, contract?.contractAddress, fetchLiveState]);

    // Handle Escape key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !contract) return null;

    const copyToClipboard = (text: string, key: string, label: string = 'Copied to Clipboard') => {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        toast.info(label, text.length > 32 ? `${text.slice(0, 16)}...${text.slice(-8)}` : text);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    // Derive effective owner
    const resolvedOwner =
        contract.owner ||
        liveOwner ||
        (stateData?.raw?.owner ? String(stateData.raw.owner) : undefined);

    const explorerUrl = `${EXPLORER_BASE}/contract/${encodeURIComponent(contract.contractAddress)}`;
    const workbenchUrl = `/contracts/${encodeURIComponent(contract.contractAddress)}`;

    // Extract known public ledger fields from stateData.raw
    const rawLedger = stateData?.raw || {};
    const knownFields: { key: string; label: string; value: any; icon: React.ReactNode }[] = [];

    if (rawLedger._name || rawLedger.name) {
        knownFields.push({
            key: 'name',
            label: 'Token Name',
            value: rawLedger._name || rawLedger.name,
            icon: <Coins className="h-3.5 w-3.5 text-indigo-400" />,
        });
    }

    if (rawLedger._symbol || rawLedger.symbol) {
        knownFields.push({
            key: 'symbol',
            label: 'Token Symbol',
            value: rawLedger._symbol || rawLedger.symbol,
            icon: <Coins className="h-3.5 w-3.5 text-purple-400" />,
        });
    }

    if (rawLedger._decimals !== undefined || rawLedger.decimals !== undefined) {
        knownFields.push({
            key: 'decimals',
            label: 'Decimals',
            value: rawLedger._decimals ?? rawLedger.decimals,
            icon: <Hash className="h-3.5 w-3.5 text-cyan-400" />,
        });
    }

    if (rawLedger._totalSupply !== undefined || rawLedger.totalSupply !== undefined) {
        const supply = rawLedger._totalSupply ?? rawLedger.totalSupply;
        knownFields.push({
            key: 'totalSupply',
            label: 'Total Supply',
            value: typeof supply === 'bigint' ? supply.toString() : String(supply),
            icon: <Coins className="h-3.5 w-3.5 text-emerald-400" />,
        });
    }

    if (rawLedger._maxSupply !== undefined || rawLedger.maxSupply !== undefined) {
        const maxSupply = rawLedger._maxSupply ?? rawLedger.maxSupply;
        knownFields.push({
            key: 'maxSupply',
            label: 'Max Supply',
            value:
                maxSupply === '0' || maxSupply === 0 || maxSupply === null
                    ? 'Unlimited (0)'
                    : typeof maxSupply === 'bigint'
                    ? maxSupply.toString()
                    : String(maxSupply),
            icon: <Coins className="h-3.5 w-3.5 text-amber-400" />,
        });
    }

    if (rawLedger.sequence !== undefined || rawLedger.counter !== undefined || rawLedger.state !== undefined) {
        const seq = rawLedger.sequence ?? rawLedger.counter ?? rawLedger.state;
        knownFields.push({
            key: 'sequence',
            label: 'State Sequence',
            value: String(seq),
            icon: <Layers className="h-3.5 w-3.5 text-sky-400" />,
        });
    }

    // Additional generic properties in raw ledger not in knownFields
    const handledKeys = new Set([
        '_name',
        'name',
        '_symbol',
        'symbol',
        '_decimals',
        'decimals',
        '_totalSupply',
        'totalSupply',
        '_maxSupply',
        'maxSupply',
        'sequence',
        'counter',
        'state',
        'message',
        'owner',
        'contractStateFound',
    ]);

    const otherLedgerEntries = Object.entries(rawLedger).filter(([k]) => !handledKeys.has(k));

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-3xl rounded-3xl border border-indigo-500/30 bg-midnight-950/95 shadow-2xl shadow-indigo-950/50 flex flex-col max-h-[90vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-midnight-900/60">
                    <div className="flex items-center space-x-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/30">
                            <FileCode2 className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <h3 className="text-base font-bold text-white">
                                    {contract.nickname || 'Smart Contract Details'}
                                </h3>
                                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-mono font-medium text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                                    {contract.contractType}
                                </span>
                            </div>
                            <div className="flex items-center space-x-3 text-xs text-slate-400 mt-0.5">
                                <span className="flex items-center space-x-1">
                                    <Globe className="h-3 w-3 text-emerald-400" />
                                    <span>Midnight Preprod</span>
                                </span>
                                <span>•</span>
                                <span className="flex items-center space-x-1">
                                    {isLoadingState ? (
                                        <>
                                            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                                            <span className="text-amber-300">Syncing State...</span>
                                        </>
                                    ) : stateData?.found ? (
                                        <>
                                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                            <span className="text-emerald-300">Live On-Chain</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="h-2 w-2 rounded-full bg-slate-400" />
                                            <span className="text-slate-400">Ledger Disclosed</span>
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="rounded-xl p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                        title="Close modal"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Tabs / Subheader */}
                <div className="flex items-center justify-between px-6 pt-3 border-b border-white/5 bg-midnight-900/30">
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center space-x-2 border-b-2 ${
                                activeTab === 'overview'
                                    ? 'border-indigo-400 text-indigo-300 bg-midnight-900/80'
                                    : 'border-transparent text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Info className="h-3.5 w-3.5" />
                            <span>Overview & State</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('json')}
                            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center space-x-2 border-b-2 ${
                                activeTab === 'json'
                                    ? 'border-purple-400 text-purple-300 bg-midnight-900/80'
                                    : 'border-transparent text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Code2 className="h-3.5 w-3.5" />
                            <span>Raw Ledger JSON</span>
                        </button>
                    </div>

                    <button
                        onClick={() => fetchLiveState(contract.contractAddress)}
                        disabled={isLoadingState}
                        className="text-xs text-slate-400 hover:text-white flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-all cursor-pointer disabled:opacity-50 mb-1"
                        title="Refresh on-chain state"
                    >
                        <RefreshCw className={`h-3 w-3 ${isLoadingState ? 'animate-spin text-indigo-400' : ''}`} />
                        <span>Refresh State</span>
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {activeTab === 'overview' ? (
                        <>
                            {/* Contract Identifiers Section */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                                    <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                                    <span>Contract Identifiers</span>
                                </h4>

                                {/* Contract Address Card */}
                                <div className="rounded-2xl bg-midnight-900/70 border border-white/10 p-4 space-y-2">
                                    <div className="flex items-center justify-between text-xs text-slate-400">
                                        <span className="font-semibold text-white">Contract Address</span>
                                        <a
                                            href={explorerUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 transition-colors text-[11px]"
                                        >
                                            <span>Open in Explorer</span>
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                    <div className="flex items-center justify-between rounded-xl bg-midnight-950 px-3.5 py-2.5 border border-white/5 font-mono text-xs text-cyan-300">
                                        <span className="truncate mr-3 select-all">{contract.contractAddress}</span>
                                        <div className="flex items-center space-x-2 shrink-0">
                                            <button
                                                onClick={() => copyToClipboard(contract.contractAddress, 'contract-address')}
                                                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                                                title="Copy contract address"
                                            >
                                                {copiedKey === 'contract-address' ? (
                                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Owner & Deployment Info Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Contract Owner Card */}
                                    <div className="rounded-2xl bg-midnight-900/70 border border-white/10 p-4 space-y-2">
                                        <div className="flex items-center justify-between text-xs text-slate-400">
                                            <span className="font-semibold text-white flex items-center space-x-1.5">
                                                <Shield className="h-3.5 w-3.5 text-indigo-400" />
                                                <span>Contract Owner</span>
                                            </span>
                                            {resolvedOwner ? (
                                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                                    <span>Configured</span>
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-white/5">
                                                    Open / None
                                                </span>
                                            )}
                                        </div>
                                        {resolvedOwner ? (
                                            <div className="flex items-center justify-between rounded-xl bg-midnight-950 px-3 py-2 border border-white/5 font-mono text-xs text-emerald-300">
                                                <span className="truncate mr-2 select-all" title={resolvedOwner}>
                                                    {resolvedOwner}
                                                </span>
                                                <button
                                                    onClick={() => copyToClipboard(resolvedOwner, 'owner-address')}
                                                    className="p-1 text-slate-400 hover:text-white transition-colors shrink-0"
                                                    title="Copy owner address"
                                                >
                                                    {copiedKey === 'owner-address' ? (
                                                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="h-3.5 w-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl bg-midnight-950/40 px-3 py-2 border border-white/5 font-mono text-slate-500 text-xs italic">
                                                No owner constraint found in contract ledger
                                            </div>
                                        )}
                                    </div>

                                    {/* Deployment Details Card */}
                                    <div className="rounded-2xl bg-midnight-900/70 border border-white/10 p-4 space-y-2">
                                        <div className="flex items-center justify-between text-xs text-slate-400">
                                            <span className="font-semibold text-white flex items-center space-x-1.5">
                                                <Clock className="h-3.5 w-3.5 text-purple-400" />
                                                <span>Deployment Timestamp</span>
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                {contract.deployedAt ? 'Tracked' : 'Imported'}
                                            </span>
                                        </div>
                                        <div className="rounded-xl bg-midnight-950 px-3 py-2 border border-white/5 text-xs text-slate-200">
                                            {contract.deployedAt ? (
                                                <div className="flex items-center justify-between">
                                                    <span>{new Date(contract.deployedAt).toLocaleString()}</span>
                                                    <span className="text-[11px] text-slate-400 font-mono">
                                                        {new Date(contract.deployedAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-500 italic">Pre-existing address tracked</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Live Public Ledger State Section */}
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                                        <Layers className="h-3.5 w-3.5 text-emerald-400" />
                                        <span>Public On-Chain Ledger State</span>
                                    </h4>
                                    {lastRefreshed && (
                                        <span className="text-[11px] text-slate-400">
                                            Last checked: {lastRefreshed.toLocaleTimeString()}
                                        </span>
                                    )}
                                </div>

                                {isLoadingState ? (
                                    <div className="rounded-2xl bg-midnight-900/40 border border-white/10 p-8 text-center space-y-3">
                                        <RefreshCw className="h-6 w-6 text-indigo-400 animate-spin mx-auto" />
                                        <p className="text-xs text-slate-400">
                                            Querying Midnight Preprod GraphQL Indexer for contract state...
                                        </p>
                                    </div>
                                ) : stateError ? (
                                    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 space-y-2">
                                        <div className="flex items-center space-x-2 text-amber-400 text-xs font-semibold">
                                            <AlertCircle className="h-4 w-4" />
                                            <span>Could not retrieve live on-chain state</span>
                                        </div>
                                        <p className="text-xs text-slate-400">{stateError}</p>
                                        <button
                                            onClick={() => fetchLiveState(contract.contractAddress)}
                                            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline"
                                        >
                                            Retry Query
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {/* Prominent Message Banner if message is set */}
                                        {(stateData?.message || rawLedger.message) && (
                                            <div className="rounded-2xl bg-gradient-to-r from-indigo-950/50 via-purple-950/40 to-midnight-950 border border-indigo-500/30 p-4 space-y-1.5">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                                                    Disclosed Message State
                                                </span>
                                                <p className="text-sm font-medium text-white break-words">
                                                    &ldquo;{stateData.message || rawLedger.message}&rdquo;
                                                </p>
                                            </div>
                                        )}

                                        {/* Known Ledger Fields Grid */}
                                        {knownFields.length > 0 && (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                                {knownFields.map((field) => (
                                                    <div
                                                        key={field.key}
                                                        className="rounded-2xl bg-midnight-900/70 border border-white/10 p-3.5 space-y-1"
                                                    >
                                                        <div className="flex items-center space-x-1.5 text-[11px] text-slate-400">
                                                            {field.icon}
                                                            <span>{field.label}</span>
                                                        </div>
                                                        <div className="text-sm font-bold text-white font-mono truncate select-all" title={String(field.value)}>
                                                            {field.value}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Other Disclosed State Properties */}
                                        {otherLedgerEntries.length > 0 && (
                                            <div className="rounded-2xl bg-midnight-900/60 border border-white/10 p-4 space-y-2.5">
                                                <span className="text-xs font-semibold text-slate-300">
                                                    Additional Disclosed Fields ({otherLedgerEntries.length})
                                                </span>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                                    {otherLedgerEntries.map(([k, v]) => (
                                                        <div
                                                            key={k}
                                                            className="flex items-center justify-between rounded-xl bg-midnight-950/70 px-3 py-2 border border-white/5"
                                                        >
                                                            <span className="text-slate-400 font-mono text-[11px]">{k}:</span>
                                                            <span className="text-cyan-300 font-mono font-medium truncate ml-2 max-w-[180px]" title={typeof v === 'object' ? JSON.stringify(v) : String(v)}>
                                                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {knownFields.length === 0 && !stateData?.message && otherLedgerEntries.length === 0 && (
                                            <div className="rounded-2xl bg-midnight-900/40 border border-white/5 p-6 text-center text-xs text-slate-400 space-y-1">
                                                <p className="text-white font-medium">Contract State Initialized</p>
                                                <p>No additional public custom fields are exposed in this contract ledger.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        /* Raw JSON Viewer Tab */
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                                <span>Complete raw on-chain state returned by Midnight Node/Indexer:</span>
                                <button
                                    onClick={() =>
                                        copyToClipboard(
                                            JSON.stringify(stateData || { message: 'No state loaded' }, null, 2),
                                            'raw-json',
                                            'JSON Copied'
                                        )
                                    }
                                    className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                                >
                                    {copiedKey === 'raw-json' ? (
                                        <>
                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                            <span className="text-emerald-400">Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3.5 w-3.5" />
                                            <span>Copy JSON</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="rounded-2xl bg-midnight-950 p-4 border border-white/10 font-mono text-xs text-slate-300 overflow-x-auto max-h-[350px]">
                                <pre>{JSON.stringify(stateData || { loading: isLoadingState }, null, 2)}</pre>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between border-t border-white/10 px-6 py-4 bg-midnight-900/60">
                    <div className="flex items-center space-x-4">
                        <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                            <span>View on Explorer</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                            type="button"
                            onClick={() => setIsExportModalOpen(true)}
                            className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 border border-cyan-500/40 hover:border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-950/40 transition-all cursor-pointer shadow-sm"
                            title="Export DApp bundle with current contract address for Gemini"
                        >
                            <PackageCheck className="h-3.5 w-3.5 text-cyan-300" />
                            <span>Export for Gemini</span>
                        </button>
                    </div>

                    <div className="flex items-center space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                        >
                            Close
                        </button>
                        <Link
                            href={workbenchUrl}
                            className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:scale-[1.02] transition-transform cursor-pointer"
                        >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Open Execution Workbench</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Export DApp Bundle for Gemini Modal */}
            <ExportDappModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                contractFilename={contract.contractType || 'fungible-token-v2-2'}
                contractAddress={contract.contractAddress}
            />
        </div>
    );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    FileCode2,
    ExternalLink,
    Play,
    Copy,
    Check,
    Rocket,
    Shield,
    Clock,
    Plus,
    Search,
    Trash2,
    Sparkles,
    CheckCircle2,
    Info
} from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ContractDetailsModal } from '@/components/ContractDetailsModal';
import { useToast } from '@/src/presentation/context/ToastContext';
import type { DeployedContractRecord } from '@/src/domain/entities/contract-registry.entity';

const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.1am.xyz';

export default function ContractsPage() {
    const [deployments, setDeployments] = useState<DeployedContractRecord[]>([]);
    const [liveOwners, setLiveOwners] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [copied, setCopied] = useState<string | null>(null);
    const toast = useToast();

    // Details Modal State (Triggered on Card Double Click)
    const [selectedContractForDetails, setSelectedContractForDetails] = useState<DeployedContractRecord | null>(null);

    // Import Modal State
    const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
    const [importAddress, setImportAddress] = useState<string>('');
    const [importNickname, setImportNickname] = useState<string>('');
    const [importContractType, setImportContractType] = useState<string>('fungible-token-v2');
    const [importOwner, setImportOwner] = useState<string>('');
    const [isImporting, setIsImporting] = useState<boolean>(false);
    const [importError, setImportError] = useState<string | null>(null);

    const fetchContracts = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/contracts');
            const data = await res.json();
            if (data.success && data.data?.deployments) {
                setDeployments(data.data.deployments);
            }
        } catch (err) {
            console.error('Failed to fetch contracts:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchContracts();
    }, [fetchContracts]);

    // Query on-chain state for any contracts missing a static owner record
    useEffect(() => {
        deployments.forEach((contract) => {
            if (!contract.owner && !liveOwners[contract.contractAddress]) {
                fetch(`/api/contract/state?address=${encodeURIComponent(contract.contractAddress)}`)
                    .then((res) => res.json())
                    .then((data) => {
                        if (data?.success && data?.data?.raw?.owner) {
                            setLiveOwners((prev) => ({
                                ...prev,
                                [contract.contractAddress]: String(data.data.raw.owner),
                            }));
                        }
                    })
                    .catch((err) => console.debug('Could not fetch live owner for', contract.contractAddress, err));
            }
        });
    }, [deployments, liveOwners]);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        toast.info('Copied to Clipboard', text);
        setTimeout(() => setCopied(null), 2000);
    };

    const handleImportContract = async (e: React.FormEvent) => {
        e.preventDefault();
        setImportError(null);
        if (!importAddress.trim()) return;

        setIsImporting(true);
        try {
            const res = await fetch('/api/contracts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractAddress: importAddress.trim(),
                    contractType: importContractType,
                    nickname: importNickname.trim() || undefined,
                    owner: importOwner.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to import contract');
            }

            toast.success('Contract Tracked', `Now tracking ${importNickname || importAddress.slice(0, 10)}... (${importContractType})`);
            setIsImportModalOpen(false);
            setImportAddress('');
            setImportNickname('');
            setImportOwner('');
            setImportContractType('fungible-token-v2');
            fetchContracts();
        } catch (err: any) {
            const msg = err.message || 'Error importing contract';
            setImportError(msg);
            toast.error('Import Failed', msg);
        } finally {
            setIsImporting(false);
        }
    };

    const handleDeleteContract = async (address: string) => {
        if (!confirm(`Are you sure you want to untrack contract ${address.slice(0, 10)}...?`)) return;

        try {
            const res = await fetch(`/api/contracts/${encodeURIComponent(address)}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setDeployments((prev) => prev.filter((d) => d.contractAddress !== address));
                toast.info('Contract Untracked', `Removed ${address.slice(0, 10)}... from registry`);
            }
        } catch (err) {
            console.error('Failed to delete contract:', err);
        }
    };

    const filteredDeployments = deployments.filter((d) => {
        const q = searchQuery.toLowerCase();
        const owner = (d.owner || liveOwners[d.contractAddress] || '').toLowerCase();
        return (
            d.contractAddress.toLowerCase().includes(q) ||
            d.contractType.toLowerCase().includes(q) ||
            (d.nickname && d.nickname.toLowerCase().includes(q)) ||
            owner.includes(q)
        );
    });

    return (
        <div className="mx-auto max-w-7xl w-full px-4 py-8 sm:px-6 space-y-6">
            <Breadcrumbs />
            {/* Header & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-white">Smart Contract Registry</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Track, inspect disclosed state, and execute circuits on deployed Compact smart contracts.
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="inline-flex items-center space-x-2 rounded-xl bg-midnight-900 border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-midnight-800 transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                        <span>Track Existing Address</span>
                    </button>
                    <Link
                        href="/deploy"
                        className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 hover:scale-[1.02] transition-transform"
                    >
                        <Rocket className="h-4 w-4" />
                        <span>Deploy New</span>
                    </Link>
                </div>
            </div>

            {/* Search & Stats Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-midnight-900/60 p-4 rounded-2xl border border-white/5">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by contract address, owner, type or nickname..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-xl bg-midnight-950/80 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                </div>
                <div className="flex items-center space-x-4 text-xs text-slate-400">
                    <span>Total Tracked: <strong className="text-white">{deployments.length}</strong></span>
                    <span>Network: <strong className="text-emerald-400">Midnight Preprod</strong></span>
                </div>
            </div>

            {/* User Interaction Tip Banner */}
            <div className="flex items-center space-x-2.5 text-xs text-indigo-300/90 bg-indigo-950/30 border border-indigo-500/20 px-4 py-2.5 rounded-xl">
                <Info className="h-4 w-4 text-indigo-400 shrink-0" />
                <span>
                    <strong className="text-white">Double-click</strong> on any contract card to inspect its full details, public on-chain ledger state, owner, and parameters in a modal.
                </span>
            </div>

            {/* Contract Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    <div className="col-span-full py-12 text-center text-slate-400 text-sm">
                        Loading registered contracts...
                    </div>
                ) : filteredDeployments.length > 0 ? (
                    filteredDeployments.map((contract) => {
                        const ownerAddress = contract.owner || liveOwners[contract.contractAddress];

                        return (
                            <div
                                key={contract.contractAddress}
                                onDoubleClick={() => setSelectedContractForDetails(contract)}
                                title="Double-click to inspect contract details and live public state"
                                className="rounded-2xl border border-indigo-500/20 bg-midnight-900/70 backdrop-blur-xl p-6 shadow-xl space-y-4 hover:border-indigo-500/50 hover:shadow-indigo-500/10 transition-all flex flex-col justify-between cursor-pointer group select-none"
                            >
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition-transform">
                                                <FileCode2 className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                                                    {contract.nickname || 'Hello World'}
                                                </h3>
                                                <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wider">
                                                    {contract.contractType}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedContractForDetails(contract);
                                                }}
                                                title="View contract details & public state"
                                                className="text-slate-400 hover:text-indigo-300 hover:bg-white/5 transition-colors p-1.5 rounded-lg"
                                            >
                                                <Info className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteContract(contract.contractAddress);
                                                }}
                                                title="Untrack contract"
                                                className="text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors p-1.5 rounded-lg"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-3 text-xs">
                                        <div>
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span>Contract Address:</span>
                                                <a
                                                    href={`${EXPLORER_BASE}/contract/${encodeURIComponent(contract.contractAddress)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 transition-colors"
                                                    title="View in Midnight Explorer"
                                                >
                                                    <span>Explorer</span>
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </div>
                                            <div className="mt-1 flex items-center justify-between rounded-lg bg-midnight-950 px-3 py-2 border border-white/5 font-mono text-cyan-300">
                                                <a
                                                    href={`${EXPLORER_BASE}/contract/${encodeURIComponent(contract.contractAddress)}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="truncate mr-2 hover:underline hover:text-cyan-200 transition-colors"
                                                    title="View in Midnight Explorer"
                                                >
                                                    {contract.contractAddress}
                                                </a>
                                                <div className="flex items-center space-x-1.5 shrink-0">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            copyToClipboard(contract.contractAddress, contract.contractAddress);
                                                        }}
                                                        className="text-slate-400 hover:text-white transition-colors"
                                                        title="Copy contract address"
                                                    >
                                                        {copied === contract.contractAddress ? (
                                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="h-3.5 w-3.5" />
                                                        )}
                                                    </button>
                                                    <a
                                                        href={`${EXPLORER_BASE}/contract/${encodeURIComponent(contract.contractAddress)}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-slate-400 hover:text-indigo-300 transition-colors p-0.5"
                                                        title="Open in Midnight Explorer"
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Contract Owner Section */}
                                        <div>
                                            <div className="flex items-center justify-between text-slate-400 mb-1">
                                                <span className="flex items-center space-x-1.5">
                                                    <Shield className="h-3 w-3 text-indigo-400" />
                                                    <span>Contract Owner:</span>
                                                </span>
                                                {ownerAddress ? (
                                                    <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        <span>Authorized</span>
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-400 border border-white/5">
                                                        Public / Open
                                                    </span>
                                                )}
                                            </div>
                                            {ownerAddress ? (
                                                <div className="mt-1 flex items-center justify-between rounded-lg bg-midnight-950 px-3 py-1.5 border border-white/5 font-mono text-emerald-300/90 text-xs">
                                                    <span
                                                        className="truncate mr-2 select-all hover:text-emerald-200 transition-colors"
                                                        title={ownerAddress}
                                                    >
                                                        {ownerAddress}
                                                    </span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            copyToClipboard(ownerAddress, `owner-${contract.contractAddress}`);
                                                        }}
                                                        className="text-slate-400 hover:text-white transition-colors shrink-0 p-0.5"
                                                        title="Copy owner address"
                                                    >
                                                        {copied === `owner-${contract.contractAddress}` ? (
                                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="h-3.5 w-3.5" />
                                                        )}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="mt-1 flex items-center justify-between rounded-lg bg-midnight-950/40 px-3 py-1.5 border border-white/5 font-mono text-slate-500 text-xs">
                                                    <span className="italic text-[11px]">No owner constraint configured</span>
                                                </div>
                                            )}
                                        </div>

                                        {contract.deployedAt && (
                                            <div className="flex items-center space-x-1.5 text-slate-400 pt-1 text-[11px]">
                                                <Clock className="h-3 w-3" />
                                                <span>Deployed: {new Date(contract.deployedAt).toLocaleDateString()}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-3 border-t border-white/5 flex items-center space-x-2">
                                    <Link
                                        href={`/contracts/${encodeURIComponent(contract.contractAddress)}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full inline-flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:scale-[1.01] transition-transform"
                                    >
                                        <Play className="h-3.5 w-3.5 fill-current" />
                                        <span>Open Execution Workbench</span>
                                    </Link>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-12 text-center space-y-4">
                        <FileCode2 className="h-10 w-10 text-slate-500 mx-auto" />
                        <div>
                            <h3 className="text-base font-bold text-white">No Matching Contracts Found</h3>
                            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                                Deploy a fresh contract or track an existing contract address to interact with it in the Execution Workbench.
                            </p>
                        </div>
                        <div className="flex justify-center space-x-3">
                            <button
                                onClick={() => setIsImportModalOpen(true)}
                                className="inline-flex items-center space-x-2 rounded-xl bg-midnight-900 border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                <span>Track Address</span>
                            </button>
                            <Link
                                href="/deploy"
                                className="inline-flex items-center space-x-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500"
                            >
                                <Rocket className="h-3.5 w-3.5" />
                                <span>Deploy Contract</span>
                            </Link>
                        </div>
                    </div>
                )}
            </div>

            {/* Contract Details Modal (Triggered on Card Double Click or Info Click) */}
            <ContractDetailsModal
                isOpen={!!selectedContractForDetails}
                onClose={() => setSelectedContractForDetails(null)}
                contract={selectedContractForDetails}
                liveOwner={
                    selectedContractForDetails
                        ? liveOwners[selectedContractForDetails.contractAddress]
                        : undefined
                }
            />

            {/* Import Contract Modal */}
            {isImportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-midnight-900 border border-indigo-500/30 p-6 shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <h3 className="text-base font-bold text-white">Track Existing Contract</h3>
                            <button
                                onClick={() => setIsImportModalOpen(false)}
                                className="text-slate-400 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleImportContract} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    Contract Address <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Enter 64-character hex address..."
                                    value={importAddress}
                                    onChange={(e) => setImportAddress(e.target.value)}
                                    className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    Contract Blueprint / Type <span className="text-rose-400">*</span>
                                </label>
                                <select
                                    value={importContractType}
                                    onChange={(e) => setImportContractType(e.target.value)}
                                    className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="fungible-token-v2">Fungible Token v2 (Standard ERC-20 / Compact)</option>
                                    <option value="bulletin-board">Midnight Bulletin Board (State Managed ZK)</option>
                                    <option value="hello-world">Hello World Message Board</option>
                                    <option value="fungible-token">Fungible Token v1</option>
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    Contract Owner Address (Optional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Enter 64-char hex or Bech32m owner address..."
                                    value={importOwner}
                                    onChange={(e) => setImportOwner(e.target.value)}
                                    className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    Nickname / Label (Optional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Preprod Community Board"
                                    value={importNickname}
                                    onChange={(e) => setImportNickname(e.target.value)}
                                    className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            {importError && (
                                <p className="text-xs text-rose-400">{importError}</p>
                            )}

                            <div className="flex items-center justify-end space-x-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsImportModalOpen(false)}
                                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isImporting || !importAddress.trim()}
                                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                                >
                                    {isImporting ? 'Saving...' : 'Track Contract'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}


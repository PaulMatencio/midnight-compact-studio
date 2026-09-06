'use client';

import React, { useState, useEffect, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import {
    FileCode2,
    ArrowLeft,
    RefreshCw,
    Play,
    Shield,
    Copy,
    Check,
    ExternalLink,
    Clock,
    AlertCircle,
    CheckCircle2,
    Lock,
    Sparkles,
    Zap,
    Loader2,
    Flame,
    ShieldAlert
} from 'lucide-react';
import { useWallet } from '@/src/presentation/context/WalletContext';
import { useTransactions } from '@/src/presentation/context/TransactionContext';
import { useToast } from '@/src/presentation/context/ToastContext';
import { CONTRACT_BLUEPRINTS, getContractBlueprint } from '@/src/infrastructure/contracts/contract-registry';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { TransactionFeed } from '@/components/TransactionFeed';
import { BulletinBoardWorkbench } from '@/components/BulletinBoardWorkbench';
import type { TxRecord } from '@/src/types/tx';

type ExecutionStage = 'idle' | 'syncing' | 'proving' | 'balancing' | 'submitting' | 'confirmed' | 'error';

const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.1am.xyz';

export default function ContractWorkbenchPage({
    params,
}: {
    params: Promise<{ address: string }>;
}) {
    const resolvedParams = use(params);
    const contractAddress = decodeURIComponent(resolvedParams.address);

    const { seed, walletStatus, fetchWalletStatus } = useWallet();
    const { transactions, addTransaction, fetchTransactions } = useTransactions();
    const toast = useToast();

    // Contract State
    const [contractState, setContractState] = useState<any>(null);
    const [isLoadingState, setIsLoadingState] = useState<boolean>(true);
    const [lastChecked, setLastChecked] = useState<string | null>(null);

    // Dynamic Contract Blueprint State
    const [blueprint, setBlueprint] = useState(getContractBlueprint('hello-world')!);
    const [activeCircuit, setActiveCircuit] = useState(blueprint.circuits[0]);
    const [formInputs, setFormInputs] = useState<Record<string, string>>({ message: '' });

    // Execution Stepper State
    const [stage, setStage] = useState<ExecutionStage>('idle');
    const [statusText, setStatusText] = useState<string>('');
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<any>(null);
    const [copied, setCopied] = useState<boolean>(false);

    const isSynced = walletStatus?.isSynced ?? false;
    const syncPercentage = walletStatus?.syncProgress?.percentage ?? 0;
    const dustBalance = BigInt(walletStatus?.dustBalance || '0');
    const isSubmitting = stage !== 'idle' && stage !== 'confirmed' && stage !== 'error';

    // Fetch Live On-Chain State
    const fetchState = useCallback(async () => {
        setIsLoadingState(true);
        try {
            const res = await fetch(`/api/contract/state?address=${encodeURIComponent(contractAddress)}`);
            const data = await res.json();
            if (data.success && data.data) {
                setContractState(data.data);
                setLastChecked(data.data.lastChecked || new Date().toISOString());
            }
        } catch (err) {
            console.error('Failed to fetch contract state:', err);
        } finally {
            setIsLoadingState(false);
        }
    }, [contractAddress]);

    // Polling for live contract state and transaction history
    useEffect(() => {
        fetchState();
        fetchTransactions();
        const interval = setInterval(() => {
            fetchState();
            fetchTransactions();
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchState, fetchTransactions]);

    useEffect(() => {
        const fetchContractMeta = async () => {
            try {
                const res = await fetch('/api/contracts');
                const data = await res.json();
                if (data.success && data.data) {
                    const list = data.data.deployments || (Array.isArray(data.data) ? data.data : []);
                    const found = list.find((c: any) => c.contractAddress === contractAddress);
                    if (found) {
                        let type = found.contractType;
                        if (!type || type === 'hello-world') {
                            if (found.nickname?.toLowerCase().includes('bulletin')) {
                                type = 'bulletin-board';
                            }
                        }
                        const bp = getContractBlueprint(type || 'hello-world');
                        if (bp) {
                            setBlueprint(bp);
                            if (bp.circuits?.length > 0) {
                                setActiveCircuit(bp.circuits[0]);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch contract metadata:', err);
            }
        };
        fetchContractMeta();
    }, [contractAddress]);

    const copyAddress = () => {
        navigator.clipboard.writeText(contractAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Execute Circuit
    const handleExecuteCircuit = async (e: React.FormEvent) => {
        e.preventDefault();
        setExecutionError(null);
        setReceipt(null);

        if (!seed) {
            const err = 'No wallet seed found. Please set your seed in Wallet Studio.';
            setExecutionError(err);
            setStage('error');
            toast.error('Wallet Error', err);
            return;
        }

        if (!isSynced) {
            const err = `Wallet is currently synchronizing (${syncPercentage}%). Transactions are blocked until synchronization is 100% complete.`;
            setExecutionError(err);
            setStage('error');
            toast.error('Sync Required', err);
            return;
        }

        if (dustBalance === 0n) {
            const err = 'Zero DUST gas balance. Transaction fee balancing requires DUST.';
            setExecutionError(err);
            setStage('error');
            toast.error('Insufficient Gas', err);
            return;
        }

        setStage('syncing');
        setStatusText('Checking synchronization with Midnight Preprod...');

        // Simulate progress milestones as the backend performs the ZK workflow
        const timer1 = setTimeout(() => {
            setStage('proving');
            setStatusText('Generating Zero-Knowledge SNARK proof via Proof Server (127.0.0.1:6300)...');
        }, 1200);

        const timer2 = setTimeout(() => {
            setStage('balancing');
            setStatusText('Balancing transaction with DUST and private Shielded coins...');
        }, 4500);

        const timer3 = setTimeout(() => {
            setStage('submitting');
            setStatusText('Broadcasting transaction to Midnight Preprod node...');
        }, 7500);

        try {
            const res = await fetch('/api/contract/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    seed: seed.trim(),
                    contractAddress: contractAddress.trim(),
                    circuitName: activeCircuit.name,
                    args: formInputs,
                }),
            });

            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Circuit execution failed');
            }

            setStage('confirmed');
            setStatusText('Transaction confirmed in block!');
            setReceipt(data.data);
            toast.success('Circuit Execution Confirmed', `Successfully executed ${activeCircuit.displayName}`, data.data.txHash);

            const newTx: TxRecord = {
                id: `tx-${Date.now()}`,
                txHash: data.data.txHash,
                contractAddress: contractAddress,
                circuitName: activeCircuit.name,
                contractType: blueprint.id,
                txType: 'contract_call',
                blockHeight: data.data.blockHeight,
                message: formInputs.message || `${activeCircuit.displayName} executed`,
                timestamp: data.data.timestamp || new Date().toISOString(),
                dustPaid: data.data.dustPaid,
                durationMs: data.data.durationMs,
            };
            addTransaction(newTx);

            // Refresh state & balances immediately
            fetchState();
            fetchWalletStatus();
            fetchTransactions();
        } catch (err: any) {
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
            console.error('Execution error:', err);
            const msg = err.message || 'Transaction failed during ZK proof generation';
            setExecutionError(msg);
            setStage('error');
            toast.error('Execution Failed', msg);
        }
    };

    // Filter transactions for this contract
    const contractTransactions = useMemo(() => {
        const addrLower = contractAddress.toLowerCase();
        const shortAddr = contractAddress.slice(0, 8).toLowerCase();
        return transactions.filter((tx) => {
            const txContract = tx.contractAddress?.toLowerCase();
            const txHash = tx.txHash?.toLowerCase();
            const txMsg = tx.message?.toLowerCase();
            return (
                txContract === addrLower ||
                txHash === addrLower ||
                (txMsg && txMsg.includes(shortAddr))
            );
        });
    }, [transactions, contractAddress]);

    if (blueprint.id === 'bulletin-board') {
        return (
            <div className="mx-auto max-w-7xl w-full px-4 py-8 sm:px-6 space-y-8">
                <div className="flex flex-col gap-3">
                    <Breadcrumbs customLabels={{ [contractAddress]: `${contractAddress.slice(0, 8)}...` }} />
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <Link
                            href="/contracts"
                            className="inline-flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span>Back to Contract Registry</span>
                        </Link>

                        <div className="flex items-center space-x-2">
                            <div className="flex rounded-xl bg-midnight-950 p-1 border border-white/10">
                                <button
                                    onClick={() => {
                                        const bp = getContractBlueprint('bulletin-board');
                                        if (bp) {
                                            setBlueprint(bp);
                                            if (bp.circuits?.length > 0) setActiveCircuit(bp.circuits[0]);
                                        }
                                    }}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow-sm transition-colors"
                                >
                                    Bulletin Board
                                </button>
                                <button
                                    onClick={() => {
                                        const bp = getContractBlueprint('hello-world');
                                        if (bp) {
                                            setBlueprint(bp);
                                            if (bp.circuits?.length > 0) setActiveCircuit(bp.circuits[0]);
                                        }
                                    }}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                                >
                                    Hello World
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <BulletinBoardWorkbench
                    contractAddress={contractAddress}
                    contractNickname={blueprint.name}
                    onTransactionExecuted={() => {
                        fetchTransactions();
                        fetchState();
                        fetchWalletStatus();
                    }}
                />

                {/* Bottom Transaction Feed for Bulletin Board */}
                <div className="space-y-4 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-white">Contract Activity Log</h2>
                        <button
                            onClick={() => {
                                fetchTransactions();
                                fetchState();
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>Refresh Activity</span>
                        </button>
                    </div>
                    <TransactionFeed transactions={contractTransactions} />
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl w-full px-4 py-8 sm:px-6 space-y-8">
            {/* Top Breadcrumbs & Header */}
            <div className="flex flex-col gap-3">
                <Breadcrumbs customLabels={{ [contractAddress]: `${contractAddress.slice(0, 8)}...` }} />

                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex items-center space-x-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
                            <FileCode2 className="h-6 w-6" />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <h1 className="text-2xl font-bold tracking-tight text-white">
                                    {blueprint.name}
                                </h1>
                                <span className="rounded-full bg-emerald-500/10 text-emerald-300 px-2.5 py-0.5 text-xs font-semibold border border-emerald-500/30">
                                    Preprod
                                </span>
                            </div>
                            <div className="flex items-center space-x-2 mt-1">
                                <span className="font-mono text-xs text-slate-400 truncate max-w-xs sm:max-w-md">
                                    {contractAddress}
                                </span>
                                <button
                                    onClick={copyAddress}
                                    className="text-slate-400 hover:text-white transition-colors"
                                    title="Copy contract address"
                                >
                                    {copied ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                    )}
                                </button>
                                <a
                                    href={`${EXPLORER_BASE}/contract/${encodeURIComponent(contractAddress)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-400 hover:text-indigo-300 transition-colors inline-flex items-center space-x-1"
                                    title="View in Explorer"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center space-x-3">
                        {/* Workbench Type Switcher */}
                        <div className="flex rounded-xl bg-midnight-950 p-1 border border-white/10">
                            <button
                                onClick={() => {
                                    const bp = getContractBlueprint('bulletin-board');
                                    if (bp) {
                                        setBlueprint(bp);
                                        if (bp.circuits?.length > 0) setActiveCircuit(bp.circuits[0]);
                                    }
                                }}
                                className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                            >
                                Bulletin Board
                            </button>
                            <button
                                onClick={() => {
                                    const bp = getContractBlueprint('hello-world');
                                    if (bp) {
                                        setBlueprint(bp);
                                        if (bp.circuits?.length > 0) setActiveCircuit(bp.circuits[0]);
                                    }
                                }}
                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow-sm transition-colors"
                            >
                                Hello World
                            </button>
                        </div>

                        <Link
                            href="/contracts"
                            className="inline-flex items-center space-x-2 rounded-xl bg-midnight-900 border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-midnight-800 transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span>Registry</span>
                        </Link>

                        <button
                            onClick={fetchState}
                            disabled={isLoadingState}
                            className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 px-3 py-2 text-xs font-medium text-slate-300 border border-white/10 hover:bg-midnight-800 transition-colors"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingState ? 'animate-spin text-cyan-400' : ''}`} />
                            <span>Refresh State</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Workbench Columns: State Inspector & Circuit Invoker */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Left Column: Live Disclosed State Inspector */}
                <div className="rounded-2xl border border-indigo-500/20 bg-midnight-900/60 backdrop-blur-xl p-6 shadow-xl space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center space-x-2">
                            <Shield className="h-5 w-5 text-cyan-400" />
                            <h2 className="text-base font-bold text-white">On-Chain Disclosed State</h2>
                        </div>
                        {lastChecked && (
                            <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                                <Clock className="h-3 w-3" />
                                <span>Updated {new Date(lastChecked).toLocaleTimeString()}</span>
                            </span>
                        )}
                    </div>

                    {/* Disclosed State Hero Card */}
                    <div className="rounded-xl bg-gradient-to-br from-indigo-950/40 via-midnight-950 to-midnight-950 border border-indigo-500/20 p-5 space-y-3 shadow-inner">
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                            Current Message
                        </span>
                        <div className="min-h-[60px] flex items-center">
                            {isLoadingState && !contractState ? (
                                <div className="flex items-center space-x-2 text-slate-400 text-sm">
                                    <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" />
                                    <span>Querying Midnight GraphQL Indexer...</span>
                                </div>
                            ) : contractState?.message ? (
                                <p className="text-lg font-medium text-white break-words">
                                    &ldquo;{contractState.message}&rdquo;
                                </p>
                            ) : (
                                <p className="text-sm italic text-slate-500">No message set yet.</p>
                            )}
                        </div>
                    </div>

                    {/* Raw Ledger Inspector */}
                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-slate-400">Raw Ledger Payload</span>
                        <div className="rounded-xl bg-midnight-950 p-4 border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto max-h-48">
                            <pre>{JSON.stringify(contractState || { status: 'loading' }, null, 2)}</pre>
                        </div>
                    </div>
                </div>

                {/* Right Column: Dynamic Circuit Invoker */}
                <div className="rounded-2xl border border-indigo-500/20 bg-midnight-900/60 backdrop-blur-xl p-6 shadow-xl space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <div className="flex items-center space-x-2">
                            <Zap className="h-5 w-5 text-amber-400" />
                            <h2 className="text-base font-bold text-white">Execute Circuit</h2>
                        </div>
                        <span className="text-xs text-indigo-300 font-mono">
                            {activeCircuit.name}()
                        </span>
                    </div>

                    {/* Circuit Selector */}
                    <div className="flex space-x-2 border-b border-white/5 pb-3">
                        {blueprint.circuits.map((c) => (
                            <button
                                key={c.name}
                                onClick={() => setActiveCircuit(c)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                    activeCircuit.name === c.name
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-midnight-950 text-slate-400 hover:text-white'
                                }`}
                            >
                                {c.displayName}
                            </button>
                        ))}
                    </div>

                    {/* Dynamic Form */}
                    <form onSubmit={handleExecuteCircuit} className="space-y-4">
                        {activeCircuit.params.map((param) => (
                            <div key={param.name} className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    {param.label} {param.required && <span className="text-rose-400">*</span>}
                                </label>
                                <input
                                    type="text"
                                    required={param.required}
                                    placeholder={param.placeholder}
                                    value={formInputs[param.name] || ''}
                                    onChange={(e) => setFormInputs({ ...formInputs, [param.name]: e.target.value })}
                                    disabled={isSubmitting}
                                    className="w-full rounded-xl bg-midnight-950/90 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                                />
                                {param.description && (
                                    <p className="text-[11px] text-slate-400">{param.description}</p>
                                )}
                            </div>
                        ))}

                        {/* Sync Warning Banner if catching up */}
                        {!isSynced && (
                            <div className="flex items-center space-x-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>Wallet is syncing ({syncPercentage}%). Action will be enabled once 100% synchronized.</span>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isSubmitting || !isSynced || dustBalance === 0n}
                            className="w-full inline-flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                                    <span>Processing Circuit Transaction...</span>
                                </>
                            ) : !isSynced ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                                    <span>Wallet Synchronizing ({syncPercentage}%)...</span>
                                </>
                            ) : dustBalance === 0n ? (
                                <>
                                    <Flame className="h-4 w-4 text-amber-400" />
                                    <span>DUST Gas Required</span>
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4 fill-current" />
                                    <span>Prove & Broadcast Transaction</span>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Live Transaction Progress Stepper */}
                    {isSubmitting && (
                        <div className="rounded-xl bg-midnight-950/90 p-5 border border-indigo-500/30 shadow-inner">
                            <div className="flex items-center space-x-3 mb-4">
                                <Loader2 className="h-5 w-5 animate-spin text-indigo-400 shrink-0" />
                                <p className="text-sm font-medium text-indigo-200">{statusText}</p>
                            </div>

                            <div className="grid grid-cols-4 gap-2 text-center text-xs">
                                <div
                                    className={`p-2 rounded-lg border transition-all ${
                                        stage === 'syncing'
                                            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300 font-semibold'
                                            : 'border-white/5 bg-white/5 text-slate-400'
                                    }`}
                                >
                                    1. Sync Wallet
                                </div>
                                <div
                                    className={`p-2 rounded-lg border transition-all ${
                                        stage === 'proving'
                                            ? 'border-purple-500 bg-purple-500/10 text-purple-300 font-semibold'
                                            : 'border-white/5 bg-white/5 text-slate-400'
                                    }`}
                                >
                                    2. ZK Proof
                                </div>
                                <div
                                    className={`p-2 rounded-lg border transition-all ${
                                        stage === 'balancing'
                                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300 font-semibold'
                                            : 'border-white/5 bg-white/5 text-slate-400'
                                    }`}
                                >
                                    3. Balance DUST
                                </div>
                                <div
                                    className={`p-2 rounded-lg border transition-all ${
                                        stage === 'submitting'
                                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-semibold'
                                            : 'border-white/5 bg-white/5 text-slate-400'
                                    }`}
                                >
                                    4. Confirm
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Success Notification */}
                    {stage === 'confirmed' && receipt && (
                        <div className="rounded-xl bg-emerald-950/40 p-5 border border-emerald-500/30">
                            <div className="flex items-start space-x-3">
                                <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
                                <div className="space-y-1 text-xs">
                                    <h4 className="text-sm font-bold text-emerald-300">Transaction Confirmed on Midnight!</h4>
                                    <p className="text-slate-300">
                                        Circuit <span className="font-semibold text-white font-mono">{activeCircuit.displayName}</span> successfully committed to ledger.
                                    </p>
                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono">
                                        <div className="bg-midnight-950/80 p-2.5 rounded-xl border border-white/5">
                                            <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Transaction Hash</span>
                                            <span className="text-slate-200 truncate block text-[11px]" title={receipt.txHash}>
                                                {receipt.txHash}
                                            </span>
                                        </div>
                                        <div className="bg-midnight-950/80 p-2.5 rounded-xl border border-white/5">
                                            <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Block Height</span>
                                            <span className="text-slate-200 block text-[11px]">
                                                #{receipt.blockHeight?.toLocaleString() || 'Pending'}
                                            </span>
                                        </div>
                                        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-2.5 rounded-xl border border-amber-500/30">
                                            <span className="text-amber-400 block text-[10px] uppercase font-sans font-semibold flex items-center gap-1">
                                                <Flame className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                                                <span>DUST Gas Used</span>
                                            </span>
                                            <span className="text-amber-200 block text-[12px] font-bold mt-0.5">
                                                {receipt.dustPaid && receipt.dustPaid !== '0'
                                                    ? `${BigInt(receipt.dustPaid).toLocaleString()} DUST`
                                                    : 'Covered via DUST UTXO'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error / Warning Notification */}
                    {stage === 'error' && executionError && (
                        <div className="rounded-xl bg-rose-950/40 p-5 border border-rose-500/30">
                            <div className="flex items-start space-x-3">
                                <ShieldAlert className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
                                <div className="space-y-1 text-xs">
                                    <h4 className="text-sm font-bold text-rose-300">Execution Failed</h4>
                                    <p className="text-slate-300 leading-relaxed">{executionError}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Transaction Feed */}
            <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Contract Activity Log</h2>
                    <button
                        onClick={() => {
                            fetchTransactions();
                            fetchState();
                        }}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Refresh Activity</span>
                    </button>
                </div>
                <TransactionFeed transactions={contractTransactions} />
            </div>
        </div>
    );
}

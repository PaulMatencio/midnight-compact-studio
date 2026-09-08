'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Rocket,
    Shield,
    Play,
    CheckCircle2,
    AlertCircle,
    RefreshCw,
    FileCode2,
    ArrowRight,
    ExternalLink,
    Lock,
    KeyRound,
    Eye,
    EyeOff,
    Check,
    SlidersHorizontal,
} from 'lucide-react';
import { useWallet } from '@/src/presentation/context/WalletContext';
import { useSystem } from '@/src/presentation/context/SystemContext';
import { useTransactions } from '@/src/presentation/context/TransactionContext';
import { useToast } from '@/src/presentation/context/ToastContext';
import { getAllContractBlueprints, type ContractBlueprint } from '@/src/infrastructure/contracts/contract-registry';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { TransactionFeed } from '@/components/TransactionFeed';
import type { TxRecord } from '@/src/types/tx';

type DeployStage = 'idle' | 'preparing' | 'proving' | 'submitting' | 'confirmed' | 'error';

export default function DeployPage() {
    const { seed, walletStatus, fetchWalletStatus, isExtensionConnected, extensionAddress } = useWallet();
    const { systemHealth, fetchSystemHealth, setActiveContractAddress } = useSystem();
    const { transactions, addTransaction, fetchTransactions } = useTransactions();
    const toast = useToast();
    const router = useRouter();

    const [blueprints, setBlueprints] = useState<ContractBlueprint[]>(getAllContractBlueprints());
    const [selectedBlueprint, setSelectedBlueprint] = useState<ContractBlueprint>(blueprints[0] || {
        id: 'hello-world',
        name: 'Hello World Message Board',
        description: 'Zero-Knowledge smart contract',
        category: 'Messaging',
        version: '1.0.0',
        circuits: [],
        stateFields: [],
    });
    const [nickname, setNickname] = useState('');
    const [password, setPassword] = useState('');
    const [constructorArgs, setConstructorArgs] = useState<Record<string, string>>({});
    const [showPassword, setShowPassword] = useState(false);
    const [hasEnvPassword, setHasEnvPassword] = useState<boolean>(false);
    const [showPasswordOverride, setShowPasswordOverride] = useState(false);
    const [stage, setStage] = useState<DeployStage>('idle');
    const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<any>(null);

    // Initialize constructor arguments whenever selected blueprint changes
    useEffect(() => {
        if (!selectedBlueprint?.constructorParams || selectedBlueprint.constructorParams.length === 0) {
            setConstructorArgs({});
            return;
        }

        const initial: Record<string, string> = {};
        for (const param of selectedBlueprint.constructorParams) {
            if (param.defaultValue === 'deployer') {
                if (isExtensionConnected && extensionAddress) {
                    initial[param.name] = extensionAddress;
                } else if (walletStatus?.unshieldedAddress) {
                    initial[param.name] = walletStatus.unshieldedAddress;
                } else {
                    initial[param.name] = '';
                }
            } else if (param.defaultValue !== undefined) {
                initial[param.name] = String(param.defaultValue);
            } else {
                initial[param.name] = '';
            }
        }
        setConstructorArgs(initial);
    }, [selectedBlueprint, isExtensionConnected, extensionAddress, walletStatus?.unshieldedAddress]);

    const isSynced = walletStatus?.isSynced ?? false;
    const syncPercentage = walletStatus?.syncProgress?.percentage ?? 0;
    const dustBalance = BigInt(walletStatus?.dustBalance || '0');

    // Fetch deploy configuration and dynamically discovered contracts
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
                const requestedContract = urlParams?.get('contract') || urlParams?.get('template') || '';

                const res = await fetch('/api/contract/deploy');
                const data = await res.json();
                if (data.success && data.data) {
                    setHasEnvPassword(Boolean(data.data.hasEnvPassword));
                    const contracts: ContractBlueprint[] = data.data.availableContracts || [];
                    if (contracts.length > 0) {
                        setBlueprints(contracts);

                        // If user arrived from IDE with ?contract=name, auto-select it
                        if (requestedContract) {
                            const match = contracts.find(
                                (c) => c.id.toLowerCase() === requestedContract.toLowerCase()
                            );
                            if (match) {
                                setSelectedBlueprint(match);
                                return;
                            }
                        }
                        setSelectedBlueprint(contracts[0]);
                    }
                }
            } catch (err) {
                console.warn('Failed to load deploy config:', err);
            }
        };
        fetchConfig();
    }, []);

    const isPasswordValid = hasEnvPassword && !showPasswordOverride
        ? true
        : password.trim().length >= 16;

    const handleDeploy = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setDeployedAddress(null);
        setReceipt(null);

        if (!seed) {
            const err = 'No wallet seed found. Please configure your wallet in Wallet Studio.';
            setErrorMsg(err);
            setStage('error');
            toast.error('Deployment Failed', err);
            return;
        }

        if (!isSynced) {
            const err = `Wallet is synchronizing (${syncPercentage}%). Please wait for 100% sync.`;
            setErrorMsg(err);
            setStage('error');
            toast.error('Wallet Syncing', err);
            return;
        }

        if (dustBalance === 0n) {
            const err = 'Insufficient DUST balance to pay for deployment gas fees.';
            setErrorMsg(err);
            setStage('error');
            toast.error('Insufficient Gas', err);
            return;
        }

        // Validate password
        if (!hasEnvPassword || showPasswordOverride) {
            if (!password.trim()) {
                const err = 'Private state password is required when PRIVATE_STATE_PASSWORD is not set in environment.';
                setErrorMsg(err);
                setStage('error');
                toast.error('Password Required', err);
                return;
            }
            if (password.trim().length < 16) {
                const err = 'Private state password must be at least 16 characters long.';
                setErrorMsg(err);
                setStage('error');
                toast.error('Invalid Password', err);
                return;
            }
        }

        try {
            setStage('preparing');
            await new Promise((r) => setTimeout(r, 400));

            setStage('proving');
            const res = await fetch('/api/contract/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    seed,
                    contractType: selectedBlueprint.id,
                    privateStatePassword: password.trim() || undefined,
                    constructorArgs,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Deployment failed');
            }

            const addr = data.data.contractAddress;
            setDeployedAddress(addr);
            setReceipt(data.data);
            setStage('confirmed');
            setActiveContractAddress(addr);
            toast.success('Contract Deployed!', `Successfully deployed ${selectedBlueprint.name}`, addr);

            // Also save custom nickname if provided
            if (nickname.trim()) {
                await fetch('/api/contracts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contractAddress: addr,
                        contractType: selectedBlueprint.id,
                        nickname: nickname.trim(),
                    }),
                }).catch(() => {});
            }

            const newTx: TxRecord = {
                id: `deploy-${Date.now()}`,
                txHash: addr,
                contractAddress: addr,
                contractNickname: nickname.trim() || selectedBlueprint.name,
                contractType: selectedBlueprint.id,
                txType: 'contract_deploy',
                blockHeight: null,
                message: `Contract Deployed: ${nickname || selectedBlueprint.name}`,
                timestamp: new Date().toISOString(),
                dustPaid: data.data.dustPaid,
                durationMs: data.data.durationMs,
            };
            addTransaction(newTx);

            fetchSystemHealth();
            fetchWalletStatus();
            fetchTransactions();
        } catch (err: any) {
            console.error('Deployment error:', err);
            setErrorMsg(err.message || 'Deployment transaction failed');
            setStage('error');
        }
    };

    return (
        <div className="mx-auto max-w-7xl w-full px-4 py-8 sm:px-6 space-y-6">
            <Breadcrumbs />
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Contract Deployment Studio</h1>
                <p className="text-sm text-slate-400 mt-1">
                    Deploy compiled Compact smart contracts to Midnight Preprod with Zero-Knowledge circuit compilation.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Deployment Wizard Form */}
                <div className="rounded-2xl border border-indigo-500/20 bg-midnight-900/70 backdrop-blur-xl p-6 shadow-xl space-y-6">
                    <div className="flex items-center space-x-2 border-b border-white/5 pb-4">
                        <Rocket className="h-5 w-5 text-indigo-400" />
                        <h2 className="text-base font-bold text-white">Deploy Compact Smart Contract</h2>
                    </div>

                    <form onSubmit={handleDeploy} className="space-y-5">
                        {/* Contract Selector */}
                        <div className="space-y-2">
                            <label className="block text-xs font-medium text-slate-300">
                                Select Contract to Deploy <span className="text-rose-400">*</span>
                            </label>
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {blueprints.map((bp) => (
                                    <div
                                        key={bp.id}
                                        onClick={() => setSelectedBlueprint(bp)}
                                        className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start space-x-3 ${
                                            selectedBlueprint.id === bp.id
                                                ? 'bg-indigo-950/60 border-indigo-500/50 shadow-md'
                                                : 'bg-midnight-950/60 border-white/5 hover:border-white/20'
                                        }`}
                                    >
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mt-0.5">
                                            <FileCode2 className="h-4.5 w-4.5" />
                                        </div>
                                        <div className="space-y-1 min-w-0 flex-1">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-sm font-bold text-white truncate">{bp.name}</h4>
                                                <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                                                    v{bp.version}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-400 leading-relaxed">{bp.description}</p>
                                            <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-slate-500">
                                                <span>Path:</span>
                                                <code className="text-cyan-300">contracts/managed/{bp.id}</code>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Private State Password Input */}
                        <div className="space-y-2 rounded-xl bg-midnight-950/80 p-4 border border-white/10">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                                    <KeyRound className="h-4 w-4 text-amber-400" />
                                    <span>Private State Encryption Password</span>
                                    {(!hasEnvPassword || showPasswordOverride) && (
                                        <span className="text-rose-400 font-bold">*</span>
                                    )}
                                </label>
                                {hasEnvPassword && (
                                    <button
                                        type="button"
                                        onClick={() => setShowPasswordOverride(!showPasswordOverride)}
                                        className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                                    >
                                        {showPasswordOverride ? 'Use .env Password' : 'Override Password'}
                                    </button>
                                )}
                            </div>

                            {hasEnvPassword && !showPasswordOverride ? (
                                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-300">
                                    <div className="flex items-center space-x-2">
                                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                                        <span>Configured via environment variable <code className="font-mono text-white bg-midnight-900 px-1.5 py-0.5 rounded">PRIVATE_STATE_PASSWORD</code></span>
                                    </div>
                                    <span className="text-[10px] uppercase font-bold text-emerald-400">Ready</span>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="relative flex items-center">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter password (minimum 16 characters)"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3.5 py-2.5 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 text-slate-400 hover:text-white"
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-slate-400">
                                            The Midnight SDK requires a password (at least 16 chars) to encrypt off-chain private state.
                                        </span>
                                        <span
                                            className={`font-mono font-semibold px-2 py-0.5 rounded ${
                                                password.trim().length >= 16
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                            }`}
                                        >
                                            {password.trim().length} / 16 min
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Constructor Parameters (if required by contract) */}
                        {selectedBlueprint.constructorParams && selectedBlueprint.constructorParams.length > 0 && (
                            <div className="space-y-3 rounded-xl bg-midnight-950/80 p-4 border border-cyan-500/20">
                                <div className="flex items-center space-x-2 pb-1 border-b border-white/5">
                                    <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
                                    <span className="text-xs font-semibold text-slate-200">Contract Constructor Arguments</span>
                                    <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
                                        {selectedBlueprint.constructorParams.length} {selectedBlueprint.constructorParams.length === 1 ? 'argument' : 'arguments'}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    This contract requires initialization parameters for its on-chain ledger state.
                                </p>

                                <div className="space-y-3 pt-1">
                                    {selectedBlueprint.constructorParams.map((param) => {
                                        const isAddressType = param.type === 'address' || param.compactType?.includes('Bytes');
                                        return (
                                            <div key={param.name} className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                                                        <span>{param.label}</span>
                                                        <code className="text-[10px] font-mono text-cyan-400 bg-midnight-900 px-1 py-0.5 rounded">
                                                            {param.compactType || param.type}
                                                        </code>
                                                        {param.required && <span className="text-rose-400">*</span>}
                                                    </label>
                                                    {isAddressType && (
                                                        <div className="flex items-center space-x-2">
                                                            {isExtensionConnected && extensionAddress && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setConstructorArgs((prev) => ({
                                                                            ...prev,
                                                                            [param.name]: extensionAddress,
                                                                        }))
                                                                    }
                                                                    className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                                                                >
                                                                    Use Connected Lace Address
                                                                </button>
                                                            )}
                                                            {walletStatus?.unshieldedAddress && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setConstructorArgs((prev) => ({
                                                                            ...prev,
                                                                            [param.name]: walletStatus.unshieldedAddress,
                                                                        }))
                                                                    }
                                                                    className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                                                                >
                                                                    Use Studio Address
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <input
                                                    type={param.type === 'number' ? 'number' : 'text'}
                                                    placeholder={param.placeholder || `Enter ${param.label}...`}
                                                    value={constructorArgs[param.name] ?? ''}
                                                    onChange={(e) =>
                                                        setConstructorArgs((prev) => ({
                                                            ...prev,
                                                            [param.name]: e.target.value,
                                                        }))
                                                    }
                                                    className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                                                />
                                                {isAddressType && (
                                                    <p className="text-[10px] text-slate-500">
                                                        Enter your Lace unshielded address (<code>mn_addr_preprod1...</code>) or 32-byte hex to be the contract owner.
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Optional Nickname */}
                        <div className="space-y-1.5">
                            <label className="block text-xs font-medium text-slate-300">
                                Contract Nickname / Label (Optional)
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Production Bulletin Board #1"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                            />
                        </div>

                        {/* Sync Warning if not ready */}
                        {!isSynced && (
                            <div className="flex items-center space-x-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>Wallet is syncing ({syncPercentage}%). Action enabled at 100% sync.</span>
                            </div>
                        )}

                        {/* Deploy Button */}
                        <button
                            type="submit"
                            disabled={!isSynced || !isPasswordValid || stage === 'proving' || stage === 'preparing'}
                            className="w-full inline-flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {stage === 'proving' ? (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>Generating Deployment ZK Proofs...</span>
                                </>
                            ) : (
                                <>
                                    <Rocket className="h-4 w-4" />
                                    <span>Deploy {selectedBlueprint.name} to Preprod</span>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Confirmed Card with Direct Workbench Link */}
                    {stage === 'confirmed' && deployedAddress && (
                        <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/30 p-5 space-y-4 text-xs">
                            <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-sm">
                                <CheckCircle2 className="h-5 w-5" />
                                <span>Contract Deployed Successfully!</span>
                            </div>
                            <div className="font-mono text-xs text-slate-300 space-y-1 bg-midnight-950/90 p-3 rounded-lg border border-white/5">
                                <p className="truncate"><span className="text-slate-500">Address:</span> {deployedAddress}</p>
                                <p><span className="text-slate-500">Contract Type:</span> {selectedBlueprint.id}</p>
                                <p><span className="text-slate-500">Gas Paid:</span> {receipt?.dustPaid} DUST ({receipt?.durationMs}ms)</p>
                            </div>
                            <Link
                                href={`/contracts/${encodeURIComponent(deployedAddress)}`}
                                className="w-full inline-flex items-center justify-center space-x-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 text-xs shadow-md transition-colors"
                            >
                                <span>Open in Execution Workbench</span>
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </div>
                    )}

                    {stage === 'error' && errorMsg && (
                        <div className="rounded-xl bg-rose-950/40 border border-rose-500/30 p-4 text-xs text-rose-300 flex items-start space-x-2">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{errorMsg}</span>
                        </div>
                    )}
                </div>

                {/* Right: Deployment History Feed */}
                <div className="space-y-4">
                    <h2 className="text-lg font-bold text-white">Recent Deployments & Activity</h2>
                    <TransactionFeed transactions={transactions} />
                </div>
            </div>
        </div>
    );
}

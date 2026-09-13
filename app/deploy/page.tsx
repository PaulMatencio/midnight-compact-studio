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
    Copy,
    Fuel,
    Coins,
    Check,
    SlidersHorizontal,
    Dices,
} from 'lucide-react';
import { useWallet } from '@/src/presentation/context/WalletContext';
import { useSystem } from '@/src/presentation/context/SystemContext';
import { useTransactions } from '@/src/presentation/context/TransactionContext';
import { useToast } from '@/src/presentation/context/ToastContext';
import { formatDustFee } from '@/src/lib/dust-utils';
import { getAllContractBlueprints, type ContractBlueprint } from '@/src/infrastructure/contracts/contract-registry';
import { balanceAndSubmitLaceTx } from '@/src/infrastructure/midnight/midnight-dapp-connector';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { TransactionFeed } from '@/components/TransactionFeed';
import type { TxRecord } from '@/src/types/tx';

type DeployStage = 'idle' | 'preparing' | 'proving' | 'balancing' | 'submitting' | 'indexing' | 'confirmed' | 'error';

export default function DeployPage() {
    const {
        seed,
        connectionMode,
        isExtensionConnected,
        extensionAddress,
        extensionShieldedCoinPublicKey,
        extensionShieldedEncryptionPublicKey,
        extensionApi,
        walletStatus,
        backendWalletStatus,
        fetchWalletStatus,
        registerDust,
        isRegisteringDust,
    } = useWallet();
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
    const [deployStepMessage, setDeployStepMessage] = useState<string>('');
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<any>(null);
    const [gasPayerMode, setGasPayerMode] = useState<'studio' | 'lace'>('studio');

    // Initialize constructor arguments whenever selected blueprint changes
    useEffect(() => {
        if (!selectedBlueprint?.constructorParams || selectedBlueprint.constructorParams.length === 0) {
            setConstructorArgs({});
            return;
        }

        const initial: Record<string, string> = {};
        for (const param of selectedBlueprint.constructorParams) {
            const clean = param.name.replace(/^_+/, '').toLowerCase();
            const isOwnerOrAuth = clean.includes('owner') || clean.includes('admin') || param.label?.toLowerCase().includes('owner');

            if (isOwnerOrAuth) {
                if (isExtensionConnected && extensionAddress) {
                    initial[param.name] = extensionAddress;
                } else if (walletStatus?.unshieldedAddress) {
                    initial[param.name] = walletStatus.unshieldedAddress;
                } else {
                    initial[param.name] = 'deployer';
                }
            } else if (param.defaultValue === 'deployer') {
                if (isExtensionConnected && extensionAddress) {
                    initial[param.name] = extensionAddress;
                } else if (walletStatus?.unshieldedAddress) {
                    initial[param.name] = walletStatus.unshieldedAddress;
                } else {
                    initial[param.name] = 'deployer';
                }
            } else if (param.defaultValue !== undefined) {
                initial[param.name] = String(param.defaultValue);
            } else {
                initial[param.name] = '';
            }
        }
        setConstructorArgs(initial);
    }, [selectedBlueprint, isExtensionConnected, extensionAddress, walletStatus?.unshieldedAddress]);

    const isExtensionMode = connectionMode === 'extension' && isExtensionConnected && Boolean(extensionApi);
    const isSynced = isExtensionMode ? true : (walletStatus?.isSynced ?? false);
    const syncPercentage = walletStatus?.syncProgress?.percentage ?? 0;
    const dustBalance = BigInt(walletStatus?.dustBalance || '0');

    const [copiedDeployer, setCopiedDeployer] = useState(false);
    const backendDeployerAddress = backendWalletStatus?.unshieldedAddress || 'mn_addr_preprod1dmnqkj6v3r7srxetr8mnhuryey68t845prwjcpyk900h0za25a3sx8xtzh';
    const backendDustBalance = BigInt(backendWalletStatus?.dustBalance || '0');
    const isBackendReady = backendDustBalance > 0n;
    const isGasReady = isExtensionMode
        ? (gasPayerMode === 'studio' ? isBackendReady : (isExtensionConnected && Boolean(extensionAddress)))
        : isBackendReady;

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

        // ==========================================
        // 1. Browser-native Lace Extension Deployment
        // ==========================================
        if (isExtensionMode) {
            if (!extensionAddress) {
                const err = 'Midnight Lace extension is not connected. Please connect your wallet first.';
                setErrorMsg(err);
                setStage('error');
                toast.error('Lace Not Connected', err);
                return;
            }

            // Option A: Studio Wallet Gas (Recommended) - deploys with Lace as contract Owner
            if (gasPayerMode === 'studio') {
                setStage('preparing');
                setDeployStepMessage('Step 1/5: Preparing contract & binding Lace wallet as Owner...');
                setElapsedSeconds(0);
                const startTime = Date.now();
                const timer = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    setElapsedSeconds(elapsed);
                }, 1000);

                try {
                    setStage('proving');
                    setDeployStepMessage('Step 2/5: Generating ZK deployment proof on proof server (~0.4s)...');
                    await new Promise((r) => setTimeout(r, 200));

                    setStage('balancing');
                    setDeployStepMessage('Step 3/5: Balancing DUST gas fee using Studio server wallet...');

                    const deployRes = await fetch('/api/contract/deploy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contractType: selectedBlueprint.id,
                            constructorArgs,
                            deployerAddress: extensionAddress,
                            seed: seed || undefined,
                            privateStatePassword: password.trim() || undefined,
                        }),
                    });

                    const deployJson = await deployRes.json();
                    if (!deployRes.ok || !deployJson.success) {
                        throw new Error(deployJson.error || 'Failed to deploy contract');
                    }

                    setStage('submitting');
                    setDeployStepMessage('Step 4/5: Transaction broadcasted to Midnight Preprod!');

                    setStage('indexing');
                    setDeployStepMessage('Step 5/5: Committing block and finalizing deployment record...');

                    clearInterval(timer);
                    const deployReceipt = deployJson.data;
                    const contractAddress = deployReceipt.contractAddress;

                    setDeployedAddress(contractAddress);
                    setReceipt(deployReceipt);
                    setStage('confirmed');
                    setDeployStepMessage('Contract successfully deployed! Owner is your connected Lace wallet.');
                    setActiveContractAddress(contractAddress);
                    toast.success('Contract Deployed!', `Successfully deployed ${selectedBlueprint.name} with Lace wallet as Owner`, contractAddress);

                    // Save custom nickname if provided
                    if (nickname.trim()) {
                        await fetch('/api/contracts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contractAddress,
                                contractType: selectedBlueprint.id,
                                nickname: nickname.trim(),
                            }),
                        }).catch(() => {});
                    }

                    const newTx: TxRecord = {
                        id: `deploy-${Date.now()}`,
                        txHash: deployReceipt.txHash || contractAddress,
                        contractAddress,
                        contractNickname: nickname.trim() || selectedBlueprint.name,
                        contractType: selectedBlueprint.id,
                        txType: 'contract_deploy',
                        blockHeight: deployReceipt.blockHeight ?? null,
                        message: `Contract Deployed: ${nickname || selectedBlueprint.name} (Owner: Lace)`,
                        timestamp: new Date().toISOString(),
                        dustPaid: deployReceipt.dustPaid,
                        durationMs: deployReceipt.durationMs,
                    };
                    addTransaction(newTx);
                    fetchTransactions();
                    fetchWalletStatus();
                } catch (err: any) {
                    clearInterval(timer);
                    console.error('Studio Gas Deployment Error:', err);
                    const msg = err?.message || 'Deployment failed';
                    setErrorMsg(msg);
                    setStage('error');
                    toast.error('Deployment Failed', msg);
                }
                return;
            }

            // Option B: Lace Direct Gas
            if (!extensionApi) {
                const err = 'Midnight Lace extension API is not available. Please reconnect your wallet.';
                setErrorMsg(err);
                setStage('error');
                toast.error('Lace Not Connected', err);
                return;
            }

            setStage('preparing');
            setDeployStepMessage('Step 1/5: Building transaction & resolving contract salt...');
            setElapsedSeconds(0);
            await new Promise((r) => setTimeout(r, 400));

            setStage('proving');
            setDeployStepMessage('Step 2/5: Generating Plonk ZK deployment proof on proof server (~0.4s)...');

            const startTime = Date.now();
            const timer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                setElapsedSeconds(elapsed);
            }, 1000);

            try {
                // Ensure shielded keys are retrieved live from extension if not yet cached in state
                let liveShieldedCoinKey = extensionShieldedCoinPublicKey;
                let liveShieldedEncKey = extensionShieldedEncryptionPublicKey;
                if ((!liveShieldedCoinKey || !liveShieldedEncKey) && extensionApi && typeof extensionApi.getShieldedAddresses === 'function') {
                    try {
                        const sAddrs = await extensionApi.getShieldedAddresses();
                        if (sAddrs?.shieldedCoinPublicKey) liveShieldedCoinKey = String(sAddrs.shieldedCoinPublicKey);
                        if (sAddrs?.shieldedEncryptionPublicKey) liveShieldedEncKey = String(sAddrs.shieldedEncryptionPublicKey);
                    } catch (e) {
                        console.warn('Could not query live shielded keys before prepare-deploy:', e);
                    }
                }

                // Step A: Prepare unproven transaction & compute Plonk proof on Docker proof server
                const prepareRes = await fetch('/api/contract/prepare-deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contractType: selectedBlueprint.id,
                        privateStatePassword: password.trim() || undefined,
                        constructorArgs,
                        deployerAddress: extensionAddress,
                        shieldedCoinPublicKey: liveShieldedCoinKey || undefined,
                        shieldedEncryptionPublicKey: liveShieldedEncKey || undefined,
                    }),
                });

                const prepareJson = await prepareRes.json();
                if (!prepareRes.ok || !prepareJson.success) {
                    throw new Error(prepareJson.error || 'Failed to prepare contract deployment');
                }

                const { unsealedTxHex, contractAddress, contractSalt } = prepareJson.data;

                // Step B: Prompt Lace for DUST gas fee payment and user transaction signature
                setStage('balancing');
                setDeployStepMessage('Step 3/5: Awaiting Lace approval: authorize DUST gas fee & sign transaction...');

                const { txHash } = await balanceAndSubmitLaceTx(
                    extensionApi,
                    unsealedTxHex,
                    (msg) => setDeployStepMessage(msg)
                );

                // Step C: Record confirmed deployment on the server
                setStage('submitting');
                setDeployStepMessage('Step 4/5: Transaction broadcasted via Lace! Saving deployment record...');

                setStage('indexing');
                setDeployStepMessage('Step 5/5: Committing block and finalizing deployment record...');

                const recordRes = await fetch('/api/contract/record-deployment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contractAddress,
                        contractType: selectedBlueprint.id,
                        txHash,
                        deployerAddress: extensionAddress,
                        contractSalt,
                        owner: constructorArgs?.initialOwner || constructorArgs?.owner || extensionAddress,
                        dustPaid: '300000000000001',
                        durationMs: Date.now() - startTime,
                    }),
                });

                clearInterval(timer);
                const recordJson = await recordRes.json();
                const deployReceipt = recordJson.data || {
                    contractAddress,
                    contractType: selectedBlueprint.id,
                    dustPaid: '300000000000001',
                    durationMs: Date.now() - startTime,
                    network: 'preprod',
                    deployedAt: new Date().toISOString(),
                };

                setDeployedAddress(contractAddress);
                setReceipt(deployReceipt);
                setStage('confirmed');
                setDeployStepMessage('Contract successfully deployed and confirmed via Lace!');
                setActiveContractAddress(contractAddress);
                toast.success('Contract Deployed!', `Successfully deployed ${selectedBlueprint.name} with Lace wallet`, contractAddress);

                // Save custom nickname if provided
                if (nickname.trim()) {
                    await fetch('/api/contracts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contractAddress,
                            contractType: selectedBlueprint.id,
                            nickname: nickname.trim(),
                        }),
                    }).catch(() => {});
                }

                const newTx: TxRecord = {
                    id: `deploy-${Date.now()}`,
                    txHash: txHash || contractAddress,
                    contractAddress,
                    contractNickname: nickname.trim() || selectedBlueprint.name,
                    contractType: selectedBlueprint.id,
                    txType: 'contract_deploy',
                    blockHeight: null,
                    message: `Contract Deployed: ${nickname || selectedBlueprint.name} (via Lace)`,
                    timestamp: new Date().toISOString(),
                    dustPaid: deployReceipt.dustPaid,
                    durationMs: deployReceipt.durationMs,
                };
                addTransaction(newTx);
                fetchTransactions();
                fetchWalletStatus();
            } catch (err: any) {
                clearInterval(timer);
                console.error('Lace Deployment Error:', err);
                const msg = err?.message || 'Deployment failed';
                setErrorMsg(msg);
                setStage('error');
                toast.error('Deployment Failed', msg);
            }
            return;
        }

        // ==========================================
        // 2. Headless Seed Mode Deployment (Fallback)
        // ==========================================
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

        if (!isBackendReady) {
            const err = `Studio Backend Deployer has 0 DUST gas. Gas fees for ZK smart contract execution require DUST from the deployer. Please transfer 5–10 tNIGHT from your Lace wallet to ${backendDeployerAddress} and click "Register for DUST".`;
            setErrorMsg(err);
            setStage('error');
            toast.error('Deployer Gas Required', err);
            return;
        }

        setStage('preparing');
        setDeployStepMessage('Validating parameters and compiling circuit inputs...');
        setElapsedSeconds(0);
        await new Promise((r) => setTimeout(r, 400));

        setStage('proving');
        setDeployStepMessage('Generating Zero-Knowledge proofs with proof-server...');

        const startTime = Date.now();
        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            setElapsedSeconds(elapsed);
            if (elapsed >= 1 && elapsed < 4) {
                setStage('balancing');
                setDeployStepMessage('Balancing transaction & funding DUST gas fee...');
            } else if (elapsed >= 4 && elapsed < 8) {
                setStage('submitting');
                setDeployStepMessage('Broadcasting transaction to Midnight Preprod node...');
            } else if (elapsed >= 8) {
                setStage('indexing');
                setDeployStepMessage(`Awaiting Preprod block inclusion & indexer confirmation (${elapsed}s elapsed)...`);
            }
        }, 1000);

        try {
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

            clearInterval(timer);
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Deployment failed');
            }

            const addr = data.data.contractAddress;
            setDeployedAddress(addr);
            setReceipt(data.data);
            setStage('confirmed');
            setDeployStepMessage('Contract successfully deployed and confirmed on-chain!');
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
                blockHeight: data.data?.blockHeight ?? null,
                message: `Contract Deployed: ${nickname || selectedBlueprint.name}`,
                timestamp: data.data?.deployedAt || new Date().toISOString(),
                dustPaid: data.data?.dustPaid || '0',
                durationMs: data.data?.durationMs || 0,
            };
            addTransaction(newTx);

            fetchSystemHealth();
            fetchWalletStatus();
            fetchTransactions();
        } catch (err: any) {
            clearInterval(timer);
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
                                        const cleanName = param.name.replace(/^_+/, '').toLowerCase();
                                        const isSalt = cleanName.includes('salt') || param.label?.toLowerCase().includes('salt');
                                        const isAddressType = !isSalt && (param.type === 'address' || param.compactType?.includes('Bytes'));

                                        return (
                                            <div key={param.name} className="space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                                                        <span>{param.label}</span>
                                                        <code className="text-[10px] font-mono text-cyan-400 bg-midnight-900 px-1 py-0.5 rounded">
                                                            {param.compactType || param.type}
                                                        </code>
                                                        {param.required ? (
                                                            <span className="text-rose-400">*</span>
                                                        ) : (
                                                            <span className="text-[10px] text-slate-500 font-normal">(optional)</span>
                                                        )}
                                                    </label>
                                                    {isSalt && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const randomBytes = new Uint8Array(32);
                                                                window.crypto.getRandomValues(randomBytes);
                                                                const hex = '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
                                                                setConstructorArgs((prev) => ({
                                                                    ...prev,
                                                                    [param.name]: hex,
                                                                }));
                                                            }}
                                                            className="inline-flex items-center space-x-1 text-[10px] font-medium text-purple-400 hover:text-purple-300 underline cursor-pointer"
                                                        >
                                                            <Dices className="h-3 w-3" />
                                                            <span>Generate Random Salt</span>
                                                        </button>
                                                    )}
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
                                                    placeholder={param.placeholder || (isSalt ? 'Leave empty to auto-generate cryptographic salt...' : `Enter ${param.label}...`)}
                                                    value={constructorArgs[param.name] ?? ''}
                                                    onChange={(e) =>
                                                        setConstructorArgs((prev) => ({
                                                            ...prev,
                                                            [param.name]: e.target.value,
                                                        }))
                                                    }
                                                    className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                                                />
                                                {isSalt && (
                                                    <p className="text-[10px] text-slate-500">
                                                        32-byte cryptographic salt isolating caller account commitments across contracts. Leave empty to auto-generate.
                                                    </p>
                                                )}
                                                {isAddressType && (
                                                    <p className="text-[10px] text-slate-500">
                                                        {cleanName.includes('owner') || cleanName.includes('admin')
                                                            ? "Single Secret Key Model: The deployer's wallet address is used to derive the on-chain initialOwner commitment bound to the contract salt. No separate owner secret key is needed or generated—your connected wallet natively authorizes owner circuits."
                                                            : "Enter your Lace unshielded address (mn_addr_preprod1...) or 32-byte hex."}
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

                        {/* Live Multi-Stage Deployment Progress Tracker */}
                        {['preparing', 'proving', 'balancing', 'submitting', 'indexing'].includes(stage) && (
                            <div className="rounded-xl bg-midnight-950 border border-indigo-500/30 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white flex items-center space-x-2">
                                        <RefreshCw className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
                                        <span>Deployment in Progress</span>
                                    </span>
                                    <span className="text-[11px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                                        {elapsedSeconds}s elapsed
                                    </span>
                                </div>

                                {/* Step Progress Chips */}
                                <div className="grid grid-cols-5 gap-1 text-[10px]">
                                    <div className={`p-1.5 rounded text-center font-medium border truncate ${
                                        stage === 'preparing'
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                                            : ['proving', 'balancing', 'submitting', 'indexing'].includes(stage)
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-white/5 text-slate-500 border-white/5'
                                    }`}>
                                        1. Build Tx
                                    </div>
                                    <div className={`p-1.5 rounded text-center font-medium border truncate ${
                                        stage === 'proving'
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                                            : ['balancing', 'submitting', 'indexing'].includes(stage)
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-white/5 text-slate-500 border-white/5'
                                    }`}>
                                        2. ZK Proof
                                    </div>
                                    <div className={`p-1.5 rounded text-center font-medium border truncate ${
                                        stage === 'balancing'
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                                            : ['submitting', 'indexing'].includes(stage)
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-white/5 text-slate-500 border-white/5'
                                    }`}>
                                        {isExtensionMode ? (gasPayerMode === 'studio' ? '3. Studio Gas' : '3. Sign (Lace)') : '3. Sign & Gas'}
                                    </div>
                                    <div className={`p-1.5 rounded text-center font-medium border truncate ${
                                        stage === 'submitting'
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                                            : stage === 'indexing'
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-white/5 text-slate-500 border-white/5'
                                    }`}>
                                        4. Submit
                                    </div>
                                    <div className={`p-1.5 rounded text-center font-medium border truncate ${
                                        stage === 'indexing'
                                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                                            : 'bg-white/5 text-slate-500 border-white/5'
                                    }`}>
                                        5. Commit
                                    </div>
                                </div>

                                <p className="text-xs text-slate-300 font-mono flex items-center space-x-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
                                    <span>{deployStepMessage}</span>
                                </p>
                            </div>
                        )}

                        {/* Deployment Execution & Gas Service Card */}
                        <div className="space-y-3 rounded-xl bg-midnight-950/80 p-4 border border-white/10">
                            <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                <div className="flex items-center space-x-2">
                                    <Fuel className="h-4 w-4 text-amber-400" />
                                    <span className="text-xs font-semibold text-slate-200">Execution & Network Gas (DUST)</span>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                    isExtensionMode
                                        ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                                        : isBackendReady
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                }`}>
                                    {isExtensionMode
                                        ? 'Lace Wallet (Extension Mode)'
                                        : isBackendReady
                                            ? `${backendWalletStatus?.dustDisplay || backendDustBalance.toLocaleString()} DUST Ready`
                                            : '0 DUST Available'}
                                </span>
                            </div>

                            {isExtensionMode ? (
                                <div className="space-y-3">
                                    <div className="p-3 rounded-lg bg-midnight-900 border border-white/5 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">Contract Owner & Admin</span>
                                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
                                                Lace Admin Rights
                                            </span>
                                        </div>
                                        <div className="text-white font-mono text-[11px] truncate" title={extensionAddress}>
                                            <span className="text-cyan-400 font-semibold">
                                                Lace: {extensionAddress.slice(0, 12)}...{extensionAddress.slice(-8)}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400">
                                            Your connected Lace wallet is assigned on-chain ownership, minting, pausing, and token administration rights.
                                        </p>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] uppercase font-bold text-slate-400">
                                            Select Network Gas (DUST) Payment Method
                                        </label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                            {/* Studio Gas Card */}
                                            <div
                                                onClick={() => setGasPayerMode('studio')}
                                                className={`p-3 rounded-lg cursor-pointer transition-all border ${
                                                    gasPayerMode === 'studio'
                                                        ? 'bg-indigo-950/60 border-indigo-500/60 ring-1 ring-indigo-500/30 shadow-lg'
                                                        : 'bg-midnight-900/60 border-white/5 hover:border-white/20'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <div className="flex items-center space-x-2">
                                                        <div className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                                                            gasPayerMode === 'studio'
                                                                ? 'border-indigo-400 bg-indigo-500'
                                                                : 'border-slate-500'
                                                        }`}>
                                                            {gasPayerMode === 'studio' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                                        </div>
                                                        <span className="font-semibold text-white text-[11px]">Studio Wallet Gas</span>
                                                    </div>
                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                                                        Recommended
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-slate-300 leading-tight">
                                                    Server wallet pays ~0.0003 DUST gas fee. Zero extension errors. Lace retains 100% on-chain contract ownership.
                                                </p>
                                                <div className="mt-2 text-[10px] text-emerald-400 font-mono">
                                                    {backendWalletStatus?.dustDisplay || backendDustBalance.toLocaleString()} DUST Ready
                                                </div>
                                            </div>

                                            {/* Lace Direct Gas Card */}
                                            <div
                                                onClick={() => setGasPayerMode('lace')}
                                                className={`p-3 rounded-lg cursor-pointer transition-all border ${
                                                    gasPayerMode === 'lace'
                                                        ? 'bg-cyan-950/60 border-cyan-500/60 ring-1 ring-cyan-500/30 shadow-lg'
                                                        : 'bg-midnight-900/60 border-white/5 hover:border-white/20'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <div className="flex items-center space-x-2">
                                                        <div className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                                                            gasPayerMode === 'lace'
                                                                ? 'border-cyan-400 bg-cyan-500'
                                                                : 'border-slate-500'
                                                        }`}>
                                                            {gasPayerMode === 'lace' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                                        </div>
                                                        <span className="font-semibold text-white text-[11px]">Lace Direct Gas</span>
                                                    </div>
                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold uppercase">
                                                        Experimental
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 leading-tight">
                                                    Lace signs & balances DUST via balanceUnsealedTransaction. (May fail if Lace cannot balance deploy intents).
                                                </p>
                                                <div className="mt-2 text-[10px] text-cyan-400 font-mono truncate" title={extensionAddress}>
                                                    Lace DUST
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                        <div className="p-3 rounded-lg bg-midnight-900 border border-white/5 space-y-1">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">Contract Owner (Admin)</span>
                                            <div className="text-white font-mono text-[11px] truncate" title={walletStatus?.unshieldedAddress || 'Deployer'}>
                                                <span>Studio Wallet</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500">Receives admin rights & owns the deployed contract.</p>
                                        </div>

                                        <div className="p-3 rounded-lg bg-midnight-900 border border-white/5 space-y-1">
                                            <span className="text-[10px] uppercase font-bold text-slate-400">Deployer Node Service (Gas Payer)</span>
                                            <div className="text-white font-mono text-[11px] flex items-center justify-between">
                                                <span className="truncate" title={backendDeployerAddress}>
                                                    {backendDeployerAddress.slice(0, 10)}...{backendDeployerAddress.slice(-6)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(backendDeployerAddress);
                                                        setCopiedDeployer(true);
                                                        setTimeout(() => setCopiedDeployer(false), 2000);
                                                        toast.success('Address Copied', 'Studio backend deployer address copied to clipboard');
                                                    }}
                                                    className="text-indigo-400 hover:text-white text-[10px] flex items-center space-x-1 shrink-0 ml-1 cursor-pointer"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                    <span>{copiedDeployer ? 'Copied' : 'Copy'}</span>
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-slate-500">Node.js prover broadcasts tx & pays DUST gas fee.</p>
                                        </div>
                                    </div>

                                    {!isBackendReady && (
                                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-2.5">
                                            <div className="flex items-start space-x-2 text-xs text-amber-300">
                                                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                                <div className="space-y-1 leading-relaxed text-[11px]">
                                                    <p className="font-semibold text-amber-200">
                                                        Studio Backend Deployer Requires Gas (DUST)
                                                    </p>
                                                    <p className="text-slate-300">
                                                        You are in Headless Seed Mode. To deploy with your connected Lace wallet instead, select <strong>Lace Extension</strong> in the header or Wallet Studio. Otherwise, send <strong>5–10 tNIGHT</strong> to the Studio deployer address above and click <strong>Register for DUST</strong> below.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        const res = await registerDust();
                                                        if (res.success) {
                                                            toast.success('DUST Registered', res.message || 'DUST registration submitted');
                                                            fetchWalletStatus();
                                                        } else {
                                                            toast.error('DUST Registration', res.message || 'Registration failed');
                                                        }
                                                    }}
                                                    disabled={isRegisteringDust}
                                                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-midnight-950 font-bold text-xs hover:bg-amber-400 transition-colors disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                                                >
                                                    {isRegisteringDust && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                                                    <span>Register for DUST</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => fetchWalletStatus()}
                                                    className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 font-medium text-xs hover:bg-white/10 transition-colors flex items-center space-x-1.5 cursor-pointer"
                                                >
                                                    <RefreshCw className="h-3 w-3" />
                                                    <span>Refresh Balances</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Deploy Button */}
                        <button
                            type="submit"
                            disabled={!isGasReady || !isPasswordValid || ['preparing', 'proving', 'balancing', 'submitting', 'indexing'].includes(stage)}
                            className="w-full inline-flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {stage === 'preparing' && (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>1/5 Building Deployment Transaction...</span>
                                </>
                            )}
                            {stage === 'proving' && (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>2/5 Generating Plonk ZK Proofs (~0.4s)...</span>
                                </>
                            )}
                            {stage === 'balancing' && (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>{isExtensionMode && gasPayerMode === 'studio' ? '3/5 Balancing DUST Gas with Studio Wallet...' : '3/5 Awaiting Signature in Lace (Authorize & Sign)...'}</span>
                                </>
                            )}
                            {stage === 'submitting' && (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>4/5 Broadcasting to Midnight Network...</span>
                                </>
                            )}
                            {stage === 'indexing' && (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>5/5 Committing Block & Finalizing ({elapsedSeconds}s)...</span>
                                </>
                            )}
                            {!['preparing', 'proving', 'balancing', 'submitting', 'indexing'].includes(stage) && (
                                isExtensionMode ? (
                                    gasPayerMode === 'studio' ? (
                                        <>
                                            <Rocket className="h-4 w-4" />
                                            <span>Deploy {selectedBlueprint.name} (Lace Owner • Studio Gas)</span>
                                        </>
                                    ) : (
                                        <>
                                            <Rocket className="h-4 w-4" />
                                            <span>Deploy {selectedBlueprint.name} with Lace Direct Gas</span>
                                        </>
                                    )
                                ) : !isBackendReady ? (
                                    <>
                                        <Fuel className="h-4 w-4 text-amber-300" />
                                        <span>Deployer Lacks DUST Gas — Fund Deployer Address Above</span>
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="h-4 w-4" />
                                        <span>Deploy {selectedBlueprint.name} to Preprod</span>
                                    </>
                                )
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
                                <p><span className="text-slate-500">Gas Paid:</span> {formatDustFee(receipt?.dustPaid)} ({receipt?.durationMs}ms)</p>
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

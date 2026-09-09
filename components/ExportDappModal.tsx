'use client';

import React, { useState, useEffect } from 'react';
import {
    X,
    Download,
    Copy,
    Check,
    PackageCheck,
    Sparkles,
    FileCode2,
    CheckCircle2,
    AlertCircle,
    Settings2,
    RefreshCw,
    ExternalLink,
    Code2,
    Shield,
    Zap,
} from 'lucide-react';
import { useToast } from '@/src/presentation/context/ToastContext';
import { getCleanContractBaseName } from '@/src/lib/contract-utils';
import { MIDNIGHT_CONFIG } from '@/src/infrastructure/config/midnight.config';

interface ExportDappModalProps {
    isOpen: boolean;
    onClose: () => void;
    contractFilename: string;
    contractAddress?: string;
}

export function ExportDappModal({
    isOpen,
    onClose,
    contractFilename,
    contractAddress: initialContractAddress,
}: ExportDappModalProps) {
    const toast = useToast();
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    const [isCopied, setIsCopied] = useState<boolean>(false);
    const [detectedFiles, setDetectedFiles] = useState<string[]>([]);
    const [masterPrompt, setMasterPrompt] = useState<string>('');
    const [activeView, setActiveView] = useState<'artifacts' | 'prompt' | 'config'>('artifacts');

    const cleanContractName = getCleanContractBaseName(contractFilename);

    // Deployment config state loaded from midnight.config.ts defaults and current contract
    const [contractAddress, setContractAddress] = useState<string>(
        initialContractAddress || '0000000000000000000000000000000000000000000000000000000000000000'
    );
    const [networkId, setNetworkId] = useState<string>(MIDNIGHT_CONFIG.networkId);
    const [indexerUrl, setIndexerUrl] = useState<string>(MIDNIGHT_CONFIG.indexer);
    const [proofServerUrl, setProofServerUrl] = useState<string>(MIDNIGHT_CONFIG.proofServer);
    const [nodeUrl, setNodeUrl] = useState<string>(MIDNIGHT_CONFIG.nodeRpc);
    const [faucetUrl, setFaucetUrl] = useState<string>(MIDNIGHT_CONFIG.faucet);
    const [explorerUrl, setExplorerUrl] = useState<string>(MIDNIGHT_CONFIG.explorer);

    // Auto-detect and populate current deployed contract address
    useEffect(() => {
        if (!isOpen) return;

        if (initialContractAddress && initialContractAddress !== '0000000000000000000000000000000000000000000000000000000000000000') {
            setContractAddress(initialContractAddress);
            return;
        }

        const fetchCurrentContractAddress = async () => {
            try {
                const res = await fetch('/api/contracts');
                const data = await res.json();
                if (data?.success && data?.data?.deployments?.length > 0) {
                    const list: any[] = data.data.deployments;
                    const cleanName = (contractFilename || '').replace(/\.compact$/i, '').toLowerCase();
                    const exactMatch = list.find((d) => (d.contractType || '').toLowerCase() === cleanName);
                    const matched =
                        exactMatch ||
                        list.find((d) => {
                            const type = (d.contractType || '').toLowerCase();
                            const nick = (d.nickname || '').toLowerCase();
                            return type === cleanName || nick.includes(cleanName) || cleanName.includes(type);
                        }) ||
                        list[0];

                    if (matched?.contractAddress) {
                        setContractAddress(matched.contractAddress);
                    }
                }
            } catch (err) {
                console.warn('Could not auto-fetch current contract address for export:', err);
            }
        };

        fetchCurrentContractAddress();
    }, [isOpen, cleanContractName, initialContractAddress]);

    // Fetch bundle preview data
    const loadPreview = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(
                `/api/workspace/export-dapp?contract=${encodeURIComponent(
                    cleanContractName
                )}&preview=true&contractAddress=${encodeURIComponent(
                    contractAddress
                )}&networkId=${encodeURIComponent(networkId)}&indexerUrl=${encodeURIComponent(
                    indexerUrl
                )}&nodeUrl=${encodeURIComponent(nodeUrl)}&proofServerUrl=${encodeURIComponent(
                    proofServerUrl
                )}&faucetUrl=${encodeURIComponent(faucetUrl)}&explorerUrl=${encodeURIComponent(
                    explorerUrl
                )}`
            );
            const data = await res.json();
            if (data.success) {
                setDetectedFiles(data.detectedFiles || []);
                setMasterPrompt(data.masterPrompt || '');
                if (
                    data.deploymentConfig?.contractAddress &&
                    (!contractAddress || contractAddress === '0000000000000000000000000000000000000000000000000000000000000000')
                ) {
                    setContractAddress(data.deploymentConfig.contractAddress);
                }
            } else {
                throw new Error(data.error || 'Failed to inspect artifacts');
            }
        } catch (err: any) {
            toast.error('Preview Failed', err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleNetworkChange = (selectedNetwork: string) => {
        setNetworkId(selectedNetwork);
        if (selectedNetwork === 'preprod') {
            setIndexerUrl(MIDNIGHT_CONFIG.indexer);
            setNodeUrl(MIDNIGHT_CONFIG.nodeRpc);
            setProofServerUrl(MIDNIGHT_CONFIG.proofServer);
            setFaucetUrl(MIDNIGHT_CONFIG.faucet);
            setExplorerUrl(MIDNIGHT_CONFIG.explorer);
        } else if (selectedNetwork === 'devnet') {
            setIndexerUrl('http://127.0.0.1:8088/api/v4/graphql');
            setNodeUrl('http://127.0.0.1:9944');
            setProofServerUrl('http://127.0.0.1:6300');
            setFaucetUrl('http://127.0.0.1:8088');
            setExplorerUrl('');
        } else if (selectedNetwork === 'preview') {
            setIndexerUrl('https://indexer.preview.midnight.network/api/v4/graphql');
            setNodeUrl('https://rpc.preview.midnight.network');
            setProofServerUrl('http://127.0.0.1:6300');
            setFaucetUrl('https://faucet.preview.midnight.network');
            setExplorerUrl('https://explorer.1am.xyz');
        }
    };

    const handleResetToMidnightConfig = () => {
        setNetworkId(MIDNIGHT_CONFIG.networkId);
        setIndexerUrl(MIDNIGHT_CONFIG.indexer);
        setNodeUrl(MIDNIGHT_CONFIG.nodeRpc);
        setProofServerUrl(MIDNIGHT_CONFIG.proofServer);
        setFaucetUrl(MIDNIGHT_CONFIG.faucet);
        setExplorerUrl(MIDNIGHT_CONFIG.explorer);
        toast.info('Config Reset', 'Reset to midnight.config.ts defaults.');
    };

    useEffect(() => {
        if (isOpen) {
            loadPreview();
        }
    }, [isOpen, cleanContractName, contractAddress]);

    if (!isOpen) return null;

    // Handle ZIP Download
    const handleDownloadZip = async () => {
        setIsDownloading(true);
        toast.info('Packaging Bundle', `Creating ${cleanContractName}-dapp-bundle.zip...`);

        try {
            const res = await fetch('/api/workspace/export-dapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contract: cleanContractName,
                    deploymentConfig: {
                        contractName: cleanContractName,
                        contractAddress,
                        networkId,
                        indexerUrl,
                        indexerWsUrl: indexerUrl.replace(/^http/, 'ws') + (indexerUrl.endsWith('/ws') ? '' : '/ws'),
                        nodeUrl,
                        proofServerUrl,
                        faucetUrl,
                        explorerUrl,
                    },
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Download failed with status ${res.status}`);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${cleanContractName}-dapp-bundle.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast.success(
                'DApp Bundle Exported',
                `Successfully downloaded ${cleanContractName}-dapp-bundle.zip`
            );
        } catch (err: any) {
            toast.error('Export Failed', err.message);
        } finally {
            setIsDownloading(false);
        }
    };

    // Copy Prompt to Clipboard
    const handleCopyPrompt = () => {
        if (!masterPrompt) return;
        navigator.clipboard.writeText(masterPrompt);
        setIsCopied(true);
        toast.success(
            'Master Prompt Copied',
            'Paste this prompt into Gemini to scaffold your React 19/Next.js DApp!'
        );
        setTimeout(() => setIsCopied(false), 2500);
    };

    // Generate Random 32-byte Hex Address
    const generateRandomAddress = () => {
        const hex = Array.from({ length: 32 }, () =>
            Math.floor(Math.random() * 256)
                .toString(16)
                .padStart(2, '0')
        ).join('');
        setContractAddress(hex);
        toast.info('Address Generated', '32-byte hex test contract address generated.');
    };

    const artifactCategories = [
        {
            name: 'Compiled Contract Runtime',
            desc: 'index.js & index.d.ts containing Contract class, ledger() decoder, and circuit interfaces',
            matches: detectedFiles.filter((f) => f.startsWith('contract/')),
            expected: `contracts/managed/${cleanContractName}/contract/index.js`,
            critical: true,
        },
        {
            name: 'ZKIR Circuit Bytecode',
            desc: 'Zero-Knowledge Intermediate Representation (.zkir) files required by ProofProvider',
            matches: detectedFiles.filter((f) => f.startsWith('zkir/')),
            expected: `contracts/managed/${cleanContractName}/zkir/*.zkir`,
            critical: true,
        },
        {
            name: 'Compact Contract Source',
            desc: 'Original Compact 0.23 smart contract specification and constraints',
            matches: detectedFiles.filter((f) => f.startsWith('contracts/')),
            expected: `contracts/${cleanContractName}.compact`,
            critical: true,
        },
        {
            name: 'TypeScript Client SDK Adapter',
            desc: 'High-level client class and Witnesses<PS> implementation',
            matches: detectedFiles.filter((f) => f.startsWith('sdk/')),
            expected: `src/client/${cleanContractName}-sdk.ts`,
            critical: false,
        },
        {
            name: 'Technical SDK Documentation',
            desc: 'Architectural breakdown, circuit parameters, and usage guides',
            matches: detectedFiles.filter((f) => f.startsWith('docs/')),
            expected: `docs/${cleanContractName}-sdk.md`,
            critical: false,
        },
        {
            name: 'Quickstart Usage Example',
            desc: 'Runnable standalone TypeScript script for contract interactions',
            matches: detectedFiles.filter((f) => f.startsWith('examples/')),
            expected: `examples/${cleanContractName}-example.ts`,
            critical: false,
        },
        {
            name: 'Vitest Unit Test Suite',
            desc: 'Comprehensive contract simulator tests checking circuits and state',
            matches: detectedFiles.filter((f) => f.startsWith('tests/')),
            expected: `tests/contracts/${cleanContractName}.test.ts`,
            critical: false,
        },
        {
            name: 'Gemini Master Prompt & Config',
            desc: 'GEMINI_DAPP_PROMPT.md and deployment.config.json generated from midnight-config.ts for this export',
            matches: ['GEMINI_DAPP_PROMPT.md', 'deployment.config.json', 'README.md'],
            expected: 'Included automatically in ZIP',
            critical: true,
        },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="relative w-full max-w-4xl rounded-3xl border border-indigo-500/30 bg-midnight-950/95 shadow-2xl shadow-indigo-950/50 flex flex-col max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-midnight-900/60">
                    <div className="flex items-center space-x-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/30">
                            <PackageCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <h3 className="text-base font-bold text-white">
                                    Export DApp Bundle for Gemini
                                </h3>
                                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-mono text-indigo-300 border border-indigo-500/30">
                                    {cleanContractName}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400">
                                Package all artifacts, ZKIR bytecodes, SDK adapters, and instructions to scaffold a complete React/Next.js frontend.
                            </p>
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

                {/* Navigation Tabs */}
                <div className="flex items-center space-x-2 px-6 pt-3 border-b border-white/5 bg-midnight-900/30">
                    <button
                        onClick={() => setActiveView('artifacts')}
                        className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center space-x-2 border-b-2 ${
                            activeView === 'artifacts'
                                ? 'border-cyan-400 text-cyan-300 bg-midnight-900/80'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <FileCode2 className="h-4 w-4" />
                        <span>Included Artifacts ({detectedFiles.length})</span>
                    </button>

                    <button
                        onClick={() => setActiveView('prompt')}
                        className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center space-x-2 border-b-2 ${
                            activeView === 'prompt'
                                ? 'border-purple-400 text-purple-300 bg-midnight-900/80'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Sparkles className="h-4 w-4" />
                        <span>Gemini Master Prompt</span>
                    </button>

                    <button
                        onClick={() => setActiveView('config')}
                        className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center space-x-2 border-b-2 ${
                            activeView === 'config'
                                ? 'border-indigo-400 text-indigo-300 bg-midnight-900/80'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Settings2 className="h-4 w-4" />
                        <span>Deployment Config</span>
                    </button>

                    <div className="ml-auto pb-1">
                        <button
                            onClick={loadPreview}
                            disabled={isLoading}
                            className="text-xs text-slate-400 hover:text-white flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-white/5 transition-all cursor-pointer disabled:opacity-50"
                            title="Refresh detected files"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                            <span>Scan Workspace</span>
                        </button>
                    </div>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3">
                            <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin" />
                            <span className="text-xs text-slate-400">Scanning contract artifacts...</span>
                        </div>
                    ) : activeView === 'artifacts' ? (
                        <div className="space-y-3">
                            <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 text-xs text-indigo-200 flex items-start space-x-2.5">
                                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                                <div>
                                    <span className="font-semibold text-white">Gemini DApp Ready: </span>
                                    This bundle packages everything Gemini needs to generate your React 19 / Next.js DApp: wallet connection, provider wiring, contract state decoding, circuit transaction submission forms, and real-time ZK proof states.
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                {artifactCategories.map((cat, idx) => {
                                    const isFound = cat.matches.length > 0;
                                    return (
                                        <div
                                            key={idx}
                                            className={`p-3.5 rounded-2xl border transition-all ${
                                                isFound
                                                    ? 'bg-midnight-900/60 border-white/10 hover:border-cyan-500/40'
                                                    : 'bg-midnight-950/40 border-dashed border-white/5 opacity-70'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-xs font-semibold text-white flex items-center space-x-1.5">
                                                    <span>{cat.name}</span>
                                                </span>
                                                {isFound ? (
                                                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        <span>{cat.matches.length} file(s)</span>
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                                        <AlertCircle className="h-3 w-3" />
                                                        <span>Not Generated</span>
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                                                {cat.desc}
                                            </p>

                                            <div className="font-mono text-[10px] text-slate-400 bg-midnight-950 px-2.5 py-1.5 rounded-xl border border-white/5 truncate">
                                                {isFound ? cat.matches.join(', ') : cat.expected}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : activeView === 'prompt' ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-300 font-medium">
                                    Generated master prompt tailored for Gemini 3.7 / Claude 3.7:
                                </span>
                                <button
                                    onClick={handleCopyPrompt}
                                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-600/30 text-purple-200 hover:bg-purple-600 hover:text-white text-xs font-semibold border border-purple-500/40 transition-all cursor-pointer"
                                >
                                    {isCopied ? (
                                        <>
                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                            <span>Prompt Copied!</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3.5 w-3.5" />
                                            <span>Copy Master Prompt</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <pre className="p-4 rounded-2xl bg-midnight-950 font-mono text-[11px] text-slate-300 border border-white/10 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                                {masterPrompt}
                            </pre>
                        </div>
                    ) : (
                        <div className="space-y-4 max-w-xl">
                            <div className="flex items-center justify-between">
                                <div className="text-xs text-slate-300 leading-relaxed">
                                    Configure parameters written into <code className="text-cyan-300 font-mono">deployment.config.json</code> (defaults from <code className="text-cyan-300 font-mono">midnight.config.ts</code>):
                                </div>
                                <button
                                    onClick={handleResetToMidnightConfig}
                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline shrink-0 cursor-pointer ml-2"
                                    title="Reset to infrastructure/config/midnight.config.ts"
                                >
                                    Reset to midnight-config
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center space-x-2">
                                            <label className="text-xs font-medium text-slate-300">
                                                Deployed Contract Address (Hex)
                                            </label>
                                            {contractAddress &&
                                                contractAddress !==
                                                    '0000000000000000000000000000000000000000000000000000000000000000' && (
                                                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        <CheckCircle2 className="h-2.5 w-2.5" />
                                                        <span>Active Contract</span>
                                                    </span>
                                                )}
                                        </div>
                                        <button
                                            onClick={generateRandomAddress}
                                            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                                        >
                                            Generate Sample Address
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={contractAddress}
                                        onChange={(e) => setContractAddress(e.target.value)}
                                        className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                        placeholder="0000000000000000000000000000000000000000000000000000000000000000"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Network ID
                                        </label>
                                        <select
                                            value={networkId}
                                            onChange={(e) => handleNetworkChange(e.target.value)}
                                            className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none cursor-pointer"
                                        >
                                            <option value="preprod">Preprod (Public Testnet - Default)</option>
                                            <option value="devnet">Devnet (Local Docker)</option>
                                            <option value="preview">Preview (Testnet)</option>
                                            <option value="testnet-remote">Testnet (Remote)</option>
                                            <option value="undeployed">Undeployed</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Proof Server URL
                                        </label>
                                        <input
                                            type="text"
                                            value={proofServerUrl}
                                            onChange={(e) => setProofServerUrl(e.target.value)}
                                            className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">
                                        Indexer GraphQL Endpoint
                                    </label>
                                    <input
                                        type="text"
                                        value={indexerUrl}
                                        onChange={(e) => setIndexerUrl(e.target.value)}
                                        className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-300 mb-1">
                                        Node RPC URL
                                    </label>
                                    <input
                                        type="text"
                                        value={nodeUrl}
                                        onChange={(e) => setNodeUrl(e.target.value)}
                                        className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Faucet URL
                                        </label>
                                        <input
                                            type="text"
                                            value={faucetUrl}
                                            onChange={(e) => setFaucetUrl(e.target.value)}
                                            className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-300 mb-1">
                                            Block Explorer URL
                                        </label>
                                        <input
                                            type="text"
                                            value={explorerUrl}
                                            onChange={(e) => setExplorerUrl(e.target.value)}
                                            className="w-full rounded-xl bg-midnight-900 border border-white/10 px-3 py-2 text-xs font-mono text-white focus:border-indigo-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between border-t border-white/10 px-6 py-4 bg-midnight-900/60">
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleCopyPrompt}
                            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-midnight-800 text-slate-300 hover:text-white text-xs border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                        >
                            {isCopied ? (
                                <Check className="h-4 w-4 text-emerald-400" />
                            ) : (
                                <Copy className="h-4 w-4 text-slate-400" />
                            )}
                            <span>Copy Master Prompt</span>
                        </button>
                    </div>

                    <div className="flex items-center space-x-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                        >
                            Close
                        </button>

                        <button
                            onClick={handleDownloadZip}
                            disabled={isDownloading || isLoading}
                            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-600 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDownloading ? (
                                <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    <span>Bundling ZIP...</span>
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    <span>Download DApp Bundle (.zip)</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

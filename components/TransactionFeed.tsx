'use client';

import React, { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  History,
  ExternalLink,
  CheckCircle2,
  Clock,
  Hash,
  Flame,
  ShieldAlert,
  AlertTriangle,
  FileCode2,
  Zap,
  Rocket,
  Send,
  Copy,
  Check,
  ArrowRight
} from 'lucide-react';
import type { TxRecord } from '@/src/types/tx';
import { formatDustFee } from '@/src/lib/dust-utils';

interface TransactionFeedProps {
  transactions: TxRecord[];
}

const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.1am.xyz';

export const getTxExplorerUrl = (txHash: string) => `${EXPLORER_BASE}/tx/${txHash}`;
export const getContractExplorerUrl = (contractAddress: string) => `${EXPLORER_BASE}/contract/${contractAddress}`;

export const TransactionFeed: React.FC<TransactionFeedProps> = ({ transactions }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Determine the newest transaction (assuming array is newest-first)
  const latestTx = transactions && transactions.length > 0 ? transactions[0] : null;
  const isStale = useMemo(() => {
    if (!latestTx || !latestTx.timestamp) return false;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return Date.now() - new Date(latestTx.timestamp).getTime() > twentyFourHours;
  }, [latestTx]);

  const copyToClipboard = useCallback((e: React.MouseEvent, text: string, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Click handler to open explorer
  const handleTxClick = useCallback((txHash?: string, contractAddr?: string, isDeploy?: boolean) => {
    // If it's a deployment and we don't have a distinct txHash, open the contract page in explorer
    if (isDeploy && (!txHash || txHash === contractAddr || txHash.startsWith('deploy-'))) {
      if (contractAddr) {
        window.open(getContractExplorerUrl(contractAddr), '_blank');
      }
      return;
    }
    // If txHash is valid and distinct from contractAddress
    if (txHash && txHash !== contractAddr && !txHash.startsWith('deploy-')) {
      window.open(getTxExplorerUrl(txHash), '_blank');
      return;
    }
    // Fallback if we have a contract address
    if (contractAddr) {
      window.open(getContractExplorerUrl(contractAddr), '_blank');
    }
  }, []);

  // If there are no transactions, render an empty state card
  if (!transactions || transactions.length === 0) {
    return (
      <div className="glass-panel p-8 sm:p-12 text-center relative space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/20 shadow-inner">
          <History className="h-7 w-7 text-cyan-400" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">No Recent Midnight Transactions</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Zero-Knowledge proofs, contract deployments, and circuit interactions will be recorded and displayed here in real time.
          </p>
        </div>
        <div className="pt-2 flex items-center justify-center gap-3">
          <Link
            href="/ide"
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg transition-all"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Open IDE Studio</span>
          </Link>
          <Link
            href="/contracts"
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-midnight-900 hover:bg-midnight-800 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-all"
          >
            <FileCode2 className="h-3.5 w-3.5 text-slate-400" />
            <span>Contracts Directory</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel p-6 sm:p-8 relative">
      {/* Stale explorer warning banner */}
      {isStale && latestTx?.timestamp && (
        <div className="mb-5 p-3 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl flex items-center text-xs">
          <AlertTriangle className="w-4 h-4 mr-2 text-amber-400 shrink-0" />
          <span>
            Midnight Preprod Explorer last recorded transaction on{' '}
            <strong>{new Date(latestTx.timestamp).toLocaleDateString()}</strong>. Live status is active on Preprod nodes.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-5">
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <History className="h-4.5 w-4.5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Recent Midnight Transactions</h3>
            <p className="text-xs text-slate-400">Zero-Knowledge proofs, contract deployments & circuit interactions</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <a
            href={EXPLORER_BASE}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center space-x-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-lg transition-colors"
          >
            <span>explorer.1am.xyz</span>
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-xs text-slate-400 font-mono bg-midnight-950 px-2.5 py-1 rounded-lg border border-white/5">
            {transactions.length} record{transactions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Transaction Cards List */}
      <div className="space-y-3">
        {transactions.map((tx, idx) => {
          const isDeploy = tx.txType === 'contract_deploy' || tx.message?.startsWith('Contract Deployed');
          const isTransfer = tx.txType === 'token_transfer' || tx.message?.startsWith('Sent ');
          const isCircuitCall = !isDeploy && !isTransfer;
          const contractAddr = tx.contractAddress || (isDeploy ? tx.txHash : undefined);
          const isDeployPseudoHash = tx.txHash === contractAddr || (tx.txHash && tx.txHash.startsWith('deploy-'));
          const realTxHash = tx.txHash && !isDeployPseudoHash ? tx.txHash : undefined;
          const explorerTargetUrl = realTxHash
            ? getTxExplorerUrl(realTxHash)
            : contractAddr
            ? getContractExplorerUrl(contractAddr)
            : EXPLORER_BASE;

          return (
            <div
              key={tx.id || tx.txHash || idx}
              onClick={() => handleTxClick(tx.txHash, contractAddr, isDeploy)}
              className="group rounded-xl bg-midnight-950/70 border border-white/5 hover:border-indigo-500/30 p-4 transition-all hover:bg-midnight-900/60 cursor-pointer space-y-3 shadow-sm"
            >
              {/* Row 1: Type badge, Contract info, Circuit info, and Timestamp */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Transaction Type / Circuit Badge */}
                  {isDeploy ? (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/20 font-semibold text-[11px]">
                      <Rocket className="h-3 w-3 text-purple-400" />
                      <span>Contract Deploy</span>
                    </span>
                  ) : isTransfer ? (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold text-[11px]">
                      <Send className="h-3 w-3 text-cyan-400" />
                      <span>Token Transfer</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-semibold text-[11px]">
                      <Zap className="h-3 w-3 text-indigo-400" />
                      <span>Circuit: <strong className="font-mono text-white">{tx.circuitName || 'storeMessage'}</strong></span>
                    </span>
                  )}

                  {/* Contract Information Pill */}
                  {contractAddr && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center space-x-1.5 bg-midnight-900 px-2.5 py-1 rounded-lg border border-indigo-500/20 text-[11px] font-mono text-slate-300 hover:border-indigo-500/40 transition-colors"
                    >
                      <FileCode2 className="h-3 w-3 text-indigo-400 shrink-0" />
                      <span className="text-slate-400 font-sans">Contract:</span>
                      <Link
                        href={`/contracts/${encodeURIComponent(contractAddr)}`}
                        className="text-cyan-300 hover:text-white underline hover:no-underline"
                        title={`Open Workbench for ${contractAddr}`}
                      >
                        {contractAddr.slice(0, 8)}...{contractAddr.slice(-6)}
                      </Link>
                      <a
                        href={getContractExplorerUrl(contractAddr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-cyan-300 ml-0.5 p-0.5"
                        title={`View contract ${contractAddr} on explorer.1am.xyz`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        onClick={(e) => copyToClipboard(e, contractAddr, `contract-${tx.id || idx}`)}
                        className="text-slate-400 hover:text-white ml-0.5 p-0.5"
                        title="Copy contract address"
                      >
                        {copiedId === `contract-${tx.id || idx}` ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Right: Timestamp & Duration */}
                <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                  <div className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(tx.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {tx.durationMs && (
                    <span className="bg-white/5 px-2 py-0.5 rounded text-slate-300 font-mono">
                      {(tx.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: Message / Payload preview */}
              {tx.message && (
                <div className="text-xs text-slate-200 bg-midnight-900/90 rounded-lg px-3 py-2 border border-white/5 font-medium flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-slate-500 mr-2 text-[11px] uppercase font-semibold">Payload:</span>
                    <span className="text-white">&ldquo;{tx.message}&rdquo;</span>
                  </div>
                  {contractAddr && isCircuitCall && (
                    <Link
                      href={`/contracts/${encodeURIComponent(contractAddr)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-indigo-300 hover:text-indigo-200 flex items-center space-x-1 whitespace-nowrap shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span>Workbench</span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}

              {/* Row 3: Transaction hash, Block height, DUST fee, Explorer action */}
              <div className="flex flex-wrap items-center justify-between gap-y-1 text-slate-400 font-mono text-[11px] pt-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex items-center space-x-1 text-slate-400">
                    <span className="text-slate-500 font-sans">Tx:</span>
                    {realTxHash ? (
                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={getTxExplorerUrl(realTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-white underline hover:no-underline font-mono inline-flex items-center gap-1"
                          title={`View transaction ${realTxHash} on explorer.1am.xyz`}
                        >
                          <span>{`${realTxHash.slice(0, 12)}...${realTxHash.slice(-6)}`}</span>
                          <ExternalLink className="h-2.5 w-2.5 text-cyan-400" />
                        </a>
                        <button
                          onClick={(e) => copyToClipboard(e, realTxHash, `tx-${tx.id || idx}`)}
                          className="text-slate-500 hover:text-white p-0.5 ml-0.5"
                          title="Copy transaction hash"
                        >
                          {copiedId === `tx-${tx.id || idx}` ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    ) : isDeploy && contractAddr ? (
                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={getContractExplorerUrl(contractAddr)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-300 hover:text-purple-200 italic text-[10px] inline-flex items-center gap-1"
                          title={`View deployed contract ${contractAddr} on explorer.1am.xyz`}
                        >
                          <span>Genesis Deploy Contract</span>
                          <ExternalLink className="h-2.5 w-2.5 text-purple-400" />
                        </a>
                      </div>
                    ) : (
                      <span className="text-slate-500 italic text-[10px]">Pending Confirmation</span>
                    )}
                  </div>

                  {tx.blockHeight ? (
                    <span className="text-cyan-400 flex items-center space-x-1">
                      <Hash className="h-3 w-3 text-cyan-500" />
                      <span>#{tx.blockHeight.toLocaleString()}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500">Block Pending</span>
                  )}

                  {tx.error ? (
                    <div className="flex items-center text-rose-400">
                      <ShieldAlert className="h-3 w-3 mr-1" />
                      <span>{tx.error}</span>
                    </div>
                  ) : (
                    tx.dustPaid && tx.dustPaid !== '0' && (
                      <span className="flex items-center space-x-1 text-amber-300 font-semibold">
                        <Flame className="h-3 w-3 text-amber-400" />
                        <span>{formatDustFee(tx.dustPaid)}</span>
                      </span>
                    )
                  )}
                </div>

                <a
                  href={explorerTargetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center space-x-1 text-indigo-400 hover:text-cyan-300 text-[11px] font-sans transition-colors cursor-pointer"
                  title={`Open in explorer.1am.xyz: ${explorerTargetUrl}`}
                >
                  <span>{isDeploy && !realTxHash ? 'View Contract' : 'View Tx'}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};



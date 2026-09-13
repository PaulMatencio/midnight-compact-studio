'use client';

import React, { useState } from 'react';
import { Send, ShieldAlert, CheckCircle2, Loader2, Sparkles, ArrowRight, Clock, Box, Flame, Zap } from 'lucide-react';
import { useToast } from '@/src/presentation/context/ToastContext';
import { formatDustFee } from '@/src/lib/dust-utils';

interface MessagePublisherProps {
  seed: string;
  contractAddress: string;
  onSuccess: (result: any) => void;
  onError?: (error: any) => void;
  dustBalance: string;
  isSynced?: boolean;
  syncPercentage?: number;
}

type TxStage = 'idle' | 'syncing' | 'proving' | 'balancing' | 'submitting' | 'confirmed' | 'error';

export const MessagePublisher: React.FC<MessagePublisherProps> = ({
  seed,
  contractAddress,
  onSuccess,
  onError,
  dustBalance,
  isSynced = false,
  syncPercentage = 0,
}) => {
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<TxStage>('idle');
  const [statusText, setStatusText] = useState('');
  const [txResult, setTxResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    if (!seed.trim()) {
      const err = 'Please connect your wallet seed first in the Wallet Studio below.';
      setErrorMsg(err);
      setStage('error');
      toast.error('Wallet Error', err);
      return;
    }
    if (!isSynced) {
      const err = `Wallet is not synchronized (${syncPercentage}%). Blockchain interactions are blocked until synchronization is 100% complete.`;
      setErrorMsg(err);
      setStage('error');
      toast.error('Sync Required', err);
      return;
    }
    if (dustBalance === '0' || !dustBalance) {
      const err = 'Zero DUST gas balance. Transaction fee balancing requires DUST.';
      setErrorMsg(err);
      setStage('error');
      toast.error('Insufficient Gas', err);
      return;
    }

    setErrorMsg(null);
    setTxResult(null);
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
      const res = await fetch('/api/contract/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: seed.trim(),
          message: message.trim(),
          contractAddress: contractAddress.trim(),
        }),
      });

      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit transaction');
      }

      setStage('confirmed');
      setStatusText('Transaction confirmed in block!');
      setTxResult(data.data);
      toast.success('Message Published!', 'ZK proof verified and message committed to Midnight Preprod', data.data.txHash);
      onSuccess(data.data);
      setMessage('');
    } catch (err: any) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setStage('error');
      const msg = err.message || 'An unexpected error occurred.';
      setErrorMsg(msg);
      toast.error('Transaction Failed', msg);
      if (onError) {
        onError(err);
      }
    }
  };

  const isSubmitting = stage !== 'idle' && stage !== 'confirmed' && stage !== 'error';

  return (
    <div className="glass-panel p-6 sm:p-8 relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30">
            <Sparkles className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Zero-Knowledge Message Publisher</h3>
            <p className="text-xs text-slate-400">
              Executes the Compact <code className="text-indigo-300 font-mono">storeMessage</code> provable circuit
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
            New Message
          </label>
          <div className="relative">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. Hello Midnight! Privacy by design."
              maxLength={256}
              className="w-full rounded-xl bg-midnight-950/80 px-4 py-3.5 text-sm text-slate-100 placeholder-slate-500 border border-white/10 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium disabled:opacity-50"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              {message.length}/256
            </div>
          </div>
        </div>

        {/* Quick Suggestion Pills */}
        <div className="flex flex-wrap gap-2 items-center text-xs text-slate-400">
          <span className="text-[11px] text-slate-500">Suggestions:</span>
          {['Hello Midnight Preprod! 🌙', 'Zero Knowledge is Magic 🪄', 'Privacy is a Fundamental Right 🛡️'].map((preset) => (
            <button
              type="button"
              key={preset}
              onClick={() => setMessage(preset)}
              disabled={isSubmitting}
              className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-50 border border-white/5"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Sync Status Banner */}
        {!isSynced && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-200 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span>
                Wallet is currently synchronizing with Midnight ({syncPercentage}%). Transactions are blocked until 100% synchronized.
              </span>
            </div>
          </div>
        )}

        {/* Submit Action */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !message.trim() || !isSynced || dustBalance === '0'}
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:scale-100 cursor-pointer disabled:cursor-not-allowed"
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
            ) : dustBalance === '0' ? (
              <>
                <Flame className="h-4 w-4 text-amber-400" />
                <span>DUST Gas Required</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>Prove & Store Message</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Live Transaction Progress Stepper */}
      {isSubmitting && (
        <div className="mt-6 rounded-xl bg-midnight-950/90 p-5 border border-indigo-500/30 shadow-inner">
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
      {stage === 'confirmed' && txResult && (
        <div className="mt-6 rounded-xl bg-emerald-950/40 p-5 border border-emerald-500/30">
          <div className="flex items-start space-x-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-emerald-300">Transaction Confirmed on Midnight!</h4>
              <p className="text-slate-300">
                Message <span className="font-semibold text-white">&ldquo;{txResult.message}&rdquo;</span> stored to ledger.
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono">
                <div className="bg-midnight-950/80 p-2.5 rounded-xl border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Transaction Hash</span>
                  <span className="text-slate-200 truncate block text-[11px]" title={txResult.txHash}>
                    {txResult.txHash}
                  </span>
                </div>
                <div className="bg-midnight-950/80 p-2.5 rounded-xl border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans font-semibold">Block Height</span>
                  <span className="text-slate-200 block text-[11px]">
                    #{txResult.blockHeight?.toLocaleString() || 'Pending'}
                  </span>
                </div>
                <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-2.5 rounded-xl border border-amber-500/30">
                  <span className="text-amber-400 block text-[10px] uppercase font-sans font-semibold flex items-center gap-1">
                    <Flame className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                    <span>DUST Gas Used</span>
                  </span>
                  <span className="text-amber-200 block text-[12px] font-bold mt-0.5">
                    {txResult.dustPaid && txResult.dustPaid !== '0'
                      ? formatDustFee(txResult.dustPaid)
                      : 'Covered via DUST UTXO'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error / Warning Notification */}
      {errorMsg && (
        <div className="mt-6 rounded-xl bg-rose-950/40 p-5 border border-rose-500/30">
          <div className="flex items-start space-x-3">
            <ShieldAlert className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="text-sm font-bold text-rose-300">Transaction Not Permitted</h4>
              <p className="text-slate-300 leading-relaxed">{errorMsg}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

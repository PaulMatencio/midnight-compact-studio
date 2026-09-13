'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TermIcon, Play, Trash2, HelpCircle } from 'lucide-react';
import { formatDustFee } from '@/src/lib/dust-utils';

interface WebTerminalProps {
  seed: string;
  contractAddress: string;
  onRefreshState: () => void;
}

interface TermLine {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error' | 'input' | 'warning' | 'ascii';
  timestamp: string;
}

export const WebTerminal: React.FC<WebTerminalProps> = ({
  seed,
  contractAddress,
  onRefreshState,
}) => {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<TermLine[]>([
    {
      id: '1',
      text: '╔══════════════════════════════════════════════════════════════╗\n║     Midnight Hello World Contract CLI (Web Edition)          ║\n╚══════════════════════════════════════════════════════════════╝',
      type: 'ascii',
      timestamp: new Date().toLocaleTimeString(),
    },
    {
      id: '2',
      text: 'Connected to Midnight Preprod network.',
      type: 'info',
      timestamp: new Date().toLocaleTimeString(),
    },
    {
      id: '3',
      text: `Active Contract: ${contractAddress || 'None configured'}`,
      type: 'info',
      timestamp: new Date().toLocaleTimeString(),
    },
    {
      id: '4',
      text: "Type 'help' to view available commands, or '1' to store message, '2' to read message.",
      type: 'warning',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [isBusy, setIsBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const addLine = (text: string, type: TermLine['type'] = 'info') => {
    setLines((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        text,
        type,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const handleCommand = async (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    addLine(`> ${trimmed}`, 'input');
    setInput('');

    const [cmd, ...args] = trimmed.split(' ');
    const argStr = args.join(' ');

    if (cmd === 'clear') {
      setLines([]);
      return;
    }

    if (cmd === 'help') {
      addLine('Available Commands:');
      addLine('  [1] store <message>   - Proves and stores a new message to the contract');
      addLine('  [2] read              - Reads the current message from the blockchain');
      addLine('  [3] status            - Checks wallet address, tNIGHT balance and DUST balance');
      addLine('  [4] dust              - Registers unshielded coins for DUST generation');
      addLine('  [5] deploy            - Deploys a new Hello World Compact contract');
      addLine('  [6] doctor            - Runs ecosystem diagnostics (Node, Indexer, Prover, CLI)');
      addLine('  [7] codes <query>     - Searches 460+ Midnight error & status codes');
      addLine('  [8] templates         - Lists production Compact smart contract templates');
      addLine('  clear                 - Clears the terminal screen');
      return;
    }

    // Number shortcuts matching cli.ts
    if (cmd === '1' || cmd === 'store') {
      const messageToStore = argStr || (cmd === '1' ? prompt('Enter message to store:') : '');
      if (!messageToStore) {
        addLine('❌ Error: Message is required. Usage: store <message>', 'error');
        return;
      }
      if (!seed) {
        addLine('❌ Error: No wallet seed configured in Wallet Studio.', 'error');
        return;
      }

      setIsBusy(true);
      addLine(`⏳ Storing message "${messageToStore}" (generating ZK proof & submitting)...`, 'warning');

      try {
        const res = await fetch('/api/contract/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed, message: messageToStore, contractAddress }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed');
        }
        addLine('✅ Message stored successfully on Midnight Preprod!', 'success');
        addLine(`   Transaction Hash: ${data.data.txHash}`, 'info');
        addLine(`   Block Height: #${data.data.blockHeight}`, 'info');
        if (data.data.dustPaid && data.data.dustPaid !== '0') {
          addLine(`   DUST Gas Used: ${formatDustFee(data.data.dustPaid)}`, 'warning');
        }
        onRefreshState();
      } catch (err: any) {
        addLine(`❌ Error: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (cmd === '2' || cmd === 'read') {
      setIsBusy(true);
      addLine('🔍 Querying contract state from Midnight indexer...', 'info');
      try {
        const res = await fetch(`/api/contract/state?address=${encodeURIComponent(contractAddress)}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed');
        }
        if (data.data.found) {
          addLine(`📜 Current message: "${data.data.message || '(empty)'}"`, 'success');
        } else {
          addLine('⚠️  No contract state found at this address.', 'warning');
        }
      } catch (err: any) {
        addLine(`❌ Error reading state: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (cmd === '3' || cmd === 'status' || cmd === 'balance') {
      if (!seed) {
        addLine('❌ Error: No wallet seed configured in Wallet Studio.', 'error');
        return;
      }
      setIsBusy(true);
      addLine('📡 Syncing with Midnight Preprod & fetching wallet balance...', 'info');
      try {
        const res = await fetch('/api/wallet/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed');
        }
        addLine(`Wallet Address: ${data.data.address}`, 'info');
        addLine(`Status: ${data.data.isSynced ? '✓ Synced' : 'Syncing'}`, 'info');
        const tNightUnits = Number(BigInt(data.data.tNightBalance || 0)) / 1_000_000;
        const dustRaw = BigInt(data.data.dustBalance || 0);
        const dustUnits = dustRaw >= 1_000_000_000n ? Number(dustRaw) / 1e15 : Number(dustRaw);
        addLine(`tNIGHT Balance: ${tNightUnits.toLocaleString(undefined, { maximumFractionDigits: 6 })} tNIGHT`, 'success');
        addLine(`DUST Balance:   ${dustUnits.toLocaleString(undefined, { maximumFractionDigits: 4 })} DUST`, 'success');
      } catch (err: any) {
        addLine(`❌ Error: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (cmd === '4' || cmd === 'dust') {
      if (!seed) {
        addLine('❌ Error: No wallet seed configured in Wallet Studio.', 'error');
        return;
      }
      setIsBusy(true);
      addLine('⚡ Registering unshielded UTXOs for DUST generation...', 'warning');
      try {
        const res = await fetch('/api/wallet/register-dust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed');
        }
        addLine(`✅ ${data.data.message}`, 'success');
      } catch (err: any) {
        addLine(`❌ Error: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (cmd === '5' || cmd === 'deploy') {
      if (!seed) {
        addLine('❌ Error: No wallet seed configured in Wallet Studio.', 'error');
        return;
      }
      setIsBusy(true);
      addLine('🚀 Deploying new Hello World Compact contract to Midnight Preprod (30-60s)...', 'warning');
      try {
        const res = await fetch('/api/contract/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed');
        }
        addLine(`✅ Contract Deployed Successfully! Address: ${data.data.contractAddress}`, 'success');
        onRefreshState();
      } catch (err: any) {
        addLine(`❌ Error: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // Command 6: Doctor
    if (cmd === '6' || cmd === 'doctor') {
      setIsBusy(true);
      addLine('🩺 Running Midnight Ecosystem Doctor diagnostics...', 'warning');
      try {
        const res = await fetch('/api/diagnostics/doctor');
        const data = await res.json();
        if (data.success) {
          const s = data.diagnostics.services;
          addLine(`Network: ${data.diagnostics.networkId.toUpperCase()}`, 'info');
          addLine(`• Node RPC:     [${s.node?.status?.toUpperCase()}] ${s.node?.latencyMs || 0}ms (${s.node?.url})`, s.node?.status === 'online' ? 'success' : 'error');
          addLine(`• Indexer:      [${s.indexer?.status?.toUpperCase()}] ${s.indexer?.latencyMs || 0}ms`, s.indexer?.status === 'online' ? 'success' : 'error');
          addLine(`• Proof Server: [${s.proofServer?.status?.toUpperCase()}] (${s.proofServer?.note || 'Port 6300'})`, s.proofServer?.status === 'online' ? 'success' : 'warning');
          addLine(`• Compact CLI:  [${s.compactCli?.status?.toUpperCase()}] ${s.compactCli?.version || 'N/A'}`, s.compactCli?.status === 'online' ? 'success' : 'error');
        } else {
          addLine('❌ Doctor diagnostic probe failed.', 'error');
        }
      } catch (err: any) {
        addLine(`❌ Doctor error: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // Command 7: Status Codes Lookup
    if (cmd === '7' || cmd === 'codes' || cmd === 'code') {
      const q = argStr.trim();
      if (!q) {
        addLine('❌ Usage: codes <code number or keyword> (e.g. codes 0, codes network, codes witness)', 'error');
        return;
      }
      setIsBusy(true);
      addLine(`🔍 Searching Midnight status codes for "${q}"...`, 'warning');
      try {
        const res = await fetch(`/api/diagnostics/codes?q=${encodeURIComponent(q)}&limit=5`);
        const data = await res.json();
        if (data.success && data.entries.length > 0) {
          addLine(`Found ${data.total} status codes (showing first ${data.entries.length}):`, 'success');
          data.entries.forEach((e: any) => {
            addLine(`• [Code ${e.code}] ${e.name} (${e.source}): ${e.description}`, 'info');
            if (e.fixes && e.fixes.length > 0) {
              addLine(`   Fix: ${e.fixes[0]}`, 'success');
            }
          });
        } else {
          addLine(`No status codes matching "${q}".`, 'warning');
        }
      } catch (err: any) {
        addLine(`❌ Search failed: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    // Command 8: Templates
    if (cmd === '8' || cmd === 'templates') {
      setIsBusy(true);
      try {
        const res = await fetch('/api/contracts/templates');
        const data = await res.json();
        if (data.success && data.templates.length > 0) {
          addLine(`Available Compact Contract Templates (${data.templates.length}):`, 'success');
          data.templates.forEach((t: any) => {
            addLine(`• [${t.category}] ${t.name} - ${t.description}`, 'info');
          });
          addLine('Tip: Open the Tools & Doctor tab to view source code or load directly into the IDE.', 'warning');
        }
      } catch (err: any) {
        addLine(`❌ Failed to list templates: ${err.message}`, 'error');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    addLine(`Command not recognized: "${cmd}". Type 'help' for available commands.`, 'error');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBusy) {
      handleCommand(input);
    }
  };

  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-indigo-500/30 shadow-2xl flex flex-col h-[550px]">
      {/* Terminal Title Bar */}
      <div className="bg-midnight-900 px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1.5">
            <div className="h-3 w-3 rounded-full bg-rose-500/80" />
            <div className="h-3 w-3 rounded-full bg-amber-500/80" />
            <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-xs font-mono font-medium text-slate-300 ml-2 flex items-center gap-1.5">
            <TermIcon className="h-3.5 w-3.5 text-cyan-400" />
            <span>midnight-cli (hello-world)</span>
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleCommand('help')}
            className="flex items-center space-x-1 rounded px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-white/5"
            title="Help"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Help</span>
          </button>
          <button
            onClick={() => setLines([])}
            className="flex items-center space-x-1 rounded px-2 py-1 text-[11px] text-slate-400 hover:text-rose-400 hover:bg-white/5"
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Output Area */}
      <div className="flex-1 bg-midnight-950 p-4 font-mono text-xs overflow-y-auto space-y-1.5 select-text">
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap leading-relaxed ${
              line.type === 'input'
                ? 'text-cyan-400 font-bold'
                : line.type === 'success'
                ? 'text-emerald-400'
                : line.type === 'error'
                ? 'text-rose-400'
                : line.type === 'warning'
                ? 'text-amber-400'
                : line.type === 'ascii'
                ? 'text-indigo-400 font-semibold'
                : 'text-slate-300'
            }`}
          >
            {line.text}
          </div>
        ))}
        {isBusy && (
          <div className="text-amber-300 animate-pulse flex items-center space-x-2">
            <span>⠋ Processing Midnight ZK operation...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Terminal Input Bar */}
      <form onSubmit={handleSubmit} className="bg-midnight-900 p-3 border-t border-white/10 flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-cyan-400 pl-1">{'>'}</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isBusy}
          placeholder="Type 'help' or choose: [1] store <msg>, [2] read, [3] status..."
          className="flex-1 bg-transparent font-mono text-xs text-slate-100 placeholder-slate-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isBusy || !input.trim()}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-white font-medium hover:bg-indigo-500 disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
        </button>
      </form>
    </div>
  );
};

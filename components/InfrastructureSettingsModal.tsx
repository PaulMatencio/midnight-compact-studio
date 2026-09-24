'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  SlidersHorizontal,
  Cpu,
  Activity,
  Database,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Terminal,
  Server,
  Zap,
  Info,
  Layers,
} from 'lucide-react';

interface InfrastructureSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'overview' | 'prover' | 'indexer' | 'storage';

export const InfrastructureSettingsModal: React.FC<InfrastructureSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Configuration State
  const [config, setConfig] = useState<any>(null);

  // Test Results State
  const [isTesting, setIsTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, any>>({});

  const fetchConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    try {
      const res = await fetch('/api/system/config');
      const data = await res.json();
      if (data.success && data.data) {
        setConfig(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
      runAllTests();
    }
  }, [isOpen, fetchConfig]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const probeProverClientSide = async (targetUrl?: string) => {
    const proverUrl = targetUrl || config?.prover?.url || 'http://127.0.0.1:6300';
    const startTime = performance.now();
    try {
      const res = await fetch(proverUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(2500),
      });
      const latencyMs = Math.round(performance.now() - startTime);
      if (res.status === 200 || res.status === 404 || res.status === 405) {
        return {
          status: 'online',
          httpStatus: res.status,
          latencyMs,
          url: proverUrl,
          message: `Prover server reachable directly from browser (${latencyMs}ms, HTTP ${res.status})`,
        };
      }
    } catch {
      // client probe failed
    }
    return null;
  };

  const runTest = async (action: 'test_prover' | 'test_indexer' | 'test_redis' | 'test_files') => {
    setIsTesting((prev) => ({ ...prev, [action]: true }));
    try {
      const res = await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        let result = data.data;
        // If server-side check failed, attempt direct browser-to-prover check
        if (action === 'test_prover' && result.status !== 'online') {
          const direct = await probeProverClientSide();
          if (direct) result = direct;
        }
        setTestResults((prev) => ({ ...prev, [action]: result }));
      }
    } catch (err: any) {
      let fallbackResult: any = { status: 'offline', message: err.message };
      if (action === 'test_prover') {
        const direct = await probeProverClientSide();
        if (direct) fallbackResult = direct;
      }
      setTestResults((prev) => ({
        ...prev,
        [action]: fallbackResult,
      }));
    } finally {
      setIsTesting((prev) => ({ ...prev, [action]: false }));
    }
  };

  const runAllTests = async () => {
    setIsTesting((prev) => ({ ...prev, all: true }));
    try {
      const res = await fetch('/api/system/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_all' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        let proverResult = data.data.prover;
        if (proverResult?.status !== 'online') {
          const direct = await probeProverClientSide();
          if (direct) proverResult = direct;
        }
        setTestResults({
          test_prover: proverResult,
          test_indexer: data.data.indexer,
          test_redis: data.data.redis,
          test_files: data.data.files,
        });
      }
    } catch (err) {
      console.error('Failed to run all tests:', err);
    } finally {
      setIsTesting((prev) => ({ ...prev, all: false }));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl rounded-2xl bg-midnight-950/95 border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-midnight-900/60 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 p-0.5 shadow-lg">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-midnight-950">
                <SlidersHorizontal className="h-5 w-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">Midnight Infrastructure Configuration</h3>
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 border border-cyan-500/20">
                  Preprod
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage and verify ZK Proving Server, Indexer GraphQL, Redis, and Storage Drivers
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={runAllTests}
              disabled={isTesting.all}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-xs font-semibold text-indigo-200 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
              title="Test all infrastructure connections"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isTesting.all ? 'animate-spin' : ''}`} />
              <span>{isTesting.all ? 'Testing...' : 'Test All'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-white/10 bg-midnight-900/40 px-6 shrink-0 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Diagnostics', icon: Layers },
            { id: 'prover', label: 'ZK Prover Server', icon: Cpu },
            { id: 'indexer', label: 'Indexer & RPC', icon: Activity },
            { id: 'storage', label: 'Storage (Redis & Files)', icon: Database },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center space-x-2 py-3 px-4 border-b-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Prover Status Card */}
                <div className="glass-panel p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Cpu className="h-4 w-4 text-cyan-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">ZK Prover</h4>
                    </div>
                    <span
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        testResults.test_prover?.status === 'online'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          testResults.test_prover?.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                      />
                      <span>{testResults.test_prover?.status === 'online' ? 'Online' : 'Offline'}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono truncate">{config?.prover?.url || 'http://127.0.0.1:6300'}</p>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-slate-400">
                    <span>Latency: {testResults.test_prover?.latencyMs ? `${testResults.test_prover.latencyMs}ms` : '—'}</span>
                    <button
                      onClick={() => runTest('test_prover')}
                      disabled={isTesting.test_prover}
                      className="text-cyan-400 hover:text-cyan-300 underline font-sans"
                    >
                      {isTesting.test_prover ? 'Pinging...' : 'Ping'}
                    </button>
                  </div>
                </div>

                {/* Indexer Status Card */}
                <div className="glass-panel p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Activity className="h-4 w-4 text-purple-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Indexer GraphQL</h4>
                    </div>
                    <span
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        testResults.test_indexer?.status === 'online'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          testResults.test_indexer?.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                      />
                      <span>{testResults.test_indexer?.status === 'online' ? 'Online' : 'Offline'}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono truncate">
                    {testResults.test_indexer?.blockHeight
                      ? `Block #${Number(testResults.test_indexer.blockHeight).toLocaleString()}`
                      : 'Preprod Indexer'}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-slate-400">
                    <span>Latency: {testResults.test_indexer?.latencyMs ? `${testResults.test_indexer.latencyMs}ms` : '—'}</span>
                    <button
                      onClick={() => runTest('test_indexer')}
                      disabled={isTesting.test_indexer}
                      className="text-cyan-400 hover:text-cyan-300 underline font-sans"
                    >
                      {isTesting.test_indexer ? 'Querying...' : 'Query'}
                    </button>
                  </div>
                </div>

                {/* Storage Driver Status Card */}
                <div className="glass-panel p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Database className="h-4 w-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Storage Driver</h4>
                    </div>
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase font-mono">
                      {config?.storage?.driver || 'file'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono truncate">
                    {config?.storage?.driver === 'redis-json' ? config?.storage?.redis?.url : 'Local JSON files'}
                  </p>
                  <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-slate-400">
                    <span>
                      {config?.storage?.driver === 'redis-json'
                        ? `Ping: ${testResults.test_redis?.latencyMs ? `${testResults.test_redis.latencyMs}ms` : '—'}`
                        : 'Active on disk'}
                    </span>
                    <button
                      onClick={() => (config?.storage?.driver === 'redis-json' ? runTest('test_redis') : runTest('test_files'))}
                      className="text-cyan-400 hover:text-cyan-300 underline font-sans"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              </div>

              {/* Diagnostic Terminal Log */}
              <div className="rounded-xl bg-midnight-900 border border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center space-x-1.5 font-mono font-bold text-slate-300">
                    <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Diagnostic Log & Telemetry Output</span>
                  </span>
                  <span className="text-[11px]">Auto-refreshed</span>
                </div>
                <div className="p-3 rounded-lg bg-midnight-950 font-mono text-[11px] text-slate-300 space-y-1.5 border border-white/5">
                  <div className="text-cyan-300">➜ Midnight Infrastructure System Audit:</div>
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500">•</span>
                    <span>Prover ({config?.prover?.url}):</span>
                    <span className={testResults.test_prover?.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}>
                      {testResults.test_prover?.message || 'Testing...'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500">•</span>
                    <span>Indexer ({config?.indexer?.url}):</span>
                    <span className={testResults.test_indexer?.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}>
                      {testResults.test_indexer?.message || 'Testing...'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500">•</span>
                    <span>Storage Driver ({config?.storage?.driver}):</span>
                    <span className="text-indigo-300">
                      {config?.storage?.driver === 'redis-json'
                        ? testResults.test_redis?.message || 'Checking Redis...'
                        : testResults.test_files?.message || 'File persistence active.'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PROVER CONFIGURATION */}
          {activeTab === 'prover' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">Prover HTTP Server URL</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={config?.prover?.url || 'http://127.0.0.1:6300'}
                    className="flex-1 bg-midnight-900 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                  />
                  <button
                    onClick={() => copyToClipboard(config?.prover?.url || 'http://127.0.0.1:6300', 'prover-url')}
                    className="p-2.5 rounded-xl bg-midnight-900 hover:bg-midnight-800 border border-white/10 text-slate-300 hover:text-white"
                    title="Copy URL"
                  >
                    {copiedKey === 'prover-url' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => runTest('test_prover')}
                    disabled={isTesting.test_prover}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg transition-all"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isTesting.test_prover ? 'animate-spin' : ''}`} />
                    <span>{isTesting.test_prover ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  The local proof server generates zero-knowledge proofs for Midnight Compact circuits.
                </p>
              </div>

              {/* Prover Starter Helper */}
              <div className="rounded-xl bg-midnight-900/90 border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Server className="h-4 w-4 text-cyan-400" />
                    <span>How to Start the Local Prover Container</span>
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-midnight-950 border border-white/5 font-mono text-xs text-slate-200">
                    <span>docker compose up -d</span>
                    <button
                      onClick={() => copyToClipboard('docker compose up -d', 'cmd-prover')}
                      className="text-slate-400 hover:text-white p-1"
                      title="Copy command"
                    >
                      {copiedKey === 'cmd-prover' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-midnight-950 border border-white/5 font-mono text-xs text-slate-200">
                    <span>npm run proof-server:start</span>
                    <button
                      onClick={() => copyToClipboard('npm run proof-server:start', 'cmd-prover-npm')}
                      className="text-slate-400 hover:text-white p-1"
                      title="Copy command"
                    >
                      {copiedKey === 'cmd-prover-npm' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INDEXER CONFIGURATION */}
          {activeTab === 'indexer' && (
            <div className="space-y-5">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300">Indexer GraphQL Endpoint</label>
                  <div className="flex items-center space-x-2 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={config?.indexer?.url || ''}
                      className="flex-1 bg-midnight-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                    />
                    <button
                      onClick={() => copyToClipboard(config?.indexer?.url || '', 'indexer-url')}
                      className="p-2 rounded-xl bg-midnight-900 border border-white/10 text-slate-300 hover:text-white"
                      title="Copy GraphQL URL"
                    >
                      {copiedKey === 'indexer-url' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">WebSocket Subscription Endpoint</label>
                  <div className="flex items-center space-x-2 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={config?.indexer?.wsUrl || ''}
                      className="flex-1 bg-midnight-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                    />
                    <button
                      onClick={() => copyToClipboard(config?.indexer?.wsUrl || '', 'ws-url')}
                      className="p-2 rounded-xl bg-midnight-900 border border-white/10 text-slate-300 hover:text-white"
                      title="Copy WS URL"
                    >
                      {copiedKey === 'ws-url' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-300">Node RPC</label>
                    <input
                      type="text"
                      readOnly
                      value={config?.indexer?.nodeRpc || ''}
                      className="w-full bg-midnight-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-300">Network ID</label>
                    <input
                      type="text"
                      readOnly
                      value={config?.indexer?.networkId || 'preprod'}
                      className="w-full bg-midnight-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono mt-1"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => runTest('test_indexer')}
                    disabled={isTesting.test_indexer}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg transition-all"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isTesting.test_indexer ? 'animate-spin' : ''}`} />
                    <span>{isTesting.test_indexer ? 'Querying Indexer...' : 'Ping Indexer & Query Block'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: STORAGE CONFIGURATION (REDIS & FILES) */}
          {activeTab === 'storage' && (
            <div className="space-y-6">
              {/* Active Driver Banner */}
              <div className="p-4 rounded-xl bg-midnight-900/90 border border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">Active Persistence Driver</div>
                  <p className="text-[11px] text-slate-400">
                    Switch between local file system JSON files and RedisJSON via the <code className="text-cyan-300 font-mono">STORAGE_DRIVER</code> environment variable.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold uppercase font-mono">
                  {config?.storage?.driver || 'file'}
                </span>
              </div>

              {/* Redis Stack Section */}
              <div className="rounded-xl bg-midnight-900/60 border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Database className="h-4 w-4 text-cyan-400" />
                    <span>Redis Stack / RedisJSON Configuration</span>
                  </span>
                  <button
                    onClick={() => runTest('test_redis')}
                    disabled={isTesting.test_redis}
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    {isTesting.test_redis ? 'Testing...' : 'Test PING'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400">Redis URL</label>
                    <input
                      type="text"
                      readOnly
                      value={config?.storage?.redis?.url || 'redis://127.0.0.1:6379'}
                      className="w-full bg-midnight-950 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white font-mono mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">Key Prefix</label>
                    <input
                      type="text"
                      readOnly
                      value={config?.storage?.redis?.keyPrefix || 'midnight:'}
                      className="w-full bg-midnight-950 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white font-mono mt-1"
                    />
                  </div>
                </div>

                {/* Redis Docker Compose command */}
                <div className="p-2.5 rounded-lg bg-midnight-950 border border-white/5 flex items-center justify-between text-xs font-mono text-slate-300">
                  <span>npm run redis:start</span>
                  <button
                    onClick={() => copyToClipboard('npm run redis:start', 'cmd-redis')}
                    className="text-slate-400 hover:text-white p-1"
                    title="Copy command"
                  >
                    {copiedKey === 'cmd-redis' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* File Storage Paths */}
              <div className="rounded-xl bg-midnight-900/60 border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <FileCode className="h-4 w-4 text-purple-400" />
                    <span>File System Persistence Paths</span>
                  </span>
                  <button
                    onClick={() => runTest('test_files')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Inspect Files
                  </button>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-midnight-950 border border-white/5">
                    <span className="text-slate-400">Deployment File:</span>
                    <span className="text-slate-200">{config?.storage?.file?.deploymentPath || 'deployment.json'}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-midnight-950 border border-white/5">
                    <span className="text-slate-400">Wallet State File:</span>
                    <span className="text-slate-200">{config?.storage?.file?.walletStatePath || 'wallet-serialized-state.json'}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-midnight-950 border border-white/5">
                    <span className="text-slate-400">Tx History File:</span>
                    <span className="text-slate-200">{config?.storage?.file?.txHistoryPath || 'tx-history.json'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-midnight-900/60 shrink-0 text-xs text-slate-400">
          <div className="flex items-center space-x-1.5">
            <Info className="h-3.5 w-3.5 text-cyan-400" />
            <span>Preprod Network • Midnight Compact v0.23+</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-midnight-800 hover:bg-midnight-700 border border-white/10 text-white font-semibold transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

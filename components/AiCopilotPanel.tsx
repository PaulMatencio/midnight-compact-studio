'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
    Sparkles,
    Send,
    Bot,
    User,
    Copy,
    Check,
    RefreshCw,
    Key,
    Settings,
    Shield,
    Zap,
    FlaskConical,
    FileCode2,
    CheckCircle2,
    AlertCircle,
    ArrowDownToLine,
    Trash2,
    HelpCircle,
    Code2,
    ExternalLink,
    Save,
    Download,
    Play,
    PackageCheck,
    Repeat,
} from 'lucide-react';
import { useToast } from '@/src/presentation/context/ToastContext';
import { getCleanContractBaseName, CONTRACT_PATHS } from '@/src/lib/contract-utils';
import { ExportDappModal } from './ExportDappModal';

interface AiMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    action?: string;
    codeBlocks?: { language: string; code: string }[];
}

interface AiCopilotPanelProps {
    filename: string;
    sourceCode: string;
    contractFilename?: string;
    contractCode?: string;
    compilerResult: any;
    testResult: any;
    onApplyCodeToEditor: (code: string) => void;
    onSwitchTab?: (tab: string) => void;
    onRunTests?: () => void;
    isRunningTests?: boolean;
}

export function AiCopilotPanel({
    filename,
    sourceCode,
    contractFilename,
    contractCode,
    compilerResult,
    testResult,
    onApplyCodeToEditor,
    onSwitchTab,
    onRunTests,
    isRunningTests = false,
}: AiCopilotPanelProps) {
    const toast = useToast();
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
    const [messages, setMessages] = useState<AiMessage[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: `👋 **Hello! I'm Gemini 3.7 Flash, your Midnight Compact AI Copilot.**

I can help you build, fix, and test Zero-Knowledge smart contracts and generate Midnight.js client SDK applications:
* 🛠️ **Diagnose & Fix** compiler errors or witness type mismatches.
* ⚡ **Generate Midnight.js TypeScript Client** connection code.
* 🧪 **Scaffold Vitest unit tests** with simulated circuit contexts.
* 🔒 **Audit ZK & Privacy constraints** for witness leaks.

Ask a question below or click one of the quick actions to get started!`,
            timestamp: new Date(),
        },
    ]);
    const [inputPrompt, setInputPrompt] = useState<string>('');
    const [isStreaming, setIsStreaming] = useState<boolean>(false);
    const [abortController, setAbortController] = useState<AbortController | null>(null);

    const [apiKey, setApiKey] = useState<string>('');
    const [selectedModel, setSelectedModel] = useState<string>('gemini-3.7-flash');
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

    // Autonomous Test & Auto-Heal Loop Agent State
    const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
    const [agentStatus, setAgentStatus] = useState<string>('');

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Restore saved settings & chat history once mounted on client
    useEffect(() => {
        setIsMounted(true);
        try {
            const savedKey = localStorage.getItem('midnight_gemini_api_key');
            const savedModel = localStorage.getItem('midnight_gemini_model');
            const savedMessages = localStorage.getItem('midnight_ide_copilot_messages');

            if (savedKey) setApiKey(savedKey);
            if (savedModel) setSelectedModel(savedModel);
            if (savedMessages) {
                const parsed = JSON.parse(savedMessages);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setMessages(parsed);
                }
            }
        } catch {
            // Ignore
        }
    }, []);

    // Persist messages to localStorage ONLY after client has mounted
    useEffect(() => {
        if (!isMounted) return;
        if (messages.length > 0) {
            try {
                localStorage.setItem('midnight_ide_copilot_messages', JSON.stringify(messages));
            } catch {
                // Ignore
            }
        }
    }, [isMounted, messages, isStreaming]);

    const saveApiKey = (key: string) => {
        setApiKey(key);
        try {
            if (key) {
                localStorage.setItem('midnight_gemini_api_key', key);
            } else {
                localStorage.removeItem('midnight_gemini_api_key');
            }
            toast.success('Settings Saved', 'Gemini API Key preferences updated.');
            setIsSettingsOpen(false);
        } catch {
            // Ignore
        }
    };

    const saveModel = (model: string) => {
        setSelectedModel(model);
        try {
            localStorage.setItem('midnight_gemini_model', model);
        } catch {
            // Ignore
        }
    };

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isStreaming]);

    // Send AI request (streaming)
    const handleSendAction = async (action: string = 'chat', customPrompt?: string) => {
        const textPrompt = customPrompt !== undefined ? customPrompt : inputPrompt;
        if (!textPrompt.trim() && action === 'chat') return;

        // Create user message
        const userMsgId = `user-${Date.now()}`;
        const userMsg: AiMessage = {
            id: userMsgId,
            role: 'user',
            content:
                action === 'fix_error'
                    ? '🛠️ Fix Compiler Error for this contract'
                    : action === 'generate_client'
                    ? '⚡ Generate Midnight.js TypeScript Client Adapter'
                    : action === 'generate_tests'
                    ? '🧪 Generate Vitest Unit Tests for this contract'
                    : action === 'audit_zk'
                    ? '🔒 Conduct ZK & Privacy Audit'
                    : action === 'explain'
                    ? '📖 Explain this Compact contract architecture'
                    : textPrompt,
            timestamp: new Date(),
            action,
        };

        const assistantMsgId = `assistant-${Date.now()}`;
        const assistantMsg: AiMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            action,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setInputPrompt('');
        setIsStreaming(true);

        const controller = new AbortController();
        setAbortController(controller);

        // If a non-compact file is currently open in the editor (e.g. install script or test file),
        // use the active Compact contract code and filename for contract-centric actions.
        const shouldUseContractContext =
            (action === 'generate_client' ||
                action === 'generate_tests' ||
                action === 'audit_zk' ||
                action === 'explain') &&
            !filename.endsWith('.compact') &&
            Boolean(contractCode && contractFilename);

        const effectiveCode = shouldUseContractContext ? (contractCode as string) : sourceCode;
        const effectiveFilename = shouldUseContractContext ? (contractFilename as string) : filename;

        try {
            const res = await fetch('/api/ai/compact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: textPrompt,
                    action,
                    code: effectiveCode,
                    filename: effectiveFilename,
                    diagnostics: compilerResult?.diagnostics || [],
                    compilerOutput: compilerResult?.rawOutput || compilerResult?.error || '',
                    dtsContent: compilerResult?.dts || '',
                    testOutput: testResult?.rawOutput || (testResult ? JSON.stringify(testResult) : ''),
                    model: selectedModel,
                    apiKey: apiKey || undefined,
                }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                if (res.status === 401) {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === assistantMsgId
                                ? {
                                      ...msg,
                                      content: `⚠️ **Gemini API Key Required**\n\nPlease configure your Google AI Studio API key in the [Copilot Settings](#settings) or add \`GEMINI_API_KEY=...\` to your \`.env.local\` file.\n\nGet a free API key at [Google AI Studio](https://aistudio.google.com/).`,
                                  }
                                : msg
                        )
                    );
                    setIsSettingsOpen(true);
                    return;
                }
                throw new Error(errorData.message || `API Error ${res.status}`);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No response stream available');

            const decoder = new TextDecoder();
            let accumulatedContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                accumulatedContent += chunk;

                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantMsgId ? { ...msg, content: accumulatedContent } : msg
                    )
                );
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                // User cancelled stream
            } else {
                console.error('AI Stream Error:', err);
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantMsgId
                            ? {
                                  ...msg,
                                  content: `❌ **Error**: ${err.message || 'Failed to generate response. Please check your API key and connection.'}`,
                              }
                            : msg
                    )
                );
                toast.error('AI Request Failed', err.message);
            }
        } finally {
            setIsStreaming(false);
            setAbortController(null);
        }
    };

    // Autonomous Test & Auto-Heal Loop Agent Runner
    const handleRunAutoTestAgent = async () => {
        if (isStreaming || isAgentRunning) return;

        const effectiveContractName = contractFilename
            ? getCleanContractBaseName(contractFilename)
            : getCleanContractBaseName(filename);

        const effectiveCode = contractCode || sourceCode;

        setIsAgentRunning(true);
        setAgentStatus(`Starting autonomous compile & test loop for ${effectiveContractName}...`);

        const agentMsgId = `agent-${Date.now()}`;
        const initialAgentMsg: AiMessage = {
            id: agentMsgId,
            role: 'assistant',
            content: `🤖 **Autonomous Test Agent Activated for \`${effectiveContractName}\`**\n\n- 🔄 Step 1: Compiling Compact contract...\n`,
            timestamp: new Date(),
            action: 'agent_loop',
        };

        setMessages((prev) => [...prev, initialAgentMsg]);

        try {
            const res = await fetch('/api/ai/agent/test-loop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractName: effectiveContractName,
                    sourceCode: effectiveCode,
                    maxIterations: 4,
                    apiKey: apiKey || undefined,
                    model: selectedModel,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                if (res.status === 401) {
                    setMessages((prev) =>
                        prev.map((msg) =>
                            msg.id === agentMsgId
                                ? {
                                      ...msg,
                                      content: `${msg.content}\n\n⚠️ **Gemini API Key Required**\nPlease configure your Google AI Studio API key in Settings or add \`GEMINI_API_KEY\` to \`.env.local\`.`,
                                  }
                                : msg
                        )
                    );
                    setIsSettingsOpen(true);
                    return;
                }
                throw new Error(errData.message || 'Agent endpoint returned error');
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No readable stream from agent endpoint');

            const decoder = new TextDecoder();
            let accumulatedContent = initialAgentMsg.content;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const event = JSON.parse(line.slice(6));
                            setAgentStatus(event.message);

                            if (event.step === 'compiling') {
                                accumulatedContent += `- ⚙️ **Compiler**: ${event.message}\n`;
                            } else if (event.step === 'compile_error') {
                                accumulatedContent += `- ❌ **Compilation Failed**:\n\`\`\`\n${event.details || event.message}\n\`\`\`\n`;
                            } else if (event.step === 'generating_tests') {
                                accumulatedContent += `- 🧪 **Generating Vitest Suite**: ${event.message}\n`;
                            } else if (event.step === 'running_tests') {
                                accumulatedContent += `- 🏃 **Round ${event.iteration}/${event.maxIterations}**: Executing tests...\n`;
                            } else if (event.step === 'healing') {
                                accumulatedContent += `- 🛠️ **Healing Round ${event.iteration}**: ${event.details?.failed || 0} failed. Gemini fixing witnesses & state...\n`;
                            } else if (event.step === 'success') {
                                accumulatedContent += `\n### 🎉 **100% PASSED!**\n${event.message}\nAll tests verified against Compact runtime in ${event.details?.iterationsUsed || 1} round(s).\n`;
                                toast.success('Agent Succeeded', `All ${event.details?.total || 0} tests passed!`);
                            } else if (event.step === 'failed') {
                                accumulatedContent += `\n### ⚠️ **Agent Stopped**\n${event.message}\n`;
                                toast.error('Agent Stopped', event.message);
                            }

                            setMessages((prev) =>
                                prev.map((msg) =>
                                    msg.id === agentMsgId ? { ...msg, content: accumulatedContent } : msg
                                )
                            );
                        } catch {
                            // Non-JSON SSE chunk
                        }
                    }
                }
            }

            // Trigger fresh test run in the tests tab to sync with UI
            if (onRunTests) {
                setTimeout(() => onRunTests(), 1000);
            }
        } catch (agentErr: any) {
            toast.error('Agent Error', agentErr.message);
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === agentMsgId
                        ? { ...msg, content: `${msg.content}\n\n❌ **Agent Error**: ${agentErr.message}` }
                        : msg
                )
            );
        } finally {
            setIsAgentRunning(false);
            setAgentStatus('');
        }
    };

    const handleStopStream = () => {
        if (abortController) {
            abortController.abort();
            setIsStreaming(false);
            setAbortController(null);
            toast.info('Generation Stopped', 'Response generation was cancelled.');
        }
    };

    const handleClearChat = () => {
        const resetMsg: AiMessage[] = [
            {
                id: 'welcome-reset',
                role: 'assistant',
                content: `Chat history cleared. How can I assist you with **${filename}**?`,
                timestamp: new Date(),
            },
        ];
        setMessages(resetMsg);
        try {
            localStorage.setItem('midnight_ide_copilot_messages', JSON.stringify(resetMsg));
        } catch {
            // Ignore
        }
        toast.info('Chat Cleared', 'Copilot conversation history has been reset.');
    };

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(id);
        toast.success('Copied to Clipboard', 'Code copied.');
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const detectFileMeta = (code: string, language: string, rawFilename: string) => {
        // Derive clean contract base name from contractFilename or rawFilename
        let baseName = getCleanContractBaseName(contractFilename);
        if (!baseName || baseName === 'contract') {
            baseName = getCleanContractBaseName(rawFilename);
        }

        // Also check if the code snippet itself references a managed contract path
        const managedMatch = code.match(/contracts\/managed\/([a-zA-Z0-9_-]+)/i);
        if (managedMatch && managedMatch[1]) {
            baseName = getCleanContractBaseName(managedMatch[1]);
        }

        const lang = (language || '').toLowerCase().trim();
        const trimmed = code.trim();

        // 1. Shell / Terminal Commands (Must be checked FIRST so npm install is never treated as TypeScript)
        if (
            lang === 'bash' ||
            lang === 'sh' ||
            lang === 'shell' ||
            lang === 'zsh' ||
            trimmed.startsWith('npm ') ||
            trimmed.startsWith('yarn ') ||
            trimmed.startsWith('pnpm ') ||
            trimmed.startsWith('npx ') ||
            trimmed.startsWith('docker ') ||
            trimmed.startsWith('cd ') ||
            trimmed.startsWith('$ ') ||
            trimmed.startsWith('git ')
        ) {
            return {
                folder: 'scripts',
                filename: `${baseName}-install.sh`,
                typeLabel: 'Shell / Terminal Script',
                icon: 'sh',
                badgeColor: 'text-amber-300 bg-amber-500/20 border-amber-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: true,
            };
        }

        // 2. Architecture Diagrams / ASCII Art / Mermaid
        if (
            lang === 'mermaid' ||
            lang === 'ascii' ||
            lang === 'diagram' ||
            trimmed.includes('┌─') ||
            trimmed.includes('└─') ||
            trimmed.includes('├──') ||
            trimmed.includes('+--') ||
            (lang === 'text' && (trimmed.includes('-->') || trimmed.includes('|') || trimmed.includes('===')))
        ) {
            return {
                folder: 'docs',
                filename: `${baseName}-architecture.txt`,
                typeLabel: 'Architecture Diagram',
                icon: 'diagram',
                badgeColor: 'text-slate-300 bg-slate-700/50 border-white/10',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: true,
                isShell: false,
            };
        }

        // 3. Compact Smart Contract
        if (
            lang === 'compact' ||
            (trimmed.includes('export ledger') && trimmed.includes('export circuit')) ||
            (trimmed.includes('pragma language_version') && trimmed.includes('export'))
        ) {
            return {
                folder: 'contracts',
                filename: `${baseName}.compact`,
                typeLabel: 'Compact Smart Contract',
                icon: 'compact',
                badgeColor: 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30',
                isCompact: true,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 4. Vitest Test Suite
        if (
            (trimmed.includes('describe(') && (trimmed.includes('it(') || trimmed.includes('test('))) ||
            trimmed.includes("from 'vitest'") ||
            trimmed.includes('from "vitest"')
        ) {
            return {
                folder: 'tests/contracts',
                filename: `${baseName}.test.ts`,
                typeLabel: 'Vitest Unit Tests',
                icon: 'test',
                badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: true,
                isDoc: false,
                isShell: false,
            };
        }

        // 5. API Reference Outline / Signature Only (e.g. class outline without implementation or imports)
        const isOutlineOnly =
            (trimmed.startsWith('class ') || trimmed.includes('class ')) &&
            trimmed.includes('constructor(') &&
            !trimmed.includes('import ') &&
            !trimmed.includes('export class ') &&
            (trimmed.includes('): ConstructorResult') || trimmed.includes('): CircuitResults'));

        if (isOutlineOnly) {
            return {
                folder: 'docs',
                filename: `${baseName}-api.d.ts`,
                typeLabel: 'API Reference Outline',
                icon: 'ts',
                badgeColor: 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 6. Production TypeScript Client SDK (Full Class Adapter) - Must be checked BEFORE pure types
        if (
            (trimmed.includes('class ') || trimmed.includes('export class ') || trimmed.includes('constructor(')) &&
            !trimmed.includes('describe(') &&
            !trimmed.includes('async function main')
        ) {
            return {
                folder: 'src/client',
                filename: `${baseName}-sdk.ts`,
                typeLabel: 'TypeScript SDK Client',
                icon: 'ts',
                badgeColor: 'text-cyan-300 bg-cyan-500/20 border-cyan-500/30',
                isCompact: false,
                isTsSdk: true,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 6. Usage Walkthrough / Quickstart Script (e.g. async function main(), client.storeMessage(...))
        if (
            trimmed.includes('async function main') ||
            trimmed.includes('async function run') ||
            trimmed.includes('async function example') ||
            (trimmed.includes('const client = new') && trimmed.includes('await client.')) ||
            trimmed.includes('// Step ') ||
            trimmed.includes('// 1.') ||
            trimmed.includes('// Quickstart')
        ) {
            return {
                folder: 'examples',
                filename: `${baseName}-example.ts`,
                typeLabel: 'Usage Example',
                icon: 'example',
                badgeColor: 'text-blue-300 bg-blue-500/20 border-blue-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: true,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 7. API Reference & Pure Type Signatures (Interfaces / Types only, without class)
        if (
            (trimmed.startsWith('interface ') || trimmed.startsWith('export interface ') || trimmed.startsWith('type ') || trimmed.startsWith('export type ')) ||
            trimmed.includes('interface ') ||
            trimmed.includes('type Ledger') ||
            trimmed.includes('type PrivateState')
        ) {
            return {
                folder: 'src/client',
                filename: `${baseName}-types.ts`,
                typeLabel: 'API Type Definitions',
                icon: 'ts',
                badgeColor: 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 8. General TypeScript / JavaScript Module Fallback
        if (lang === 'typescript' || lang === 'ts' || lang === 'js' || lang === 'javascript') {
            return {
                folder: 'src/client',
                filename: `${baseName}-sdk.ts`,
                typeLabel: 'TypeScript SDK Client',
                icon: 'ts',
                badgeColor: 'text-cyan-300 bg-cyan-500/20 border-cyan-500/30',
                isCompact: false,
                isTsSdk: true,
                isExample: false,
                isTest: false,
                isDoc: false,
                isShell: false,
            };
        }

        // 8. Markdown / Documentation
        if (lang === 'markdown' || lang === 'md' || trimmed.startsWith('# ') || trimmed.includes('## ')) {
            return {
                folder: 'docs',
                filename: `${baseName}-sdk.md`,
                typeLabel: 'SDK Documentation',
                icon: 'doc',
                badgeColor: 'text-purple-300 bg-purple-500/20 border-purple-500/30',
                isCompact: false,
                isTsSdk: false,
                isExample: false,
                isTest: false,
                isDoc: true,
                isShell: false,
            };
        }

        return {
            folder: 'docs',
            filename: `${baseName}-notes.txt`,
            typeLabel: lang || 'Text Snippet',
            icon: 'txt',
            badgeColor: 'text-slate-300 bg-slate-700/50 border-white/10',
            isCompact: false,
            isTsSdk: false,
            isExample: false,
            isTest: false,
            isDoc: true,
            isShell: false,
        };
    };

    // Save code snippet directly to workspace (with intelligent path suggestion)
    const handleSaveSnippetToFile = async (code: string, language: string) => {
        if (isStreaming) {
            toast.error('Generation in Progress', 'Please wait for Gemini to finish generating before saving the file.');
            return;
        }

        if (!code || code.trim().length < 10) {
            toast.error('Invalid Code', 'The code snippet is empty or incomplete.');
            return;
        }

        const meta = detectFileMeta(code, language, filename);

        const targetPath = prompt(`Enter workspace path to save this file:`, `${meta.folder}/${meta.filename}`);
        if (!targetPath) return;

        const cleanPath = targetPath.trim().replace(/\\/g, '/');
        const parts = cleanPath.split('/').filter(Boolean);
        const saveName = parts.pop() || meta.filename;
        const saveFolder = parts.join('/') || '.';

        try {
            const res = await fetch('/api/compiler/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCode: code,
                    filename: saveName,
                    folder: saveFolder,
                }),
            });
            const data = await res.json();
            if (data.success) {
                toast.success('File Saved to Workspace', `Saved to ${data.data.folder}/${data.data.filename}`);
            } else {
                throw new Error(data.error || 'Failed to save file');
            }
        } catch (err: any) {
            toast.error('Save Failed', err.message);
        }
    };

    // Save entire markdown documentation to workspace
    const handleSaveFullDocToFile = async (fullContent: string) => {
        const baseName = getCleanContractBaseName(contractFilename || filename);
        const defaultDocPath = CONTRACT_PATHS.doc(baseName);
        const targetPath = prompt(`Enter workspace path to save SDK documentation:`, defaultDocPath);
        if (!targetPath) return;

        const cleanPath = targetPath.trim().replace(/\\/g, '/');
        const parts = cleanPath.split('/').filter(Boolean);
        const saveName = parts.pop() || `${baseName}-sdk.md`;
        const saveFolder = parts.join('/') || 'docs';

        try {
            const res = await fetch('/api/compiler/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCode: fullContent,
                    filename: saveName,
                    folder: saveFolder,
                }),
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Documentation Saved', `Saved to ${data.data.folder}/${data.data.filename}`);
            } else {
                throw new Error(data.error || 'Failed to save documentation');
            }
        } catch (err: any) {
            toast.error('Save Failed', err.message);
        }
    };

    // Download snippet as a local file
    const handleDownloadSnippet = (code: string, language: string) => {
        const meta = detectFileMeta(code, language, filename);

        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = meta.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('File Downloaded', `Downloaded ${meta.filename}`);
    };

    // Download full markdown documentation
    const handleDownloadFullDoc = (fullContent: string) => {
        const baseName = getCleanContractBaseName(contractFilename || filename);
        const docName = `${baseName}-sdk.md`;
        const blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = docName;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Documentation Downloaded', `Downloaded ${docName}`);
    };

    // Helper to parse markdown code blocks for extraction
    const extractCodeBlocks = (text: string) => {
        const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
        const blocks: { language: string; code: string; fullMatch: string }[] = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            blocks.push({
                language: match[1] || 'text',
                code: match[2].trim(),
                fullMatch: match[0],
            });
        }
        return blocks;
    };

    // Render formatted markdown content with interactive code blocks
    const renderMessageContent = (content: string, msgId: string, role: string = 'assistant') => {
        const blocks = extractCodeBlocks(content);

        // Find key deliverables by selecting the complete, production file (with imports) or largest matching block
        const tsSdkBlocks = blocks.filter((b) => {
            const meta = detectFileMeta(b.code, b.language, filename);
            return meta.isTsSdk;
        });
        const tsSdkBlock =
            tsSdkBlocks.find((b) => b.code.includes('import ') && b.code.includes('export class ')) ||
            tsSdkBlocks.find((b) => b.code.includes('import ')) ||
            [...tsSdkBlocks].sort((a, b) => b.code.length - a.code.length)[0];

        const exampleBlocks = blocks.filter((b) => detectFileMeta(b.code, b.language, filename).isExample);
        const exampleBlock =
            exampleBlocks.find((b) => b.code.includes('import ')) ||
            [...exampleBlocks].sort((a, b) => b.code.length - a.code.length)[0];

        const testBlocks = blocks.filter((b) => detectFileMeta(b.code, b.language, filename).isTest);
        const testBlock =
            testBlocks.find((b) => b.code.includes('describe(') && b.code.includes('it(')) ||
            [...testBlocks].sort((a, b) => b.code.length - a.code.length)[0];

        const isSdkResponse =
            role === 'assistant' &&
            (content.includes('SDK Documentation') ||
                content.includes('TypeScript Client SDK') ||
                tsSdkBlock !== undefined);

        if (blocks.length === 0) {
            return (
                <div className="space-y-3 text-xs text-slate-200 leading-relaxed font-sans">
                    <div className="whitespace-pre-wrap">{content}</div>
                </div>
            );
        }

        // Split text by code blocks
        const parts = content.split(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g);

        return (
            <div className="space-y-3 text-xs text-slate-200 leading-relaxed">
                {/* Deliverables Quick Actions Header for SDK / Multi-file Responses */}
                {isSdkResponse && (
                    <div className="p-3.5 rounded-2xl bg-midnight-950/95 border border-cyan-500/40 shadow-2xl space-y-2.5 mb-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                                <Sparkles className="h-4 w-4 text-cyan-400" />
                                <span>Generated Deliverables</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                                {blocks.length} artifact(s) available
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            {/* 1. Full Documentation Actions */}
                            <button
                                onClick={() => handleSaveFullDocToFile(content)}
                                disabled={isStreaming}
                                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-600/30 text-purple-200 hover:bg-purple-600 hover:text-white text-[11px] font-bold border border-purple-500/40 transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Save full documentation to docs/"
                            >
                                <FileCode2 className="h-3.5 w-3.5 text-purple-300" />
                                <span>Save SDK Docs (.md)</span>
                            </button>

                            <button
                                onClick={() => handleDownloadFullDoc(content)}
                                disabled={isStreaming}
                                className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-midnight-900 text-slate-300 hover:text-white text-[11px] border border-white/15 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Download complete SDK documentation markdown file"
                            >
                                <Download className="h-3.5 w-3.5 text-slate-400" />
                                <span>Download Docs (.md)</span>
                            </button>

                            {/* 2. TypeScript Client SDK Actions */}
                            {tsSdkBlock && (
                                <>
                                    <button
                                        onClick={() => handleSaveSnippetToFile(tsSdkBlock.code, tsSdkBlock.language)}
                                        disabled={isStreaming}
                                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-cyan-600/30 text-cyan-200 hover:bg-cyan-600 hover:text-white text-[11px] font-bold border border-cyan-500/40 transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Save TypeScript client adapter to src/client/"
                                    >
                                        <Zap className="h-3.5 w-3.5 text-cyan-300" />
                                        <span>Save Client SDK (.ts)</span>
                                    </button>

                                    <button
                                        onClick={() => handleDownloadSnippet(tsSdkBlock.code, tsSdkBlock.language)}
                                        disabled={isStreaming}
                                        className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-midnight-900 text-slate-300 hover:text-white text-[11px] border border-white/15 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Download TypeScript client file"
                                    >
                                        <Download className="h-3.5 w-3.5 text-cyan-400" />
                                        <span>Download Client (.ts)</span>
                                    </button>
                                </>
                            )}

                            {/* 3. Example Walkthrough Actions if present */}
                            {exampleBlock && (
                                <button
                                    onClick={() => handleSaveSnippetToFile(exampleBlock.code, exampleBlock.language)}
                                    disabled={isStreaming}
                                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600/30 text-blue-200 hover:bg-blue-600 hover:text-white text-[11px] font-bold border border-blue-500/40 transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Save runnable example script to examples/"
                                >
                                    <FileCode2 className="h-3.5 w-3.5 text-blue-300" />
                                    <span>Save Example (.ts)</span>
                                </button>
                            )}

                            {/* 4. Vitest Unit Tests Actions if present */}
                            {testBlock && (
                                <button
                                    onClick={() => handleSaveSnippetToFile(testBlock.code, testBlock.language)}
                                    disabled={isStreaming}
                                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600 hover:text-white text-[11px] font-bold border border-emerald-500/40 transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Save unit tests to tests/contracts/"
                                >
                                    <FlaskConical className="h-3.5 w-3.5 text-emerald-300" />
                                    <span>Save Tests (.ts)</span>
                                </button>
                            )}

                            {/* 5. Export DApp Bundle for Gemini */}
                            <button
                                onClick={() => setIsExportModalOpen(true)}
                                disabled={isStreaming}
                                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600/30 via-purple-600/30 to-cyan-600/30 text-cyan-200 hover:text-white hover:from-indigo-600 hover:to-cyan-600 text-[11px] font-bold border border-cyan-500/40 transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                                title="Export full DApp bundle (.zip) with ZKIR and master prompt for Gemini"
                            >
                                <PackageCheck className="h-3.5 w-3.5 text-cyan-300" />
                                <span>Export for Gemini (.zip)</span>
                            </button>
                        </div>
                    </div>
                )}

                {parts.map((part, index) => {
                    const block = blocks[index];
                    const meta = block ? detectFileMeta(block.code, block.language, filename) : null;

                    return (
                        <React.Fragment key={index}>
                            {part.trim() && (
                                <div className="whitespace-pre-wrap font-sans text-slate-200">{part.trim()}</div>
                            )}
                            {block && meta && (
                                <div className="rounded-xl border border-indigo-500/30 bg-midnight-950 overflow-hidden shadow-lg my-2">
                                    {/* Code Block Header with exact file target */}
                                    <div className="flex items-center justify-between bg-midnight-900/90 px-3 py-1.5 border-b border-white/5 text-[11px]">
                                        <div className="flex items-center space-x-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${meta.badgeColor}`}>
                                                {meta.typeLabel}
                                            </span>
                                            <span className="font-mono text-slate-300 text-[11px]">
                                                {meta.folder}/{meta.filename}
                                            </span>
                                        </div>

                                        <div className="flex items-center space-x-1.5">
                                            {/* Apply to Monaco Editor Button (if compact code) */}
                                            {meta.isCompact && (
                                                <button
                                                    onClick={() => {
                                                        onApplyCodeToEditor(block.code);
                                                        toast.success(
                                                            'Applied to Editor',
                                                            'Contract code updated in Monaco Editor.'
                                                        );
                                                    }}
                                                    disabled={isStreaming}
                                                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-600/40 text-indigo-200 hover:bg-indigo-600 text-[10px] font-semibold border border-indigo-500/40 transition-colors cursor-pointer disabled:opacity-50"
                                                    title="Replace current Monaco Editor code with this snippet"
                                                >
                                                    <ArrowDownToLine className="h-3 w-3" />
                                                    <span>Apply to Editor</span>
                                                </button>
                                            )}

                                            {/* Save to Workspace File */}
                                            <button
                                                onClick={() =>
                                                    handleSaveSnippetToFile(block.code, block.language)
                                                }
                                                disabled={isStreaming}
                                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600 hover:text-white text-[10px] font-semibold border border-emerald-500/40 transition-colors cursor-pointer disabled:opacity-50"
                                                title={`Save to workspace as ${meta.folder}/${meta.filename}`}
                                            >
                                                <Save className="h-3 w-3 text-emerald-400" />
                                                <span>Save File</span>
                                            </button>

                                            {/* Download button */}
                                            <button
                                                onClick={() =>
                                                    handleDownloadSnippet(block.code, block.language)
                                                }
                                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-midnight-800 text-slate-300 hover:text-white text-[10px] border border-white/10 transition-colors cursor-pointer"
                                                title={`Download as ${meta.filename}`}
                                            >
                                                <Download className="h-3 w-3 text-slate-400" />
                                                <span>Download</span>
                                            </button>

                                            {/* Copy code button */}
                                            <button
                                                onClick={() =>
                                                    copyToClipboard(block.code, `${msgId}-${index}`)
                                                }
                                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-midnight-800 text-slate-300 hover:text-white text-[10px] border border-white/10 transition-colors cursor-pointer"
                                                title="Copy code to clipboard"
                                            >
                                                {copiedIndex === `${msgId}-${index}` ? (
                                                    <>
                                                        <Check className="h-3 w-3 text-emerald-400" />
                                                        <span className="text-emerald-400">Copied</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="h-3 w-3 text-slate-400" />
                                                        <span>Copy</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 bg-midnight-950/80 leading-snug">
                                        <code>{block.code}</code>
                                    </pre>
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        );
    };

    const hasCompilerError =
        compilerResult?.success === false ||
        (compilerResult?.diagnostics && compilerResult.diagnostics.length > 0);

    return (
        <div className="flex flex-col h-full bg-midnight-950/60 overflow-hidden">
            {/* Copilot Header */}
            <div className="flex items-center justify-between border-b border-white/10 bg-midnight-950/90 px-4 py-2.5">
                <div className="flex items-center space-x-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-sm shadow-indigo-500/30">
                        <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                        <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-xs text-white">Gemini 3.7 Flash</span>
                            <span className="rounded-full bg-indigo-500/10 text-indigo-300 px-1.5 py-0.2 text-[10px] font-mono border border-indigo-500/30">
                                Copilot
                            </span>
                            <span
                                className="rounded-full bg-emerald-500/10 text-emerald-300 px-1.5 py-0.2 text-[10px] font-mono border border-emerald-500/30 flex items-center space-x-1"
                                title="Midnight Expert Skills (.agents/plugins) dynamically injected"
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span>Expert Skills</span>
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center space-x-1">
                    <button
                        onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        className={`p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors ${
                            isSettingsOpen ? 'bg-indigo-600/30 text-indigo-200' : 'hover:bg-midnight-900'
                        }`}
                        title="AI Settings & API Key"
                    >
                        <Settings className="h-4 w-4" />
                    </button>
                    <button
                        onClick={handleClearChat}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-midnight-900 transition-colors"
                        title="Clear chat history"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* API Key & Settings Drawer */}
            {isSettingsOpen && (
                <div className="border-b border-indigo-500/30 bg-midnight-900/95 p-3.5 space-y-3 animate-in slide-in-from-top-2 duration-150">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-200">
                            <Key className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Gemini API Key Configuration</span>
                        </div>
                        <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                        >
                            <span>Get free key</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                    </div>

                    <div className="space-y-1.5">
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="AIzaSy... (Leave blank to use server GEMINI_API_KEY)"
                            className="w-full rounded-lg bg-midnight-950 px-3 py-1.5 text-xs font-mono text-cyan-300 border border-white/10 focus:border-indigo-500 focus:outline-none"
                        />
                        <p className="text-[10px] text-slate-400">
                            Keys entered here are securely saved in your local browser storage.
                        </p>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center space-x-2">
                            <span className="text-[11px] text-slate-400">Model:</span>
                            <select
                                value={selectedModel}
                                onChange={(e) => saveModel(e.target.value)}
                                className="rounded-lg bg-midnight-950 px-2 py-1 text-xs text-slate-200 border border-white/10 focus:outline-none"
                            >
                                <option value="gemini-3.7-flash">Gemini 3.7 Flash (Recommended)</option>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            </select>
                        </div>

                        <button
                            onClick={() => saveApiKey(apiKey)}
                            className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors shadow-sm"
                        >
                            Save Settings
                        </button>
                    </div>
                </div>
            )}

            {/* Quick Action Prompt Chips */}
            <div className="border-b border-white/5 bg-midnight-900/40 p-2.5 flex flex-wrap gap-1.5">
                {hasCompilerError && (
                    <button
                        onClick={() => handleSendAction('fix_error')}
                        disabled={isStreaming}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-600/20 text-rose-300 border border-rose-500/40 text-[11px] font-semibold hover:bg-rose-600/30 transition-all animate-pulse"
                    >
                        <AlertCircle className="h-3 w-3 text-rose-400" />
                        <span>Fix Compiler Error</span>
                    </button>
                )}

                <button
                    onClick={() => handleSendAction('generate_client')}
                    disabled={isStreaming}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-medium hover:bg-indigo-600/30 hover:text-white transition-colors"
                >
                    <Zap className="h-3 w-3 text-indigo-400" />
                    <span>Generate Client SDK</span>
                </button>

                <button
                    onClick={() => handleSendAction('generate_tests')}
                    disabled={isStreaming}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium hover:bg-emerald-600/30 hover:text-white transition-colors cursor-pointer"
                    title="Generate Vitest unit tests for this contract"
                >
                    <FlaskConical className="h-3 w-3 text-emerald-400" />
                    <span>Generate Tests</span>
                </button>

                <button
                    onClick={() => {
                        if (onRunTests) {
                            onRunTests();
                        } else if (onSwitchTab) {
                            onSwitchTab('tests');
                        }
                    }}
                    disabled={isRunningTests || isStreaming || isAgentRunning}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[11px] font-semibold hover:bg-emerald-500/30 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Run Vitest circuit unit tests (Ctrl+T)"
                >
                    {isRunningTests ? (
                        <RefreshCw className="h-3 w-3 animate-spin text-emerald-400" />
                    ) : (
                        <Play className="h-3 w-3 text-emerald-400 fill-current" />
                    )}
                    <span>{isRunningTests ? 'Running Tests...' : 'Run Tests'}</span>
                </button>

                <button
                    onClick={handleRunAutoTestAgent}
                    disabled={isStreaming || isAgentRunning || isRunningTests}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-cyan-600/30 via-indigo-600/30 to-purple-600/30 text-cyan-200 border border-cyan-500/40 text-[11px] font-bold hover:from-cyan-600/40 hover:to-purple-600/40 hover:text-white transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Autonomous Loop: Compiles, generates/runs tests, and auto-heals failures with Gemini until 100% pass"
                >
                    {isAgentRunning ? (
                        <RefreshCw className="h-3 w-3 animate-spin text-cyan-300" />
                    ) : (
                        <Repeat className="h-3 w-3 text-cyan-300" />
                    )}
                    <span>{isAgentRunning ? 'Agent Running...' : 'Auto-Test Agent'}</span>
                </button>

                <button
                    onClick={() => handleSendAction('audit_zk')}
                    disabled={isStreaming}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-medium hover:bg-cyan-600/30 hover:text-white transition-colors"
                >
                    <Shield className="h-3 w-3 text-cyan-400" />
                    <span>Audit ZK</span>
                </button>

                <button
                    onClick={() => handleSendAction('explain')}
                    disabled={isStreaming}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-midnight-800 text-slate-300 border border-white/5 text-[11px] font-medium hover:bg-midnight-700 hover:text-white transition-colors"
                >
                    <HelpCircle className="h-3 w-3 text-slate-400" />
                    <span>Explain</span>
                </button>
            </div>

            {/* Active Agent Loop Progress Banner */}
            {isAgentRunning && (
                <div className="bg-gradient-to-r from-cyan-950/60 via-indigo-950/60 to-purple-950/60 border-b border-cyan-500/30 px-3.5 py-2 flex items-center justify-between text-xs text-cyan-200 animate-pulse">
                    <div className="flex items-center space-x-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                        <span className="font-medium">{agentStatus || 'Agent loop active...'}</span>
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/80 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                        Auto-Heal
                    </span>
                </div>
            )}

            {/* Chat Messages Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[250px]">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex flex-col ${
                            msg.role === 'user' ? 'items-end' : 'items-start'
                        }`}
                    >
                        <div className="flex items-center space-x-1.5 mb-1 px-1">
                            {msg.role === 'user' ? (
                                <>
                                    <span className="text-[10px] text-slate-400">You</span>
                                    <User className="h-3 w-3 text-indigo-400" />
                                </>
                            ) : (
                                <>
                                    <Bot className="h-3 w-3 text-cyan-400" />
                                    <span className="text-[10px] text-slate-400">Gemini 3.7 Flash</span>
                                </>
                            )}
                        </div>

                        <div
                            className={`rounded-2xl px-4 py-3 max-w-[95%] shadow-md ${
                                msg.role === 'user'
                                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-none'
                                    : 'bg-midnight-900/90 text-slate-200 border border-white/10 rounded-tl-none'
                            }`}
                        >
                            {msg.content ? (
                                renderMessageContent(msg.content, msg.id, msg.role)
                            ) : (
                                <div className="flex items-center space-x-2 text-xs text-slate-400 py-1">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                                    <span>Thinking and analyzing circuits...</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Context bar & Input Box */}
            <div className="border-t border-white/10 bg-midnight-950/90 p-3 space-y-2">
                {/* Active Context indicator */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                    <div className="flex items-center space-x-1.5 overflow-hidden">
                        <FileCode2 className="h-3 w-3 text-indigo-400 flex-shrink-0" />
                        <span className="font-mono text-slate-300 truncate">{filename}</span>
                        <span>•</span>
                        <span>{sourceCode.split('\n').length} lines</span>
                    </div>

                    {hasCompilerError && (
                        <span className="text-rose-400 font-semibold flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                            Compiler errors in context
                        </span>
                    )}
                </div>

                {/* Chat Input Bar */}
                <div className="relative flex items-center">
                    <textarea
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendAction('chat');
                            }
                        }}
                        placeholder="Ask Gemini about this contract or requested circuits... (Enter to send)"
                        rows={2}
                        disabled={isStreaming}
                        className="w-full resize-none rounded-xl bg-midnight-900 px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 border border-white/10 focus:border-indigo-500 focus:outline-none pr-20"
                    />

                    <div className="absolute right-2 flex items-center space-x-1.5">
                        {isStreaming ? (
                            <button
                                onClick={handleStopStream}
                                className="p-1.5 rounded-lg bg-rose-600/30 text-rose-300 border border-rose-500/40 hover:bg-rose-600 text-xs transition-colors"
                                title="Stop generation"
                            >
                                Stop
                            </button>
                        ) : (
                            <button
                                onClick={() => handleSendAction('chat')}
                                disabled={!inputPrompt.trim()}
                                className="p-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all cursor-pointer"
                                title="Send message"
                            >
                                <Send className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Export DApp Bundle for Gemini Modal */}
            <ExportDappModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                contractFilename={contractFilename || filename}
            />
        </div>
    );
}

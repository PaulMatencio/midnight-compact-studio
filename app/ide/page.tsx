'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
    Play,
    Sparkles,
    FileCode2,
    CheckCircle2,
    AlertCircle,
    Copy,
    Check,
    Download,
    RefreshCw,
    Terminal,
    Shield,
    Zap,
    Rocket,
    Code2,
    FilePlus,
    Flame,
    Cpu,
    Maximize2,
    Minimize2,
    Folder,
    FolderOpen,
    HardDrive,
    Save,
    Upload,
    X,
    FlaskConical,
    Undo2,
    Redo2,
    Plus,
    ShieldCheck,
    Scale,
    FolderTree,
    AlertTriangle,
    PackageCheck,
} from 'lucide-react';
import type { OnMount } from '@monaco-editor/react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useToast } from '@/src/presentation/context/ToastContext';
import {
    COMPACT_LANGUAGE_ID,
    compactLanguageDefinition,
    compactLanguageConfiguration,
    compactTheme,
} from '@/src/infrastructure/ide/compact-monarch';
import { COMPACT_TEMPLATES, CompactTemplate } from '@/src/infrastructure/ide/compact-templates';
import { AiCopilotPanel } from '@/components/AiCopilotPanel';
import { FormalVerificationPanel } from '@/components/FormalVerificationPanel';
import type { FormalVerificationReport } from '@/app/api/compiler/verify/route';
import { FileExplorer } from '@/components/FileExplorer';
import type { WorkspaceFileNode } from '@/app/api/workspace/files/route';
import { ExportDappModal } from '@/components/ExportDappModal';

// Dynamically import Monaco to prevent SSR issues
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type OutputTab = 'console' | 'dts' | 'circuits' | 'js' | 'tests' | 'verify' | 'ai';

interface WorkspaceFile {
    name: string;
    relativePath: string;
    sizeBytes: number;
    updatedAt: string;
}

export default function CompactIdePage() {
    const toast = useToast();
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Editor state
    const [selectedTemplate, setSelectedTemplate] = useState<CompactTemplate>(COMPACT_TEMPLATES[0]);
    const [filename, setFilename] = useState<string>(COMPACT_TEMPLATES[0].filename);
    const [sourceCode, setSourceCode] = useState<string>(COMPACT_TEMPLATES[0].code);
    const [isDirty, setIsDirty] = useState<boolean>(false);
    const lastSavedContentRef = useRef<string>(COMPACT_TEMPLATES[0].code);

    // Track the last active .compact contract so AI actions retain contract context when browsing other files
    const lastCompactContractRef = useRef<{ filename: string; code: string }>({
        filename: COMPACT_TEMPLATES[0].filename,
        code: COMPACT_TEMPLATES[0].code,
    });

    useEffect(() => {
        if (filename.endsWith('.compact')) {
            lastCompactContractRef.current = {
                filename,
                code: sourceCode,
            };
        }
    }, [filename, sourceCode]);

    const [skipZk, setSkipZk] = useState<boolean>(false);
    const [persistToManaged, setPersistToManaged] = useState<boolean>(true);
    const [isCompiling, setIsCompiling] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isExplorerOpen, setIsExplorerOpen] = useState<boolean>(true);
    const [activeFilePath, setActiveFilePath] = useState<string>('contracts/fungible-token.compact');
    const [activeLanguage, setActiveLanguage] = useState<string>('compact');

    // Workspace files loading state
    const [isOpenModalOpen, setIsOpenModalOpen] = useState<boolean>(false);
    const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);

    // Compilation result state
    const [compilationResult, setCompilationResult] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<OutputTab>('circuits');
    const [copiedDts, setCopiedDts] = useState<boolean>(false);

    // Test runner state
    const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
    const [testResult, setTestResult] = useState<any>(null);

    // Formal Verification state
    const [isVerifying, setIsVerifying] = useState<boolean>(false);
    const [verificationReport, setVerificationReport] = useState<FormalVerificationReport | null>(null);

    // Export / Save As Modal State
    const [isSaveAsModalOpen, setIsSaveAsModalOpen] = useState<boolean>(false);
    const [saveAsFilename, setSaveAsFilename] = useState<string>(COMPACT_TEMPLATES[0].filename);
    const [saveAsFolder, setSaveAsFolder] = useState<string>('contracts');
    const [isSavingWorkspace, setIsSavingWorkspace] = useState<boolean>(false);

    // Export DApp Bundle Modal State
    const [isExportDappModalOpen, setIsExportDappModalOpen] = useState<boolean>(false);

    // Unsaved Changes Confirmation Modal State
    const [isUnsavedModalOpen, setIsUnsavedModalOpen] = useState<boolean>(false);
    const [pendingFileAction, setPendingFileAction] = useState<(() => void | Promise<void>) | null>(null);
    const [pendingTargetName, setPendingTargetName] = useState<string>('');
    const [isSavingBeforeLoad, setIsSavingBeforeLoad] = useState<boolean>(false);

    // Hydration mount state
    const [isMounted, setIsMounted] = useState<boolean>(false);

    // Resizable Split-Pane State (percentage width for left editor pane)
    const [leftPanelWidth, setLeftPanelWidth] = useState<number>(56);
    const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
    const splitWorkspaceRef = useRef<HTMLDivElement>(null);

    // Resizable File Explorer State (pixel width for left explorer sidebar)
    const [explorerWidth, setExplorerWidth] = useState<number>(260);
    const [isDraggingExplorerSplitter, setIsDraggingExplorerSplitter] = useState<boolean>(false);
    const leftSubContainerRef = useRef<HTMLDivElement>(null);

    // Keep refs for Monaco keyboard command bindings
    const handleQuickSaveRef = useRef<() => void>(() => { });
    const handleRunTestsRef = useRef<() => void>(() => { });

    // Restore editor workspace session & split layout from localStorage once mounted on client
    useEffect(() => {
        setIsMounted(true);
        try {
            const handoverCode = localStorage.getItem('compact_editor_code');
            const handoverFile = localStorage.getItem('compact_active_file');
            if (handoverCode && handoverFile) {
                const cleanName = handoverFile.split('/').pop() || handoverFile;
                localStorage.setItem('midnight_ide_source_code', handoverCode);
                localStorage.setItem('midnight_ide_filename', cleanName);
                localStorage.setItem('midnight_ide_is_dirty', 'true');
                localStorage.removeItem('compact_editor_code');
                localStorage.removeItem('compact_active_file');
            }

            const savedCode = localStorage.getItem('midnight_ide_source_code');
            const savedFilename = localStorage.getItem('midnight_ide_filename');
            const savedTab = localStorage.getItem('midnight_ide_active_tab') as OutputTab | null;
            const savedDirty = localStorage.getItem('midnight_ide_is_dirty');
            const savedSplitWidth = localStorage.getItem('midnight_ide_split_width');
            const savedLastSaved = localStorage.getItem('midnight_ide_last_saved_code');

            if (savedCode && savedFilename) {
                setSourceCode(savedCode);
                setFilename(savedFilename);
                setSaveAsFilename(savedFilename);
                lastSavedContentRef.current = savedLastSaved !== null ? savedLastSaved : savedCode;
                const matched = COMPACT_TEMPLATES.find((t) => t.filename === savedFilename);
                if (matched) setSelectedTemplate(matched);
                if (editorRef.current) {
                    editorRef.current.setValue(savedCode);
                }
            } else {
                lastSavedContentRef.current = savedLastSaved !== null ? savedLastSaved : COMPACT_TEMPLATES[0].code;
            }
            if (savedDirty !== null) {
                const isActuallyDirty = savedCode !== null && savedCode !== lastSavedContentRef.current;
                setIsDirty(isActuallyDirty);
            }
            if (savedTab) {
                setActiveTab(savedTab);
            }
            if (savedSplitWidth) {
                const parsed = parseFloat(savedSplitWidth);
                if (!isNaN(parsed) && parsed >= 25 && parsed <= 75) {
                    setLeftPanelWidth(parsed);
                }
            }
            const savedExplorer = localStorage.getItem('midnight_ide_explorer_open');
            if (savedExplorer !== null) {
                setIsExplorerOpen(savedExplorer === 'true');
            }
            const savedExplorerWidth = localStorage.getItem('midnight_ide_explorer_width');
            if (savedExplorerWidth) {
                const parsed = parseInt(savedExplorerWidth, 10);
                if (!isNaN(parsed) && parsed >= 180 && parsed <= 600) {
                    setExplorerWidth(parsed);
                }
            }
            const savedActiveFile = localStorage.getItem('midnight_ide_active_filepath');
            if (savedActiveFile) {
                setActiveFilePath(savedActiveFile);
            }
            const savedActiveLang = localStorage.getItem('midnight_ide_active_language');
            if (savedActiveLang) {
                setActiveLanguage(savedActiveLang);
            }
        } catch {
            // Ignore localStorage errors
        }
    }, []);

    // Global keyboard shortcuts (Ctrl+B / Cmd+B for File Explorer)
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                setIsExplorerOpen((prev) => {
                    const next = !prev;
                    try {
                        localStorage.setItem('midnight_ide_explorer_open', String(next));
                    } catch { }
                    return next;
                });
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    // Split pane mouse drag listener for smooth horizontal resizing
    useEffect(() => {
        if (!isDraggingSplitter) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!splitWorkspaceRef.current) return;
            const containerRect = splitWorkspaceRef.current.getBoundingClientRect();
            const relativeX = e.clientX - containerRect.left;
            const newPercentage = (relativeX / containerRect.width) * 100;
            const clamped = Math.min(Math.max(newPercentage, 25), 75);
            setLeftPanelWidth(clamped);
            try {
                localStorage.setItem('midnight_ide_split_width', clamped.toString());
            } catch { }
        };

        const handleMouseUp = () => {
            setIsDraggingSplitter(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingSplitter]);

    // File Explorer mouse drag listener for horizontal resizing
    useEffect(() => {
        if (!isDraggingExplorerSplitter) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!leftSubContainerRef.current) return;
            const containerRect = leftSubContainerRef.current.getBoundingClientRect();
            const relativeX = e.clientX - containerRect.left;
            const minWidth = 180;
            const maxWidth = Math.max(minWidth, containerRect.width - 240);
            const clamped = Math.round(Math.min(Math.max(relativeX, minWidth), Math.min(maxWidth, 600)));
            setExplorerWidth(clamped);
            try {
                localStorage.setItem('midnight_ide_explorer_width', clamped.toString());
            } catch { }
        };

        const handleMouseUp = () => {
            setIsDraggingExplorerSplitter(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingExplorerSplitter]);

    // Persist editor workspace session to localStorage ONLY after client has mounted
    useEffect(() => {
        if (!isMounted) return;
        try {
            if (sourceCode) {
                localStorage.setItem('midnight_ide_source_code', sourceCode);
            }
            if (filename) {
                localStorage.setItem('midnight_ide_filename', filename);
            }
            localStorage.setItem('midnight_ide_is_dirty', String(isDirty));
            if (activeTab) {
                localStorage.setItem('midnight_ide_active_tab', activeTab);
            }
        } catch {
            // Ignore
        }
    }, [isMounted, sourceCode, filename, isDirty, activeTab]);

    // Prevent accidental navigation/tab closing when there are unsaved edits
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    // Quick Save (to activeFilePath or contracts/<filename>)
    const handleQuickSave = async (): Promise<boolean> => {
        if (!sourceCode.trim()) {
            toast.error('Save Error', 'Source code cannot be empty.');
            return false;
        }

        setIsSaving(true);
        try {
            const targetPath = activeFilePath || (filename.includes('/') ? filename : `contracts/${filename}`);
            const res = await fetch('/api/workspace/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: targetPath,
                    content: sourceCode,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to save file');
            }

            setIsDirty(false);
            lastSavedContentRef.current = sourceCode;
            try {
                localStorage.setItem('midnight_ide_is_dirty', 'false');
                localStorage.setItem('midnight_ide_last_saved_code', sourceCode);
            } catch { }
            toast.success('File Saved', `Saved to ${data.data.path}`);
            return true;
        } catch (err: any) {
            console.error('Quick save failed:', err);
            toast.error('Save Failed', err.message || 'Could not save file to workspace');
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // Helper to guard file/template loading when the editor has unsaved changes
    const confirmIfUnsaved = (action: () => void | Promise<void>, targetDescription: string) => {
        const hasUnsavedEdits = isDirty && sourceCode !== lastSavedContentRef.current;
        if (hasUnsavedEdits) {
            setPendingFileAction(() => action);
            setPendingTargetName(targetDescription);
            setIsUnsavedModalOpen(true);
            return;
        }
        // If content has not actually changed, ensure isDirty is false and proceed immediately
        setIsDirty(false);
        try {
            localStorage.setItem('midnight_ide_is_dirty', 'false');
        } catch { }
        action();
    };

    const handleConfirmSaveAndLoad = async () => {
        if (!pendingFileAction) return;
        setIsSavingBeforeLoad(true);
        try {
            const saved = await handleQuickSave();
            if (saved) {
                const actionToRun = pendingFileAction;
                setPendingFileAction(null);
                setIsUnsavedModalOpen(false);
                await actionToRun();
            }
        } finally {
            setIsSavingBeforeLoad(false);
        }
    };

    const handleConfirmDiscardAndLoad = async () => {
        if (!pendingFileAction) return;
        setIsDirty(false);
        try {
            localStorage.setItem('midnight_ide_is_dirty', 'false');
        } catch { }
        const actionToRun = pendingFileAction;
        setPendingFileAction(null);
        setIsUnsavedModalOpen(false);
        await actionToRun();
    };

    const handleCancelUnsavedModal = () => {
        setPendingFileAction(null);
        setPendingTargetName('');
        setIsUnsavedModalOpen(false);
    };

    // Apply code suggested by Gemini AI Copilot to Monaco Editor & auto-recompile
    const handleApplyAiCode = async (newCode: string) => {
        setSourceCode(newCode);
        setIsDirty(true);
        try {
            localStorage.setItem('midnight_ide_source_code', newCode);
            localStorage.setItem('midnight_ide_is_dirty', 'true');
        } catch {
            // Ignore
        }
        if (editorRef.current) {
            const model = editorRef.current.getModel();
            if (model) {
                editorRef.current.executeEdits('ai-copilot', [
                    {
                        range: model.getFullModelRange(),
                        text: newCode,
                        forceMoveMarkers: true,
                    },
                ]);
                editorRef.current.pushUndoStop();
            } else {
                editorRef.current.setValue(newCode);
            }
        }
        updateEditorMarkers([]);
        setCompilationResult(null);

        // Auto-recompile to verify fix and clear previous error state
        setIsCompiling(true);
        toast.info('Fix Applied', 'Recompiling contract to verify fix...');
        try {
            const res = await fetch('/api/compiler/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCode: newCode,
                    filename,
                    skipZk,
                    persistToManaged,
                }),
            });

            const data = await res.json();
            setCompilationResult(data);

            if (data.success) {
                updateEditorMarkers([]);
                const msg = data.managedPath
                    ? `Compiled in ${data.durationMs}ms & saved to ./${data.managedPath}`
                    : `Compiled in ${data.durationMs}ms with ${data.circuits?.length || 0} circuit(s)`;
                toast.success('Fix Verified & Compiled!', msg);
                setActiveTab('circuits');
            } else {
                updateEditorMarkers(data.diagnostics || []);
                toast.error('Compilation Still Has Issues', `${data.diagnostics?.length || 1} error(s) found`);
            }
        } catch (err: any) {
            console.error('Re-compilation after fix failed:', err);
        } finally {
            setIsCompiling(false);
        }
    };

    // Setup Monaco syntax highlighting on editor mount & register keybindings
    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Register Compact Language & Grammar
        if (!monaco.languages.getLanguages().some((lang: any) => lang.id === COMPACT_LANGUAGE_ID)) {
            monaco.languages.register({ id: COMPACT_LANGUAGE_ID });
            monaco.languages.setMonarchTokensProvider(COMPACT_LANGUAGE_ID, compactLanguageDefinition);
            monaco.languages.setLanguageConfiguration(COMPACT_LANGUAGE_ID, compactLanguageConfiguration);
            monaco.editor.defineTheme('compact-midnight-dark', compactTheme);
        }
        monaco.editor.setTheme('compact-midnight-dark');

        // Bind Ctrl+S / Cmd+S to Quick Save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            handleQuickSaveRef.current?.();
        });

        // Bind Ctrl+T / Cmd+T to Run Tests
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, () => {
            handleRunTestsRef.current?.();
        });

        // Bind Ctrl+B / Cmd+B to Toggle Explorer
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
            setIsExplorerOpen((prev) => {
                const next = !prev;
                try {
                    localStorage.setItem('midnight_ide_explorer_open', String(next));
                } catch { }
                return next;
            });
        });

        // Ensure Monaco editor displays the cached source code if already loaded
        try {
            const savedCode = localStorage.getItem('midnight_ide_source_code');
            if (savedCode && savedCode !== editor.getValue()) {
                editor.setValue(savedCode);
            }
        } catch {
            // Ignore
        }
    };

    // Update markers (squiggles) in Monaco on error diagnostics
    const updateEditorMarkers = useCallback((diagnostics: any[]) => {
        if (!monacoRef.current || !editorRef.current) return;
        const monaco = monacoRef.current;
        const model = editorRef.current.getModel();
        if (!model) return;

        const markers = diagnostics.map((d) => ({
            startLineNumber: d.line || 1,
            startColumn: d.column || 1,
            endLineNumber: d.line || 1,
            endColumn: (d.column || 1) + 10,
            message: d.message,
            severity: monaco.MarkerSeverity.Error,
        }));

        monaco.editor.setModelMarkers(model, 'compact-compiler', markers);
    }, []);

    // Template switcher
    const handleSelectTemplate = (tmpl: CompactTemplate) => {
        confirmIfUnsaved(() => {
            setSelectedTemplate(tmpl);
            setFilename(tmpl.filename);
            setSaveAsFilename(tmpl.filename);
            const targetPath = `contracts/${tmpl.filename}`;
            setActiveFilePath(targetPath);
            setActiveLanguage('compact');
            lastSavedContentRef.current = tmpl.code;
            setSourceCode(tmpl.code);
            setIsDirty(false);
            setCompilationResult(null);
            try {
                localStorage.setItem('midnight_ide_source_code', tmpl.code);
                localStorage.setItem('midnight_ide_filename', tmpl.filename);
                localStorage.setItem('midnight_ide_active_filepath', targetPath);
                localStorage.setItem('midnight_ide_active_language', 'compact');
                localStorage.setItem('midnight_ide_is_dirty', 'false');
                localStorage.setItem('midnight_ide_last_saved_code', tmpl.code);
            } catch {
                // Ignore
            }
            if (editorRef.current) {
                editorRef.current.setValue(tmpl.code);
            }
            if (monacoRef.current && editorRef.current) {
                const model = editorRef.current.getModel();
                if (model) {
                    monacoRef.current.editor.setModelMarkers(model, 'compact-compiler', []);
                }
            }
            toast.info('Template Loaded', tmpl.title);
        }, tmpl.title);
    };

    // Open a fresh new Compact file initialized with pragma & CompactStandardLibrary
    const handleNewCompactFile = () => {
        confirmIfUnsaved(() => {
            const newCode = `pragma language_version >= 0.23;

import CompactStandardLibrary;
`;
            const newFilename = 'my-contract.compact';
            const targetPath = `contracts/${newFilename}`;
            setFilename(newFilename);
            setSaveAsFilename(newFilename);
            setActiveFilePath(targetPath);
            setActiveLanguage('compact');
            lastSavedContentRef.current = newCode;
            setSourceCode(newCode);
            setIsDirty(false);
            setCompilationResult(null);
            setSelectedTemplate({
                id: 'blank',
                title: 'Blank Contract',
                description: 'Clean starter with language pragma and Compact standard library.',
                filename: newFilename,
                code: newCode,
            });

            if (editorRef.current) {
                editorRef.current.setValue(newCode);
                editorRef.current.focus();
                // Move cursor to line 4
                editorRef.current.setPosition({ lineNumber: 4, column: 1 });
            }

            if (monacoRef.current && editorRef.current) {
                const model = editorRef.current.getModel();
                if (model) {
                    monacoRef.current.editor.setModelMarkers(model, 'compact-compiler', []);
                }
            }

            try {
                localStorage.setItem('midnight_ide_source_code', newCode);
                localStorage.setItem('midnight_ide_filename', newFilename);
                localStorage.setItem('midnight_ide_active_filepath', targetPath);
                localStorage.setItem('midnight_ide_active_language', 'compact');
                localStorage.setItem('midnight_ide_is_dirty', 'false');
                localStorage.setItem('midnight_ide_last_saved_code', newCode);
            } catch {
                // Ignore
            }

            toast.success('New Compact File Opened', 'Initialized with pragma >= 0.23 and CompactStandardLibrary');
        }, 'New Contract');
    };

    // Fetch workspace files from contracts directory
    const fetchWorkspaceFiles = async () => {
        setIsLoadingFiles(true);
        try {
            const res = await fetch('/api/compiler/files');
            const data = await res.json();
            if (data.success) {
                setWorkspaceFiles(data.data || []);
            }
        } catch (err) {
            console.warn('Failed to fetch workspace files:', err);
        } finally {
            setIsLoadingFiles(false);
        }
    };

    const openLoadModal = () => {
        fetchWorkspaceFiles();
        setIsOpenModalOpen(true);
    };

    // Load file from workspace
    const handleLoadWorkspaceFile = async (relativePath: string) => {
        confirmIfUnsaved(async () => {
            try {
                const res = await fetch(`/api/compiler/files?file=${encodeURIComponent(relativePath)}`);
                const data = await res.json();
                if (data.success && data.data?.content !== undefined) {
                    const targetPath = `contracts/${relativePath}`;
                    setFilename(data.data.filename);
                    setSaveAsFilename(data.data.filename);
                    setActiveFilePath(targetPath);
                    setActiveLanguage('compact');
                    lastSavedContentRef.current = data.data.content;
                    setSourceCode(data.data.content);
                    setIsDirty(false);
                    setCompilationResult(null);
                    setIsOpenModalOpen(false);
                    try {
                        localStorage.setItem('midnight_ide_source_code', data.data.content);
                        localStorage.setItem('midnight_ide_filename', data.data.filename);
                        localStorage.setItem('midnight_ide_active_filepath', targetPath);
                        localStorage.setItem('midnight_ide_active_language', 'compact');
                        localStorage.setItem('midnight_ide_is_dirty', 'false');
                        localStorage.setItem('midnight_ide_last_saved_code', data.data.content);
                    } catch {
                        // Ignore
                    }
                    if (editorRef.current) {
                        editorRef.current.setValue(data.data.content);
                    }
                    toast.success('Contract Loaded', `Loaded ${targetPath}`);
                } else {
                    throw new Error(data.error || 'Failed to read contract content');
                }
            } catch (err: any) {
                toast.error('Load Failed', err.message || 'Could not load contract file');
            }
        }, relativePath);
    };

    // Load file from workspace explorer (contracts, sdk, examples, docs, scripts, modules, tests, utils)
    const handleSelectWorkspaceFile = async (node: WorkspaceFileNode) => {
        if (activeFilePath === node.path) return;
        confirmIfUnsaved(async () => {
            try {
                const res = await fetch(`/api/workspace/files?file=${encodeURIComponent(node.path)}`);
                const data = await res.json();
                if (data.success && data.data?.content !== undefined) {
                    setActiveFilePath(data.data.path);
                    setFilename(data.data.filename);
                    setSaveAsFilename(data.data.filename);
                    lastSavedContentRef.current = data.data.content;
                    setSourceCode(data.data.content);
                    setActiveLanguage(data.data.language || 'plaintext');
                    setIsDirty(false);
                    setCompilationResult(null);

                    try {
                        localStorage.setItem('midnight_ide_source_code', data.data.content);
                        localStorage.setItem('midnight_ide_filename', data.data.filename);
                        localStorage.setItem('midnight_ide_active_filepath', data.data.path);
                        localStorage.setItem('midnight_ide_active_language', data.data.language || 'plaintext');
                        localStorage.setItem('midnight_ide_is_dirty', 'false');
                        localStorage.setItem('midnight_ide_last_saved_code', data.data.content);
                    } catch {
                        // Ignore
                    }

                    if (editorRef.current) {
                        editorRef.current.setValue(data.data.content);
                    }

                    updateEditorMarkers([]);
                    toast.success('Loaded File', data.data.path);
                } else {
                    throw new Error(data.error || 'Failed to read file content');
                }
            } catch (err: any) {
                toast.error('Load Failed', err.message || 'Could not load workspace file');
            }
        }, node.name);
    };

    // Open from local disk (Native File Picker or input fallback)
    const handleNativeFileOpen = async () => {
        confirmIfUnsaved(async () => {
            if ('showOpenFilePicker' in window) {
                try {
                    const [fileHandle] = await (window as any).showOpenFilePicker({
                        types: [
                            {
                                description: 'Compact Smart Contract (*.compact)',
                                accept: {
                                    'text/plain': ['.compact', '.txt'],
                                },
                            },
                        ],
                        multiple: false,
                    });
                    const file = await fileHandle.getFile();
                    const content = await file.text();
                    const targetPath = file.name.includes('/') ? file.name : `contracts/${file.name}`;
                    setFilename(file.name);
                    setSaveAsFilename(file.name);
                    setActiveFilePath(targetPath);
                    setActiveLanguage('compact');
                    lastSavedContentRef.current = content;
                    setSourceCode(content);
                    setIsDirty(false);
                    setCompilationResult(null);
                    setIsOpenModalOpen(false);
                    try {
                        localStorage.setItem('midnight_ide_source_code', content);
                        localStorage.setItem('midnight_ide_filename', file.name);
                        localStorage.setItem('midnight_ide_active_filepath', targetPath);
                        localStorage.setItem('midnight_ide_active_language', 'compact');
                        localStorage.setItem('midnight_ide_is_dirty', 'false');
                        localStorage.setItem('midnight_ide_last_saved_code', content);
                    } catch { }
                    if (editorRef.current) {
                        editorRef.current.setValue(content);
                    }
                    toast.success('File Loaded', `Loaded ${file.name}`);
                    return;
                } catch (err: any) {
                    if (err.name === 'AbortError') return;
                    console.warn('showOpenFilePicker error, using input fallback:', err);
                }
            }

            // Fallback to hidden file input
            fileInputRef.current?.click();
        }, 'Local File');
    };

    // File input fallback change handler
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        confirmIfUnsaved(() => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                const targetPath = file.name.includes('/') ? file.name : `contracts/${file.name}`;
                setFilename(file.name);
                setSaveAsFilename(file.name);
                setActiveFilePath(targetPath);
                setActiveLanguage('compact');
                lastSavedContentRef.current = content || '';
                setSourceCode(content || '');
                setIsDirty(false);
                setCompilationResult(null);
                setIsOpenModalOpen(false);
                try {
                    localStorage.setItem('midnight_ide_source_code', content || '');
                    localStorage.setItem('midnight_ide_filename', file.name);
                    localStorage.setItem('midnight_ide_active_filepath', targetPath);
                    localStorage.setItem('midnight_ide_active_language', 'compact');
                    localStorage.setItem('midnight_ide_is_dirty', 'false');
                    localStorage.setItem('midnight_ide_last_saved_code', content || '');
                } catch { }
                if (editorRef.current) {
                    editorRef.current.setValue(content || '');
                }
                toast.success('File Loaded', `Loaded ${file.name}`);
            };
            reader.readAsText(file);
        }, file.name);

        e.target.value = '';
    };

    // Trigger Compilation
    const handleCompile = async () => {
        if (!sourceCode.trim()) {
            toast.error('Compiler Error', 'Source code cannot be empty.');
            return;
        }

        setIsCompiling(true);
        try {
            const res = await fetch('/api/compiler/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCode,
                    filename,
                    skipZk,
                    persistToManaged,
                }),
            });

            const data = await res.json();
            setCompilationResult(data);

            if (data.success) {
                updateEditorMarkers([]);
                const msg = data.managedPath
                    ? `Compiled in ${data.durationMs}ms & saved to ./${data.managedPath}`
                    : `Compiled in ${data.durationMs}ms with ${data.circuits?.length || 0} circuit(s)`;
                toast.success('Compilation Succeeded!', msg);
                if (activeTab === 'console') {
                    setActiveTab('circuits');
                }
            } else {
                updateEditorMarkers(data.diagnostics || []);
                toast.error('Compilation Failed', `${data.diagnostics?.length || 1} error(s) found`);
                setActiveTab('console');
            }
        } catch (err: any) {
            console.error('Compilation request failed:', err);
            toast.error('Compiler Error', err.message || 'Failed to reach compiler endpoint');
        } finally {
            setIsCompiling(false);
        }
    };

    // Run Circuit Unit Tests (Current Contract or All Available Tests)
    const handleRunTests = async (runAll: boolean = false) => {
        setIsRunningTests(true);
        setActiveTab('tests');
        try {
            const cleanContractName = filename.replace(/\.compact$/, '');
            const res = await fetch('/api/compiler/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contractType: cleanContractName,
                    filename,
                    all: runAll,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to run circuit tests');
            }
            setTestResult(data.data);

            if (data.data.testAvailable === false) {
                toast.info(
                    'No Tests Available',
                    `No test suite found for ${filename}. Click below to generate tests with AI Copilot.`
                );
            } else if (data.data.failedTests === 0) {
                toast.success(
                    runAll ? 'All Project Tests Passed!' : 'Circuit Tests Passed!',
                    `All ${data.data.totalTests} test(s) passed in ${data.data.totalDurationMs}ms.`
                );
            } else {
                toast.error(
                    'Tests Failed',
                    `${data.data.failedTests} of ${data.data.totalTests} test(s) failed.`
                );
            }
        } catch (err: any) {
            toast.error('Test Execution Failed', err.message || 'Unknown error');
            setTestResult({
                error: err.message,
                failedTests: 1,
                totalTests: 1,
                passedTests: 0,
                totalDurationMs: 0,
                suites: [],
            });
        } finally {
            setIsRunningTests(false);
        }
    };

    // Run Formal Verification (SMT-LIB2 / Z3 symbolic analysis)
    const handleRunFormalVerification = async () => {
        setIsVerifying(true);
        setActiveTab('verify');
        try {
            const res = await fetch('/api/compiler/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceCode,
                    filename: filename,
                }),
            });
            const data = await res.json();
            if (data.success && data.data) {
                setVerificationReport(data.data);
                toast.success(
                    'Formal Verification Complete',
                    `${data.data.summary.proven} of ${data.data.summary.totalProperties} properties mathematically proven`
                );
            } else {
                toast.error('Verification Failed', data.error || 'Could not verify contract');
            }
        } catch (err: any) {
            toast.error('Verification Error', err.message);
        } finally {
            setIsVerifying(false);
        }
    };

    // Keep refs in sync for Monaco editor keybindings
    useEffect(() => {
        handleQuickSaveRef.current = handleQuickSave;
        handleRunTestsRef.current = handleRunTests;
    });

    // Format code (basic indentation)
    const handleFormat = () => {
        if (editorRef.current) {
            editorRef.current.getAction('editor.action.formatDocument')?.run();
            toast.info('Formatted', 'Code formatted');
        }
    };

    // Undo action for Monaco Editor
    const handleUndo = () => {
        if (editorRef.current) {
            editorRef.current.focus();
            editorRef.current.trigger('toolbar', 'undo', null);
            toast.info('Undo', 'Reverted last edit');
        }
    };

    // Redo action for Monaco Editor
    const handleRedo = () => {
        if (editorRef.current) {
            editorRef.current.focus();
            editorRef.current.trigger('toolbar', 'redo', null);
            toast.info('Redo', 'Restored next edit');
        }
    };

    // Jump to line from diagnostic
    const handleJumpToLine = (line: number, col: number) => {
        if (editorRef.current) {
            editorRef.current.revealPositionInCenter({ lineNumber: line, column: col });
            editorRef.current.setPosition({ lineNumber: line, column: col });
            editorRef.current.focus();
        }
    };

    const copyDts = () => {
        if (compilationResult?.files?.dts) {
            navigator.clipboard.writeText(compilationResult.files.dts);
            setCopiedDts(true);
            toast.info('Copied', 'TypeScript declaration copied to clipboard');
            setTimeout(() => setCopiedDts(false), 2000);
        }
    };

    const openSaveAsModal = () => {
        const safeName = filename.endsWith('.compact') ? filename : `${filename}.compact`;
        setSaveAsFilename(safeName);
        setIsSaveAsModalOpen(true);
    };

    // Save As: Native System File & Folder Picker
    const handleNativeFilePickerSaveAs = async () => {
        const safeFilename = saveAsFilename.trim().endsWith('.compact')
            ? saveAsFilename.trim()
            : `${saveAsFilename.trim()}.compact`;

        if ('showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: safeFilename,
                    types: [
                        {
                            description: 'Compact Smart Contract (*.compact)',
                            accept: {
                                'text/plain': ['.compact'],
                            },
                        },
                    ],
                });
                const writable = await handle.createWritable();
                await writable.write(sourceCode);
                await writable.close();
                setFilename(handle.name);
                lastSavedContentRef.current = sourceCode;
                setIsDirty(false);
                try {
                    localStorage.setItem('midnight_ide_is_dirty', 'false');
                    localStorage.setItem('midnight_ide_last_saved_code', sourceCode);
                } catch { }
                toast.success('Contract Saved', `Saved to ${handle.name}`);
                setIsSaveAsModalOpen(false);
                return;
            } catch (err: any) {
                if (err.name === 'AbortError') return;
                console.warn('showSaveFilePicker error, falling back to download:', err);
            }
        }

        // Fallback standard download
        handleStandardDownload();
    };

    // Save As: Save to Workspace Directory via Server API
    const handleSaveAsWorkspace = async () => {
        const safeFilename = saveAsFilename.trim().endsWith('.compact')
            ? saveAsFilename.trim()
            : `${saveAsFilename.trim()}.compact`;

        setIsSavingWorkspace(true);
        try {
            const res = await fetch('/api/compiler/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceCode,
                    filename: safeFilename,
                    folder: saveAsFolder.trim() || 'contracts',
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to save to workspace folder');
            }

            setFilename(data.data.filename);
            const savedPath = `${data.data.folder}/${data.data.filename}`;
            setActiveFilePath(savedPath);
            lastSavedContentRef.current = sourceCode;
            setIsDirty(false);
            try {
                localStorage.setItem('midnight_ide_active_filepath', savedPath);
                localStorage.setItem('midnight_ide_filename', data.data.filename);
                localStorage.setItem('midnight_ide_is_dirty', 'false');
                localStorage.setItem('midnight_ide_last_saved_code', sourceCode);
            } catch { }
            toast.success(
                'Saved to Workspace Folder',
                `Saved as ${data.data.folder}/${data.data.filename}`
            );
            setIsSaveAsModalOpen(false);
        } catch (err: any) {
            console.error('Save to workspace failed:', err);
            toast.error('Save Failed', err.message || 'Error saving file to workspace');
        } finally {
            setIsSavingWorkspace(false);
        }
    };

    // Save As: Browser Direct Download
    const handleStandardDownload = () => {
        const safeFilename = saveAsFilename.trim().endsWith('.compact')
            ? saveAsFilename.trim()
            : `${saveAsFilename.trim()}.compact`;
        const blob = new Blob([sourceCode], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeFilename;
        a.click();
        URL.revokeObjectURL(url);
        setFilename(safeFilename);
        lastSavedContentRef.current = sourceCode;
        setIsDirty(false);
        try {
            localStorage.setItem('midnight_ide_is_dirty', 'false');
            localStorage.setItem('midnight_ide_last_saved_code', sourceCode);
        } catch { }
        toast.success('Contract Saved', `Downloaded ${safeFilename}`);
        setIsSaveAsModalOpen(false);
    };

    return (
        <div className="mx-auto max-w-8xl w-full px-4 py-6 sm:px-6 space-y-6 flex flex-col min-h-[calc(100vh-5rem)]">
            <Breadcrumbs />

            {/* Header & Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex items-center space-x-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25">
                        <Code2 className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="flex items-center space-x-2">
                            <h1 className="text-2xl font-bold tracking-tight text-white">
                                Compact Web Studio & IDE
                            </h1>
                            <span className="rounded-full bg-indigo-500/10 text-indigo-300 px-2.5 py-0.5 text-xs font-semibold border border-indigo-500/30">
                                In-Browser Compiler
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Author, test, and compile Zero-Knowledge smart contracts for Midnight.
                        </p>
                    </div>
                </div>

                {/* Top Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    {/* Hidden file input fallback */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileInputChange}
                        accept=".compact,.txt"
                        className="hidden"
                    />

                    {/* New Contract Button */}
                    <button
                        onClick={handleNewCompactFile}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 px-3 py-2 text-xs font-semibold text-slate-300 border border-white/10 hover:bg-midnight-800 hover:text-white transition-colors cursor-pointer shadow-sm"
                        title="Create a new Compact contract (initialized with pragma >= 0.23 & CompactStandardLibrary)"
                    >
                        <FilePlus className="h-3.5 w-3.5 text-cyan-400" />
                        <span>New File</span>
                    </button>

                    {/* Explorer Toggle Button */}
                    <button
                        onClick={() => {
                            const next = !isExplorerOpen;
                            setIsExplorerOpen(next);
                            try {
                                localStorage.setItem('midnight_ide_explorer_open', String(next));
                            } catch { }
                        }}
                        className={`inline-flex items-center space-x-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition-all cursor-pointer ${isExplorerOpen
                                ? 'bg-indigo-600/30 text-white border-indigo-500/50 shadow-md shadow-indigo-950/40'
                                : 'bg-midnight-900/90 text-slate-400 hover:text-white border-white/5 hover:border-white/20'
                            }`}
                        title="Toggle File System Explorer (contracts, sdk, examples, docs, scripts, modules, tests, utils) [Ctrl+B]"
                    >
                        <FolderTree className="h-4 w-4 text-indigo-400" />
                        <span>Explorer</span>
                    </button>

                    {/* Open from Workspace / Disk Button */}
                    <button
                        onClick={openLoadModal}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 px-3 py-2 text-xs font-semibold text-slate-300 border border-white/10 hover:bg-midnight-800 transition-colors cursor-pointer"
                        title="Open .compact file from workspace or local disk"
                    >
                        <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Open...</span>
                    </button>

                    {/* Quick Save Button (Ctrl+S) */}
                    <button
                        onClick={handleQuickSave}
                        disabled={isSaving}
                        className={`inline-flex items-center space-x-1.5 rounded-xl px-3 py-2 text-xs font-semibold border transition-colors cursor-pointer ${isDirty
                                ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/50 hover:bg-indigo-600/40 shadow-sm'
                                : 'bg-midnight-900 text-slate-300 border-white/10 hover:bg-midnight-800'
                            }`}
                        title="Save to workspace contracts/ folder (Ctrl+S)"
                    >
                        <Save className="h-3.5 w-3.5 text-emerald-400" />
                        <span>{isSaving ? 'Saving...' : 'Save'}</span>
                        {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
                    </button>

                    {/* Save As Button */}
                    <button
                        onClick={openSaveAsModal}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 px-3 py-2 text-xs font-semibold text-slate-300 border border-white/10 hover:bg-midnight-800 transition-colors cursor-pointer"
                        title="Save as a new .compact file or select destination folder"
                    >
                        <Download className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Save As...</span>
                    </button>

                    {/* Undo / Redo Toolbar Controls */}
                    <div className="flex items-center space-x-1 bg-midnight-900 rounded-xl p-1 border border-white/10">
                        <button
                            onClick={handleUndo}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white hover:bg-midnight-800 rounded-lg transition-colors cursor-pointer"
                            title="Undo changes (Ctrl+Z / ⌘Z)"
                        >
                            <Undo2 className="h-3.5 w-3.5 text-indigo-400" />
                            <span className="hidden sm:inline">Undo</span>
                        </button>
                        <button
                            onClick={handleRedo}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white hover:bg-midnight-800 rounded-lg transition-colors cursor-pointer"
                            title="Redo changes (Ctrl+Y / ⌘⇧Z)"
                        >
                            <Redo2 className="h-3.5 w-3.5 text-indigo-400" />
                            <span className="hidden sm:inline">Redo</span>
                        </button>
                    </div>

                    <button
                        onClick={handleFormat}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 px-3 py-2 text-xs font-semibold text-slate-300 border border-white/10 hover:bg-midnight-800 transition-colors cursor-pointer"
                        title="Format Compact code"
                    >
                        <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="hidden sm:inline">Format</span>
                    </button>

                    {/* Skip ZK Prover toggle for lightning fast debugging */}
                    <label className="flex items-center space-x-2 text-xs text-slate-400 bg-midnight-900/90 px-3 py-2 rounded-xl border border-white/5 cursor-pointer hover:border-white/10 select-none">
                        <input
                            type="checkbox"
                            checked={skipZk}
                            onChange={(e) => setSkipZk(e.target.checked)}
                            className="rounded bg-midnight-950 border-white/20 text-indigo-600 focus:ring-0 h-3.5 w-3.5"
                        />
                        <span title="Skip generating proving keys for faster TS type checking">
                            Fast Mode (--skip-zk)
                        </span>
                    </label>

                    {/* Persist to contracts/managed toggle */}
                    <label className="flex items-center space-x-2 text-xs text-slate-300 bg-midnight-900/90 px-3 py-2 rounded-xl border border-white/5 cursor-pointer hover:border-white/10 select-none">
                        <input
                            type="checkbox"
                            checked={persistToManaged}
                            onChange={(e) => setPersistToManaged(e.target.checked)}
                            className="rounded bg-midnight-950 border-white/20 text-indigo-600 focus:ring-0 h-3.5 w-3.5"
                        />
                        <span title="Save compiled artifacts to contracts/managed/<name>">
                            Sync to <code className="text-cyan-300 font-mono">contracts/managed/</code>
                        </span>
                    </label>

                    {/* Compile Button */}
                    <button
                        onClick={handleCompile}
                        disabled={isCompiling}
                        className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                        {isCompiling ? (
                            <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                <span>Compiling Circuits...</span>
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 fill-current" />
                                <span>Compile Contract</span>
                            </>
                        )}
                    </button>

                    {/* Highly Visible AI Copilot Button */}
                    <button
                        onClick={() => setActiveTab('ai')}
                        className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2 text-xs font-bold shadow-lg transition-all cursor-pointer ${activeTab === 'ai'
                                ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-indigo-500/30 scale-[1.02] ring-2 ring-indigo-400'
                                : 'bg-gradient-to-r from-purple-600/40 via-indigo-600/40 to-cyan-500/40 text-indigo-100 border border-indigo-500/60 hover:from-purple-600 hover:to-cyan-500 hover:text-white shadow-indigo-950/50 hover:scale-[1.02]'
                            }`}
                        title="Open Gemini 3.7 Flash AI Copilot"
                    >
                        <Sparkles className="h-4 w-4 text-cyan-300 animate-pulse" />
                        <span>AI Copilot</span>
                        <span className="rounded-full bg-cyan-400/20 text-cyan-200 text-[10px] px-1.5 py-0.2 border border-cyan-400/40 font-mono">
                            3.7 Flash
                        </span>
                    </button>

                    {/* 3. Run Tests for Current Contract (Ctrl+T) */}
                    <button
                        onClick={() => handleRunTests(false)}
                        disabled={isRunningTests || isCompiling}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-3.5 py-2 text-xs font-bold shadow-lg shadow-emerald-950/30 hover:bg-emerald-600/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                        title={`Run circuit unit tests for ${filename} (Ctrl+T)`}
                    >
                        {isRunningTests ? (
                            <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                                <span>Running Tests...</span>
                            </>
                        ) : (
                            <>
                                <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />
                                <span>Run Tests</span>
                            </>
                        )}
                    </button>

                    {/* 4. Formal Verification Button (SMT / Z3) */}
                    <button
                        onClick={handleRunFormalVerification}
                        disabled={isVerifying || isCompiling}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 px-3.5 py-2 text-xs font-bold shadow-lg shadow-cyan-950/30 hover:bg-cyan-600/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                        title="Formally verify ZK constraints & ledger invariants (SMT/Z3)"
                    >
                        {isVerifying ? (
                            <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                                <span>Verifying...</span>
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                                <span>Verify (FV)</span>
                            </>
                        )}
                    </button>

                    {/* 5. Deploy Button */}
                    <Link
                        href={`/deploy?contract=${encodeURIComponent(filename.replace(/\.compact$/, ''))}`}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-950/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                        title="Deploy this contract to Midnight Preprod"
                    >
                        <Rocket className="h-3.5 w-3.5" />
                        <span>Deploy</span>
                    </Link>

                    {/* 6. Export DApp Bundle for Gemini */}
                    <button
                        onClick={() => setIsExportDappModalOpen(true)}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-gradient-to-r from-indigo-600/30 via-purple-600/30 to-cyan-600/30 hover:from-indigo-600/50 hover:to-cyan-600/50 text-cyan-200 border border-cyan-500/40 hover:border-cyan-400 px-3 py-2 text-xs font-bold transition-all cursor-pointer shadow-sm hover:shadow-cyan-500/20"
                        title="Export all compiled artifacts, ZKIR bytecodes, and master prompt for Gemini to scaffold the frontend"
                    >
                        <PackageCheck className="h-3.5 w-3.5 text-cyan-300" />
                        <span>Export for Gemini</span>
                    </button>

                    {/* 7. Run All Available Tests */}
                    <button
                        onClick={() => handleRunTests(true)}
                        disabled={isRunningTests || isCompiling}
                        className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900/90 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/60 px-3 py-2 text-xs font-medium hover:bg-emerald-950/40 hover:text-emerald-200 transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                        title="Run all available test suites across the repository"
                    >
                        <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />
                        <span>All Tests</span>
                    </button>
                </div>
            </div>

            {/* Template Selector Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-midnight-900/60 p-3 rounded-2xl border border-white/5">
                <div className="flex items-center space-x-2 overflow-x-auto pb-1 sm:pb-0">
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider whitespace-nowrap mr-1">
                        Templates:
                    </span>
                    {COMPACT_TEMPLATES.map((tmpl) => (
                        <button
                            key={tmpl.id}
                            onClick={() => handleSelectTemplate(tmpl)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${selectedTemplate.id === tmpl.id
                                    ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 shadow-inner'
                                    : 'bg-midnight-950 text-slate-400 hover:text-white border border-white/5'
                                }`}
                        >
                            {tmpl.title}
                        </button>
                    ))}

                    <button
                        onClick={handleNewCompactFile}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all bg-indigo-600/20 text-cyan-300 hover:text-white border border-indigo-500/40 hover:bg-indigo-600/30 cursor-pointer shadow-sm ml-1"
                        title="Open a fresh new Compact file with pragma >= 0.23 and CompactStandardLibrary"
                    >
                        <Plus className="h-3.5 w-3.5 text-cyan-400" />
                        <span>New Contract</span>
                    </button>
                </div>

                <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400">File:</span>
                    <input
                        type="text"
                        value={filename}
                        onChange={(e) => {
                            const newName = e.target.value;
                            setFilename(newName);
                            setSaveAsFilename(newName);
                            setIsDirty(true);
                            if (activeFilePath) {
                                const parentDir = activeFilePath.includes('/')
                                    ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
                                    : 'contracts';
                                setActiveFilePath(`${parentDir}/${newName}`);
                            } else {
                                setActiveFilePath(`contracts/${newName}`);
                            }
                        }}
                        className="rounded-lg bg-midnight-950 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-white/10 focus:border-indigo-500 focus:outline-none w-48"
                        placeholder="filename.compact"
                    />
                </div>
            </div>

            {/* Main IDE Workspace: Resizable Split-Pane (Left: Editor / Right: Studio) */}
            <div
                ref={splitWorkspaceRef}
                className={`flex flex-col lg:flex-row items-stretch gap-0 flex-1 min-h-[560px] relative ${isDraggingSplitter || isDraggingExplorerSplitter ? 'select-none cursor-col-resize' : ''
                    }`}
                style={{
                    ['--left-pane-width' as any]: `${leftPanelWidth}%`,
                }}
            >
                {/* Left: Editor & File Explorer Sub-container */}
                <div
                    ref={leftSubContainerRef}
                    className="flex flex-col lg:flex-row items-stretch gap-1 min-h-[500px] w-full lg:w-[calc(var(--left-pane-width)-8px)]"
                    style={{
                        flexShrink: 0,
                        ['--explorer-width' as any]: `${explorerWidth}px`,
                    }}
                >
                    {/* Collapsible & Resizable File Explorer Sidebar */}
                    {isExplorerOpen && (
                        <>
                            <div className="w-full lg:w-[var(--explorer-width)] flex-shrink-0 rounded-2xl border border-indigo-500/20 bg-midnight-950/90 shadow-2xl overflow-hidden min-h-[350px] lg:min-h-full flex flex-col">
                                <FileExplorer
                                    activeFilePath={activeFilePath || (filename ? `contracts/${filename}` : undefined)}
                                    onSelectFile={handleSelectWorkspaceFile}
                                    onFileCreated={(newNode) => {
                                        toast.success('File Created', newNode.path);
                                    }}
                                    onFileDeleted={(deletedPath) => {
                                        if (activeFilePath === deletedPath) {
                                            setActiveFilePath('');
                                        }
                                        toast.info('File Deleted', deletedPath);
                                    }}
                                />
                            </div>

                            {/* Vertical Resizer Gutter between Explorer and Editor (Desktop lg+) */}
                            <div
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setIsDraggingExplorerSplitter(true);
                                }}
                                onDoubleClick={() => {
                                    setExplorerWidth(260);
                                    try {
                                        localStorage.setItem('midnight_ide_explorer_width', '260');
                                    } catch { }
                                    toast.info('Explorer Reset', 'Reset explorer width to 260px');
                                }}
                                className="hidden lg:flex items-center justify-center w-3 mx-0.5 group cursor-col-resize z-20 select-none flex-shrink-0"
                                title="Drag horizontally to resize File Explorer (Double-click to reset)"
                            >
                                <div
                                    className={`w-1 h-14 rounded-full transition-all duration-150 ${isDraggingExplorerSplitter
                                            ? 'bg-gradient-to-b from-indigo-400 via-cyan-400 to-purple-500 w-1.5 shadow-lg shadow-indigo-500/50 scale-y-110'
                                            : 'bg-white/10 group-hover:bg-indigo-400/80 group-hover:w-1.5 group-hover:shadow-md group-hover:shadow-indigo-400/30'
                                        }`}
                                />
                            </div>
                        </>
                    )}

                    {/* Monaco Editor Card */}
                    <div className={`flex-1 flex flex-col rounded-2xl border border-indigo-500/20 bg-midnight-950/90 shadow-2xl overflow-hidden min-h-[500px] min-w-0 ${isDraggingSplitter || isDraggingExplorerSplitter ? 'pointer-events-none select-none' : ''
                        }`}>
                        {/* Editor Tab Header */}
                        <div className="flex items-center justify-between border-b border-white/10 bg-midnight-900/80 px-4 py-2 text-xs">
                            <div className="flex items-center space-x-2 truncate min-w-0">
                                <FileCode2 className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                                <span className="font-mono text-slate-200 font-medium truncate" title={activeFilePath || filename}>
                                    {activeFilePath || filename}
                                </span>
                                {isDirty ? (
                                    <span className="text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1 flex-shrink-0">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                        <span>Unsaved (Ctrl+S)</span>
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex-shrink-0">
                                        Saved
                                    </span>
                                )}
                                <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 capitalize flex-shrink-0">
                                    {activeLanguage}
                                </span>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                                {/* Editor Tab Quick Undo / Redo */}
                                <div className="flex items-center space-x-0.5 bg-midnight-950/80 rounded-lg p-0.5 border border-white/10 mr-1">
                                    <button
                                        onClick={handleUndo}
                                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                                        title="Undo (Ctrl+Z / ⌘Z)"
                                    >
                                        <Undo2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={handleRedo}
                                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                                        title="Redo (Ctrl+Y / ⌘⇧Z)"
                                    >
                                        <Redo2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <button
                                    onClick={() => setActiveTab('ai')}
                                    className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-purple-600/30 to-indigo-600/30 text-indigo-200 hover:from-purple-600 hover:to-indigo-600 hover:text-white border border-indigo-500/40 text-[11px] font-semibold transition-all shadow-sm"
                                    title="Open Gemini AI Copilot for this code"
                                >
                                    <Sparkles className="h-3 w-3 text-cyan-300" />
                                    <span>Ask Copilot</span>
                                </button>
                                <span className="text-[11px] text-slate-500 font-mono">
                                    {sourceCode.split('\n').length} lines
                                </span>
                            </div>
                        </div>

                        {/* Monaco Editor Container */}
                        <div className="flex-1 w-full min-h-[480px] relative">
                            <Editor
                                height="100%"
                                language={activeLanguage === 'compact' ? COMPACT_LANGUAGE_ID : activeLanguage}
                                value={sourceCode}
                                onChange={(value) => {
                                    const val = value || '';
                                    setSourceCode(val);
                                    const hasChanged = val !== lastSavedContentRef.current;
                                    setIsDirty(hasChanged);
                                    try {
                                        localStorage.setItem('midnight_ide_is_dirty', String(hasChanged));
                                    } catch { }
                                }}
                                onMount={handleEditorDidMount}
                                options={{
                                    fontSize: 13,
                                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
                                    minimap: { enabled: false },
                                    tabSize: 2,
                                    wordWrap: 'on',
                                    automaticLayout: true,
                                    scrollBeyondLastLine: false,
                                    lineNumbers: 'on',
                                    renderLineHighlight: 'all',
                                    padding: { top: 12, bottom: 12 },
                                }}
                                theme="compact-midnight-dark"
                            />
                        </div>
                    </div>
                </div>

                {/* Vertical Resizer Gutter (Desktop lg+) */}
                <div
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsDraggingSplitter(true);
                    }}
                    onDoubleClick={() => {
                        setLeftPanelWidth(56);
                        try {
                            localStorage.setItem('midnight_ide_split_width', '56');
                        } catch { }
                        toast.info('Split Reset', 'Reset editor pane layout to 56% / 44%');
                    }}
                    className="hidden lg:flex items-center justify-center w-4 mx-0.5 group cursor-col-resize z-20 select-none flex-shrink-0"
                    title="Drag horizontally to resize Editor / Studio (Double-click to reset)"
                >
                    <div
                        className={`w-1 h-16 rounded-full transition-all duration-150 ${isDraggingSplitter
                                ? 'bg-gradient-to-b from-cyan-400 via-indigo-500 to-purple-500 w-1.5 shadow-lg shadow-cyan-500/50 scale-y-110'
                                : 'bg-white/10 group-hover:bg-cyan-400/80 group-hover:w-1.5 group-hover:shadow-md group-hover:shadow-cyan-400/30'
                            }`}
                    />
                </div>

                {/* Right: Compiler Output & Artifact Studio */}
                <div className={`flex flex-col rounded-2xl border border-indigo-500/20 bg-midnight-900/70 backdrop-blur-xl shadow-2xl overflow-hidden min-h-[500px] w-full mt-6 lg:mt-0 lg:w-[calc(100%-var(--left-pane-width)-8px)] lg:flex-1 ${isDraggingSplitter || isDraggingExplorerSplitter ? 'pointer-events-none select-none' : ''
                    }`}>
                    {/* Studio Tabs Header */}
                    <div className="flex items-center justify-between border-b border-white/10 bg-midnight-950/80 px-3 py-2 overflow-x-auto">
                        <div className="flex space-x-1 min-w-max">
                            <button
                                onClick={() => setActiveTab('circuits')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'circuits'
                                        ? 'bg-indigo-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <Zap className="h-3.5 w-3.5" />
                                <span>Circuits</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('dts')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'dts'
                                        ? 'bg-indigo-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <FileCode2 className="h-3.5 w-3.5" />
                                <span>Types (.d.ts)</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('console')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'console'
                                        ? 'bg-indigo-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <Terminal className="h-3.5 w-3.5" />
                                <span>Console</span>
                                {compilationResult?.diagnostics?.length > 0 && (
                                    <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white">
                                        {compilationResult.diagnostics.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setActiveTab('js')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'js'
                                        ? 'bg-indigo-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <span>JS Runtime</span>
                            </button>

                            <button
                                onClick={() => setActiveTab('tests')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'tests'
                                        ? 'bg-emerald-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <FlaskConical className="h-3.5 w-3.5" />
                                <span>Tests</span>
                                {testResult && (
                                    <span className={`ml-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[10px] font-bold ${testResult.failedTests === 0
                                            ? 'bg-emerald-400/30 text-emerald-200'
                                            : 'bg-rose-500 text-white'
                                        }`}>
                                        {testResult.failedTests === 0 ? '✓' : testResult.failedTests}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setActiveTab('verify')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'verify'
                                        ? 'bg-cyan-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />
                                <span>Verification</span>
                                {verificationReport && (
                                    <span className="ml-1 flex h-4 px-1 items-center justify-center rounded-full text-[10px] font-bold bg-cyan-400/30 text-cyan-200">
                                        ✓
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setActiveTab('ai')}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${activeTab === 'ai'
                                        ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-indigo-500/30 ring-1 ring-white/20'
                                        : 'bg-indigo-600/30 text-indigo-100 border border-indigo-500/50 hover:bg-indigo-600/50 hover:text-white'
                                    }`}
                            >
                                <Sparkles className="h-3.5 w-3.5 text-cyan-300 animate-pulse" />
                                <span>AI Copilot</span>
                                {(compilationResult?.success === false || (compilationResult?.diagnostics && compilationResult.diagnostics.length > 0)) ? (
                                    <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                                ) : (
                                    <span className="text-[9px] bg-cyan-400/20 text-cyan-300 px-1 py-0.2 rounded font-mono border border-cyan-400/30">
                                        3.7
                                    </span>
                                )}
                            </button>
                        </div>

                        {compilationResult?.success && (
                            <span className="flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Compiled ({compilationResult.durationMs}ms)</span>
                            </span>
                        )}
                    </div>

                    {/* Studio Tab Contents */}
                    <div className="flex-1 p-4 overflow-y-auto space-y-4">
                        {/* Tab 1: Circuits & State Inspector */}
                        {activeTab === 'circuits' && (
                            <div className="space-y-4">
                                {compilationResult?.success ? (
                                    <>
                                        {/* Deployment Handoff Card */}
                                        <div className="rounded-xl bg-gradient-to-br from-indigo-950/60 via-midnight-950 to-midnight-950 border border-indigo-500/30 p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2 text-white font-bold text-sm">
                                                    <Sparkles className="h-4 w-4 text-cyan-400" />
                                                    <span>Ready for Midnight Preprod</span>
                                                </div>
                                                <span className="text-[10px] uppercase font-semibold text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                                    Prover Keys Ready
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                                Your Compact contract compiled successfully with Zero-Knowledge circuits.
                                            </p>
                                            <Link
                                                href="/deploy"
                                                className="inline-flex items-center justify-center space-x-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:scale-[1.01] transition-transform"
                                            >
                                                <Rocket className="h-4 w-4" />
                                                <span>Deploy this Contract in Deploy Studio</span>
                                            </Link>
                                        </div>

                                        {/* Managed Output Path Confirmation */}
                                        {compilationResult.managedPath && (
                                            <div className="rounded-xl bg-midnight-950 p-3.5 border border-indigo-500/20 flex items-start space-x-3 text-xs">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                                <div className="space-y-0.5">
                                                    <span className="font-semibold text-slate-200 block">
                                                        Compiled Artifacts Saved to Workspace
                                                    </span>
                                                    <p className="text-[11px] text-slate-400 font-mono">
                                                        ./{compilationResult.managedPath}/ (contract/index.d.ts, keys, zkir)
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Exported Circuits List */}
                                        <div className="space-y-2">
                                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                                                <Zap className="h-3.5 w-3.5 text-amber-400" />
                                                <span>Exported Circuits ({compilationResult.circuits?.length || 0})</span>
                                            </span>
                                            {compilationResult.circuits?.length > 0 ? (
                                                <div className="space-y-2">
                                                    {compilationResult.circuits.map((c: any) => (
                                                        <div
                                                            key={c.name}
                                                            className="rounded-xl bg-midnight-950 p-3 border border-white/5 space-y-1"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="font-mono text-xs font-bold text-white">
                                                                    {c.name}()
                                                                </span>
                                                                <span className="text-[10px] text-cyan-300 font-mono">
                                                                    ZK Provable
                                                                </span>
                                                            </div>
                                                            <p className="font-mono text-[11px] text-slate-400">
                                                                Params: <code className="text-slate-300">{c.params || '()'}</code>
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs italic text-slate-500">No exported circuits detected.</p>
                                            )}
                                        </div>

                                        {/* Ledger State Fields */}
                                        <div className="space-y-2">
                                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                                                <Shield className="h-3.5 w-3.5 text-cyan-400" />
                                                <span>On-Chain Disclosed State ({compilationResult.stateFields?.length || 0})</span>
                                            </span>
                                            {compilationResult.stateFields?.length > 0 ? (
                                                <div className="space-y-2">
                                                    {compilationResult.stateFields.map((s: any) => (
                                                        <div
                                                            key={s.name}
                                                            className="rounded-xl bg-midnight-950 p-3 border border-white/5 flex items-center justify-between"
                                                        >
                                                            <span className="font-mono text-xs text-slate-200">
                                                                {s.name}
                                                            </span>
                                                            <span className="font-mono text-[11px] text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                                                {s.type}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs italic text-slate-500">No ledger state variables declared.</p>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                                        <FileCode2 className="h-10 w-10 text-slate-600" />
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-300">No Compiled Circuits Yet</h4>
                                            <p className="text-xs text-slate-500 mt-1 max-w-xs">
                                                Click "Compile Contract" above to run the Compact compiler and inspect circuits.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab 2: TypeScript Declaration View */}
                        {activeTab === 'dts' && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400 font-mono">contract/index.d.ts</span>
                                    {compilationResult?.files?.dts && (
                                        <button
                                            onClick={copyDts}
                                            className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-white"
                                        >
                                            {copiedDts ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                            <span>{copiedDts ? 'Copied' : 'Copy'}</span>
                                        </button>
                                    )}
                                </div>
                                <div className="rounded-xl bg-midnight-950 p-3.5 border border-white/5 font-mono text-xs text-slate-200 overflow-x-auto max-h-[460px]">
                                    <pre>{compilationResult?.files?.dts || '// Click "Compile Contract" to generate TypeScript declarations.'}</pre>
                                </div>
                            </div>
                        )}

                        {/* Tab 3: Compiler Console & Diagnostics */}
                        {activeTab === 'console' && (
                            <div className="space-y-3">
                                {/* Error Diagnostics Cards */}
                                {compilationResult?.diagnostics?.length > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-rose-400 flex items-center space-x-1">
                                                <AlertCircle className="h-3.5 w-3.5" />
                                                <span>Compiler Diagnostics ({compilationResult.diagnostics.length})</span>
                                            </span>
                                            <button
                                                onClick={() => setActiveTab('ai')}
                                                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-rose-600 to-purple-600 text-white text-[11px] font-bold shadow hover:scale-105 transition-all cursor-pointer"
                                                title="Open Gemini AI Copilot to automatically diagnose and fix this error"
                                            >
                                                <Sparkles className="h-3 w-3" />
                                                <span>Fix with Gemini 3.7 Flash</span>
                                            </button>
                                        </div>
                                        {compilationResult.diagnostics.map((diag: any, idx: number) => (
                                            <div
                                                key={idx}
                                                onClick={() => handleJumpToLine(diag.line, diag.column)}
                                                className="rounded-xl bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-200 space-y-1 cursor-pointer hover:border-rose-400 transition-colors"
                                            >
                                                <div className="flex items-center justify-between font-mono text-[11px] text-rose-300">
                                                    <span>Line {diag.line}, Col {diag.column}</span>
                                                    <span className="text-[10px] underline">Jump to code</span>
                                                </div>
                                                <p className="leading-relaxed font-sans">{diag.message}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Raw Terminal Output */}
                                <div className="space-y-1.5">
                                    <span className="text-xs font-semibold text-slate-400">Raw Compiler Stream</span>
                                    <div className="rounded-xl bg-midnight-950 p-3.5 border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto max-h-[360px] whitespace-pre-wrap">
                                        {compilationResult?.stdout || compilationResult?.stderr ? (
                                            `${compilationResult.stdout}\n${compilationResult.stderr}`.trim()
                                        ) : (
                                            <span className="text-slate-500">Compact compiler idle. Click "Compile Contract" to run.</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tab 4: JS Runtime Code */}
                        {activeTab === 'js' && (
                            <div className="space-y-3">
                                <span className="text-xs text-slate-400 font-mono">contract/index.js</span>
                                <div className="rounded-xl bg-midnight-950 p-3.5 border border-white/5 font-mono text-xs text-slate-300 overflow-x-auto max-h-[460px]">
                                    <pre>{compilationResult?.files?.js || '// Click "Compile Contract" to view emitted JavaScript runtime.'}</pre>
                                </div>
                            </div>
                        )}

                        {/* Tab 5: Circuit Unit Tests */}
                        {activeTab === 'tests' && (
                            <div className="space-y-4">
                                {testResult ? (
                                    testResult.testAvailable === false ? (
                                        <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl bg-midnight-950/70 border border-amber-500/30 space-y-4 min-h-[320px]">
                                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-inner">
                                                <FlaskConical className="h-7 w-7" />
                                            </div>
                                            <div className="space-y-1.5 max-w-md">
                                                <h4 className="text-base font-bold text-white">
                                                    No Test Suite Found for <span className="text-amber-300 font-mono">{filename}</span>
                                                </h4>
                                                <p className="text-xs text-slate-300 leading-relaxed">
                                                    There is no test file at <code className="text-cyan-300 font-mono bg-white/5 px-1.5 py-0.5 rounded">{testResult.targetTestFile}</code> yet. You can automatically generate a complete Vitest unit test suite using the AI Copilot.
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                                                <button
                                                    onClick={() => setActiveTab('ai')}
                                                    className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                                                >
                                                    <Sparkles className="h-4 w-4 text-cyan-200" />
                                                    <span>Generate Tests with AI Copilot</span>
                                                </button>
                                                <button
                                                    onClick={() => handleRunTests(true)}
                                                    disabled={isRunningTests}
                                                    className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 border border-emerald-500/30 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-midnight-800 hover:border-emerald-500/60 transition-colors cursor-pointer disabled:opacity-50"
                                                >
                                                    <FlaskConical className="h-3.5 w-3.5" />
                                                    <span>Run All Available Tests</span>
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {/* Test Suite Summary Banner */}
                                            <div
                                                className={`rounded-xl p-4 border ${testResult.failedTests === 0
                                                        ? 'bg-emerald-950/40 border-emerald-500/30'
                                                        : 'bg-rose-950/40 border-rose-500/30'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center space-x-2.5">
                                                        {testResult.failedTests === 0 ? (
                                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                                <CheckCircle2 className="h-5 w-5" />
                                                            </div>
                                                        ) : (
                                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                                                <AlertCircle className="h-5 w-5" />
                                                            </div>
                                                        )}
                                                        <div>
                                                            <h4 className="text-sm font-bold text-white">
                                                                {testResult.failedTests === 0
                                                                    ? testResult.isAllTests
                                                                        ? 'All Available Tests Passed'
                                                                        : `${testResult.contractType || filename} Tests Passed`
                                                                    : `${testResult.failedTests} of ${testResult.totalTests} Tests Failed`}
                                                            </h4>
                                                            <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                                                                {testResult.targetTestFile || 'tests/contracts/'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center space-x-2">
                                                        <button
                                                            onClick={() => handleRunTests(false)}
                                                            disabled={isRunningTests}
                                                            className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600/30 border border-emerald-500/40 hover:bg-emerald-600/50 text-emerald-200 text-xs font-semibold px-3 py-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                                            title={`Run tests for ${filename}`}
                                                        >
                                                            <RefreshCw className={`h-3 w-3 ${isRunningTests ? 'animate-spin' : ''}`} />
                                                            <span>Run {filename.replace(/\.compact$/, '')}</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleRunTests(true)}
                                                            disabled={isRunningTests}
                                                            className="inline-flex items-center space-x-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                                            title="Run all test suites across the project"
                                                        >
                                                            <FlaskConical className="h-3 w-3 text-cyan-400" />
                                                            <span>Run All</span>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Summary Stats Row */}
                                                <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-white/10 text-center">
                                                    <div className="bg-midnight-950/70 p-2 rounded-lg border border-white/5">
                                                        <div className="text-[10px] uppercase font-semibold text-slate-400">Total</div>
                                                        <div className="text-sm font-bold text-white">{testResult.totalTests}</div>
                                                    </div>
                                                    <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                                                        <div className="text-[10px] uppercase font-semibold text-emerald-400">Passed</div>
                                                        <div className="text-sm font-bold text-emerald-300">{testResult.passedTests}</div>
                                                    </div>
                                                    <div className="bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                                                        <div className="text-[10px] uppercase font-semibold text-rose-400">Failed</div>
                                                        <div className="text-sm font-bold text-rose-300">{testResult.failedTests}</div>
                                                    </div>
                                                    <div className="bg-midnight-950/70 p-2 rounded-lg border border-white/5">
                                                        <div className="text-[10px] uppercase font-semibold text-slate-400">Duration</div>
                                                        <div className="text-sm font-bold text-cyan-300">{testResult.totalDurationMs}ms</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Test Suites and Test Cases */}
                                            <div className="space-y-3">
                                                {testResult.suites?.map((suite: any, idx: number) => (
                                                    <div key={idx} className="rounded-xl bg-midnight-950/80 border border-white/10 overflow-hidden">
                                                        <div className="flex items-center justify-between bg-midnight-900/90 px-3.5 py-2.5 border-b border-white/5">
                                                            <div className="flex items-center space-x-2">
                                                                <FlaskConical className="h-3.5 w-3.5 text-cyan-400" />
                                                                <span className="font-mono text-xs font-semibold text-slate-200">{suite.name}</span>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 font-mono">{suite.durationMs}ms</span>
                                                        </div>

                                                        <div className="divide-y divide-white/5 p-1">
                                                            {suite.tests?.map((testCase: any, tIdx: number) => (
                                                                <div key={tIdx} className="p-2.5 rounded-lg hover:bg-white/[0.02] transition-colors space-y-1.5">
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div className="flex items-start space-x-2">
                                                                            {testCase.status === 'passed' ? (
                                                                                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                                                            ) : (
                                                                                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                                                                            )}
                                                                            <div>
                                                                                <p className="text-xs font-medium text-slate-200 leading-snug">
                                                                                    {testCase.title}
                                                                                </p>
                                                                                <span className="text-[10px] text-slate-500 font-mono">
                                                                                    {testCase.suite}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                        <span className="text-[10px] text-slate-400 font-mono shrink-0 bg-white/5 px-2 py-0.5 rounded">
                                                                            {testCase.durationMs}ms
                                                                        </span>
                                                                    </div>

                                                                    {testCase.failureMessages?.length > 0 && (
                                                                        <div className="mt-2 p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/30 text-rose-200 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
                                                                            {testCase.failureMessages.join('\n')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl bg-midnight-950/40 border border-white/5 space-y-4 min-h-[300px]">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            <FlaskConical className="h-6 w-6" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-white">No Test Results Yet</h4>
                                            <p className="text-xs text-slate-400 max-w-sm mt-1">
                                                Execute circuit unit tests in-memory to verify Compact assertions, witness execution, and state transitions.
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-center gap-3">
                                            <button
                                                onClick={() => handleRunTests(false)}
                                                disabled={isRunningTests}
                                                className="inline-flex items-center space-x-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 hover:bg-emerald-500 transition-colors cursor-pointer"
                                            >
                                                <Play className="h-3.5 w-3.5 fill-current" />
                                                <span>{isRunningTests ? 'Running Tests...' : `Run ${filename.replace(/\.compact$/, '')} Tests (Ctrl+T)`}</span>
                                            </button>
                                            <button
                                                onClick={() => handleRunTests(true)}
                                                disabled={isRunningTests}
                                                className="inline-flex items-center space-x-1.5 rounded-xl bg-midnight-900 border border-emerald-500/30 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-midnight-800 hover:border-emerald-500/60 transition-colors cursor-pointer"
                                            >
                                                <FlaskConical className="h-3.5 w-3.5" />
                                                <span>Run All Available Tests</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tab 6: Formal Verification (SMT / Z3) */}
                        {activeTab === 'verify' && (
                            <div className="h-full -m-4">
                                <FormalVerificationPanel
                                    sourceCode={sourceCode}
                                    filename={filename}
                                    isVerifying={isVerifying}
                                    onRunVerification={handleRunFormalVerification}
                                    report={verificationReport}
                                />
                            </div>
                        )}

                        {/* Tab 7: AI Copilot */}
                        {activeTab === 'ai' && (
                            <div className="h-full -m-4">
                                <AiCopilotPanel
                                    filename={filename}
                                    sourceCode={sourceCode}
                                    contractFilename={lastCompactContractRef.current.filename}
                                    contractCode={lastCompactContractRef.current.code}
                                    compilerResult={compilationResult}
                                    testResult={testResult}
                                    onApplyCodeToEditor={handleApplyAiCode}
                                    onSwitchTab={(tab) => setActiveTab(tab as OutputTab)}
                                    onRunTests={handleRunTests}
                                    isRunningTests={isRunningTests}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Load / Open Contract Modal */}
            {isOpenModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-midnight-900 border border-cyan-500/30 p-6 shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <div className="flex items-center space-x-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                    <FolderOpen className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white">Open Compact Contract</h3>
                                    <p className="text-[11px] text-slate-400">Load a contract into the studio editor</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsOpenModalOpen(false)}
                                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Open from local computer */}
                        <div
                            onClick={handleNativeFileOpen}
                            className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-900/40 hover:border-cyan-500/60 transition-all cursor-pointer flex items-center justify-between group"
                        >
                            <div className="flex items-center space-x-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 group-hover:scale-105 transition-transform">
                                    <Upload className="h-5 w-5" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-white group-hover:text-cyan-200">
                                        Browse Computer...
                                    </h4>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        Select any <code className="text-cyan-300 font-mono">.compact</code> file from your file system
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs font-semibold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-500/20">
                                Browse
                            </span>
                        </div>

                        {/* Workspace files list */}
                        <div className="space-y-2 pt-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                                    <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
                                    <span>Contracts in Project (<code className="text-indigo-300 font-mono">contracts/</code>)</span>
                                </span>
                                <button
                                    onClick={fetchWorkspaceFiles}
                                    className="text-[11px] text-slate-400 hover:text-white"
                                >
                                    Refresh
                                </button>
                            </div>

                            {isLoadingFiles ? (
                                <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                                    <span>Scanning contracts directory...</span>
                                </div>
                            ) : workspaceFiles.length > 0 ? (
                                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                    {workspaceFiles.map((file) => (
                                        <div
                                            key={file.relativePath}
                                            onClick={() => handleLoadWorkspaceFile(file.relativePath)}
                                            className="p-2.5 rounded-xl border border-white/5 bg-midnight-950 hover:bg-indigo-950/40 hover:border-indigo-500/30 transition-all cursor-pointer flex items-center justify-between group"
                                        >
                                            <div className="flex items-center space-x-2.5 min-w-0">
                                                <FileCode2 className="h-4 w-4 text-indigo-400 shrink-0" />
                                                <div className="truncate">
                                                    <span className="font-mono text-xs font-bold text-slate-200 group-hover:text-indigo-200 block truncate">
                                                        {file.relativePath}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">
                                                        {(file.sizeBytes / 1024).toFixed(1)} KB • {new Date(file.updatedAt).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                className="text-[11px] font-semibold text-indigo-300 bg-indigo-500/10 group-hover:bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0"
                                            >
                                                Load
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs italic text-slate-500 py-3 text-center">
                                    No .compact files found in workspace contracts/ folder.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Save As Modal */}
            {isSaveAsModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-midnight-900 border border-indigo-500/30 p-6 shadow-2xl space-y-5">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                            <div className="flex items-center space-x-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                    <Save className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white">Save Contract As...</h3>
                                    <p className="text-[11px] text-slate-400">Save as a .compact smart contract file</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsSaveAsModalOpen(false)}
                                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* File Details Form */}
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-medium text-slate-300">
                                    File Name <span className="text-rose-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={saveAsFilename}
                                    onChange={(e) => setSaveAsFilename(e.target.value)}
                                    className="w-full rounded-xl bg-midnight-950 border border-white/10 px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                                    placeholder="contract-name.compact"
                                />
                                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                    <span className="text-indigo-400 font-mono">Format:</span>
                                    <span>Compact Smart Contract Source (<code className="text-cyan-300 font-mono">*.compact</code>)</span>
                                </p>
                            </div>

                            {/* Save Options Grid */}
                            <div className="space-y-3 pt-2">
                                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                                    Choose Save Destination:
                                </span>

                                {/* Option 1: Native System Folder Picker */}
                                <div
                                    onClick={handleNativeFilePickerSaveAs}
                                    className="p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/30 hover:bg-indigo-900/40 hover:border-indigo-500/60 transition-all cursor-pointer flex items-start space-x-3 group"
                                >
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 group-hover:scale-105 transition-transform mt-0.5">
                                        <FolderOpen className="h-4.5 w-4.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-bold text-white group-hover:text-indigo-200">
                                                Select Folder on Computer
                                            </h4>
                                            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-semibold">
                                                Native Picker
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            Opens your operating system folder dialog to choose any directory and save with <code className="text-indigo-300 font-mono">.compact</code> extension.
                                        </p>
                                    </div>
                                </div>

                                {/* Option 2: Save directly to Project Workspace Folder */}
                                <div className="p-3.5 rounded-xl border border-white/10 bg-midnight-950/70 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2 text-xs font-bold text-white">
                                            <HardDrive className="h-4 w-4 text-cyan-400" />
                                            <span>Save to Project Workspace Folder</span>
                                        </div>
                                        <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 font-semibold">
                                            Server Folder
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="text"
                                            value={saveAsFolder}
                                            onChange={(e) => setSaveAsFolder(e.target.value)}
                                            placeholder="contracts"
                                            className="flex-1 rounded-lg bg-midnight-900 border border-white/10 px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                                        />
                                        <button
                                            onClick={handleSaveAsWorkspace}
                                            disabled={isSavingWorkspace || !saveAsFolder.trim()}
                                            className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                                        >
                                            {isSavingWorkspace ? 'Saving...' : 'Save Here'}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-500">
                                        Target path: <code className="text-slate-400 font-mono">./{saveAsFolder || 'contracts'}/{saveAsFilename.endsWith('.compact') ? saveAsFilename : `${saveAsFilename}.compact`}</code>
                                    </p>
                                </div>

                                {/* Option 3: Browser Download Fallback */}
                                <div
                                    onClick={handleStandardDownload}
                                    className="p-3 rounded-xl border border-white/5 bg-midnight-950/40 hover:bg-white/5 transition-colors cursor-pointer flex items-center justify-between text-xs text-slate-400 hover:text-white"
                                >
                                    <div className="flex items-center space-x-2">
                                        <Download className="h-3.5 w-3.5 text-slate-400" />
                                        <span>Download to default Downloads folder</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-500">Direct download</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Unsaved Changes Confirmation Modal */}
            {isUnsavedModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
                    <div className="w-full max-w-md rounded-2xl bg-midnight-900 border border-amber-500/40 p-6 shadow-2xl shadow-amber-500/10 space-y-5">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div className="flex items-center space-x-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white">Unsaved Changes</h3>
                                    <p className="text-[11px] text-slate-400">Review unsaved work before proceeding</p>
                                </div>
                            </div>
                            <button
                                onClick={handleCancelUnsavedModal}
                                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                                title="Cancel"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs text-slate-300">
                            <p>
                                You have unsaved changes in{' '}
                                <span className="font-mono text-amber-300 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                    {activeFilePath || filename}
                                </span>
                                .
                            </p>
                            <p className="text-slate-400 leading-relaxed">
                                Loading{' '}
                                <span className="font-mono text-cyan-300 font-medium">
                                    {pendingTargetName || 'another file'}
                                </span>{' '}
                                will replace your current editor content. Do you want to save your changes first or cancel?
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-white/5">
                            <button
                                type="button"
                                onClick={handleCancelUnsavedModal}
                                disabled={isSavingBeforeLoad}
                                className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 border border-white/10 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDiscardAndLoad}
                                disabled={isSavingBeforeLoad}
                                className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:text-white hover:bg-rose-600/30 border border-rose-500/30 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1.5"
                            >
                                <span>Discard Changes</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmSaveAndLoad}
                                disabled={isSavingBeforeLoad}
                                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 shadow-lg shadow-indigo-500/25 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1.5"
                            >
                                {isSavingBeforeLoad ? (
                                    <>
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-3.5 w-3.5" />
                                        <span>Save & Load</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Export DApp Bundle Modal */}
            <ExportDappModal
                isOpen={isExportDappModalOpen}
                onClose={() => setIsExportDappModalOpen(false)}
                contractFilename={lastCompactContractRef.current.filename || filename}
            />
        </div>
    );
}

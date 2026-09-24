'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    Folder,
    FolderOpen,
    FileCode2,
    FileText,
    Terminal,
    Braces,
    Search,
    RefreshCw,
    Plus,
    ChevronDown,
    ChevronRight,
    ChevronsUpDown,
    Check,
    Copy,
    Trash2,
    File,
    Layers,
    Sparkles,
    Shield,
    BookOpen,
    Code,
    Zap,
    FlaskConical,
    X,
} from 'lucide-react';
import { WorkspaceFileNode } from '@/app/api/workspace/files/route';

interface FileExplorerProps {
    activeFilePath?: string;
    onSelectFile: (file: WorkspaceFileNode) => void;
    onDoubleClickFile?: (file: WorkspaceFileNode) => void;
    onFileCreated?: (file: WorkspaceFileNode) => void;
    onFileDeleted?: (path: string) => void;
    className?: string;
}

// Folder visual configuration
const FOLDER_CONFIG: Record<
    string,
    { label: string; icon: React.ComponentType<{ className?: string }>; color: string; badge: string }
> = {
    contracts: {
        label: 'contracts',
        icon: Zap,
        color: 'text-purple-400',
        badge: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    },
    sdk: {
        label: 'sdk',
        icon: Code,
        color: 'text-cyan-400',
        badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
    },
    examples: {
        label: 'examples',
        icon: Sparkles,
        color: 'text-blue-400',
        badge: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    },
    docs: {
        label: 'docs',
        icon: BookOpen,
        color: 'text-rose-400',
        badge: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    },
    scripts: {
        label: 'scripts',
        icon: Terminal,
        color: 'text-emerald-400',
        badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    },
    modules: {
        label: 'modules',
        icon: Layers,
        color: 'text-indigo-400',
        badge: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    },
    tests: {
        label: 'tests',
        icon: FlaskConical,
        color: 'text-amber-400',
        badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    },
    utils: {
        label: 'utils',
        icon: Shield,
        color: 'text-teal-400',
        badge: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
    },
};

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(extension?: string) {
    switch (extension) {
        case '.compact':
            return <Zap className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />;
        case '.ts':
        case '.tsx':
            return <FileCode2 className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />;
        case '.js':
        case '.cjs':
        case '.mjs':
            return <FileCode2 className="h-3.5 w-3.5 text-amber-300 flex-shrink-0" />;
        case '.md':
        case '.markdown':
            return <FileText className="h-3.5 w-3.5 text-rose-400 flex-shrink-0" />;
        case '.json':
            return <Braces className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />;
        case '.sh':
        case '.bash':
            return <Terminal className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />;
        default:
            return <File className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />;
    }
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
    activeFilePath,
    onSelectFile,
    onDoubleClickFile,
    onFileCreated,
    onFileDeleted,
    className = '',
}) => {
    const [tree, setTree] = useState<WorkspaceFileNode[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [copiedPath, setCopiedPath] = useState<string | null>(null);

    // New File Modal State
    const [isNewFileModalOpen, setIsNewFileModalOpen] = useState<boolean>(false);
    const [newFileFolder, setNewFileFolder] = useState<string>('contracts');
    const [newFileName, setNewFileName] = useState<string>('');
    const [isCreatingFile, setIsCreatingFile] = useState<boolean>(false);

    // Delete Confirmation
    const [deletingPath, setDeletingPath] = useState<string | null>(null);

    // Fetch workspace file tree
    const fetchTree = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/workspace/files');
            const data = await res.json();
            if (data.success && data.data?.tree) {
                setTree(data.data.tree);

                // Default: expand top-level folders that have files
                setExpandedFolders((prev) => {
                    const next = { ...prev };
                    data.data.tree.forEach((folder: WorkspaceFileNode) => {
                        if (next[folder.path] === undefined) {
                            next[folder.path] = true; // start expanded
                        }
                    });
                    return next;
                });
            }
        } catch (err) {
            console.error('Failed to load workspace file tree:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTree();
    }, []);

    // Toggle single folder
    const toggleFolder = (folderPath: string) => {
        setExpandedFolders((prev) => ({
            ...prev,
            [folderPath]: !prev[folderPath],
        }));
    };

    // Toggle all folders
    const toggleAllFolders = () => {
        const anyExpanded = Object.values(expandedFolders).some(Boolean);
        const next: Record<string, boolean> = {};
        const applyToggle = (nodes: WorkspaceFileNode[]) => {
            nodes.forEach((node) => {
                if (node.isDir) {
                    next[node.path] = !anyExpanded;
                    if (node.children) applyToggle(node.children);
                }
            });
        };
        applyToggle(tree);
        setExpandedFolders(next);
    };

    // Copy relative path
    const handleCopyPath = (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(filePath);
        setCopiedPath(filePath);
        setTimeout(() => setCopiedPath(null), 1500);
    };

    // Handle Delete
    const handleDeleteFile = async (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to delete ${filePath}?`)) return;

        setDeletingPath(filePath);
        try {
            const res = await fetch(`/api/workspace/files?file=${encodeURIComponent(filePath)}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                onFileDeleted?.(filePath);
                await fetchTree();
            } else {
                alert(data.error || 'Failed to delete file');
            }
        } catch (err: any) {
            alert(err.message || 'Error deleting file');
        } finally {
            setDeletingPath(null);
        }
    };

    // Handle Create File
    const handleCreateFile = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = newFileName.trim();
        if (!trimmedName) return;

        setIsCreatingFile(true);
        const fullRelativePath = `${newFileFolder}/${trimmedName}`;

        // Generate minimal template starter
        let initialContent = '';
        if (trimmedName.endsWith('.compact')) {
            initialContent = `pragma language_version >= 0.23;\n\nimport CompactStandardLibrary;\n\nconstructor() {\n}\n`;
        } else if (trimmedName.endsWith('.ts') || trimmedName.endsWith('.js')) {
            initialContent = `// ${trimmedName}\n`;
        } else if (trimmedName.endsWith('.md')) {
            initialContent = `# ${trimmedName.replace(/\.md$/, '')}\n\n`;
        } else if (trimmedName.endsWith('.json')) {
            initialContent = `{\n  \n}\n`;
        }

        try {
            const res = await fetch('/api/workspace/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: fullRelativePath,
                    content: initialContent,
                }),
            });
            const data = await res.json();
            if (data.success && data.data) {
                const newNode: WorkspaceFileNode = {
                    name: trimmedName,
                    path: fullRelativePath,
                    isDir: false,
                    extension: `.${trimmedName.split('.').pop()}`,
                    sizeBytes: 0,
                    updatedAt: new Date().toISOString(),
                };
                setIsNewFileModalOpen(false);
                setNewFileName('');
                await fetchTree();
                onSelectFile(newNode);
                onFileCreated?.(newNode);
            } else {
                alert(data.error || 'Failed to create file');
            }
        } catch (err: any) {
            alert(err.message || 'Error creating file');
        } finally {
            setIsCreatingFile(false);
        }
    };

    // Filter tree by search query
    const filterNodes = (nodes: WorkspaceFileNode[], query: string): WorkspaceFileNode[] => {
        if (!query) return nodes;
        const lower = query.toLowerCase();

        return nodes
            .map((node) => {
                if (node.isDir) {
                    const filteredChildren = filterNodes(node.children || [], query);
                    if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
                        return { ...node, children: filteredChildren };
                    }
                    return null;
                }
                if (node.name.toLowerCase().includes(lower) || node.path.toLowerCase().includes(lower)) {
                    return node;
                }
                return null;
            })
            .filter(Boolean) as WorkspaceFileNode[];
    };

    const filteredTree = useMemo(() => {
        return filterNodes(tree, searchQuery);
    }, [tree, searchQuery]);

    // Count total files recursively
    const countFiles = (nodes: WorkspaceFileNode[]): number => {
        return nodes.reduce((acc, node) => {
            if (node.isDir) {
                return acc + countFiles(node.children || []);
            }
            return acc + 1;
        }, 0);
    };

    const totalFilesCount = useMemo(() => countFiles(tree), [tree]);

    // Recursive node renderer
    const renderNode = (node: WorkspaceFileNode, level: number = 0) => {
        const isExpanded = searchQuery ? true : Boolean(expandedFolders[node.path]);
        const isActive = activeFilePath === node.path || activeFilePath === node.name;

        if (node.isDir) {
            const isTopLevel = level === 0;
            const folderCfg = isTopLevel ? FOLDER_CONFIG[node.name] : null;
            const Icon = folderCfg?.icon || Folder;
            const fileCount = countFiles(node.children || []);

            return (
                <div key={node.path} className="select-none">
                    <div
                        onClick={() => toggleFolder(node.path)}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            toggleFolder(node.path);
                        }}
                        className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors select-none ${
                            isTopLevel
                                ? 'hover:bg-white/5 text-slate-200 mt-1'
                                : 'hover:bg-white/5 text-slate-300 ml-2'
                        }`}
                        style={{ paddingLeft: `${Math.max(8, level * 14)}px` }}
                    >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1 pointer-events-none">
                            {isExpanded ? (
                                <ChevronDown className="h-3 w-3 text-slate-400 flex-shrink-0" />
                            ) : (
                                <ChevronRight className="h-3 w-3 text-slate-400 flex-shrink-0" />
                            )}
                            {isExpanded ? (
                                <FolderOpen className={`h-3.5 w-3.5 ${folderCfg?.color || 'text-slate-400'} flex-shrink-0`} />
                            ) : (
                                <Icon className={`h-3.5 w-3.5 ${folderCfg?.color || 'text-slate-400'} flex-shrink-0`} />
                            )}
                            <span className="truncate font-mono tracking-tight">{node.name}</span>
                        </div>

                        <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.2 rounded-full bg-white/5 pointer-events-none">
                            {fileCount}
                        </span>
                    </div>

                    {isExpanded && node.children && node.children.length > 0 && (
                        <div className="border-l border-white/5 ml-3 pl-1 space-y-0.5 mt-0.5">
                            {node.children.map((child) => renderNode(child, level + 1))}
                        </div>
                    )}
                </div>
            );
        }

        // File node
        return (
            <div
                key={node.path}
                onClick={() => onSelectFile(node)}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    (onDoubleClickFile || onSelectFile)(node);
                }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-all select-none ${
                    isActive
                        ? 'bg-indigo-600/30 text-white font-semibold border border-indigo-500/40 shadow-sm'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                }`}
                style={{ paddingLeft: `${Math.max(12, level * 14)}px` }}
                title={`${node.path} (${formatBytes(node.sizeBytes)})`}
            >
                <div className="flex items-center space-x-2 min-w-0 flex-1 pointer-events-none">
                    {getFileIcon(node.extension)}
                    <span className="truncate font-mono text-[12px]">{node.name}</span>
                </div>

                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => handleCopyPath(node.path, e)}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                        title="Copy relative path"
                    >
                        {copiedPath === node.path ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                            <Copy className="h-3 w-3" />
                        )}
                    </button>
                    <button
                        onClick={(e) => handleDeleteFile(node.path, e)}
                        disabled={deletingPath === node.path}
                        className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors"
                        title="Delete file"
                    >
                        <Trash2 className="h-3 w-3" />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className={`flex flex-col h-full bg-midnight-950 border-r border-white/10 select-none ${className}`}>
            {/* Header */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between bg-midnight-900/60">
                <div className="flex items-center space-x-2">
                    <Layers className="h-4 w-4 text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Explorer
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                        {totalFilesCount}
                    </span>
                </div>

                <div className="flex items-center space-x-1">
                    <button
                        onClick={() => setIsNewFileModalOpen(true)}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                        title="New File"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={toggleAllFolders}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Toggle Expand/Collapse All"
                    >
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={fetchTree}
                        disabled={isLoading}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                        title="Refresh Workspace Files"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Live Filter Search Bar */}
            <div className="p-2 border-b border-white/5 bg-midnight-950/80">
                <div className="relative flex items-center">
                    <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-midnight-900/90 border border-white/10 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 font-mono transition-colors"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 text-slate-500 hover:text-white p-0.5"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* File Tree Content */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                {isLoading && tree.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 space-y-2 text-slate-500 text-xs">
                        <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
                        <span>Loading workspace...</span>
                    </div>
                ) : filteredTree.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                        {searchQuery ? `No files matching "${searchQuery}"` : 'No files found'}
                    </div>
                ) : (
                    filteredTree.map((topFolder) => renderNode(topFolder, 0))
                )}
            </div>

            {/* New File Modal */}
            {isNewFileModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
                    <div className="bg-midnight-900 border border-indigo-500/30 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Plus className="h-4 w-4 text-cyan-400" />
                                <span>Create New Workspace File</span>
                            </h3>
                            <button
                                onClick={() => setIsNewFileModalOpen(false)}
                                className="text-slate-400 hover:text-white p-1 rounded-lg"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateFile} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                                    Target Folder
                                </label>
                                <select
                                    value={newFileFolder}
                                    onChange={(e) => setNewFileFolder(e.target.value)}
                                    className="w-full bg-midnight-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                                >
                                    {Object.keys(FOLDER_CONFIG).map((f) => (
                                        <option key={f} value={f}>
                                            📁 {f}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                                    File Name
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. MyToken.compact, token-test.ts, readme.md"
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    autoFocus
                                    className="w-full bg-midnight-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono placeholder-slate-600"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">
                                    Full path: <code className="text-cyan-300 font-mono">{newFileFolder}/{newFileName || '...'}</code>
                                </p>
                            </div>

                            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsNewFileModalOpen(false)}
                                    className="px-3 py-1.5 rounded-xl bg-midnight-950 text-slate-400 hover:text-white text-xs border border-white/10 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!newFileName.trim() || isCreatingFile}
                                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md disabled:opacity-50 cursor-pointer transition-all"
                                >
                                    {isCreatingFile ? 'Creating...' : 'Create File'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

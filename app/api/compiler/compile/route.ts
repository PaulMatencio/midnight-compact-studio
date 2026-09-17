import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

interface CompilerDiagnostic {
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning';
}

function parseDiagnostics(output: string): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Matches "line X char Y:" or "line X col Y:"
        const match = line.match(/line\s+(\d+)\s+(?:char|col)\s+(\d+):\s*(.*)/i);
        if (match) {
            const lineNum = parseInt(match[1], 10);
            const colNum = parseInt(match[2], 10);
            let message = match[3].trim();

            // Look ahead for additional message context
            if (i + 1 < lines.length && lines[i + 1].trim().length > 0 && !lines[i + 1].includes('line ')) {
                const nextLine = lines[i + 1].trim();
                message = message ? `${message}: ${nextLine}` : nextLine;
            }

            message = message.replace(/^[\s:-]+/, '');

            diagnostics.push({
                line: lineNum,
                column: colNum,
                message: message || 'Syntax or Type error',
                severity: 'error',
            });
        }
    }

    if (diagnostics.length === 0) {
        for (const line of lines) {
            if (line.toLowerCase().includes('error:') || line.toLowerCase().includes('exception:')) {
                diagnostics.push({
                    line: 1,
                    column: 1,
                    message: line.trim(),
                    severity: 'error',
                });
                break;
            }
        }
    }

    return diagnostics;
}

function extractCircuitsAndState(compactSource: string, dtsContent?: string) {
    const circuits: Array<{ name: string; params: string; returnType: string }> = [];
    const stateFields: Array<{ name: string; type: string }> = [];

    // Extract from compact source
    const circuitRegex = /export\s+circuit\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/g;
    let match;
    while ((match = circuitRegex.exec(compactSource)) !== null) {
        circuits.push({
            name: match[1],
            params: match[2].trim() || 'none',
            returnType: match[3]?.trim() || 'void',
        });
    }

    const stateRegex = /export\s+ledger\s+(\w+)\s*:\s*([^;]+);/g;
    while ((match = stateRegex.exec(compactSource)) !== null) {
        stateFields.push({
            name: match[1],
            type: match[2].trim(),
        });
    }

    return { circuits, stateFields };
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const sandboxId = `compact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspaceRoot = process.cwd();
    const sandboxDir = path.join(workspaceRoot, 'scratch', 'compiler', sandboxId);
    const sourceDir = path.join(sandboxDir, 'src');
    const outDir = path.join(sandboxDir, 'dist');

    try {
        const body = await req.json();
        const { sourceCode, filename = 'contract.compact', skipZk = false, persistToManaged = true } = body;

        if (!sourceCode || typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: 'Source code cannot be empty.' },
                { status: 400 }
            );
        }

        // Create temporary sandbox directory
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.mkdir(outDir, { recursive: true });

        const safeFilename = path.basename(filename).endsWith('.compact')
            ? path.basename(filename)
            : `${path.basename(filename)}.compact`;
        const sourceFilePath = path.join(sourceDir, safeFilename);

        await fs.writeFile(sourceFilePath, sourceCode, 'utf-8');

        // Ensure standard module links exist for relative imports (../security, ../utils, ../modules, etc.)
        const modulesRoot = path.join(workspaceRoot, 'contracts', 'modules');
        const compactTempRoot = path.join(workspaceRoot, '.compact-temp');

        const moduleCategories = ['security', 'utils', 'access', 'token', 'math', 'crypto', 'data-structures', 'identity'];
        for (const cat of moduleCategories) {
            const targetDir = path.join(modulesRoot, cat);
            const linkInTemp = path.join(compactTempRoot, cat);
            const linkInSource = path.join(sourceDir, cat);
            try {
                await fs.symlink(targetDir, linkInTemp).catch(() => {});
                await fs.symlink(targetDir, linkInSource).catch(() => {});
            } catch {}
        }
        try {
            await fs.symlink(modulesRoot, path.join(compactTempRoot, 'modules')).catch(() => {});
            await fs.symlink(modulesRoot, path.join(sourceDir, 'modules')).catch(() => {});
        } catch {}

        // Locate compact compiler executable
        const possiblePaths = [
            '/home/paul/.local/bin/compact',
            'compact',
            'compactc',
        ];

        let compilerBin = 'compact';
        for (const p of possiblePaths) {
            try {
                if (p.startsWith('/')) {
                    await fs.access(p);
                    compilerBin = p;
                    break;
                }
            } catch {
                // Ignore and try next
            }
        }

        // Build command flags: flags must precede source and target directory paths
        const zkFlag = skipZk ? '--skip-zk' : '';
        const compactPathFlag = `--compact-path "${path.join(workspaceRoot, 'contracts')}:${modulesRoot}"`;
        const compileCmd = `${compilerBin} compile ${zkFlag} ${compactPathFlag} "${sourceFilePath}" "${outDir}"`.replace(/\s+/g, ' ');

        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        const timeoutMs = skipZk ? 60000 : 300000;

        try {
            console.log(`[Compiler API] Executing: ${compileCmd}`);
            const execResult = await execAsync(compileCmd, {
                cwd: workspaceRoot,
                timeout: timeoutMs,
                env: {
                    ...process.env,
                    PATH: `${process.env.PATH}:/home/paul/.local/bin:/usr/local/bin`,
                },
            });
            stdout = execResult.stdout || '';
            stderr = execResult.stderr || '';
            console.log(`[Compiler API] Compilation succeeded in ${Date.now() - startTime}ms`);
        } catch (execError: any) {
            exitCode = execError.code || 1;
            stdout = execError.stdout || '';
            stderr = execError.stderr || execError.message || '';

            if (execError.killed || execError.signal === 'SIGTERM') {
                stderr = `Compilation timed out after ${timeoutMs / 1000}s. Generating cryptographic proving keys for ${safeFilename} requires intensive computation. Tip: Check 'Fast Mode (--skip-zk)' in the top toolbar to compile circuits and TypeScript bindings in ~1-2 seconds.`;
            }
            console.warn(`[Compiler API] Compilation exited with code ${exitCode}:`, stderr);
        }

        const combinedOutput = `${stdout}\n${stderr}`.trim();
        const durationMs = Date.now() - startTime;
        const diagnostics = parseDiagnostics(combinedOutput);

        if (exitCode !== 0) {
            return NextResponse.json({
                success: false,
                durationMs,
                diagnostics: diagnostics.length > 0 ? diagnostics : [
                    {
                        line: 1,
                        column: 1,
                        message: combinedOutput || 'Compilation failed with unknown error',
                        severity: 'error',
                    },
                ],
                stdout,
                stderr,
            });
        }

        // Read generated TypeScript declaration & JS
        let dtsContent = '';
        let jsContent = '';
        const dtsPath = path.join(outDir, 'contract', 'index.d.ts');
        const jsPath = path.join(outDir, 'contract', 'index.js');

        try {
            dtsContent = await fs.readFile(dtsPath, 'utf-8');
        } catch {
            dtsContent = '// No TypeScript declaration generated';
        }

        try {
            jsContent = await fs.readFile(jsPath, 'utf-8');
        } catch {
            jsContent = '// No JavaScript output generated';
        }

        // Check if ZKIR and Keys were created
        let zkirCount = 0;
        let keysCount = 0;
        try {
            const zkirFiles = await fs.readdir(path.join(outDir, 'zkir'));
            zkirCount = zkirFiles.length;
        } catch {}

        try {
            const keyFiles = await fs.readdir(path.join(outDir, 'keys'));
            keysCount = keyFiles.length;
        } catch {}

        // Persist compiled managed artifacts to workspace (contracts/managed/<contract-name>)
        let managedPath: string | null = null;
        if (persistToManaged) {
            try {
                const contractName = path.basename(safeFilename, '.compact');
                const targetManagedDir = path.join(workspaceRoot, 'contracts', 'managed', contractName);
                await fs.mkdir(targetManagedDir, { recursive: true });
                await fs.cp(outDir, targetManagedDir, { recursive: true });
                managedPath = `contracts/managed/${contractName}`;

                // Also keep source file saved to contracts/<safeFilename>
                const contractsDir = path.join(workspaceRoot, 'contracts');
                await fs.mkdir(contractsDir, { recursive: true });
                await fs.writeFile(path.join(contractsDir, safeFilename), sourceCode, 'utf-8');
            } catch (persistErr) {
                console.warn('Failed to persist managed contract output:', persistErr);
            }
        }

        const { circuits, stateFields } = extractCircuitsAndState(sourceCode, dtsContent);

        return NextResponse.json({
            success: true,
            durationMs,
            diagnostics: [],
            stdout,
            stderr,
            files: {
                dts: dtsContent,
                js: jsContent,
            },
            circuits,
            stateFields,
            zkirCount,
            keysCount,
            managedPath,
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                durationMs: Date.now() - startTime,
                error: error?.message || 'Internal compiler error',
                diagnostics: [
                    {
                        line: 1,
                        column: 1,
                        message: error?.message || 'Internal compiler error',
                        severity: 'error',
                    },
                ],
            },
            { status: 500 }
        );
    } finally {
        // Clean up sandbox asynchronously in background
        fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    }
}

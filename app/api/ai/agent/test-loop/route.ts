import { NextRequest } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { getSkillsForAction } from '@/src/infrastructure/skills/skill-loader';
import { getCleanContractBaseName } from '@/src/lib/contract-utils';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AgentEvent {
    step:
        | 'compiling'
        | 'compile_error'
        | 'generating_artifacts'
        | 'generating_tests'
        | 'running_tests'
        | 'healing'
        | 'success'
        | 'failed';
    iteration?: number;
    maxIterations?: number;
    message: string;
    details?: any;
    timestamp: string;
}

const SYSTEM_PROMPT = `
You are an expert AI Autonomous Test & Debug Agent specialized in the Midnight blockchain, Compact smart contracts (v >= 0.23), and the Midnight.js / Compact runtime.
Your goal is to inspect a Compact contract, any existing tests, and Vitest test failure output, then generate or repair the full Vitest test suite so that 100% of the tests pass.

CRITICAL RULES TO ENSURE TESTS PASS ON COMPACT RUNTIME:
1. Vitest imports:
   \`import { describe, it, expect, beforeEach } from 'vitest';\`
   \`import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';\` (NEVER \`import { CompactRuntime }\`)
   \`import { Contract, ledger, type Witnesses } from '../../contracts/managed/<contract-name>/contract/index.js';\` (NEVER \`./contract/index.js\`)

2. Compact Uint values must be bigint in TypeScript runtime:
   \`1000n\`, \`8n\`, \`0n\`. Provide a normalizing wrapper:
   \`\`\`typescript
   const runCircuit = (circuitFn: (...args: any[]) => any, ...args: any[]) => {
     if (circuitContext) {
       circuitContext.currentPrivateState = privateState;
     }
     const normalizedArgs = args.map((arg) => (typeof arg === 'number' ? BigInt(arg) : arg));
     const result = circuitFn(circuitContext, ...normalizedArgs);
     circuitContext = CompactRuntime.createCircuitContext(
       dummyContractAddress,
       dummyCoinPublicKey,
       result.context.currentQueryContext.state,
       privateState
     );
     return result.result;
   };
   \`\`\`

3. CALLER AUTHENTICATION & MULTI-CALLER PRIVATE STATE SYNCHRONIZATION (CRITICAL):
   When switching caller secret keys via \`setCallerSecretKey(sk)\`, you MUST explicitly synchronize \`circuitContext.currentPrivateState = privateState\`!
   If you fail to do this, witness functions will keep using the owner's secret key, causing assertions in non-owner operations (transfers, approvals, burns) to fail with authorization errors.
   \`\`\`typescript
   let currentCallerSecretKey: Uint8Array = OWNER_SK;
   let privateState: PrivateState = { currentSecretKey: OWNER_SK };

   const setCallerSecretKey = (sk: Uint8Array) => {
     currentCallerSecretKey = sk;
     privateState = { currentSecretKey: sk };
     if (circuitContext) {
       circuitContext.currentPrivateState = privateState;
     }
   };

   const witnesses: Witnesses<PrivateState> = {
     localSecretKey: (ctx) => [
       ctx.privateState,
       ctx.privateState?.currentSecretKey ?? currentCallerSecretKey,
     ],
   };
   \`\`\`

4. DYNAMIC PERSISTENT HASH RESOLUTION:
   Do NOT hardcode \`_persistentHash_0\`. In Compact contracts with multiple hashes, find the method on helperContract that changes output when \`sk\` changes:
   \`\`\`typescript
   const dummyAddressBytes = Uint8Array.from(Buffer.from(dummyContractAddress, 'hex'));
   const helperContract = new Contract({ localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)] });
   const proto = Object.getPrototypeOf(helperContract);
   const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
   const accountHashMethod = hashMethods.find((method) => {
     try {
       const t1 = (helperContract as any)[method]([domainTagAuth, { bytes: dummyAddressBytes }, createKey(1)]);
       const t2 = (helperContract as any)[method]([domainTagAuth, { bytes: dummyAddressBytes }, createKey(2)]);
       return t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0;
     } catch { return false; }
   }) || '_persistentHash_0';

   const deriveAccount = (sk: Uint8Array): Uint8Array => {
     return (helperContract as any)[accountHashMethod]([domainTagAuth, { bytes: dummyAddressBytes }, sk]);
   };
   \`\`\`

5. UNEXPORTED CIRCUITS:
   Only circuits with \`export circuit\` exist on \`contract.circuits\`. Do not call private circuits like \`isZeroKey\` on the contract; implement local TS helpers for them instead.

Return the complete, corrected test suite inside a single \`\`\`typescript ... \`\`\` code block.
`;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const {
        contractName: rawContractName,
        sourceCode: clientSourceCode,
        maxIterations = 4,
        apiKey: userApiKey,
        model = 'gemini-3.7-flash',
    } = body;

    const effectiveApiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!effectiveApiKey) {
        return new Response(JSON.stringify({ error: 'GEMINI_API_KEY_REQUIRED' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const cleanContractName = getCleanContractBaseName(rawContractName || 'contract');
    const pascalName = cleanContractName
        .split('-')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');

    const workspaceRoot = process.cwd();

    // Setup SSE Stream
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const sendEvent = async (event: AgentEvent) => {
        try {
            await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
            // Client might have disconnected
        }
    };

    (async () => {
        try {
            // STEP 1: Determine Contract Source Code
            let compactCode = clientSourceCode;
            if (!compactCode) {
                const candidates = [
                    path.join(workspaceRoot, 'contracts', `${cleanContractName}.compact`),
                    path.join(workspaceRoot, 'contracts', `${cleanContractName}-v2-2.compact`),
                ];
                for (const candidate of candidates) {
                    try {
                        compactCode = await fs.readFile(candidate, 'utf-8');
                        break;
                    } catch {}
                }
            }

            if (!compactCode) {
                await sendEvent({
                    step: 'compile_error',
                    message: `Could not find source code for contract ${cleanContractName}.`,
                    timestamp: new Date().toISOString(),
                });
                await writer.close();
                return;
            }

            // STEP 2: Compile the Contract
            await sendEvent({
                step: 'compiling',
                message: `Compiling Compact contract ${cleanContractName}...`,
                timestamp: new Date().toISOString(),
            });

            // Locate compiler binary
            const possiblePaths = ['/home/paul/.local/bin/compact', 'compact', 'compactc'];
            let compilerBin = 'compact';
            for (const p of possiblePaths) {
                try {
                    if (p.startsWith('/')) {
                        await fs.access(p);
                        compilerBin = p;
                        break;
                    }
                } catch {}
            }

            const targetManagedDir = path.join(workspaceRoot, 'contracts', 'managed', cleanContractName);
            const sourceFilePath = path.join(workspaceRoot, 'contracts', `${cleanContractName}.compact`);
            const modulesRoot = path.join(workspaceRoot, 'contracts', 'modules');

            await fs.mkdir(targetManagedDir, { recursive: true });
            await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
            await fs.writeFile(sourceFilePath, compactCode, 'utf-8');

            const compileCmd = `${compilerBin} compile --compact-path "${path.join(workspaceRoot, 'contracts')}:${modulesRoot}" "${sourceFilePath}" "${targetManagedDir}"`;
            
            try {
                await execAsync(compileCmd, {
                    cwd: workspaceRoot,
                    timeout: 45000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:/home/paul/.local/bin:/usr/local/bin`,
                    },
                });
            } catch (compileErr: any) {
                const errMsg = compileErr.stderr || compileErr.stdout || compileErr.message;
                await sendEvent({
                    step: 'compile_error',
                    message: `Compilation failed for ${cleanContractName}`,
                    details: errMsg,
                    timestamp: new Date().toISOString(),
                });
                await writer.close();
                return;
            }

            // Read generated dts
            let dtsContent = '';
            try {
                dtsContent = await fs.readFile(path.join(targetManagedDir, 'contract', 'index.d.ts'), 'utf-8');
            } catch {}

            const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

            // STEP 3: Generate and SAVE SDK Client, Documentation, Example script, and Install script
            await sendEvent({
                step: 'generating_artifacts',
                message: `Generating & saving Client SDK, Docs, Example script, and Install script for ${cleanContractName}...`,
                timestamp: new Date().toISOString(),
            });

            const clientPrompt = `
Task: Generate a production-grade TypeScript client SDK, comprehensive technical documentation, a runnable example script, and an install shell script for this Midnight Compact smart contract.
Contract Name: ${cleanContractName}
Contract Filename: ${cleanContractName}.compact

Compact Contract Source Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Type Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

Please output FOUR separate, clearly labeled code blocks with file target headers:

1. SDK Implementation:
\`\`\`typescript:src/client/${cleanContractName}-sdk.ts
// Complete TypeScript SDK Adapter Class importing from '../../contracts/managed/${cleanContractName}/contract/index.js'
\`\`\`

2. SDK Documentation:
\`\`\`markdown:docs/${cleanContractName}-sdk.md
# Documentation for ${cleanContractName}
\`\`\`

3. Runnable Quickstart Example:
\`\`\`typescript:examples/${cleanContractName}-example.ts
/**
 * Quickstart Example: ${pascalName} Client SDK
 * How to run: npx tsx examples/${cleanContractName}-example.ts
 */
\`\`\`

4. Installation Shell Script:
\`\`\`bash:scripts/${cleanContractName}-install.sh
#!/usr/bin/env bash
\`\`\`
`;

            try {
                const clientGen = await ai.models.generateContent({
                    model,
                    contents: clientPrompt,
                    config: {
                        temperature: 0.2,
                    },
                });

                const rawClientOutput = clientGen.text || '';

                // Extract and save sdk.ts
                const sdkMatch =
                    rawClientOutput.match(/```(?:typescript|ts)?(?::src\/client\/[^\n]+)?\n([\s\S]*?import\s+[\s\S]*?export\s+class\s+[\s\S]*?)```/) ||
                    rawClientOutput.match(/```(?:typescript|ts)\n([\s\S]*?export\s+class\s+[\s\S]*?)```/);
                if (sdkMatch && sdkMatch[1].trim().length > 50) {
                    const sdkPath = path.join(workspaceRoot, 'src', 'client', `${cleanContractName}-sdk.ts`);
                    await fs.mkdir(path.dirname(sdkPath), { recursive: true });
                    await fs.writeFile(sdkPath, sdkMatch[1].trim(), 'utf-8');
                }

                // Extract and save documentation (.md)
                const docMatch =
                    rawClientOutput.match(/```(?:markdown|md)?(?::docs\/[^\n]+)?\n([\s\S]*?#\s+[\s\S]*?)```/) ||
                    rawClientOutput.match(/```markdown\n([\s\S]*?)```/);
                if (docMatch && docMatch[1].trim().length > 50) {
                    const docPath = path.join(workspaceRoot, 'docs', `${cleanContractName}-sdk.md`);
                    await fs.mkdir(path.dirname(docPath), { recursive: true });
                    await fs.writeFile(docPath, docMatch[1].trim(), 'utf-8');
                }

                // Extract and save example.ts
                const exampleMatch =
                    rawClientOutput.match(/```(?:typescript|ts)?(?::examples\/[^\n]+)?\n([\s\S]*?async\s+function\s+main[\s\S]*?)```/) ||
                    rawClientOutput.match(/```(?:typescript|ts)\n([\s\S]*?main\(\)[\s\S]*?)```/);
                if (exampleMatch && exampleMatch[1].trim().length > 50) {
                    const examplePath = path.join(workspaceRoot, 'examples', `${cleanContractName}-example.ts`);
                    await fs.mkdir(path.dirname(examplePath), { recursive: true });
                    await fs.writeFile(examplePath, exampleMatch[1].trim(), 'utf-8');
                }

                // Extract and save install.sh
                const installMatch =
                    rawClientOutput.match(/```(?:bash|sh)?(?::scripts\/[^\n]+)?\n([\s\S]*?npm\s+install[\s\S]*?)```/) ||
                    rawClientOutput.match(/```bash\n([\s\S]*?)```/);
                if (installMatch && installMatch[1].trim().length > 10) {
                    const installPath = path.join(workspaceRoot, 'scripts', `${cleanContractName}-install.sh`);
                    await fs.mkdir(path.dirname(installPath), { recursive: true });
                    await fs.writeFile(installPath, installMatch[1].trim(), { encoding: 'utf-8', mode: 0o755 });
                }
            } catch (artifactErr: any) {
                console.warn('Artifact generation warning:', artifactErr.message);
            }

            // STEP 4: Check If Tests Exist or Generate Initial Test File
            const testFilePath = path.join(workspaceRoot, 'tests', 'contracts', `${cleanContractName}.test.ts`);
            let currentTestCode = '';
            try {
                currentTestCode = await fs.readFile(testFilePath, 'utf-8');
            } catch {
                currentTestCode = '';
            }

            const injectedSkills = getSkillsForAction('generate_tests', '');
            const effectiveSystemPrompt = injectedSkills
                ? `${SYSTEM_PROMPT}\n\n${injectedSkills}`
                : SYSTEM_PROMPT;

            if (!currentTestCode || currentTestCode.trim().length < 50) {
                await sendEvent({
                    step: 'generating_tests',
                    message: `Generating initial Vitest test suite for ${cleanContractName}...`,
                    timestamp: new Date().toISOString(),
                });

                const genPrompt = `
Generate a comprehensive, robust Vitest unit test suite for:
Contract Name: ${cleanContractName}
Target Test File: tests/contracts/${cleanContractName}.test.ts
Managed Contract Artifact: ../../contracts/managed/${cleanContractName}/contract/index.js

Contract Compact Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

Please output the complete test file inside a \`\`\`typescript ... \`\`\` block.
`;
                const initialGen = await ai.models.generateContent({
                    model,
                    contents: genPrompt,
                    config: {
                        systemInstruction: effectiveSystemPrompt,
                        temperature: 0.2,
                    },
                });

                const rawText = initialGen.text || '';
                const codeMatch = rawText.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
                currentTestCode = codeMatch ? codeMatch[1].trim() : rawText;

                // Write temporary initial test for testing
                await fs.mkdir(path.dirname(testFilePath), { recursive: true });
                await fs.writeFile(testFilePath, currentTestCode, 'utf-8');
            }

            // STEP 5: Autonomous Run & Self-Healing Loop
            let iteration = 0;
            let allPassed = false;
            let lastSummary = { total: 0, passed: 0, failed: 0, failures: [] as string[] };

            while (iteration < maxIterations && !allPassed) {
                iteration++;

                await sendEvent({
                    step: 'running_tests',
                    iteration,
                    maxIterations,
                    message: `Executing Vitest tests (Iteration ${iteration}/${maxIterations})...`,
                    timestamp: new Date().toISOString(),
                });

                const vitestCmd = `npx vitest run --reporter=json tests/contracts/${cleanContractName}.test.ts`;
                let vitestStdout = '';
                let vitestStderr = '';
                let vitestFailed = false;

                try {
                    const result = await execAsync(vitestCmd, {
                        cwd: workspaceRoot,
                        timeout: 45000,
                        maxBuffer: 10 * 1024 * 1024,
                    });
                    vitestStdout = result.stdout;
                    vitestStderr = result.stderr;
                } catch (runErr: any) {
                    vitestFailed = true;
                    vitestStdout = runErr.stdout || '';
                    vitestStderr = runErr.stderr || runErr.message || '';
                }

                // Parse Vitest JSON output
                const jsonMatch = vitestStdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
                let parsedJson: any = null;
                if (jsonMatch) {
                    try {
                        parsedJson = JSON.parse(jsonMatch[0]);
                    } catch {}
                }

                if (parsedJson) {
                    const total = parsedJson.numTotalTests || 0;
                    const passed = parsedJson.numPassedTests || 0;
                    const failed = parsedJson.numFailedTests || 0;
                    const failureList: string[] = [];

                    for (const suite of parsedJson.testResults || []) {
                        for (const test of suite.assertionResults || []) {
                            if (test.status === 'failed') {
                                failureList.push(`[${test.fullName || test.title}]: ${(test.failureMessages || []).join('\n')}`);
                            }
                        }
                        if (suite.status === 'failed' && (!suite.assertionResults || suite.assertionResults.length === 0)) {
                            failureList.push(`[Suite Error]: ${suite.message || 'Unknown suite failure'}`);
                        }
                    }

                    lastSummary = { total, passed, failed, failures: failureList };
                    allPassed = failed === 0 && total > 0 && !vitestFailed;
                } else {
                    // Raw string error fallback
                    allPassed = !vitestFailed;
                    lastSummary = {
                        total: 1,
                        passed: vitestFailed ? 0 : 1,
                        failed: vitestFailed ? 1 : 0,
                        failures: [vitestStderr || vitestStdout],
                    };
                }

                if (allPassed) {
                    break;
                }

                // Need healing
                await sendEvent({
                    step: 'healing',
                    iteration,
                    maxIterations,
                    message: `Iteration ${iteration}: ${lastSummary.failed} of ${lastSummary.total} tests failed. Healing test code with Gemini...`,
                    details: {
                        total: lastSummary.total,
                        passed: lastSummary.passed,
                        failed: lastSummary.failed,
                        failures: lastSummary.failures.slice(0, 5), // top 5 failures
                    },
                    timestamp: new Date().toISOString(),
                });

                const healPrompt = `
Task: Fix the failing Vitest tests for Compact contract: ${cleanContractName}.
The contract is compiled at \`contracts/managed/${cleanContractName}\`.

Current Test Failures:
${lastSummary.failures.join('\n\n')}

Active Contract Compact Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

Current Failing Test File (\`tests/contracts/${cleanContractName}.test.ts\`):
\`\`\`typescript
${currentTestCode}
\`\`\`

Diagnose why the tests failed:
1. Did caller secret keys switch without syncing \`circuitContext.currentPrivateState = privateState\`?
2. Did \`deriveAccount()\` fail to hash dynamically?
3. Were bigints formatted without \`n\`?
4. Were assert error messages slightly mismatched?
5. Did private internal circuits get called on \`contract.circuits\`?

Provide the complete, updated test file inside a \`\`\`typescript ... \`\`\` code block.
`;

                const healRes = await ai.models.generateContent({
                    model,
                    contents: healPrompt,
                    config: {
                        systemInstruction: effectiveSystemPrompt,
                        temperature: 0.2,
                    },
                });

                const rawHealed = healRes.text || '';
                const codeMatch = rawHealed.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
                if (codeMatch && codeMatch[1].trim().length > 50) {
                    currentTestCode = codeMatch[1].trim();
                    await fs.writeFile(testFilePath, currentTestCode, 'utf-8');
                }
            }

            // STEP 6: Final Result & Save Verified Tests
            if (allPassed) {
                // Permanently SAVE the passing test file
                await fs.mkdir(path.dirname(testFilePath), { recursive: true });
                await fs.writeFile(testFilePath, currentTestCode, 'utf-8');

                await sendEvent({
                    step: 'success',
                    message: `🎉 All ${lastSummary.total} tests passed! Saved test suite to ${testFilePath}`,
                    details: {
                        total: lastSummary.total,
                        passed: lastSummary.passed,
                        iterationsUsed: iteration,
                        testFile: `tests/contracts/${cleanContractName}.test.ts`,
                        sdkFile: `src/client/${cleanContractName}-sdk.ts`,
                        docFile: `docs/${cleanContractName}-sdk.md`,
                        exampleFile: `examples/${cleanContractName}-example.ts`,
                        installScript: `scripts/${cleanContractName}-install.sh`,
                    },
                    timestamp: new Date().toISOString(),
                });
            } else {
                await sendEvent({
                    step: 'failed',
                    message: `Reached maximum iterations (${maxIterations}). ${lastSummary.failed} test(s) still failing.`,
                    details: {
                        total: lastSummary.total,
                        passed: lastSummary.passed,
                        failed: lastSummary.failed,
                        failures: lastSummary.failures.slice(0, 5),
                    },
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (err: any) {
            await sendEvent({
                step: 'failed',
                message: `Agent encountered an unexpected error: ${err.message}`,
                timestamp: new Date().toISOString(),
            });
        } finally {
            await writer.close();
        }
    })();

    return new Response(stream.readable, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        },
    });
}

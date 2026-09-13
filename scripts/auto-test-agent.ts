#!/usr/bin/env node
/**
 * Autonomous Compact Compile -> SDK/Docs/Examples/Install -> Test -> Auto-Heal Loop Agent CLI
 * 
 * Usage:
 *   npx tsx scripts/auto-test-agent.ts [contract-name] [--max-iterations=4]
 * 
 * Example:
 *   npx tsx scripts/auto-test-agent.ts fungible-token-v2-2
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';

const execAsync = promisify(exec);

// CLI Colors
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
    console.log(bold(cyan('\n🤖 Midnight Compact Studio — Autonomous Test & Auto-Heal Agent\n')));

    // Parse args
    const args = process.argv.slice(2);
    let targetContract = args[0] || 'fungible-token-v2-2';
    if (targetContract.startsWith('--')) {
        targetContract = 'fungible-token-v2-2';
    }
    targetContract = targetContract.replace(/\.compact$/, '');

    const pascalName = targetContract
        .split('-')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');

    let maxIterations = 4;
    const maxIterArg = args.find(a => a.startsWith('--max-iterations='));
    if (maxIterArg) {
        maxIterations = parseInt(maxIterArg.split('=')[1], 10) || 4;
    }

    const workspaceRoot = process.cwd();

    // Check API Key
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        try {
            const envContent = await fs.readFile(path.join(workspaceRoot, '.env.local'), 'utf-8');
            const match = envContent.match(/GEMINI_API_KEY\s*=\s*(.*)/);
            if (match) {
                apiKey = match[1].trim().replace(/^['"]|['"]$/g, '');
            }
        } catch {}
    }

    if (!apiKey) {
        console.error(red('✖ Error: GEMINI_API_KEY is not set in environment or .env.local.'));
        process.exit(1);
    }

    // Step 1: Check contract source
    const contractSourcePath = path.join(workspaceRoot, 'contracts', `${targetContract}.compact`);
    let compactCode = '';
    try {
        compactCode = await fs.readFile(contractSourcePath, 'utf-8');
        console.log(`📄 Found contract source: ${dim(contractSourcePath)}`);
    } catch {
        console.error(red(`✖ Error: Contract not found at ${contractSourcePath}`));
        process.exit(1);
    }

    // Step 2: Compile Contract
    console.log(`\n⚙️  ${bold('Step 1: Compiling Compact contract')} ${cyan(targetContract)}...`);
    const targetManagedDir = path.join(workspaceRoot, 'contracts', 'managed', targetContract);
    const modulesRoot = path.join(workspaceRoot, 'contracts', 'modules');
    await fs.mkdir(targetManagedDir, { recursive: true });

    // Locate compact compiler
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

    const compileCmd = `${compilerBin} compile --compact-path "${path.join(workspaceRoot, 'contracts')}:${modulesRoot}" "${contractSourcePath}" "${targetManagedDir}"`;
    try {
        await execAsync(compileCmd, {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:/home/paul/.local/bin:/usr/local/bin`,
            },
        });
        console.log(green(`✔ Compact compilation successful -> ${targetManagedDir}`));
    } catch (compileErr: any) {
        console.error(red(`✖ Compact compilation failed:`));
        console.error(compileErr.stderr || compileErr.stdout || compileErr.message);
        process.exit(1);
    }

    let dtsContent = '';
    try {
        dtsContent = await fs.readFile(path.join(targetManagedDir, 'contract', 'index.d.ts'), 'utf-8');
    } catch {}

    const ai = new GoogleGenAI({ apiKey });

    // Step 3: Generate & SAVE SDK, Docs, Examples, and Install Script
    console.log(`\n📦 ${bold('Step 2: Generating & Saving Client SDK, Documentation, Examples, and Install Script')}...`);

    const sanitizeExtracted = (raw: string): string => {
        let clean = raw.trim();
        if (clean.startsWith('```')) {
            clean = clean.replace(/^```[^\r\n]*\r?\n/, '');
            clean = clean.replace(/\r?\n```\s*$/, '');
        }
        return clean.trim();
    };

    const extractDelimitedContent = (
        text: string,
        targetFilePath: string,
        fallbackPatterns: RegExp[] = []
    ): string => {
        const escaped = targetFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagRegex = new RegExp(`<<<START_FILE:${escaped}>>>([\\s\\S]*?)<<<END_FILE>>>`, 'i');
        const tagMatch = text.match(tagRegex);
        if (tagMatch && tagMatch[1].trim()) {
            return sanitizeExtracted(tagMatch[1]);
        }

        const base = path.basename(targetFilePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const looseRegex = new RegExp(`<<<START_FILE:[^>]*${base}[^>]*>>>([\\s\\S]*?)<<<END_FILE>>>`, 'i');
        const looseMatch = text.match(looseRegex);
        if (looseMatch && looseMatch[1].trim()) {
            return sanitizeExtracted(looseMatch[1]);
        }

        for (const pat of fallbackPatterns) {
            const m = text.match(pat);
            if (m && m[1] && m[1].trim()) {
                return sanitizeExtracted(m[1]);
            }
        }

        return '';
    };

    const codeArtifactPrompt = `
Task: Generate the complete, production-grade TypeScript Client SDK class AND a runnable quickstart example script for the Midnight Compact smart contract "${targetContract}".

Contract Name: ${targetContract}
Contract Filename: ${targetContract}.compact

Compact Contract Source Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Type Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

OUTPUT FORMAT REQUIREMENT:
Output the two files using the exact delimiter tags below. Do NOT wrap files in outer markdown backticks:

<<<START_FILE:src/client/${targetContract}-sdk.ts>>>
// Production-grade TypeScript SDK Client Adapter Class
// Rules:
// 1. Import from '@midnight-ntwrk/compact-runtime'
// 2. Import contract artifacts strictly from '../../contracts/managed/${targetContract}/contract/index.js'
// 3. Export typed PrivateState and Witnesses interfaces
// 4. Export ${pascalName}SDK class with constructor, query methods, and typed circuit executors
<<<END_FILE>>>

<<<START_FILE:examples/${targetContract}-example.ts>>>
/**
 * Quickstart Example: ${pascalName} Client SDK
 * How to run: npx tsx examples/${targetContract}-example.ts
 */
// Complete runnable TypeScript script importing from '../src/client/${targetContract}-sdk.js'
<<<END_FILE>>>
`;

    const docArtifactPrompt = `
Task: Generate comprehensive technical documentation and an installation script for the Midnight Compact smart contract "${targetContract}".

Contract Name: ${targetContract}
Contract Filename: ${targetContract}.compact

Compact Contract Source Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Type Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

OUTPUT FORMAT REQUIREMENT:
Output the two files using the exact delimiter tags below:

<<<START_FILE:docs/${targetContract}-sdk.md>>>
# Technical Documentation: ${targetContract} SDK

## Overview
(Deep architectural description of the contract, its purpose, state model, and privacy boundaries)

## Contract State Architecture
(Complete schema of public ledger state, data types, and access controls)

## Zero-Knowledge Circuits & Methods
(Comprehensive table and descriptions of all circuits, parameters, preconditions, and assertions)

## SDK API Reference
(Detailed documentation of the client adapter methods, witnesses, and query functions)

## Security & Privacy Considerations
(Key zero-knowledge considerations, secret key handling, and witness protections)
<<<END_FILE>>>

<<<START_FILE:scripts/${targetContract}-install.sh>>>
#!/usr/bin/env bash
# Installation script for ${targetContract} dependencies
npm install --save @midnight-ntwrk/compact-runtime
<<<END_FILE>>>
`;

    try {
        const [codeRes, docRes] = await Promise.all([
            ai.models.generateContent({
                model: 'gemini-3.7-flash',
                contents: codeArtifactPrompt,
                config: {
                    temperature: 0.2,
                    maxOutputTokens: 16384,
                },
            }),
            ai.models.generateContent({
                model: 'gemini-3.7-flash',
                contents: docArtifactPrompt,
                config: {
                    temperature: 0.2,
                    maxOutputTokens: 16384,
                },
            }),
        ]);

        const rawCode = codeRes.text || '';
        const rawDoc = docRes.text || '';

        // Save sdk.ts
        const sdkCode = extractDelimitedContent(
            rawCode,
            `src/client/${targetContract}-sdk.ts`,
            [
                /```(?:typescript|ts)?(?::src\/client\/[^\n]+)?\n([\s\S]*?import\s+[\s\S]*?export\s+class\s+[\s\S]*?)```/,
                /```(?:typescript|ts)\n([\s\S]*?export\s+class\s+[\s\S]*?)```/,
            ]
        );
        if (sdkCode.length > 50) {
            const sdkPath = path.join(workspaceRoot, 'src', 'client', `${targetContract}-sdk.ts`);
            await fs.mkdir(path.dirname(sdkPath), { recursive: true });
            await fs.writeFile(sdkPath, sdkCode, 'utf-8');
            console.log(green(`✔ Saved SDK -> ${sdkPath}`));
        }

        // Save doc
        let docContent = extractDelimitedContent(
            rawDoc,
            `docs/${targetContract}-sdk.md`,
            [
                /```(?:markdown|md)?(?::docs\/[^\n]+)?\n([\s\S]*?#\s+[\s\S]*?)```/,
                /```markdown\n([\s\S]*?)```/,
            ]
        );
        if (!docContent && rawDoc.includes('# ')) {
            docContent = sanitizeExtracted(rawDoc);
        }
        if (docContent.length > 50) {
            const docPath = path.join(workspaceRoot, 'docs', `${targetContract}-sdk.md`);
            await fs.mkdir(path.dirname(docPath), { recursive: true });
            await fs.writeFile(docPath, docContent, 'utf-8');
            console.log(green(`✔ Saved Documentation -> ${docPath}`));
        }

        // Save example
        const exampleCode = extractDelimitedContent(
            rawCode,
            `examples/${targetContract}-example.ts`,
            [
                /```(?:typescript|ts)?(?::examples\/[^\n]+)?\n([\s\S]*?async\s+function\s+main[\s\S]*?)```/,
                /```(?:typescript|ts)\n([\s\S]*?main\(\)[\s\S]*?)```/,
            ]
        );
        if (exampleCode.length > 50) {
            const examplePath = path.join(workspaceRoot, 'examples', `${targetContract}-example.ts`);
            await fs.mkdir(path.dirname(examplePath), { recursive: true });
            await fs.writeFile(examplePath, exampleCode, 'utf-8');
            console.log(green(`✔ Saved Quickstart Example -> ${examplePath}`));
        }

        // Save install.sh
        const installCode = extractDelimitedContent(
            rawDoc,
            `scripts/${targetContract}-install.sh`,
            [
                /```(?:bash|sh)?(?::scripts\/[^\n]+)?\n([\s\S]*?npm\s+install[\s\S]*?)```/,
                /```bash\n([\s\S]*?)```/,
            ]
        );
        if (installCode.length > 10) {
            const installPath = path.join(workspaceRoot, 'scripts', `${targetContract}-install.sh`);
            await fs.mkdir(path.dirname(installPath), { recursive: true });
            await fs.writeFile(installPath, installCode, { encoding: 'utf-8', mode: 0o755 });
            console.log(green(`✔ Saved Install Script -> ${installPath}`));
        }
    } catch (artifactErr: any) {
        console.warn(yellow(`⚠️  Artifact generation warning: ${artifactErr.message}`));
    }

    // Step 4: Check / Generate Test file
    const testFilePath = path.join(workspaceRoot, 'tests', 'contracts', `${targetContract}.test.ts`);
    let currentTestCode = '';
    try {
        currentTestCode = await fs.readFile(testFilePath, 'utf-8');
        console.log(`\n🧪 Existing test suite found: ${dim(testFilePath)}`);
    } catch {
        currentTestCode = '';
    }

    if (!currentTestCode || currentTestCode.trim().length < 50) {
        console.log(`\n✨ ${bold('Step 3: Generating initial Vitest suite with Gemini 3.7 Flash')}...`);
        const genPrompt = `
Generate a complete, compilable Vitest unit test file for:
Contract Name: ${targetContract}
Target File: tests/contracts/${targetContract}.test.ts
Managed Contract Artifact: ../../contracts/managed/${targetContract}/contract/index.js

Rules:
1. Vitest imports:
   \`import { describe, it, expect, beforeEach } from 'vitest';\`
   \`import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';\`
   \`import { Contract, ledger, type Witnesses } from '../../contracts/managed/${targetContract}/contract/index.js';\`

2. Double-insulate witness & multi-caller key synchronizer:
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

3. Dynamic persistentHash resolution:
   \`\`\`typescript
   const dummySalt = new Uint8Array(32).fill(7);
   const helperContract = new Contract({ localSecretKey: (ctx: any) => [ctx.privateState, new Uint8Array(32)] });
   const proto = Object.getPrototypeOf(helperContract);
   const hashMethods = Object.getOwnPropertyNames(proto).filter((k) => k.startsWith('_persistentHash'));
   let accountHashMethod = '_persistentHash_1';
   let passWrappedObject = false;

   for (const method of hashMethods) {
     try {
       const t1 = (helperContract as any)[method]([domainTagAuth, dummySalt, createKey(1)]);
       const t2 = (helperContract as any)[method]([domainTagAuth, dummySalt, createKey(2)]);
       if (t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0) {
         accountHashMethod = method;
         passWrappedObject = false;
         break;
       }
     } catch {}
     try {
       const t1 = (helperContract as any)[method]([domainTagAuth, { bytes: dummySalt }, createKey(1)]);
       const t2 = (helperContract as any)[method]([domainTagAuth, { bytes: dummySalt }, createKey(2)]);
       if (t1 instanceof Uint8Array && t2 instanceof Uint8Array && Buffer.from(t1).compare(Buffer.from(t2)) !== 0) {
         accountHashMethod = method;
         passWrappedObject = true;
         break;
       }
     } catch {}
   }

   const deriveAccount = (sk: Uint8Array, salt: Uint8Array = CONTRACT_SALT): Uint8Array => {
     const saltArg = passWrappedObject ? { bytes: salt } : salt;
     return (helperContract as any)[accountHashMethod]([domainTagAuth, saltArg, sk]);
   };
   \`\`\`

4. Public ledger state vs Exported Circuits (NO GETTER CIRCUITS):
   - In Compact contracts, public ledger variables (_balances, _allowances, _totalSupply, _maxSupply, _name, _symbol, _decimals, _paused, _contractSalt) are queried directly via \`ledger(circuitContext.currentQueryContext.state)\`!
   - ABSOLUTELY NEVER call \`contract.circuits.balanceOf\`, \`contract.circuits.allowance\`, \`contract.circuits.totalSupply\`, \`contract.circuits.maxSupply\`, \`contract.circuits.paused\`, \`contract.circuits.name\`, \`contract.circuits.symbol\`, \`contract.circuits.decimals\`, or \`contract.circuits.contractSalt\`! These circuits do NOT exist on \`contract.circuits\`.
   - DO NOT create tests called "exposes getter circuits".
   - Use direct ledger helpers:
     \`\`\`typescript
     const getLedger = () => ledger(circuitContext.currentQueryContext.state);
     const getBalance = (account: Uint8Array): bigint => {
       const l = getLedger();
       return l._balances.member(account) ? l._balances.lookup(account) : 0n;
     };
     const getAllowance = (owner: Uint8Array, spender: Uint8Array): bigint => {
       const l = getLedger();
       const key: [Uint8Array, Uint8Array] = [owner, spender];
       return l._allowances.member(key) ? l._allowances.lookup(key) : 0n;
     };
     \`\`\`

5. Constructor & Initial State:
   - Always match constructor arguments: if constructor takes \`(salt_: Bytes<32>, initialOwner: Bytes<32>, ...)\`, pass \`CONTRACT_SALT\` first: \`contract.initialState(constructorCtx, CONTRACT_SALT, initialOwner, ...)\`.

Contract Compact Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Definitions:
\`\`\`typescript
${dtsContent}
\`\`\`

Output only the complete TypeScript code block inside \`\`\`typescript ... \`\`\`.
`;

        const res = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: genPrompt,
            config: { temperature: 0.2 },
        });

        const raw = res.text || '';
        const match = raw.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
        currentTestCode = match ? match[1].trim() : raw;
        await fs.mkdir(path.dirname(testFilePath), { recursive: true });
        await fs.writeFile(testFilePath, currentTestCode, 'utf-8');
        console.log(green(`✔ Generated initial tests -> ${testFilePath}`));
    }

    // Step 5: Run & Auto-Heal Loop
    console.log(`\n🔁 ${bold('Step 4: Starting Test & Auto-Heal Loop')} (Max ${maxIterations} rounds)...\n`);

    let iteration = 0;
    let allPassed = false;
    let lastSummary = { total: 0, passed: 0, failed: 0, failures: [] as string[] };

    while (iteration < maxIterations && !allPassed) {
        iteration++;
        process.stdout.write(`[Round ${iteration}/${maxIterations}] Running Vitest... `);

        const vitestCmd = `npx vitest run --reporter=json tests/contracts/${targetContract}.test.ts`;
        let vitestStdout = '';
        let vitestStderr = '';
        let runFailed = false;

        try {
            const out = await execAsync(vitestCmd, {
                cwd: workspaceRoot,
                timeout: 45000,
                maxBuffer: 10 * 1024 * 1024,
            });
            vitestStdout = out.stdout;
            vitestStderr = out.stderr;
        } catch (err: any) {
            runFailed = true;
            vitestStdout = err.stdout || '';
            vitestStderr = err.stderr || err.message || '';
        }

        const jsonMatch = vitestStdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
        let parsed: any = null;
        if (jsonMatch) {
            try { parsed = JSON.parse(jsonMatch[0]); } catch {}
        }

        if (parsed) {
            const total = parsed.numTotalTests || 0;
            const passed = parsed.numPassedTests || 0;
            const failed = parsed.numFailedTests || 0;
            const failureList: string[] = [];

            for (const suite of parsed.testResults || []) {
                for (const test of suite.assertionResults || []) {
                    if (test.status === 'failed') {
                        failureList.push(`[${test.fullName || test.title}]: ${(test.failureMessages || []).join('\n')}`);
                    }
                }
                if (suite.status === 'failed' && (!suite.assertionResults || suite.assertionResults.length === 0)) {
                    failureList.push(`[Suite Error]: ${suite.message || 'Unknown error'}`);
                }
            }

            lastSummary = { total, passed, failed, failures: failureList };
            allPassed = failed === 0 && total > 0 && !runFailed;
        } else {
            allPassed = !runFailed;
            lastSummary = {
                total: 1,
                passed: runFailed ? 0 : 1,
                failed: runFailed ? 1 : 0,
                failures: [vitestStderr || vitestStdout],
            };
        }

        if (allPassed) {
            console.log(green(`PASSED! (${lastSummary.passed}/${lastSummary.total} tests green)`));
            break;
        }

        console.log(red(`FAILED! (${lastSummary.failed} failed of ${lastSummary.total})`));
        console.log(yellow(`\n🛠️  Agent self-healing round ${iteration} with Gemini 3.7 Flash...`));

        // Display snippet of failure
        if (lastSummary.failures.length > 0) {
            console.log(dim(`Sample failure:\n${lastSummary.failures[0].slice(0, 300)}...\n`));
        }

        const healPrompt = `
Task: Fix the failing Vitest tests for Compact contract: ${targetContract}.
Contract Artifact: contracts/managed/${targetContract}/contract/index.js

Test Failures:
${lastSummary.failures.join('\n\n')}

Active Contract Compact Code:
\`\`\`compact
${compactCode}
\`\`\`

Generated TypeScript Definitions (.d.ts):
\`\`\`typescript
${dtsContent}
\`\`\`

Current Test File:
\`\`\`typescript
${currentTestCode}
\`\`\`

Diagnose and patch:
1. Ensure circuitContext.currentPrivateState is synced in setCallerSecretKey(sk) AND runCircuit.
2. Dynamic persistentHash resolution for deriveAccount.
3. Uint<N> bigints with 'n' suffix.
4. Correct exact assert error messages.
5. No calls to unexported internal circuits.

Provide the complete updated test file in \`\`\`typescript ... \`\`\`.
`;

        const healRes = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: healPrompt,
            config: { temperature: 0.2 },
        });

        const raw = healRes.text || '';
        const match = raw.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
        if (match && match[1].trim().length > 50) {
            currentTestCode = match[1].trim();
            await fs.writeFile(testFilePath, currentTestCode, 'utf-8');
            console.log(green(`✔ Updated test file for next iteration -> ${testFilePath}\n`));
        }
    }

    if (allPassed) {
        // Step 6: Permanently save verified passing tests
        await fs.mkdir(path.dirname(testFilePath), { recursive: true });
        await fs.writeFile(testFilePath, currentTestCode, 'utf-8');
        console.log(bold(green(`\n💾 Saved verified test suite -> ${testFilePath}`)));
        console.log(bold(green(`🎉 SUCCESS: All ${lastSummary.total} tests for ${targetContract} passed in round ${iteration}!\n`)));
        process.exit(0);
    } else {
        console.log(bold(red(`\n✖ FAILED: Completed ${maxIterations} rounds. ${lastSummary.failed} tests still failing.\n`)));
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(red('Fatal Agent Error:'), err);
    process.exit(1);
});

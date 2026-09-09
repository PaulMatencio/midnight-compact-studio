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

    const clientPrompt = `
Task: Generate a production-grade TypeScript client SDK, comprehensive technical documentation, a runnable example script, and an install shell script for this Midnight Compact smart contract.
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

Please output FOUR separate, clearly labeled code blocks with file target headers:

1. SDK Implementation:
\`\`\`typescript:src/client/${targetContract}-sdk.ts
// Complete TypeScript SDK Adapter Class importing from '../../contracts/managed/${targetContract}/contract/index.js'
\`\`\`

2. SDK Documentation:
\`\`\`markdown:docs/${targetContract}-sdk.md
# Documentation for ${targetContract}
\`\`\`

3. Runnable Quickstart Example:
\`\`\`typescript:examples/${targetContract}-example.ts
/**
 * Quickstart Example: ${pascalName} Client SDK
 * How to run: npx tsx examples/${targetContract}-example.ts
 */
\`\`\`

4. Installation Shell Script:
\`\`\`bash:scripts/${targetContract}-install.sh
#!/usr/bin/env bash
\`\`\`
`;

    try {
        const clientRes = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: clientPrompt,
            config: { temperature: 0.2 },
        });

        const rawClient = clientRes.text || '';

        // Save sdk.ts
        const sdkMatch =
            rawClient.match(/```(?:typescript|ts)?(?::src\/client\/[^\n]+)?\n([\s\S]*?import\s+[\s\S]*?export\s+class\s+[\s\S]*?)```/) ||
            rawClient.match(/```(?:typescript|ts)\n([\s\S]*?export\s+class\s+[\s\S]*?)```/);
        if (sdkMatch && sdkMatch[1].trim().length > 50) {
            const sdkPath = path.join(workspaceRoot, 'src', 'client', `${targetContract}-sdk.ts`);
            await fs.mkdir(path.dirname(sdkPath), { recursive: true });
            await fs.writeFile(sdkPath, sdkMatch[1].trim(), 'utf-8');
            console.log(green(`✔ Saved SDK -> ${sdkPath}`));
        }

        // Save doc
        const docMatch =
            rawClient.match(/```(?:markdown|md)?(?::docs\/[^\n]+)?\n([\s\S]*?#\s+[\s\S]*?)```/) ||
            rawClient.match(/```markdown\n([\s\S]*?)```/);
        if (docMatch && docMatch[1].trim().length > 50) {
            const docPath = path.join(workspaceRoot, 'docs', `${targetContract}-sdk.md`);
            await fs.mkdir(path.dirname(docPath), { recursive: true });
            await fs.writeFile(docPath, docMatch[1].trim(), 'utf-8');
            console.log(green(`✔ Saved Documentation -> ${docPath}`));
        }

        // Save example
        const exampleMatch =
            rawClient.match(/```(?:typescript|ts)?(?::examples\/[^\n]+)?\n([\s\S]*?async\s+function\s+main[\s\S]*?)```/) ||
            rawClient.match(/```(?:typescript|ts)\n([\s\S]*?main\(\)[\s\S]*?)```/);
        if (exampleMatch && exampleMatch[1].trim().length > 50) {
            const examplePath = path.join(workspaceRoot, 'examples', `${targetContract}-example.ts`);
            await fs.mkdir(path.dirname(examplePath), { recursive: true });
            await fs.writeFile(examplePath, exampleMatch[1].trim(), 'utf-8');
            console.log(green(`✔ Saved Quickstart Example -> ${examplePath}`));
        }

        // Save install.sh
        const installMatch =
            rawClient.match(/```(?:bash|sh)?(?::scripts\/[^\n]+)?\n([\s\S]*?npm\s+install[\s\S]*?)```/) ||
            rawClient.match(/```bash\n([\s\S]*?)```/);
        if (installMatch && installMatch[1].trim().length > 10) {
            const installPath = path.join(workspaceRoot, 'scripts', `${targetContract}-install.sh`);
            await fs.mkdir(path.dirname(installPath), { recursive: true });
            await fs.writeFile(installPath, installMatch[1].trim(), { encoding: 'utf-8', mode: 0o755 });
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

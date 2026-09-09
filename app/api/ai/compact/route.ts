import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getSkillsForAction } from '@/src/infrastructure/skills/skill-loader';
import { getCleanContractBaseName } from '@/src/lib/contract-utils';

export const dynamic = 'force-dynamic';

const COMPACT_SYSTEM_PROMPT = `
You are an expert AI assistant specialized in the Midnight blockchain, the Compact smart contract programming language (version >= 0.23), and the Midnight.js TypeScript SDK.

### Midnight Compact Language Principles (v >= 0.23):
1. **State & Types**:
   - \`export ledger <var>: <Type>;\` declares public on-chain state stored on the ledger.
   - Types include: \`Uint<N>\` (e.g. \`Uint<32>\`, \`Uint<64>\`), \`Bytes<N>\` (e.g. \`Bytes<32>\`), \`Boolean\`, \`Counter\`, \`Map<K, V>\`, \`Set<T>\`, \`Vector<N, T>\`, \`Maybe<T>\`, \`Opaque<"string">\`, custom structs, and enums. (NOTE: Do NOT wrap types in \`Cell<...>\`).
   - \`constructor(...) { ... }\` initializes all declared ledger state fields.

2. **MANDATORY DISCLOSE() RULE ON CONSTRUCTOR & CIRCUIT ARGUMENTS (CRITICAL)**:
   - In Midnight Compact, **ALL arguments passed to \`constructor(...)\` and \`export circuit ...(...)\` are considered PRIVATE data by default.**
   - **ALL values returned by \`witness ...()\` functions are PRIVATE data.**
   - \`disclose(<expr>)\` is a built-in wrapper function used to explicitly reveal private data on the public ledger.
   - **Whenever assigning, writing, or updating ANY constructor argument, circuit parameter, or witness value into an on-chain public ledger field (\`export ledger\`), you MUST wrap it in \`disclose(...)\`!**
   - Direct assignment like \`manager = initialManager;\` is an INVALID type error in Compact. You MUST write \`manager = disclose(initialManager);\`.
   
   Example Correct Constructor:
   \`\`\`compact
   export ledger manager: Bytes<32>;
   export ledger propertyId: Bytes<32>;
   export ledger totalAuthorizedShares: Uint<64>;
   export ledger totalIssuedShares: Uint<64>;

   constructor(
       initialManager: Bytes<32>,
       initialPropertyId: Bytes<32>,
       authorizedShares: Uint<64>
   ) {
       // ALWAYS wrap constructor arguments in disclose() when assigning to public ledger:
       manager = disclose(initialManager);
       propertyId = disclose(initialPropertyId);
       totalAuthorizedShares = disclose(authorizedShares);
       totalIssuedShares = 0; // Literal constants do not need disclose()
   }
   \`\`\`

   Example Correct Circuit:
   \`\`\`compact
   export circuit updateManager(newManager: Bytes<32>): [] {
       manager = disclose(newManager); // ALWAYS disclose() parameter before writing to ledger
   }

   export circuit deposit(amount: Uint<64>): [] {
       balance = (balance + disclose(amount)) as Uint<64>; // ALWAYS disclose() parameter in arithmetic
   }
   \`\`\`

3. **Witness Functions**:
   - Witnesses represent off-chain private computations / private state lookups.
   - Declaration: \`witness <name>(<args>): <ReturnType>;\`
   - CRITICAL WITNESS CONVENTION in TypeScript SDK: Witness functions in client runtime must return a 2-element tuple \`[nextPrivateState, witnessValue]\` (i.e. \`[PS, T]\`).

4. **Circuits & Assertions**:
   - \`export circuit <name>(<args>): <ReturnType> { ... }\` defines ZK circuits executed on client and verified on-chain.
   - \`assert(condition, "error message");\` enforces constraints and validates state transitions. Parentheses around condition and message are MANDATORY: \`assert(x > 0, "must be positive");\`.
   - Hashing: Use \`persistentHash<Type>(value)\` or \`transientHash<Type>(value)\` (e.g., \`persistentHash<Bytes<32>>(secret)\`). Do NOT use \`sha256(...)\` as a bare function name.
   - Arithmetic Casting: Operations on bounded types like \`Uint<32>\` or \`Uint<64>\` must be explicitly cast back: \`count = (count + disclose(by)) as Uint<32>;\`.
   - \`kernel.self()\` returns the contract address.

### Midnight TypeScript Client SDK (@midnight-ntwrk/midnight-js-* & compact-runtime):
- Contract class: \`import { Contract, ledger, type Witnesses } from './contract/index.js';\`
- Construction: \`const contract = new Contract(witnesses);\`
- Contexts:
  - Constructor Context: \`CompactRuntime.createConstructorContext(privateState, coinPublicKey);\` (Takes 2 arguments: privateState and coinPublicKey).
  - Initial State: \`const { currentContractState, currentPrivateState, currentZswapLocalState } = contract.initialState(constructorCtx);\`
  - Circuit Context: \`CompactRuntime.createCircuitContext(contractAddress, coinPublicKey, contractStateData, privateState);\`
  - Context Synchronization: In unit test harnesses with multi-caller flows, ALWAYS synchronize \`circuitContext.currentPrivateState = privateState\` both inside \`setCallerSecretKey(sk)\` AND immediately before circuit execution inside \`runCircuit(...)\` so witness functions receive the active caller's secret key.
- Invoking Circuits: \`const result = contract.circuits.<circuitName>(circuitContext, ...args);\`
- Reading state: \`const state = ledger(result.context.currentQueryContext.state);\`:

### MANDATORY TEST GENERATION PROTOCOL (CRITICAL - DO NOT FORGET):
Whenever generating Vitest contract tests with multiple callers (owner, Alice, Bob, etc.):
1. **Never forget to sync \`circuitContext.currentPrivateState = privateState\`**: If you fail to sync \`circuitContext.currentPrivateState\` when switching caller secret keys, the witness function will continue using the initial caller's secret key (the owner's key), causing \`authenticate()\` assertions to fail with \`"FungibleToken: caller authorization failed"\` on every non-owner circuit call (transfers, approvals, transferFrom, burn, etc.).
2. **Double-Insulate the Witness Implementation**:
   Use a tracking variable \`currentCallerSecretKey\` and a fallback in \`witnesses.localSecretKey\` so it can never read a stale key:
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
3. **Synchronize at the start of \`runCircuit\`**:
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

When responding:
- Provide high-quality, idiomatic, clean code.
- ALWAYS use \`disclose(...)\` on constructor arguments, circuit arguments, and witnesses when assigning to public ledger variables.
- When fixing compiler errors, identify the exact Compact syntax or type mismatch (such as missing disclose(), missing parentheses in assert, using sha256 instead of persistentHash, or missing constructor) and provide the complete, compilable Compact code block.
- When generating Midnight.js clients or Vitest test suites, ensure all imports, mock contexts, and witness tuples \`[PS, Value]\` are strictly type-safe, and synchronize \`circuitContext.currentPrivateState = privateState\` whenever caller identities switch.
`;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            prompt,
            action = 'chat',
            code = '',
            filename = 'contract.compact',
            diagnostics = [],
            compilerOutput = '',
            dtsContent = '',
            testOutput = '',
            model = 'gemini-3.7-flash',
            apiKey: userApiKey,
        } = body;

        const effectiveApiKey = userApiKey || process.env.GEMINI_API_KEY;

        if (!effectiveApiKey) {
            return NextResponse.json(
                {
                    error: 'MISSING_API_KEY',
                    message: 'Gemini API Key is not configured. Please enter your Google AI Studio API key in the AI Copilot settings or set GEMINI_API_KEY in your .env.local file.',
                },
                { status: 401 }
            );
        }

        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

        // Build context-aware prompt based on action
        let contextualPrompt = '';

        if (action === 'fix_error') {
            contextualPrompt = `
Task: Fix the following Compact compiler or runtime error.
Filename: ${filename}

Current Source Code:
\`\`\`compact
${code}
\`\`\`

Compiler / Diagnostic Output:
${compilerOutput || JSON.stringify(diagnostics, null, 2)}

${prompt ? `Additional user notes: ${prompt}` : ''}

Compact 0.23 Strict Guidelines to follow:
1. **assert syntax**: Must use parentheses \`assert(condition, "error message");\`.
2. **hashing**: Use \`persistentHash<Bytes<32>>(data)\` or \`transientHash<Bytes<32>>(data)\` instead of \`sha256\`.
3. **ledger fields**: Use bare types \`export ledger x: Boolean;\`, \`export ledger x: Bytes<32>;\` (never \`Cell<...>\`).
4. **disclosures**: Wrap circuit parameters and witnesses in \`disclose(...)\` when storing to ledger or doing arithmetic: \`commitHash = disclose(initialHash);\`, \`count = (count + disclose(by)) as Uint<32>;\`.
5. **constructors**: Ensure \`constructor(...) { ... }\` initializes all declared ledger variables.

Please:
1. Explain what caused the error.
2. Provide the complete, compilable fixed code block inside \`\`\`compact ... \`\`\`.
3. Highlight what changed and why.
`;
        } else if (action === 'generate_client') {
            const baseContractName = getCleanContractBaseName(filename);
            const pascalName = baseContractName
                .split('-')
                .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            contextualPrompt = `
Task: Generate a production-grade TypeScript client SDK AND comprehensive technical documentation for this Midnight Compact smart contract.
Contract Name: ${baseContractName}
Contract Filename: ${baseContractName}.compact

Compact Contract Source Code:
\`\`\`compact
${code}
\`\`\`

${dtsContent ? `Generated TypeScript Type Definitions (.d.ts):\n\`\`\`typescript\n${dtsContent}\n\`\`\`` : ''}

${prompt ? `Additional user requirements: ${prompt}` : ''}

Please structure your response into two distinct, high-quality deliverables:

### Part 1: Comprehensive SDK Documentation
Provide detailed, structured technical documentation covering:
1. **Contract Overview & Architecture**:
   - Explanation of the contract purpose.
   - Public Ledger State schema (\`export ledger ...\`) and data types.
   - Private State & Witness specification (\`witness ...\`) and security considerations.
   - Available Zero-Knowledge Circuits (\`export circuit ...\`) and their assertions/rules.
2. **Prerequisites & Installation**:
   - Required packages (\`@midnight-ntwrk/compact-runtime\`, etc.).
   - If providing terminal installation commands, specify that they are for \`scripts/${baseContractName}-install.sh\`.
3. **API Reference**:
   - Method signatures, parameters, return types, and circuit error codes.
4. **Step-by-Step Quickstart & Usage Walkthrough**:
   - Provide a complete runnable TypeScript example script (intended for \`examples/${baseContractName}-example.ts\`).
   - The script MUST begin with a header comment showing how to run it:
     \`\`\`typescript
     /**
      * Quickstart Example: ${pascalName} Client SDK
      *
      * How to run:
      *   npx tsx examples/${baseContractName}-example.ts
      */
     \`\`\`
   - IMPORTANT: The example script MUST import the SDK adapter class directly from \`../src/client/${baseContractName}-sdk.js\` (e.g. \`import { ${pascalName}Client, type ${pascalName}PrivateState } from '../src/client/${baseContractName}-sdk.js';\`).
   - Use 32-byte hex strings for mock test addresses and keys: \`const coinPublicKey = '01'.repeat(32);\` and \`const contractAddress = '00'.repeat(32);\` (in Midnight.js runtime, \`coinPublicKey\` and \`contractAddress\` are hex strings, NOT \`Uint8Array\`).
   - Demonstrate: initializing contract state with \`createConstructorContext\`, tracking on-chain state via \`let currentChargedState = initResult.currentContractState.data\` (updated after circuit runs with \`currentChargedState = result.context.currentQueryContext.state\`), creating circuit contexts with \`createCircuitContext(contractAddress, coinPublicKey, currentChargedState, privateState)\`, and querying ledger state.
5. **Privacy & Security Notes**:
   - Off-chain witness handling, avoiding disclosure leaks, and key management.

### Part 2: Production TypeScript Client SDK Implementation
Provide the complete, strongly-typed TypeScript SDK file (intended for \`src/client/${baseContractName}-sdk.ts\`) inside a \`\`\`typescript ... \`\`\` code block that adheres strictly to Midnight.js / Compact runtime conventions:
1. Imports from \`@midnight-ntwrk/compact-runtime\`:
   \`import { type CircuitContext, type QueryContext, type WitnessContext, type ConstructorContext, type ConstructorResult, type CircuitResults, type StateValue, type ChargedState } from '@midnight-ntwrk/compact-runtime';\`
2. STRICTLY imports the compiled contract artifacts from:
   \`import { Contract as ManagedContract, ledger, type Witnesses as ContractWitnesses, type Ledger as ContractLedger } from '../../contracts/managed/${baseContractName}/contract/index.js';\` (NEVER use \`./contract/index.js\`).
3. Defines strict TypeScript interfaces for \`${pascalName}PrivateState\`, \`${pascalName}Witnesses<PS>\` (witness functions taking \`context: WitnessContext<ContractLedger, PS>\` where off-chain private state is accessed via \`context.privateState\` and returning 2-element tuples \`[PS, ReturnValue]\`), and \`${pascalName}LedgerState = ContractLedger\`.
4. Implements a high-level, production-ready \`${pascalName}Client\` class with:
   - \`initialState(context: ConstructorContext<PS>): ConstructorResult<PS>\` builder.
   - Type-safe circuit execution methods managing circuit contexts. (NOTE: Circuits with no return value in Compact return \`CircuitResults<PS, []>\` with the unit empty tuple \`[]\`, NOT \`void\`).
   - Strongly-typed ledger state query helper: \`queryLedgerStateFromRaw(rawState: StateValue | ChargedState | unknown): ${pascalName}LedgerState { return ledger(rawState as StateValue | ChargedState); }\`.
   - Comprehensive TSDoc inline comments.
`;
        } else if (action === 'generate_tests') {
            const cleanContractName = getCleanContractBaseName(filename);
            contextualPrompt = `
Task: Generate a comprehensive Vitest unit test suite for this Compact contract strictly adhering to the Midnight-CQ Compact Contract Testing Standards.
Contract Name: ${cleanContractName}
Contract Filename: ${cleanContractName}.compact
Expected Test File: tests/contracts/${cleanContractName}.test.ts

Compact Contract Code:
\`\`\`compact
${code}
\`\`\`

${dtsContent ? `TypeScript Type Definitions (.d.ts):\n\`\`\`typescript\n${dtsContent}\n\`\`\`` : ''}

${prompt ? `Additional test cases requested: ${prompt}` : ''}

MANDATORY MIDNIGHT-CQ TEST GENERATION RULES (CRITICAL - DO NOT VIOLATE):
1. **EXACT IMPORTS (NEVER DEVIATE)**:
   \`\`\`typescript
   import { describe, it, expect, beforeEach } from 'vitest';
   import * as CompactRuntime from '@midnight-ntwrk/compact-runtime';
   import { Contract, ledger, type Witnesses } from '../../contracts/managed/${cleanContractName}/contract/index.js';
   \`\`\`
   - WARNING: NEVER use \`import { CompactRuntime }\`! \`CompactRuntime\` is NOT a named export; you MUST use \`import * as CompactRuntime\`.
   - WARNING: NEVER import from \`./contract/index.js\`! The test file is in \`tests/contracts/\`, so the path to the managed contract MUST be \`../../contracts/managed/${cleanContractName}/contract/index.js\`.

2. **ALL COMPACT UINT VALUES MUST BE BIGINT**:
   - All Compact \`Uint<N>\` types (\`Uint<8>\`, \`Uint<16>\`, \`Uint<32>\`, \`Uint<64>\`, \`Uint<128>\`, \`Uint<256>\`) in TypeScript runtime require \`bigint\` literals (e.g. \`8n\`, \`18n\`, \`1_000n\`). Passing numbers causes runtime type errors.
   - Always implement an auto-normalizing runner in the test file that also ensures \`circuitContext.currentPrivateState\` is synced:
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

3. **BIGINT RETURN ASSERTIONS**:
   - When asserting \`Uint<N>\` returns (such as \`decimals()\` or \`totalSupply()\`), expect \`bigint\` or convert with \`Number(...)\`:
     \`expect(Number(decimals)).toBe(8);\` (or \`expect(decimals).toBe(8n);\`)
     \`expect(totalSupply).toBe(0n);\`

4. **MODULE vs CONTRACT AWARENESS**:
   - If the Compact contract is defined inside \`module <Name> { ... }\`, internal module circuits are NOT visible on \`Contract.circuits\`. Tests must ONLY invoke circuits that are declared top-level on \`Circuits<PS>\` in the generated \`.d.ts\`.

5. **EXACT ERROR STRING ASSERTIONS**:
   - Negative tests MUST assert the exact string from \`assert(condition, "error message")\`:
     \`expect(() => runCircuit(contract.circuits.xyz, ...)).toThrow('Exact error message');\`

6. **DETERMINISTIC MOCK DATA**:
   - Create 32-byte key arrays: \`const createKey = (b: number): Uint8Array => new Uint8Array(32).fill(b);\`
   - Context addresses: \`const dummyContractAddress = '00'.repeat(32); const dummyCoinPublicKey = '01'.repeat(32);\`

7. **CALLER AUTHENTICATION & MULTI-CALLER PRIVATE STATE SYNCHRONIZATION (CRITICAL - DO NOT FORGET)**:
   - **MANDATORY: SYNC PRIVATE STATE WHEN SWITCHING CALLERS**:
     When simulating multiple callers (e.g. owner, Alice, Bob) and switching secret keys via \`setCallerSecretKey(sk)\`, you MUST explicitly synchronize \`circuitContext.currentPrivateState = privateState\`.
     **DO NOT FORGET THIS**: If \`circuitContext.currentPrivateState\` is not synchronized when switching callers, the witness function will continue using the initial caller's secret key (the owner's key), causing \`authenticate()\` assertions to fail with \`"FungibleToken: caller authorization failed"\` on every non-owner circuit call (transfers, approvals, transferFrom, burning, etc.) and failing the entire test suite.
   - Always implement the double-insulated witness pattern and synchronizer:
     \`\`\`typescript
     let currentCallerSecretKey: Uint8Array = ownerSK;
     let privateState: PrivateState = { currentSecretKey: ownerSK };

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
   - **DYNAMIC PERSISTENT HASH RESOLUTION FOR DERIVED ACCOUNTS**:
     In Compact contracts with multiple persistent hashes (e.g. \`persistentHash<[Bytes<32>, ContractAddress]>\` for contract account and \`persistentHash<[Bytes<32>, ContractAddress, Bytes<32>]>\` for user authentication), the compiler generates multiple methods (\`_persistentHash_0\`, \`_persistentHash_1\`, etc.).
     NEVER hardcode \`_persistentHash_0\`! Instead, dynamically find the method where altering \`sk\` produces distinct outputs:
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
       } catch {
         return false;
       }
     }) || '_persistentHash_0';

     const deriveAccount = (sk: Uint8Array): Uint8Array => {
       return (helperContract as any)[accountHashMethod]([domainTagAuth, { bytes: dummyAddressBytes }, sk]);
     };
     \`\`\`
   - NEVER use a fallback that returns raw \`sk\` (\`return sk;\`). Raw secret keys will cause \`authenticate()\` assertions to fail with \`caller authorization failed\`.

8. **UNEXPORTED INTERNAL CIRCUITS (CRITICAL)**:
   - In Compact, only circuits declared with \`export circuit\` are exposed on \`contract.circuits\`.
   - Circuits declared without \`export\` (such as \`pure circuit isZeroKey(...)\` or \`circuit _transfer(...)\`) are private internal circuits and DO NOT exist on \`contract.circuits\`.
   - NEVER call \`contract.circuits.isZeroKey\`, \`contract.circuits.zeroKey\`, or \`contract.pureCircuits.<name>\`.
   - For internal zero-key checks or helper logic, implement local TypeScript utility helpers in the test:
     \`\`\`typescript
     const isZeroKey = (key: Uint8Array): boolean => key.every((b) => b === 0);
     const zeroKey = (): Uint8Array => new Uint8Array(32).fill(0);
     \`\`\`

Please generate the complete, runnable Vitest test file (\`tests/contracts/${cleanContractName}.test.ts\`) inside a \`\`\`typescript ... \`\`\` code block.
`;
        } else if (action === 'audit_zk') {
            contextualPrompt = `
Task: Conduct a Zero-Knowledge, Privacy, and Logic Audit for this Compact contract.
Filename: ${filename}

Compact Contract Code:
\`\`\`compact
${code}
\`\`\`

${prompt ? `User focus: ${prompt}` : ''}

Please review:
1. **Privacy & Witness Leakage**: Are private inputs disclosed inadvertently or inappropriately on the ledger?
2. **Circuit Constraints & Assertions**: Are all preconditions, bounds, and owner permissions strictly enforced with \`assert\`?
3. **State Machine Integrity**: Can the contract get stuck in an invalid state? Are sequence numbers or identifiers properly maintained?
4. **Actionable Recommendations**: Clear, specific improvements with code snippets.
`;
        } else if (action === 'explain') {
            contextualPrompt = `
Task: Explain this Compact smart contract and its ZK architecture.
Filename: ${filename}

Compact Contract Code:
\`\`\`compact
${code}
\`\`\`

${prompt ? `Specific question: ${prompt}` : ''}

Please explain:
1. **Contract Overview & Purpose**: What problem it solves and its main domain model.
2. **Public Ledger State**: What is recorded on-chain.
3. **Private Witness Computations**: What stays off-chain and private.
4. **Circuits & Transitions**: How users interact with it step-by-step.
`;
        } else {
            // General Chat
            contextualPrompt = `
Contract Filename: ${filename}

${code ? `Active Contract Code:\n\`\`\`compact\n${code}\n\`\`\`` : ''}
${compilerOutput ? `Recent Compiler Output:\n${compilerOutput}` : ''}
${testOutput ? `Recent Test Output:\n${testOutput}` : ''}

User Message:
${prompt}
`;
        }

        // Dynamically inject relevant Midnight Expert Skills from .agents/plugins/
        const injectedSkills = getSkillsForAction(action, prompt);
        const effectiveSystemPrompt = injectedSkills
            ? `${COMPACT_SYSTEM_PROMPT}\n\n${injectedSkills}`
            : COMPACT_SYSTEM_PROMPT;

        // Use selected model, default to gemini-3.7-flash
        const selectedModel = model || 'gemini-3.7-flash';

        const responseStream = await ai.models.generateContentStream({
            model: selectedModel,
            contents: contextualPrompt,
            config: {
                systemInstruction: effectiveSystemPrompt,
                temperature: action === 'chat' ? 0.4 : 0.2,
            },
        });

        // Set up streaming response
        const encoder = new TextEncoder();
        const customStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of responseStream) {
                        const text = chunk.text;
                        if (text) {
                            controller.enqueue(encoder.encode(text));
                        }
                    }
                    controller.close();
                } catch (err: any) {
                    controller.error(err);
                }
            },
        });

        return new Response(customStream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Transfer-Encoding': 'chunked',
            },
        });
    } catch (error: any) {
        console.error('Gemini AI API Error:', error);
        return NextResponse.json(
            {
                error: 'AI_GENERATION_FAILED',
                message: error?.message || 'Failed to generate response from Gemini Flash.',
            },
            { status: 500 }
        );
    }
}

# Implementation Plan: Export DApp Bundle for Gemini

Add a dedicated **"Export DApp Bundle for Gemini"** button and modal directly inside the Web Studio IDE. This allows developers to export with one click all compiled contract artifacts, ZKIR circuit bytecodes, TypeScript client SDK, tests, documentation, and a tailor-made **Gemini Master Prompt** (`GEMINI_DAPP_PROMPT.md`) so Gemini can immediately scaffold a complete React/Next.js frontend architecture.

---

## User Review Required

> [!IMPORTANT]
> **ZIP Archive Strategy**:
> We will create an API route `POST /api/workspace/export-dapp` to package the bundle.
> We plan to use `jszip` (lightweight, zero-native dependencies) for building the in-memory `.zip` archive on the server. If unavailable or during offline operation, the endpoint will fall back to using Linux `/usr/bin/zip` command.
>
> **Artifacts Included in the Bundle**:
> 1. `contract/index.js`, `contract/index.d.ts` (compiled contract runtime)
> 2. `zkir/*.zkir` (all circuit ZKIR bytecode for proofs)
> 3. `contracts/<contract>.compact` (source Compact contract)
> 4. `sdk/<contract>-sdk.ts` (Midnight TypeScript client adapter)
> 5. `docs/<contract>-sdk.md` (SDK documentation)
> 6. `examples/<contract>-example.ts` (Quickstart script)
> 7. `tests/<contract>.test.ts` (Vitest test suite)
> 8. `scripts/<contract>-install.sh` (environment script)
> 9. `deployment.config.json` (contract address and devnet endpoints)
> 10. `GEMINI_DAPP_PROMPT.md` (comprehensive prompt guide for Gemini to scaffold the React/Next.js DApp)

---

## Proposed Changes

### 1. Backend: DApp Export API Route & Bundle Builder

#### [NEW] [`app/api/workspace/export-dapp/route.ts`](file:///home/paul/compact/midnight-compact-studio/app/api/workspace/export-dapp/route.ts)
- Receives `POST` request with `{ contract: string, deploymentConfig?: DeploymentConfig }`.
- Resolves the contract clean name via `getCleanContractBaseName(contract)`.
- Scans and bundles all existing files from:
  - `contracts/managed/<contract>/contract/index.js` & `index.d.ts`
  - `contracts/managed/<contract>/zkir/*.zkir`
  - `contracts/<contract>.compact`
  - `src/client/<contract>-sdk.ts`
  - `docs/<contract>-sdk.md`
  - `examples/<contract>-example.ts`
  - `tests/contracts/<contract>.test.ts`
  - `scripts/<contract>-install.sh`
- Dynamically creates `deployment.config.json`:
  ```json
  {
    "contractName": "fungible-token",
    "contractAddress": "0000000000000000000000000000000000000000000000000000000000000000",
    "networkId": "devnet",
    "indexerUrl": "http://127.0.0.1:8088/api/v4/graphql",
    "indexerWsUrl": "ws://127.0.0.1:8088/api/v4/graphql/ws",
    "nodeUrl": "http://127.0.0.1:9944",
    "proofServerUrl": "http://127.0.0.1:6300"
  }
  ```
- Dynamically creates `GEMINI_DAPP_PROMPT.md` tailored specifically to the contract:
  - **1) Clean Architecture**: Enforces separation across Domain (`entities/`, `ports/` like `i-wallet.gateway.ts`, `i-contract.gateway.ts`, `i-activity.storage.ts`), Application (`use-cases/`), Infrastructure (`adapters/`, providers), and Presentation (`context/`, `hooks/`, `components/`).
  - **2) UI Side Panel**: Mandates a persistent, collapsible left navigation sidebar with branding, network status badge, menu navigation (Dashboard, Circuits, Activity, Config), and bottom wallet status widget.
  - **3) Comprehensive Dashboard**: Mandates a feature-rich central hub with token/user metrics, contract status cards, quick action triggers, and live transaction stepper/activity feed.
  - Explains the wallet connection via `window.midnight` (Lace / DApp Connector).
  - Outlines the 5-provider assembly (`WalletProvider`, `PublicDataProvider`, `ProofProvider`, `ZKConfigProvider`, `PrivateStateProvider`).
  - Instructs how to build custom React hooks (`useContractState`, `useCircuitAction`).
  - Explains how to construct the UI with real-time feedback, ZK proof progress, and transaction statuses.
- Packages all files into `<contract>-dapp-bundle.zip` and returns with binary headers.

---

### 2. Frontend: Export Modal Component

#### [NEW] [`components/ExportDappModal.tsx`](file:///home/paul/compact/midnight-compact-studio/components/ExportDappModal.tsx)
- Sleek modern modal opened from the IDE toolbar or AI Copilot.
- **Contract Header**: Shows the active contract name and status of available artifacts.
- **File Checklist Preview**: Lists all artifacts detected on disk with status indicators (found vs not yet generated).
- **Deployment Settings Form**:
  - Optional inputs for `contractAddress` (with random 32-byte generator button), `networkId` (`devnet`, `testnet-remote`, `preview`), and service endpoints.
- **Action Buttons**:
  - **"Download ZIP Bundle"**: Downloads the complete `.zip` file for Gemini.
  - **"Copy Gemini Master Prompt"**: Copies the full `GEMINI_DAPP_PROMPT.md` content to clipboard for instant pasting into Gemini.
  - **"Close"**.

---

### 3. Studio IDE Integration

#### [MODIFY] [`app/ide/page.tsx`](file:///home/paul/compact/midnight-compact-studio/app/ide/page.tsx)
- Add **"Export DApp Bundle"** button in the main top toolbar (alongside Compile & Deploy) with a distinctive icon (`PackageOpen` or `Boxes`) and tooltip.
- Connect state `isExportModalOpen` to toggle `<ExportDappModal />`.
- Ensure it uses `lastCompactContractRef.current.filename` so even if a non-compact file is active in the editor, the correct contract is targeted.

#### [MODIFY] [`components/AiCopilotPanel.tsx`](file:///home/paul/compact/midnight-compact-studio/components/AiCopilotPanel.tsx)
- Add an **"Export DApp Bundle"** action button in the `Generated Deliverables` section of Copilot, allowing quick export immediately after generating the client SDK or tests.

---

## Verification Plan

### Automated Tests
1. **API Route Tests**:
   - Create [`tests/application/export-dapp.test.ts`](file:///home/paul/compact/midnight-compact-studio/tests/application/export-dapp.test.ts) to verify that `POST /api/workspace/export-dapp` returns a valid zip containing all contract files and `GEMINI_DAPP_PROMPT.md`.
2. **Vitest Suite**:
   - Run `npm test` to verify all existing and new tests pass.
3. **Type Checking**:
   - Run `npx tsc --noEmit` to ensure zero TypeScript errors.

### Manual Verification
1. Open `http://127.0.0.1:3000/ide` in the browser.
2. Verify the **"Export DApp Bundle"** button appears in the toolbar.
3. Click the button for `fungible-token.compact` to open the modal.
4. Verify the artifact checklist shows the detected files.
5. Click **"Download ZIP Bundle"** and confirm `<contract>-dapp-bundle.zip` downloads.
6. Extract the zip and inspect the contents to verify:
   - `contract/index.js` and `contract/index.d.ts` are present
   - `zkir/*.zkir` are present
   - `GEMINI_DAPP_PROMPT.md` contains clear, high-quality prompt instructions
   - `deployment.config.json` is formatted properly
7. Test the **"Copy Gemini Master Prompt"** button and confirm clipboard copy.

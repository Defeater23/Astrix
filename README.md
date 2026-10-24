# Sentinel Wallet - Agent Wallet: Letting AI Agents Pay Safely

Security-first wallet for AI agents. The agent proposes transactions; smart-account
authorization and on-chain policy decide what may execute.

**Current delivery: Module 7C (cryptographic owner authorization) on top of 7A, 7B and the partial,
NOT ACCEPTED Module 06.** 7C adds `SentinelOwnerApproval` and `SentinelApprovalKernelHook`
(Solidity, EIP-712 owner signature verified on-chain, single use, bound to the exact operation,
account, chain and expiry) plus `features/authorization/` (TypeScript signing, local verification and
the verifier for the 7B release gate). **The Solidity was not compiled or run by the author;
`forge build && forge test -vv` is the first step.** The Module 06 gate is still unmet. See
"Owner authorization (Module 7C)" below, `docs/OWNER_AUTHORIZATION.md` and MODULE_HANDOVER.md.

**Previous delivery: Module 7B (approval request data model, validation and workflow) on top of
Module 7A and the partial, NOT ACCEPTED Module 06.** 7B adds typed approval requests, strict
validation, expiry, nonce and duplicate protection and a status lifecycle as domain logic under
`features/requests/`; there is no new UI and no signature. A stored `approved` status never
authorizes execution. See "Approval request workflow" below, `docs/REQUEST_WORKFLOW.md` and
MODULE_HANDOVER.md.

**Module 7A** (owner approval UI, demo data) adds the `/approvals` queue and review UI only; its
decisions are local to this browser and are not signatures. See "Owner approval review" below.

**Earlier headline: Module 05 of 12 - Spending Policy Engine (front end only, drafts)**
(cumulative: includes Modules 01 to 04: design system, MetaMask integration, read-only
smart-account overview and the browser-local agent registry). The app can configure per-agent
spending policy **drafts** and preview a hypothetical transaction against them. **Nothing is
enforced on-chain**: policies and agent records live in this browser only, and there is no deployed
contract code of ours, no backend, database or AI yet. Nothing has been security-audited.
**Real Vitest and production-build runs of Modules 01 to 05 are still unconfirmed by the author of
this delivery; see MODULE_HANDOVER.md.** Use test networks and test funds only.

## Requirements

- Windows 10/11 with VS Code (Linux and macOS also work)
- Node.js 20.11 or newer (22 LTS recommended) and npm 10+
- Git (optional)

Check versions in PowerShell:

```powershell
node -v
npm -v
```

## Setup (PowerShell)

From the project root (the folder containing this README):

```powershell
cd apps\web
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:5173. The dev server uses a fixed port and fails if it is taken.

If PowerShell blocks npm with an execution-policy error, run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Commands

Run from `apps\web` (or from the root using the same names, which delegate to `apps/web`):

| Command                | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Start the dev server on port 5173                           |
| `npm run build`        | Type-check, then build to `dist/`                           |
| `npm run preview`      | Serve the production build on port 4173                     |
| `npm run typecheck`    | Strict TypeScript check                                     |
| `npm run lint`         | ESLint (TypeScript, React hooks, jsx-a11y)                  |
| `npm run format`       | Format with Prettier                                        |
| `npm run format:check` | Verify formatting                                           |
| `npm test`             | Run Vitest once                                             |
| `npm run check`        | typecheck, lint, format check, tests and build, in sequence |

## Service ports

| Service         | Port | Status              |
| --------------- | ---- | ------------------- |
| Vite dev server | 5173 | Used in Module 01   |
| Vite preview    | 4173 | Used in Module 01   |
| Backend API     | 4000 | Reserved, not built |

## Environment variables

Defined in `apps/web/.env.example`. Only `VITE_`-prefixed variables reach the browser, so never
put secrets in them.

| Variable                             | Default                      | Meaning                                                                            |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| `VITE_APP_NAME`                      | Sentinel Wallet              | Display name                                                                       |
| `VITE_DEFAULT_CHAIN_ID`              | 11155111                     | Preferred chain: 11155111 (Sepolia) or 31337 (Anvil). Other values fail at startup |
| `VITE_EXPLORER_URL`                  | https://sepolia.etherscan.io | Explorer base URL (used from Module 09)                                            |
| `VITE_API_BASE_URL`                  | http://localhost:4000        | Backend URL (used from Module 04)                                                  |
| `VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA` | empty                        | Smart-account address on Sepolia (public data, optional)                           |
| `VITE_SMART_ACCOUNT_ADDRESS_ANVIL`   | empty                        | Smart-account address on local Anvil (optional)                                    |

Invalid values (for example a non-numeric chain ID or a non-http URL) throw a clear error at
startup instead of being silently accepted.

## Project structure

```
apps/web/
  src/
    components/ui/       Button, Card, Dialog, Field, Notice, Table, Toast, ...
    components/layout/   AppShell, SidebarNav, PageHeader, BrandMark
    features/wallet/     chains, error classification, state derivation, wagmi config,
                         provider, useWallet hook, WalletStatus (top bar)
    features/smart-account/  EntryPoint v0.7 constants, deployment-state derivation, config,
                         read-only chain reads, hook and Wallet page sections
    features/agents/     agent rules (validation, lifecycle), local storage, hook, registry UI
    features/policies/   policy draft validation, rules evaluator, local storage, hook, editor and preview
    features/execution/  Module 06 domain layer (advisory validation, status derivation); no UI yet
    features/approvals/  Module 7A: demo requests, calldata description, local decisions, queue/review UI
    features/requests/   Module 7B: request schema and validation, status lifecycle, registry, storage,
                         release gate (interface for 7C); domain logic only, no UI
    config/              env parsing, navigation and planned-scope data
    pages/               Landing, placeholder pages, design system, not found
    test/                Vitest setup
  tailwind.config.ts     Monochrome tokens (colors replaced, not extended)
docs/ARCHITECTURE.md     Stack confirmation and module decisions
docs/SMART_ACCOUNT.md    EntryPoint, account choice, UserOperation lifecycle, open items
contracts/               Foundry scaffold and read-only chain check script (no Solidity yet)
MODULE_HANDOVER.md       Features, test results and limitations for this delivery
```

## Routes

`/` landing page. Inside the application shell: `/dashboard`, `/wallet`, `/agents`,
`/policies`, `/approvals`, `/ai-agent`, `/transactions`, `/analytics`, `/security`,
`/settings`, and `/design-system`. `/wallet`, `/agents`, `/policies` and `/approvals` are real pages. The
remaining feature pages are placeholders that state which module delivers them and show
"Unavailable" instead of data.

## Wallet and network behavior (Module 02)

- **Connect / disconnect:** the top bar and the Wallet page use the MetaMask injected connector
  only. Connecting shares your public address and chain ID. No signature or transaction is
  requested, and the app never asks for a seed phrase or private key.
- **Supported networks:** Ethereum Sepolia (11155111) and local Anvil (31337). Anything else,
  including Ethereum mainnet, is shown as "Unsupported network" with a switch button.
- **Switch to Sepolia:** requests `wallet_switchEthereumChain`. If MetaMask does not know the
  network, wagmi asks MetaMask to add it; if that fails you see an error and nothing changes.
- **Live changes:** account and network changes made inside MetaMask update the display, because
  wagmi listens to the provider's `accountsChanged` and `chainChanged` events.
- **Errors handled:** rejected request, request already pending, MetaMask missing, network not
  added, unsupported network, and unknown provider errors. Each shows a plain message and a
  Dismiss button; failed actions never change displayed wallet state.
- **Reload:** wagmi remembers only which connector was last used (in `localStorage`) and
  silently reconnects if MetaMask still has the site connected. No keys are stored.
- **Disconnect limit:** "Disconnect" clears the app's connection. MetaMask may still list the
  site as connected; remove it under MetaMask's connected-sites settings if you want that too.

### Manual MetaMask checklist

Automated tests use a mock wallet, not the real extension. Please run these once in a browser
with MetaMask installed (`npm run dev`, open http://localhost:5173/wallet):

1. Without MetaMask enabled: top bar says "MetaMask not detected", connect is disabled.
2. Click Connect, reject in MetaMask: error message appears, still "not connected".
3. Click Connect, approve: address (short in top bar, full on Wallet page) and chain appear.
4. In MetaMask switch to Ethereum Mainnet: status becomes "Unsupported network".
5. Click "Switch to Sepolia", approve: status shows Sepolia, chain ID 11155111.
6. Switch accounts in MetaMask: the displayed address changes.
7. Click Disconnect: returns to "not connected".
8. Reload while connected: reconnects, or shows "not connected" if you removed the site.

## Smart account overview (Module 03)

- **Read-only.** The Wallet page reads the owner balance, EntryPoint v0.7 code presence and, if
  an address is configured, the smart account's code, native balance and EntryPoint deposit.
  Nothing is signed, sent or deployed.
- **Separate addresses.** The owner EOA (MetaMask) and the smart account are different cards.
- **Configure the account.** Put its address in `apps/web/.env.local` as
  `VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA` or `VITE_SMART_ACCOUNT_ADDRESS_ANVIL`. It is not derived
  from a factory yet.
- **States:** Not configured, Unknown (read failed), Counterfactual (no code), Deployed (code
  present). "Initialized" is never shown because it needs the pinned account implementation.
- **Units:** balances are exact (bigint wei formatted without floating point) and labeled with
  the network name and chain ID. Failed reads show the error, never a number.
- **Local Anvil:** a fresh chain has no EntryPoint; the page says so. See docs/SMART_ACCOUNT.md.
- **Read-only chain check (needs Foundry):** `contracts\scripts\check-chain.ps1`.

### Manual checklist for Module 03

With MetaMask on Sepolia and `npm run dev`, open /wallet:

1. Disconnected: smart account and balances show "Unavailable".
2. Connect: owner balance appears labeled "Sepolia, chain ID 11155111"; compare with MetaMask.
3. With no address configured: "No smart account configured for this network".
4. Set `VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA` to an address with no code, restart: "Counterfactual".
5. Set it to a contract address: "Deployed (code present)", initialization "Not determined".
6. Switch MetaMask to mainnet: "Unsupported network", no chain data shown.
7. Switch to local Anvil: EntryPoint card reports "No contract found" with the Anvil note.

## Agent registry (Module 04, local only)

- **What it is.** The Agents page registers agents (name, optional description, signer address,
  optional expiry in UTC) for the connected owner on the connected network, and lists them with
  Active, Paused, Expired or Revoked status.
- **What it is not.** Records live in this browser's `localStorage` under a key scoped by chain ID
  and owner address. Nothing is written to the smart account and nothing is enforced on-chain.
  Pausing, revoking or expiring an agent here does not remove any on-chain authority. The page,
  the confirmation dialogs and the toasts all say so. Enforcement in the smart-account layer is
  **not delivered** in this module (see MODULE_HANDOVER.md).
- **Rules (pure code, unit-tested).** Signer must be a valid checksummed address, not the zero
  address, not the owner account, not already registered and not a previously revoked signer.
  A pasted private key or seed phrase is rejected. Names and descriptions reject control and
  direction-override characters. Expiry must be at least a minute in the future. Expired is
  derived from the clock, never stored; revoked is terminal; expired agents cannot be resumed.
- **Failure behavior.** If the browser cannot save, the change is not applied and an error shows.
  Corrupt or invalid stored data is ignored and reported, never shown as agents.

### Manual checklist for Module 04

With MetaMask on Sepolia and `npm run dev`, open /agents:

1. Disconnected: "No wallet connected", no Register button, not-enforced notice visible.
2. Connect: empty registry with zero counts; click Register agent.
3. Submit empty: field errors. Enter your own owner address as signer: rejected.
4. Register with a fresh address and no expiry: row shows Active; reload keeps it.
5. Pause then Resume, each through the confirmation dialog; status follows.
6. Register another with an expiry two minutes ahead; wait: it becomes Expired and cannot resume.
7. Revoke one: Revoked, all actions disabled; registering the same signer again is rejected.
8. Switch MetaMask accounts or network: the list changes to that owner and network's records.

## Spending policy drafts (Module 05, local only)

- **What it is.** The Policies page edits one draft per agent: a per-transaction limit and a daily
  cumulative limit (native ETH, exact wei, no floating point), and allowlists for recipients,
  tokens, contracts and 4-byte function selectors. A preview panel evaluates a hypothetical native
  transfer, token transfer or contract call against the draft and lists every passing and failing
  check.
- **What it is not.** Drafts are saved in `localStorage` (scoped by chain ID and owner). The smart
  account does not hold them, so they do not limit any agent key. The "Submit on-chain" button is
  disabled with a reason, and "Submitted" and "Confirmed on-chain" are shown as unavailable. Stored
  records claiming any state other than draft are rejected on load.
- **Semantics (deny by default).** An empty allowlist allows nothing of that kind. Limits apply to
  native value only; token amounts are not limited. The daily window is the UTC calendar day, and
  "already spent today" is typed by hand in the preview because spending is not tracked yet. A
  paused, expired or revoked agent is denied everything. Malformed stored limits fail closed.
- **Reference for later modules.** `features/policies/evaluate.ts` is a pure function intended to be
  mirrored by the account-layer policy and tested against the same cases.

### Manual checklist for Module 05

With MetaMask on Sepolia, at least one agent registered on /agents, open /policies:

1. Disconnected: "No wallet connected"; no Save button. With no agents: "No agents to configure".
2. Pick an agent, enter limits and one recipient, Save draft: state shows Draft; reload keeps it.
3. Enter a daily limit below the per-transaction limit, or a bad address: field errors, nothing saved.
4. In the preview, send to the allowed recipient under the limit: "Would be allowed by this draft".
5. Raise the value above the limit, or use another recipient: denied, with the failing checks listed.
6. Pause the agent on /agents and preview again: denied with "Fail: Agent status".
7. "Submit on-chain" stays disabled with a tooltip reason.

## Owner approval review (Module 7A, UI only)

Open `/approvals` with a wallet connected on a supported network. The page shows a queue of
approval requests (filters: Pending, Decided, Expired), an exact-operation review dialog, and
Approve/Reject with a confirmation step.

- **Demo data only.** 7A has no request backend. The requests come from deterministic fixtures
  (`features/approvals/demoData.ts`) and the page says so. Nothing is an agent's real output.
- **A decision is not authorization.** Approve and Reject record a decision in this browser's
  `localStorage` only. No signature is created, nothing is submitted, and nothing is verified
  on-chain. Cryptographic owner approval is Module 7C.
- **Exact review.** Addresses, nonce, calldata and amounts are shown in full. Amounts are exact
  base units; a formatted amount appears only when decimals are known, and is labelled as not
  verified on-chain. Only ERC-20 `transfer` and `approve` are decoded; anything else is shown as
  raw, undecoded calldata. Malformed calldata is flagged, never repaired.
- **Fresh review after changes.** A decision is bound to the exact reviewed payload. If any field
  changes, the decision no longer applies and the request is pending again.
- **Fail closed in the UI.** Expired requests and requests for another chain cannot be approved;
  malformed requests are hidden and counted instead of shown with guessed values.
- Demo fixtures are anchored to the current UTC day, so they roll over at 00:00 UTC.
- "Reset local decisions" clears the stored decisions for the connected account and network.

Details: `docs/APPROVAL_UI.md`.

## Approval request workflow (Module 7B, domain logic only)

`apps/web/src/features/requests/` defines what an approval request is and how it may change. It
has no screen of its own and creates no signature.

- **Typed, exact requests.** A request carries the exact Module 6 operation plus a typed
  description. Validation requires both to agree, so the owner cannot be shown one thing while the
  calldata encodes another. Unknown fields, bad addresses or integers, unsupported chains,
  malformed calldata, over-long or too-short expiry, and prohibited operations (zero address, the
  account itself, native value on token calls, zero-amount transfers) are rejected.
- **Lifecycle.** `pending`, `approved`, `rejected`, `expired`, `cancelled`, `superseded`. Only the
  owner can approve or reject, and only for the payload they reviewed and before expiry. A
  materially changed request needs a new ID; the old one can be superseded.
- **Duplicates and nonces.** The same payload is idempotent; the same ID with a different payload
  is refused; two active requests may not share an account nonce.
- **Not authorization.** `approved` only records owner intent in this app. `evaluateRelease`
  refuses to release any request without a cryptographic verifier (Module 7C), so in 7B it always
  refuses.
- The Approvals page still shows the labelled demo data; connecting it to this workflow is 7D.

Details and the interface required by 7C: `docs/REQUEST_WORKFLOW.md`.

## Owner authorization (Module 7C, contracts unverified)

- `contracts/src/SentinelOwnerApproval.sol`: verifies the owner's EIP-712 signature, records it, and
  lets an owner-approved hook consume it exactly once.
- `contracts/src/SentinelApprovalKernelHook.sol`: Module 06 hook plus approval consumption. Policy
  runs first, so prohibited operations stay prohibited even with a valid approval.
- `contracts/test/SentinelOwnerApproval.t.sol`: 43 Foundry tests (NOT RUN).
- `apps/web/src/features/authorization/`: `typedData`, `verify` and tests (37, run under a shim).
- Nothing in the UI signs yet; the `/approvals` buttons are still not signatures (7D).

```powershell
cd contracts
forge build; forge test -vv
cd ..\apps\web
npm run format; npm run check
```

## Design rules enforced in code

- Strict monochrome: Tailwind colors are replaced with white, off-white, grays, charcoal and
  black. `monochrome.test.ts` fails if a non-gray color, gradient, shadow or blur appears.
- Every control works or is disabled with a reason (tooltip plus screen-reader text).
- Visible focus outlines, skip link, labelled dialogs with focus trap, polite notifications.

## Troubleshooting

- **Port 5173 in use:** close the other process or change `server.port` in `vite.config.ts`.
- **`npm install` fails behind a proxy:** configure `npm config set proxy` and `https-proxy`.
- **Blank page:** check the browser console; an invalid `.env.local` value throws at startup.
- **Line-ending warnings from Git on Windows:** harmless; Prettier is set to LF.

## Roadmap

Modules 04 and 05 delivered interfaces and draft rules only; account-layer enforcement of agent status and spending
policy is still open and is required before either can be trusted. Module 06 (Transaction Validation & Execution) is next. The full 12-module plan is in the
original plan document; module scope is mirrored in `apps/web/src/config/navigation.ts`.


## Module 05 completion pass (contracts, unverified)

`contracts/src/SentinelPolicy.sol` and Foundry tests were added. They have not been compiled or run
by the author, and the web app is not connected to them. See `MODULE_HANDOVER.md` and
`docs/POLICY_CONTRACT.md`.

## Module 06 (partial)

`apps/web/src/features/execution/` adds the Kernel-independent execution domain layer (validation,
evidence-based status, idempotent tracking). The Module 06 gate is not met until the Kernel adapter
exists. See `MODULE_HANDOVER.md` and `docs/EXECUTION_MODEL.md`.


## Module 7D (partial, not accepted)

`apps/web/src/features/approval-flow/` joins the 7B workflow, the 7C owner signature and the Module 06
ledger: the app can only release the exact operation the owner reviewed and signed, once. `contracts/test/
CrossLanguageApproval.t.sol` checks a TypeScript-generated vector on-chain (not yet run). The UI is not
wired and the Module 06 gate is unmet. See `MODULE_HANDOVER.md` and `docs/APPROVAL_FLOW.md`.

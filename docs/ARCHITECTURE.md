# Architecture and Scope Confirmation

This document confirms the architecture from the master instructions and the
"Agent Wallet - Final 12-Module Development Plan". It describes intent. It does not claim
that any feature beyond Module 01 exists.

## Core principle

The AI agent proposes transactions. Smart-account authorization and on-chain policy
enforcement determine whether they may execute. The frontend, AI model, backend and
database are never the sole security authority.

## Stack (unchanged from the plan)

| Layer       | Choice                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| Frontend    | React, Vite, TypeScript (strict), Tailwind CSS, React Router            |
| Wallet      | wagmi, viem, MetaMask (from Module 02)                                  |
| Backend     | Node.js, TypeScript, documented HTTP API (from Module 04 onward)        |
| Database    | PostgreSQL for indexing and presentation only, never authorization      |
| Contracts   | Solidity, Foundry, Anvil (from Module 04/05 onward)                     |
| Network     | Ethereum Sepolia plus a local Anvil chain for repeatable tests          |
| Account     | Maintained ERC-4337 smart account and compatible EntryPoint (Module 03) |
| AI          | Configurable LLM API with structured proposals; scripted mode for tests |
| Environment | VS Code on Windows, PowerShell instructions                             |

## Module 01 scope (this delivery)

Included: Vite/React/TypeScript app, Tailwind monochrome design system, React Router,
landing page, responsive shell, reusable accessible components, navigable placeholder pages,
linting, formatting, type checks, baseline tests, environment parsing, documentation.

Not included, by design: wallet connection, smart accounts, contracts, backend, database,
AI, analytics, security tests. Placeholder pages display "Unavailable" and say which module
delivers the feature. No balance, transaction, approval or status is fabricated.

## Decisions made in Module 01

- **Tailwind 3.4** with `theme.colors` replaced (not extended). Colored utilities cannot be
  generated. Shadows, blur and background images are disabled in `corePlugins`.
- **React 18 and React Router 6** chosen for broad compatibility with wagmi and viem in
  Module 02. This is a conservative choice, not a verified requirement; Module 02 will check
  the wagmi version's peer dependencies before relying on it.
- **Single `apps/web` package** with root delegating scripts. Backend and contracts folders
  are added when their modules begin, to avoid empty scaffolding that implies functionality.
- **Version ranges are caret ranges, not exact pins**, and no lockfile is shipped yet. See
  MODULE_HANDOVER.md for why, and for the step that creates the lockfile.

## Open items resolved or carried from Module 03

EntryPoint version and address were checked against vendor documentation and Kernel's policy
surface was reviewed; see `docs/SMART_ACCOUNT.md`. The account version, bundler and Anvil
EntryPoint placement remain unverified and are listed there.

## Module 02 decisions

- **wagmi v2 + viem v2 + TanStack Query v5** with the `injected({ target: 'metaMask' })`
  connector. The heavier MetaMask SDK connector was not chosen because the plan needs only
  browser-extension connection. EIP-6963 multi-wallet discovery is disabled for determinism.
- **Supported chains** are Sepolia and Anvil (31337) only. `VITE_DEFAULT_CHAIN_ID` must be one
  of them or the app throws at startup.
- **Wallet state is derived, never stored by the app.** `deriveWalletState` is a pure function
  of facts reported by wagmi; `classifyWalletError` maps provider errors to a fixed set of kinds.
  Both are unit-tested without a browser.
- **Test strategy:** pure logic tests, presentational component tests, and integration tests
  using wagmi's mock connector. A real-extension checklist is in the README because the mock
  cannot prove MetaMask behavior.
- **No signing or sending** exists in this module. Later modules must trigger those only from an
  explicit user action.

## Module 03 decisions

- **EntryPoint v0.7** pinned in one constant; the account, factory, bundler and paymaster must
  all match it.
- **Kernel v3 (ERC-7579)** chosen as the intended account, with a custom Sentinel policy module
  planned for Module 05 because documented Kernel policies include no cumulative value cap or
  recipient allowlist. The Kernel SDK was **not** added as a dependency yet: nothing uses it, and
  its version and API are unverified.
- **Read-only reads** use plain RPC calls (`eth_getBalance`, `eth_getCode`, one view call).
  Smart-account address is configuration, not derived. No signing or sending was added.
- **Foundry scaffold** (`contracts/`) added with no Solidity.

## Module 04 decisions

- **Front-end-only registry.** At the owner's request the Agents page ships without contract or
  backend work, because Foundry, Postgres and the package registry were unavailable to verify
  Solidity or a server. Agent records are local to the browser (`localStorage`, scoped by chain ID
  and owner) and are **not** an authorization mechanism. Agent status must never be read from this
  store to decide whether an operation may execute.
- **Rules are pure functions** (`features/agents/validation.ts`, `lifecycle.ts`) so the same rules
  can be mirrored in the contract layer and backend later and tested against the same cases.
- **Still undecided:** Kernel v3 versus a custom account, and how agent status reaches the account
  (validator state, policy contract or registry contract). That decision gates real enforcement.

## Module 05 decisions

- **Drafts only, again.** Policy configuration and the rules evaluator ship without the on-chain
  policy contract, for the same reason as Module 04 (no Foundry or registry access to verify
  Solidity). A saved draft is a browser record, never an authorization source.
- **Fail closed.** Empty allowlists deny; malformed stored limits deny; paused, expired or revoked
  agents are denied everything; stored state other than "draft" is rejected so edited storage cannot
  fake a submitted or confirmed policy.
- **Known gaps against the plan's protections:** token amount limits, parameter-level call
  restrictions, a rolling (rather than UTC calendar) daily window, on-chain atomic daily counters,
  and permission expiry/pause/revocation enforced by the account are all unbuilt.
- **Evaluator as spec.** `features/policies/evaluate.ts` and its tests are the intended behavioral
  reference for the contract implementation.

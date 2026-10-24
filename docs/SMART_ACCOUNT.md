# Smart account, EntryPoint and UserOperation lifecycle (Module 03)

Status legend: **Verified from docs** means confirmed in vendor documentation during Module 03.
**Decision** is a project choice. **Not verified** has not been confirmed and must be before use.

## Chosen stack

| Item           | Choice                                               | Status                                                        |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| EntryPoint     | v0.7, `0x0000000071727De22E5E9d8BAf0edAc6f37da032`   | Address verified from viem / permissionless docs              |
| Account        | ZeroDev Kernel v3 (ERC-7579 modular, EntryPoint 0.7) | Decision. Exact version, factory ABI and install not verified |
| Client library | viem 2.x built-in account abstraction                | Verified: viem has had AA primitives since 2.18.0             |
| Bundler        | Not selected                                         | Not verified. Needs a v0.7 bundler for Sepolia and Anvil      |
| Paymaster      | Not used                                             | Owner or account funds gas; revisit in Module 6               |

Why v0.7: it is the version the permissionless/Pimlico account helpers default to and the one
viem v2 exposes as `entryPoint07Address`. The viem docs state that the account, factory, bundler
and paymaster must all support the same EntryPoint, so v0.7 is pinned in
`apps/web/src/features/smart-account/entryPoint.ts`. viem's v3 documentation (still a
pre-release, `3.0.0-next.10` when read) lists v0.8 and v0.9 as well; this project stays on viem v2.

## Why Kernel, and what it does not cover

Kernel's permission system composes signers and policies. Documented policies are call
(contract, function and parameter restrictions), gas, signature, rate limit and timestamp.
For Sentinel Wallet that leaves gaps:

- There is no documented built-in **cumulative daily value cap** or **recipient allowlist**. The
  rate-limit policy counts UserOps, not value spent.
- The rate-limit-with-reset policy reads `block.timestamp` and ZeroDev documents that it
  violates ERC-4337 storage rules, so it only works with some bundlers.

Module 05 therefore needs a custom Sentinel policy module (Kernel documents that custom
permission plugins can be written). That module will be unaudited code and must be covered by the
Foundry tests the plan requires. **No policy enforcement exists in Module 03.**

Alternative considered: a custom account on eth-infinitism `BaseAccount`. Rejected as the default
because the plan asks for an established implementation, but it remains the fallback if Kernel's
verified API cannot express the required policy.

## Policy-enforcement extension points (to confirm in Module 4/5)

1. A Kernel permission validator holding the agent's signer and Sentinel policy contracts.
2. Owner-only functions (install/uninstall validators, change policy) reachable only through
   the owner's validator, so the agent key cannot reach them.
3. Policy state (spent today, limits, expiry) stored in the policy contract, updated atomically in
   the same validation or execution step that approves the call.

These are design intentions from vendor docs, not tested behavior.

## What the web app does in Module 03

- Reads, on the connected chain: owner native balance, EntryPoint code presence, and, if an
  address is configured, the smart account's code, native balance and EntryPoint deposit.
- Shows the owner EOA and smart account as separate addresses.
- Deployment state is `Not configured`, `Unknown` (read failed), `Counterfactual (not deployed)`
  (no code) or `Deployed (code present)`. Initialization is never reported as "initialized"; it
  needs the pinned implementation's ABI.
- The smart-account address comes from `VITE_SMART_ACCOUNT_ADDRESS_SEPOLIA` / `_ANVIL`. It is
  **not** derived from a factory in this module.
- Reads run on load, on account or chain change and on Refresh. There is no polling.

## UserOperation lifecycle (reference for Module 6)

1. The agent or owner builds a UserOperation for the smart account (sender, nonce, call data, gas
   fields; `initCode` or factory data if the account is not yet deployed).
2. The account's validator signs the UserOperation hash, which binds the EntryPoint address and chain ID.
3. A bundler receives it via `eth_sendUserOperation`, simulates validation and holds it in a
   mempool.
4. The bundler packs UserOperations into a `handleOps` transaction to the EntryPoint.
5. The EntryPoint calls the account's validation, then execution. Gas is paid from the
   account's EntryPoint deposit or by a paymaster.
6. The outcome is read from the UserOperation receipt and the transaction receipt. A status is
   only reported as confirmed after that evidence exists.

## Open items before Module 04

- Pin and verify Kernel version, factory and install path (`forge install` tag or commit).
- Choose a bundler that supports EntryPoint v0.7 on Sepolia and local Anvil, and verify it.
- Decide how EntryPoint v0.7 is placed at its canonical address on Anvil (not verified).
- Derive the counterfactual address from the factory once the factory ABI is verified.
- Run the app against a real chain and record the evidence this module could not.

## Evidence this module does NOT have

Nothing here was executed against Sepolia, Anvil or MetaMask, and nothing was compiled or
type-checked with installed dependencies. See MODULE_HANDOVER.md for the full list.

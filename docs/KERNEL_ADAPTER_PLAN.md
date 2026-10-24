# Kernel v3 adapter: proposed architecture (PROPOSAL; interfaces NOT yet verified)

Nothing here may be implemented until the real Kernel v3 sources are available in `contracts/lib`.
Items marked **VERIFY** are my understanding of Kernel v3 / ERC-7579 and must be confirmed against
the pinned source and tests before any code is written.

## Goal

An agent signs UserOperations; the Kernel account executes them only if `SentinelPolicy` approves
each call. The owner keeps unrestricted authority through the account's root validator.

## Why not call the policy from validation

Validation-phase code is limited by ERC-4337 storage and opcode rules (notably `TIMESTAMP`, and
reading storage of unassociated contracts). The policy uses `block.timestamp` and its own storage.
So the policy check and spend recording must happen in the **execution phase**.

## Proposed design **(VERIFY each point)**

1. **Agent validator.** The agent gets its own validation entry in Kernel (a signature validator for
   the agent's EOA, ECDSA module or equivalent), installed by the owner, scoped to the account's
   execute selector(s) only. It cannot call install/uninstall, ownership or config functions.
2. **SentinelHook (ERC-7579 hook).** Installed as that validation entry's hook. Kernel calls
   `preCheck` before execution, in the execution phase, with the original call data. The hook:
   - decodes the ERC-7579 execution mode and rejects anything except plain `CALL` (single or batch);
     `DELEGATECALL` and unknown modes revert;
   - for each inner call calls `SentinelPolicy.validateAndRecord(agent, target, value, data)`;
   - takes `agent` from its own per-account configuration for this validation entry, never from calldata.
3. **Policy recorder binding.** `SentinelPolicy.account` is currently the only address allowed to
   record. With Kernel the caller is the hook. Proposed minimal change: bind the hook address as the
   recorder (rename or add `bindEnforcer`), keep `ForbiddenTarget` pointing at the Kernel account.
   A policy per Kernel account, a hook per account (or a hook keyed by `msg.sender`), to be decided
   after reading the hook interface.
4. **Owner path unchanged.** Root validator has no Sentinel hook.
5. **Revocation.** Owner revokes in the policy (`revokeAgent`) and may also uninstall the agent's
   validation entry in Kernel; either alone stops execution, both is cleanest.

## Open questions to settle from source

- Exact hook interface and how a hook is attached to a validation entry, including `preCheck`
  arguments and whether `msg.sender`/validator identity is available to the hook.
- ERC-7579 mode and `executionCalldata` encoding for single and batch, and whether other execute
  paths exist (e.g. `executeFromExecutor`, `executeUserOp`) that skip the hook.
- Selector scoping API (what the agent entry can call) and the default behaviour for unlisted selectors.
- Which EntryPoint version the pinned Kernel tag targets, and the canonical EntryPoint deployment
  on Anvil.
- Kernel's own permission policies (`IPolicy`) as an alternative for the validation-phase part of the
  agent limits, and whether any of the daily accounting could safely live there.

## Required integration tests (to be written after sources are available)

Agent op within limits executes; over per-tx, over daily, unlisted recipient/selector, paused,
revoked, expired agent all revert; agent cannot call account config/install functions; delegatecall
mode rejected; batch with one bad call reverts entirely; policy accounting rolls back on failure;
owner (root validator) can still act and can revoke; every path via the real EntryPoint on Anvil.

## What I need from you (cannot fetch it here)

```bash
cd contracts
forge install zerodevapp/kernel@<tag>      # tell me the tag you choose; I suggest the latest v3.x release tag
git -C lib/kernel describe --tags
git -C lib/kernel submodule status
```
Then either upload `contracts/lib/kernel/src` (zip it, no `.git`) plus its `foundry.toml` and
`remappings.txt`, or paste the files: `src/Kernel.sol`, `src/core/ValidationManager.sol`,
`src/core/HookManager.sol` (if present), `src/interfaces/IERC7579Modules.sol`, `src/utils/ExecLib.sol`,
`src/types/Types.sol`, and the ERC-4337 EntryPoint source/version it imports. Also an existing Kernel
test that creates an account with a hooked validator, if one exists.

## Status update (latest session)

Both supplied ZIPs (Module 05 and Module 06) were inspected: neither contains `contracts/lib/kernel`,
and the session had no Foundry, Anvil or network access. The adapter is therefore still an unverified
proposal. Trust-boundary note carried into implementation: the hook's `msgSender` is whoever called the
account entry point (for a UserOperation, the EntryPoint), so it does NOT identify the agent. The agent
identity must come from the validation entry that authenticated the UserOperation signature and be
stored in hook configuration keyed by that entry, never from calldata. SentinelPolicy's bound-account
check must not be weakened; bind the hook as the recorder only after the source confirms the call path.


## Kernel 0.3.3 source review (this session, read-only; nothing compiled or run)

The uploaded `kernel-source.zip` contains only `lib/kernel/src` (34 files, `Kernel.sol` reports version
0.3.3). It lacks Kernel's dependencies (solady, an EntryPoint v0.7 implementation), forge-std and a
remappings file, so Kernel cannot be built from it alone. Findings from reading the source:

- A UserOp is validated by a validation entry selected from `userOp.nonce`. `validateUserOp` stores that
  entry's hook in `executionHook[userOpHash]`. For a non-root entry with a real hook it requires
  `callData[0:4] == executeUserOp.selector` and `allowedSelectors[vId][callData[4:8]]`.
- `executeUserOp` calls `hook.preCheck(msg.sender = EntryPoint, msg.value, userOp.callData[4:])`, then
  delegatecalls to itself with `callData[4:]`, then `postCheck`. A revert in the inner call reverts
  `executeUserOp`, so state recorded in `preCheck` is rolled back.
- The hook is NOT told the validation entry or the agent. Agent identity therefore has to be structural:
  one hook instance per agent, installed only on that agent's validation entry. `msgSender` is the
  EntryPoint and must not be trusted as the agent.
- Other reachable paths: `execute` (EntryPoint, self or root validator only), `executeFromExecutor`
  (registered executors, each with their own hook) and `fallback` selectors. The agent's entry must be
  granted only the `execute(bytes32,bytes)` selector, install no executors, and never be root.
- `ExecLib.execute` supports single, batch, delegatecall and a non-reverting "try" exec type.

### Implemented (unverified until compiled and run)

- `contracts/src/SentinelKernelHook.sol`: per-agent hook, immutable ACCOUNT/AGENT/POLICY, only the account
  may call it, strict canonical decoding, single and batch CALL only, rejects delegatecall/static/try,
  empty or >16-call batches and non-zero value, records each inner call via `validateAndRecord`.
- `contracts/src/SentinelPolicy.sol`: added `setEnforcer` (owner only) and `enforcers`; `validateAndRecord`
  now accepts the bound account or an owner-approved enforcer. Agents cannot become enforcers and vice
  versa. Direct calls by agents or strangers still revert. This is a deliberate, minimal extension
  of the Module 05 trust boundary and needs review plus a rerun of all 46 earlier tests.
- `contracts/test/SentinelKernelHook.t.sol`: hook-level tests. NOT a Kernel/EntryPoint integration test.

### Still required before this can be called integrated

1. `forge install` Kernel at the pinned tag plus solady, forge-std and the EntryPoint v0.7 source; compile
   everything and rerun the 46 existing tests plus the new ones.
2. Deploy the real EntryPoint on Anvil, create a Kernel account (root = owner), install an ECDSA validator
   for the agent with this hook and only the `execute` selector granted, and submit real UserOps through a
   bundler. Needed cases: valid op; bad signature; wrong chain; expired validUntil; wrong or reused nonce;
   altered callData; duplicate submission; over-limit; delegatecall mode; batch split; reverted inner call
   with accounting rolled back; agent attempting `installModule`, `grantAccess` or `execute` via root.
3. Review how the validator's `validUntil` (ValidAfter/ValidUntil) is set for agent expiry.

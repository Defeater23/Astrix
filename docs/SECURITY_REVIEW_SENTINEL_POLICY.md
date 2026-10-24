# SentinelPolicy review (internal, not an audit)

Reviewer: the Claude agent that wrote the contract, so this is a self-review and carries the usual
blind spots. It is **not** an independent audit and must not be described as one. Scope: `src/`,
`test/`, `script/`, docs. Baseline reported by the project owner: build OK, 44 tests passed.

## Fixed in this pass (change not yet run; see commands in MODULE_HANDOVER.md)

| ID  | Severity     | Finding | Fix |
| --- | ------------ | ------- | --- |
| R-1 | Low-Medium   | `bindAccount` did not reject an address that is (or was) a registered agent. The owner binding an agent address as the recorder would let that agent call `validateAndRecord` directly and write its own accounting. `registerAgent` already blocked the reverse order. | `bindAccount` reverts `InvalidAgent` if `agents[account_].status != None`. Test added. |
| R-2 | Medium (config-dependent) | An owner allowlisting the bound account or the policy itself (as recipient or call rule) would let the agent call account/policy functions through the policy path, a self-escalation route. | `_evaluate` reverts `ForbiddenTarget` when `target` is the policy or the bound account. Test added. |

## Open (documented, not changed)

| ID  | Severity | Finding | Why not changed |
| --- | -------- | ------- | --------------- |
| R-3 | Low | Call rules are not cleared when a token is disallowed. A stale `approve` rule on a token address set before the token was allowlisted would become live again after `setToken(..., false)`. | Cannot enumerate selectors on-chain cheaply; owner must remove rules. Keep rules and token lists disjoint. |
| R-4 | Info | Policy does not know the call type. A Kernel `DELEGATECALL` execution would run foreign code as the account. | Must be rejected by the adapter, which sees the ERC-7579 mode. |
| R-5 | Info | Batch executions and re-entrancy: each call must be passed to `validateAndRecord` separately. State is written before the external call (checks-effects), which is correct. | Adapter responsibility. |
| R-6 | Info | `agent` is a parameter. The adapter must derive it from the validated signer/validator, never from calldata. | Adapter responsibility. |
| R-7 | Info | Recorder = bound address. With Kernel the caller will be a hook, not the account, so the binding concept must point at the hook (or a per-account enforcer). | See adapter plan. |
| R-8 | Info | UTC-day window allows two full limits across midnight; fee-on-transfer tokens counted at requested amount; no timelock; owner immutable, so key loss means no recovery; wrong `bindAccount` bricks the instance (redeploy). | Design limits, documented. |

## Not reviewed

- Lint warnings: please send the output of `forge lint` and `forge fmt --check`; I have not seen them.
- Gas, formal verification, invariant tests, mutation testing.
- Anything outside this repo (Kernel, EntryPoint, bundler).

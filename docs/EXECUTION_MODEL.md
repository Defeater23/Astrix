# Module 06 execution model (domain layer, Kernel-independent part)

Location: `apps/web/src/features/execution/`. Pure TypeScript, no network, no wallet, no chain access.
It does not execute anything and is not an authority: the smart account's signature validation and
`SentinelPolicy` decide what runs.

## Pieces

- `types.ts`: `OperationRequest` (account, agent, chainId, nonce, expiry, target, value, data) and
  `ExecutionEvidence` (client rejections, user rejection, policy rejection, bundler submission,
  inclusion receipt, unexpected error).
- `validate.ts`: `validateOperation` returns every advisory rejection: bad address/amount/nonce/data,
  wrong chain, wrong account, expired (expiry second included), nonce mismatch, nonce reused, agent not
  authorized, advisory policy preview denied. `operationKey` is a canonical idempotency identity
  (normalised case and numbers). It is not the signed digest and gives no security binding.
- `status.ts`: `deriveStatus(evidence)` maps evidence to one of `not_submitted`, `validation_failed`,
  `user_rejected`, `policy_rejected`, `submission_failed`, `pending`, `confirmed`, `reverted`, `error`.
  `confirmed` requires a successful bundle receipt and a successful UserOperationEvent. An included
  but undecoded operation stays `pending`.
- `tracker.ts`: immutable ledger. Identical payload returns the existing record (duplicate); a
  different payload on the same account, chain and nonce is flagged `nonce_conflict`. `canSubmit`
  allows a retry only when the failed attempt produced no UserOperation hash, otherwise it says to poll.
  `recordEvidence` never overwrites a final `confirmed`/`reverted` outcome.

## What this does NOT provide (Kernel-dependent, not done)

Signing, building the UserOperation, bundler calls, receipt and event fetching, the account-side
signature, nonce, chain and expiry checks, policy enforcement during execution, and the local-chain
UserOperation test. Those need the Kernel v3 adapter (`docs/KERNEL_ADAPTER_PLAN.md`) and a bundler and
EntryPoint on Anvil. Module 06's acceptance gate is NOT met without them.

## Limits

Statuses are only as good as the evidence the future chain code supplies. Final outcomes can in theory
be reorged away; the tracker does not model reorgs. The ledger is in memory only (no persistence yet).
No UI route consumes this layer yet.

## Tests

`validate.test.ts`, `status.test.ts`, `tracker.test.ts` (30 tests, Vitest syntax). Run with
`cd apps/web; npm test`. In the authoring environment Vitest was not installed, so they were executed
once under a small compatible shim (`describe`/`it`/`expect` subset): 30 passed. That is not a Vitest,
type-check, lint or Prettier run.

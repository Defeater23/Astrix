# Module 7A: Owner approval UI and request review

Status: implemented, partially verified (see MODULE_HANDOVER.md for what was and was not run).

## What it is

A review surface only. It lets the owner see exactly what an operation would do and record a
local Approve or Reject decision. It is not an authorization mechanism.

## What it is not

- No signature is created and no private key or seed phrase is touched.
- Nothing is submitted to a bundler or chain, and no Module 6 execution code is called.
- A recorded "approved" decision cannot make the smart account or `SentinelPolicy` execute
  anything. The on-chain path remains the only authority (roadmap section 5).
- The browser store can be edited by anyone with the profile, so it is never trusted as proof.

## Data

`ApprovalRequest` wraps the Module 6 `OperationRequest` (account, agent, chainId, nonce,
expiresAt, target, value, data) with `id`, `purpose`, `reason`, `createdAt` and optional
`tokenMeta` (symbol and decimals supplied with the request, unverified).

7A ships one `ApprovalRequestSource`, `demoApprovalSource`, returning seven labelled fixtures:
ERC-20 transfer, native transfer, unknown contract call, ERC-20 approve, an expired request, a
request for another chain, and malformed calldata. The `list` signature returns `unknown[]` so a
real source (Module 7B) is checked by the same display guard. Fixture addresses and tokens do not
exist on any chain.

## Display rules

- `guard.ts`: a request with a bad address, non-canonical integer string, odd-length or non-hex
  calldata, chain ID 0 or invalid token metadata is hidden and counted, never shown with guessed
  values. This is a display guard, not the 7B schema.
- `decode.ts`: only ERC-20 `transfer` (`0xa9059cbb`) and `approve` (`0x095ea8b0`) with exactly
  4 + 64 + 64 bytes and a clean address word are decoded. Anything else is a raw call; known
  selectors with the wrong length or dirty address bits are flagged malformed.
- `format.ts`: exact `bigint` arithmetic only. No floating point.
- Warnings: network mismatch, self-targeting, native value on a token call, zero-value transfer,
  allowance grants, undecoded calldata.

## Decisions

`decisions.ts` stores `{requestId, decision, decidedAt, fingerprint}` in `localStorage` under
`sentinel-wallet:approval-decisions:v1:<chainId>:<owner>`. Valid values are `ui_approved` and
`ui_rejected` only; the loader rejects anything else, duplicates and malformed records.

The fingerprint is a canonical string of every reviewed field (id, account, agent, chain, nonce,
expiry, target, value, calldata, purpose, reason, token metadata). A decision applies only while
the fingerprint matches, so a material change returns the request to pending ("fresh review").
Decisions are final in the UI; the only way back is "Reset local decisions".

Approve is blocked for expired requests, requests for a chain other than the connected one, and
already-decided requests, with the reason shown. Reject is blocked for expired and decided ones.

## Interfaces for 7B and 7C

- Replace `demoApprovalSource` with a real source that returns validated typed requests.
- 7B owns the request schema, nonce/operation ID uniqueness, expiry validation and status
  transitions. The local `ApprovalStatus` here is display state, not the workflow state machine.
- 7C owns the owner signature. The fingerprint here is NOT the signed digest; the signed payload
  must be defined against the smart account's actual signature scheme (Kernel 0.3.3, EntryPoint
  v0.7). Module 6 is not yet accepted, which blocks 7C until its gate is met.

## Files

`apps/web/src/features/approvals/`: `types`, `format`, `guard`, `decode`, `decisions`, `rows`,
`demoData`, `useApprovals`, `OperationDetails`, `ApprovalWorkspace` (plus tests);
`apps/web/src/pages/ApprovalsPage.tsx` (plus test). Shared `Dialog` gained an optional `size`.

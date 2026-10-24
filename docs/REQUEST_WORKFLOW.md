# Module 7B: approval request data model, validation and workflow

Status: implemented as pure TypeScript domain logic, partially verified (see MODULE_HANDOVER.md).
Location: `apps/web/src/features/requests/`. No UI was changed and no contract was touched.

## The rule this module exists to protect

Application and database state is separate from authorization. A request whose status is
`approved` records that the owner clicked Approve in this app for one exact payload. It cannot make
the smart account or `SentinelPolicy` execute anything. Only the owner's signature (Module 7C),
verified by the account and enforced by the on-chain policy, authorizes execution. Browser storage
is editable by anyone with the profile, so it is never evidence.

## Request schema (`types.ts`, `schema.ts`)

`RequestPayload` (schema version 1):

| Field | Meaning |
| ----- | ------- |
| `schemaVersion` | Must be `1`. |
| `requestId` | 1 to 64 chars (`A-Za-z0-9`, `.` `_` `:` `-`), unique per owner and chain. |
| `owner` | Address asked to review and, in 7C, sign. Lowercased on parse. |
| `createdAt` | Unix seconds. Not more than 300 s in the future. |
| `purpose`, `reason` | Agent-supplied text, at most 500 chars, no control or direction-override characters. |
| `tokenMeta?` | Symbol (1 to 20 printable chars) and decimals (0 to 36). Display only, unverified. |
| `typed` | What the request claims to do: `native_transfer`, `erc20_transfer`, `erc20_approve` or `contract_call`. |
| `operation` | The Module 6 `OperationRequest`: `account`, `agent`, `chainId`, `nonce`, `expiresAt`, `target`, `value`, `data`. This is the exact payload that would execute. |

`parseRequest(input, ctx)` is strict:

- unknown fields are rejected at every level; nothing is repaired or defaulted;
- addresses are 20-byte hex, integers are canonical decimal strings that fit `uint256`, calldata is
  even-length hex, chain ID must be in `ctx.supportedChainIds` (pass `SUPPORTED_CHAIN_IDS`);
- expiry must be after creation, at most 7 days after it, and in the future (the last check is
  skipped only when re-reading stored records);
- **the typed description must equal what the calldata really encodes** (kind, token, recipient or
  spender, amount, selector, value). An agent cannot show one thing and encode another;
- prohibited: zero addresses, targeting the smart account itself, native value on a token call,
  zero-amount transfers, token transfers or approvals to the zero address, malformed or truncated
  token calldata, and a token call disguised as a generic contract call;
- warnings (non-blocking): unlimited allowance, undecoded calldata.

It returns every blocking issue at once (`code`, `path`, `message`) or a normalized request, its
fingerprint and the warnings. Approving zero (revoking an allowance) is allowed.

`requestFingerprint` is a canonical string over every material field. It detects change; it is NOT
the digest the owner signs. `deriveTyped` is exported for the agent side (Module 8) to build the
typed field from calldata.

## Status lifecycle (`lifecycle.ts`)

```
pending  -> approved    owner, payload unchanged since review, not expired
pending  -> rejected    owner, not expired
pending  -> cancelled   agent or owner
approved -> cancelled   owner (revokes the app-level approval)
pending | approved -> expired      system, only once the expiry time has passed
pending | approved -> superseded   system, when a replacement request is submitted
```

`rejected`, `expired`, `cancelled` and `superseded` are final. Approve is refused when the
reviewed fingerprint differs from the stored one (`STALE_REVIEW`), when the stored payload no
longer matches its own fingerprint (`INTEGRITY`), when the clock is earlier than the last recorded
change, or when the request has expired. Every change is appended to `history` with actor and time.
`approved` is never reachable by the agent or the system.

## Registry (`registry.ts`)

Immutable operations over a store keyed by `requestId`:

- `submit`: the same payload again returns the existing record (`duplicate`). A known ID with a
  different payload is refused (`ID_REUSED_WITH_DIFFERENT_PAYLOAD`): a materially changed request
  needs a new ID. Two active requests may not share an `(chainId, account, nonce)`
  (`NONCE_CONFLICT`, or `DUPLICATE_OPERATION` when the operation is identical). Nonces of rejected,
  cancelled, expired or superseded requests may be reused. `supersedes` retires an active request
  of the same owner, chain, account and agent atomically, including an approved one, so its approval
  cannot be used. The store holds at most 500 records.
- `decide`, `cancel`, `expireDue`: apply the lifecycle. Overdue requests are expired first and the
  updated store is returned even when the requested change fails.

## Storage (`storage.ts`)

`sentinel-wallet:requests:v1:<chainId>:<owner>` in `localStorage`. Loading re-parses every record
with the same schema, recomputes and compares the fingerprint, checks that the history is a valid
chain ending in the stored status, checks owner and chain against the scope, and drops anything
inconsistent (counted, never shown). A self-consistent forgery cannot be detected; a test documents
this limit on purpose.

## Interfaces for 7C and 7D (`release.ts`)

`evaluateRelease(record, { owner, execution }, { verifier, evidence })` answers "may the app hand
this to the Module 6 submit path?". It allows only when ALL hold: status `approved`; not expired;
connected owner equals request owner; stored payload equals its fingerprint and the approval was
recorded for it; Module 6 `validateOperation` passes (chain, account, nonce, agent, policy
preview); and an `AuthorizationVerifier` accepts the owner's signature `evidence`. It reports every
block at once.

7B ships **no verifier**, so in this module the answer is always no (`NO_VERIFIER`). The tests use
clearly labelled test doubles to prove the wiring only.

7C must provide:

1. `AuthorizationVerifier.verify({ request, fingerprint, evidence, nowSeconds })` that checks the
   owner signature against the account's real signature scheme (Kernel 0.3.3 validators, EntryPoint
   v0.7) and binds it to the exact operation, account, chain ID, nonce and expiry;
2. the definition of the signed digest (the 7B fingerprint is not it);
3. the on-chain verification path and tests for forged, expired, altered, wrong-account,
   wrong-chain, reused and replayed approvals.

7D must call `evaluateRelease` before Module 6 `registerOperation` / `canSubmit`, and confirm that
the operation shown, signed and executed are byte-identical.

## 7A integration

`adapter.ts` maps a record to the 7A `ApprovalRequest` and offers `createWorkflowSource`, an
`ApprovalRequestSource` (`kind: 'workflow'`) listing active requests. The Approvals page still uses
the labelled demo source: no agent produces real requests until Module 8, and the 7A decisions
(`ui_approved` / `ui_rejected`, localStorage) are not yet connected to this lifecycle. That
wiring is left for 7D so it can be tested end to end.

## Not done in 7B

No signature, no on-chain code, no backend or database, no real request producer, no UI changes.

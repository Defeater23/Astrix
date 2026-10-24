# Module 7D: approval flow integration (logic layer)

Location: `apps/web/src/features/approval-flow/flow.ts`. Pure TypeScript. It joins the 7B request
workflow, the 7C owner signature and the Module 06 execution ledger. **It is advisory.** The smart
account validates the UserOperation signature, `SentinelPolicy` enforces limits, and
`SentinelOwnerApproval` is consumed by the hook at execution. Nothing here authorizes anything.

## Flow

1. **Review.** `snapshotForReview(record)` freezes what the owner sees: request ID, fingerprint and the
   hash of the exact `execute(bytes32,bytes)` call data that would run.
2. **Sign.** The owner signs the EIP-712 `OwnerApproval` (7C). `verifyOwnerSignature` checks it locally.
3. **Record.** `recordSignedApproval` marks the request `approved` only if the verified signature is for
   the same reviewed fingerprint. `recordRejection` records a rejection; nothing can be sent afterwards.
4. **Put the approval on-chain.** `submitApprovalCall` (7C) data is sent by anyone. The app must then read
   `SentinelOwnerApproval.statusOf(digest)` (`onChainStatusFromIndex`).
5. **Prepare.** `prepareExecution` returns a frozen `ExecutionPlan` only if ALL of these hold: the 7B
   release gate passes (approved, unexpired, owner matches, Module 06 validation incl. nonce, verifier
   accepts the evidence), the reviewed snapshot equals the payload now being released, the signed message
   equals it field by field (account, agent, nonce, expiry, execution hash, digest, chain), the on-chain
   approval is `approved`, and the ledger allows a submission (no duplicate, no nonce conflict). Every
   failure is reported, not just the first.
6. **Send.** `createSubmissionController(sender).submit(plan, ledger)` sends at most once: it re-checks the
   ledger, keeps an in-flight set against double clicks and concurrent calls, and records the outcome.
   A sender that throws becomes `error` and blocks blind retries (the UserOperation may have been sent).
   A retry is allowed only after a bundler error that produced no UserOperation hash.
7. **Confirm.** `recordInclusion` adds receipt evidence. `confirmed` needs a successful receipt AND a
   successful UserOperationEvent; a confirmed or reverted outcome is never overwritten.

## Not done in 7D (blockers and gaps)

- **No UI wiring.** `/approvals` still shows the labelled demo source; its Approve/Reject are not
  signatures. No page calls this module. No wallet signing, chain reads, bundler client or `OperationSender`
  implementation exists. Wiring it needs real RPC reads and the deployed contract addresses.
- **Module 06 gate unmet.** No UserOperation has executed on a local chain. The Kernel integration tests
  and all Solidity remain unrun (see MODULE_HANDOVER.md).
- Batch executions: the TypeScript side builds single CALL only.

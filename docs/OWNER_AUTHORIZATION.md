# Module 7C: cryptographic owner authorization

Status: written, **not compiled or run on the Solidity side** (no Foundry in the authoring sandbox).
The TypeScript side ran under a pure-JS shim, not real viem or Vitest. See MODULE_HANDOVER.md for
the exact results. No audit is claimed.

## What was inspected first

- `SentinelPolicy` (Module 05): single `owner` (immutable EOA), one bound `account`, owner-only
  admin, `validateAndRecord` callable by the account or an owner-approved enforcer.
- `SentinelKernelHook` (Module 06): per-agent ERC-7579 hook. Kernel calls
  `preCheck(entryPoint, 0, userOp.callData[4:])` from `executeUserOp`; the hook decodes
  `execute(bytes32,bytes)` (single CALL or batch), calls the policy, and a revert rolls everything
  back. It cannot see the UserOperation, its nonce or its signature.
- Kernel 0.3.3 source in `contracts/lib/kernel/src`, EntryPoint v0.7. The Kernel root validator and
  the agent validators check the UserOperation signature; they are unchanged.

## Design

The owner's approval is a separate, single-use authorization that the agent's execution path must
consume. It does not replace the agent's UserOperation signature, the EntryPoint nonce or the policy.

```
owner wallet --EIP-712 signature--> SentinelOwnerApproval.submitApproval   (anyone may relay)
                                        verifies signer == policy owner, records approval
agent UserOp -> EntryPoint -> Kernel.executeUserOp -> SentinelApprovalKernelHook.preCheck
                                        1. policy.validateAndRecord(...)   (limits, recipients, ...)
                                        2. approvals.consume(agent, keccak256(msgData))
                                        reverts if there is no live approval for exactly these bytes
```

Contracts (`contracts/src/`):

- `SentinelOwnerApproval.sol`: EIP-712 domain `SentinelOwnerApproval` v1, chain ID and verifying
  contract read at verification time. Struct
  `OwnerApproval(address account,address agent,bytes32 operationId,uint256 userOpNonce,bytes32 executionHash,uint64 expiry)`.
- `SentinelApprovalKernelHook.sol`: copy of the Module 06 hook plus approval consumption. The Module 05
  and 06 contracts and their 69 owner-verified tests are untouched.

## What the signature binds

| Element                | How it is bound                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| Operation              | `executionHash = keccak256(execute(mode, executionCalldata))`: mode, target, value, calldata |
| Account                | `account` field must equal `POLICY.account()`                                |
| Agent                  | `agent` field; the slot is `(agent, executionHash)`                          |
| Chain                  | EIP-712 domain `chainId` = `block.chainid`                                   |
| Approval contract      | EIP-712 domain `verifyingContract` = `address(this)`                         |
| Single use             | `operationId` is never accepted twice; consumption is one-shot               |
| Expiry                 | `expiry` checked at submission and again at consumption; max 7 days          |
| Signer                 | recovered address must equal `POLICY.owner()` captured at construction      |
| UserOperation nonce    | signed (`userOpNonce`) but **not enforced on-chain** (see limits)            |

Any change to any element changes the digest, so the old signature recovers a different address and
`submitApproval` reverts with `InvalidSignature`. A changed payload therefore needs a fresh approval.

## Failure behaviour (each has a Foundry test)

Forged key, garbage and wrong-length signatures, altered execution hash / expiry / nonce / agent,
wrong account, wrong chain, wrong verifying contract, high-s malleated twin, expired at submission,
lifetime over 7 days, replay of the same signed approval, reused `operationId` with a different
payload (also after consumption), second live approval for the same execution, non-owner revoke or
consumer change, direct `consume` by a stranger, execution without approval, replay after
consumption, altered amount, expiry between submission and execution, an approval for one agent used
by another agent's hook, and prohibited operations (unlisted recipient, over limit, revoked agent,
delegatecall mode) that stay prohibited and leave the approval unconsumed.

## TypeScript (`apps/web/src/features/authorization/`)

- `typedData.ts`: builds the message from the 7B request (never from caller-supplied fields),
  `executionHashOf`, `operationIdOf`, `approvalTypedData`, `approvalDigest`, minimal ABI.
- `verify.ts`: `signOwnerApproval` (wallet prompt, then local verification), `verifyOwnerSignature`
  (async recovery, low-s, expiry, fingerprint, signer vs request owner and optional on-chain owner),
  `createOwnerAuthorizationVerifier` (the sync `AuthorizationVerifier` that `evaluateRelease`
  expects; accepts only evidence issued in this module and re-derives the digest from the request
  being released), `submitApprovalCall`.

Everything in TypeScript is advisory. The contract verifies again on-chain.

## Deployment (not done here; no hashes or addresses exist)

1. `forge install eth-infinitism/account-abstraction@v0.7.0` (and solady, forge-std) if missing.
2. Deploy `SentinelOwnerApproval(policy)`.
3. Per agent: deploy `SentinelApprovalKernelHook(policy, approvals, account, agent)`, then as owner call
   `policy.setEnforcer(hook, true)` and `approvals.setConsumer(hook, true)`, and install the hook on the
   agent's validation entry as in `KernelUserOp.t.sol` (hook install data must be non-empty, `0x00`).

## Limits and open items

- Contracts uncompiled and untested. First step: `cd contracts && forge build && forge test -vv`.
- The shared known-answer digest (`3905f6b2...e3c1`) was computed on the TypeScript side. The Solidity
  test `test_knownAnswerDigestMatchesTypeScript` is the cross-check; a failure means the two disagree.
- Only an EOA owner is supported (ecrecover). No ERC-1271 or smart-contract owners.
- The signer is `POLICY.owner()`. Nothing forces it to equal the Kernel root owner.
- `userOpNonce` cannot be read by a hook. UserOp replay is prevented by the EntryPoint nonce manager;
  approval replay by `operationId` and consumption. The signed nonce is checked only off-chain.
- One live approval per `(agent, executionHash)`: two identical payments need two sequential approvals.
- Every execution by an approval-hook agent needs an approval; there is no threshold mode.
- A full Kernel + EntryPoint integration test with the approval hook was **not written**. The
  existing `KernelUserOp.t.sol` (18 tests) is still unrun. This is 7D work and the Module 06 gate is
  still unmet.
- No UI wiring: the `/approvals` page still shows demo data and its buttons are not signatures.
- No backend, no database, no persisted evidence, no real RPC reads of `policy.owner()`.

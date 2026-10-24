# SentinelPolicy contract (Module 05 completion)

**Status.** Reported by the project owner on local Ubuntu/WSL: `forge build` succeeded (solc 0.8.24,
28 files) and `forge test -vv` gave 44 passed, 0 failed, 0 skipped, with both fuzz tests at 256 runs.
That was the version before the review fixes below. The two tests added by the review
(`test_cannotBindAnAgentAsAccount`, `test_agentCannotTargetAccountOrPolicyEvenIfAllowlisted`) and the
two contract changes are **not yet run**; expected total 46. The contract has **not** been
independently audited.

Files: `contracts/src/SentinelPolicy.sol`, `contracts/test/SentinelPolicy.t.sol`,
`contracts/test/mocks/Mocks.sol` (test-only), `contracts/script/DeploySentinelPolicy.s.sol`.

## Model

One `SentinelPolicy` per owner and per smart account.

- `owner` is immutable. Only the owner can register agents, change their status, expiry, limits and
  allowlists, or bind the account. There is no owner transfer in this version.
- `account` is bound once by the owner (`bindAccount`) and can never be changed. Only that address
  can call `validateAndRecord`. A direct call by the agent, the owner or anyone else reverts
  (`NotAccount`), and so does any call before the account is bound.
- The account calls `validateAndRecord(agent, target, value, data)` just before executing an
  agent-originated call, inside the same transaction. Any violation reverts, so the account's
  execution reverts too (fail closed).

## Supported operations (everything else reverts)

1. **Native transfer**: empty calldata, value > 0, target must be an allowed recipient. Counts
   against per-transaction and daily native limits.
2. **ERC-20 `transfer(address,uint256)`** on a token the owner allowed with `setToken`. Calldata must
   be exactly 68 bytes, no ETH attached, amount > 0, decoded recipient must be allowed. Limits are
   in the token's **base units** (a 6-decimals token: `100e6` = 100 tokens). `approve`,
   `transferFrom` and every other selector on an allowed token are unsupported.
3. **Contract call** to a non-token contract: only `(target, selector)` pairs the owner allowed with
   `setCallRule`. Optional parameter rule: the address argument at a chosen word index must be an
   allowed recipient (dirty or missing words revert `MalformedCalldata`). ETH sent with the call
   counts against native limits.

## Semantics

- **Daily window**: UTC calendar day, `block.timestamp / 1 days`. Not a rolling 24 hours. A spender
  can therefore spend a full limit just before midnight and again just after.
- **Atomic accounting**: check and record happen in one call. Spends in the same block share one
  budget and are applied in transaction order, so concurrent submissions cannot jointly exceed the
  cap.
- **Failed executions**: if the account reverts the whole operation, the recorded spend reverts
  with it and the budget is not consumed. This holds only if the account calls
  `validateAndRecord` in the same execution that performs the transfer (see Limitations).
- **Expiry**: agent expiry and policy expiry are both checked; `block.timestamp >= expiry` is
  expired. Both may be 0 (no expiry).
- **Pause / resume / revoke**: pause and resume toggle `Active`/`Paused`. Revocation is terminal and
  the address can never be registered again; rotate by registering a new address.
- **Policy updates**: owner only. Spend already recorded today is kept, so lowering a daily limit
  below today's spend blocks further spend until the next UTC day. Each change bumps
  `policyVersion[agent]` and emits an event.
- **Limits are capped** at `type(uint128).max` so accounting cannot overflow.

## Limitations and open items

- **No ERC-4337 or Kernel adapter yet** (see `docs/KERNEL_ADAPTER_PLAN.md`). The policy protects only operations that the account routes
  through `validateAndRecord`. Any other path the account offers to the agent (other validators, raw
  execute, module installs) bypasses it. The adapter must make this path the only agent path, and
  that has to be tested against the real Kernel interfaces, which were not available when this was
  written.
- **ERC-4337 validation rules**: this contract reads `block.timestamp` and other contracts' storage.
  Calling it from the account's validation phase may violate bundler storage rules. The adapter
  should call it during execution, or the bundler compatibility must be verified.
- Token support is `transfer` only, no token-parameter rules beyond the recipient, no
  rebase/fee-on-transfer handling (recorded amount is the requested amount).
- No rolling window, no multi-owner or ownership transfer, no emergency pause for all agents.
- Policy changes take effect immediately; there is no timelock.
- The recipient allowlist is shared by native transfers, token transfers and parameter checks for
  one agent.
- Not audited. Do not use with real funds.

## Run the tests (PowerShell)

```powershell
cd contracts
git init            # only if this is not already a Git repository
forge install foundry-rs/forge-std@v1.9.4
forge build
forge test -vvv
```

If `forge install` complains about uncommitted changes, commit first.

## Test coverage written

Review additions: an agent address can never be bound as the account; the agent cannot target the
policy or the bound account even if allowlisted (`ForbiddenTarget`).
Authority: constructor, one-time account bind, owner-only mutators, agent/account/stranger cannot
mutate, no registering owner/account/policy/zero, no double registration, recording only by account.
Native: success, per-tx boundary, daily boundary and next-day reset, one second before midnight,
same-block sequential spends, unlisted/removed recipient, zero value, short calldata.
Lifecycle: unknown agent, unconfigured policy, pause/resume, terminal revocation, agent and policy
expiry boundaries, invalid expiry/limits.
ERC-20: limits in base units (6 decimals), daily cap, independent budgets, unlisted recipient,
approve/other selectors, wrong length, ETH attached, zero amount, dirty address, unlisted/disallowed
token.
Calls: allowed call, unlisted contract/selector, address-argument restriction, short/dirty
calldata, ETH value counts against native limit, rule on token target rejected.
Atomicity: failed execution rolls back accounting. Mutation: lowering a limit, raising it, version
counter, `check` is read-only. Fuzz: per-tx boundary and daily-cap invariant.

# AI Integration Foundation (Module 8A)

Scope: the foundation only. Module 8B (policy pre-checks, safe preview, UI, API surface, calldata and
nonce, prompt-injection test corpus) is NOT built. Nothing here claims an operation was executed.

## Core rule

AI proposes. It does not authorize. A proposal carries `authorization: 'none'` and is not
policy-checked, approved, signed or executed. The smart-account authorization path and on-chain policy
(Modules 5 to 7) remain the only authority. Model confidence, wording or claims are ignored.

## Where it lives and why

`apps/api` (Node.js + TypeScript, ESM, zero runtime dependencies). The Module 7 ZIP had no backend,
so this is a new package rather than an extension of one. It is server side on purpose: provider calls
need an API key, and the browser must never see one. The web app does not reference any AI variable
(a test scans `apps/web` for them).

```
apps/api/src/ai/
  types.ts          schema (AiTransactionProposal, ProposalOperation, messages, context, limits)
  amount.ts         exact decimal string -> integer base units (no floats)
  context.ts        validation of the trusted, application-supplied context
  prompt.ts         request checks and prompt construction (not a security boundary)
  modelOutput.ts    strict parser/validator for UNTRUSTED model text
  proposal.ts       orchestration: input check -> provider (with deadline) -> validation -> record
  provider.ts       AiProvider interface, ProviderError
  adapters/mock.ts       deterministic scripted adapter (never an LLM)
  adapters/anthropic.ts  Anthropic Messages HTTP adapter (plain fetch)
  config.ts, secret.ts, factory.ts
```

## Proposal schema

`AiTransactionProposal` (schema version 1): `proposalId`, `createdAt`, `expiresAt` (unix seconds),
`status` (`proposed | invalid | unsupported | provider_error`), `authorization: 'none'`, `source`
(`kind: 'mock' | 'llm'`, provider, model), `originalRequest` (verbatim), `chainId`, `account`, `agent`,
`owner`, `operation`, `asset`, `purpose`, `messages[]` (severity, code, message, path).

`operation` is one of `native_transfer`, `erc20_transfer`, `erc20_approve`. These match the first three
kinds of `TypedOperation` in `apps/web/src/features/requests/types.ts` (Module 7B), so 8B can map a
proposal to a 7B request. Amounts are exact decimal strings of base units (`amountWei`,
`amountBaseUnits`). `operation` and `asset` exist only when `status` is `proposed`.

## Trust boundaries

| Value | Comes from |
| --- | --- |
| chainId, account, agent, owner | application context (never the model; the model never sees the addresses) |
| expiresAt | application configuration (`AI_PROPOSAL_TTL_SECONDS`, 60 s to 7 days) |
| token address, decimals, symbol | trusted token registry in the context (unknown tokens fail closed) |
| operation kind, recipient or spender, decimal amount, purpose | model output, validated |

The model may echo `chainId` and `tokenAddress`; a mismatch is an error and is never corrected.

## What is rejected (never repaired)

Non-JSON or prose around the JSON; oversized output; unknown keys (account, nonce, expiry, calldata,
decimals, approved, `__proto__`, ...); wrong types; JSON-number amounts; exponent, signed, spaced or
leading-zero amounts; more decimal places than the asset allows (never rounded); zero and over-uint256
amounts; ENS names and malformed addresses; the zero address; the smart account as counterparty;
operation/asset mismatches; unsupported operations (`contract_call`, swaps, delegatecall); control or
direction-override characters in the request or purpose. Unlimited allowances are proposed with a
warning. Empty/too long/control-character requests never reach the provider.

## Provider abstraction and failures

`AiProvider.complete({system, user, maxOutputTokens}, {signal})` returns text. A provider gets no keys,
no signing capability, no tools and no addresses. Failures (`timeout`, `rate_limited`, `http_error`,
`network_error`, `bad_response`, `not_configured`, or any other throw) become a `provider_error`
proposal with a fixed message. Raw error text and response bodies are dropped, because they can carry
secrets. The deadline is enforced by the orchestrator even if an adapter ignores the abort signal.

## Configuration (`apps/api/.env.example`)

`AI_PROVIDER` (`mock` default | `anthropic`), `AI_API_KEY`, `AI_MODEL`, `AI_API_BASE_URL` (https, or
http for localhost), `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_REQUEST_CHARS`,
`AI_PROPOSAL_TTL_SECONDS`. The key is held in a `Secret` that prints as `[redacted]` in `JSON`,
strings and `util.inspect`. The Anthropic adapter sends the key only in the `x-api-key` header,
refuses redirects, and sends no tools.

## Mock adapter

Deterministic and clearly labelled: `source.kind = 'mock'` and a `MOCK_OUTPUT` message on every
proposal. Understands `send|transfer|pay <amount> <SYMBOL> to <0x..> [because <text>]` and
`approve <amount> <SYMBOL> for <0x..>`; anything else is `unsupported`. Scripts can return exact
text (including malformed text), a `ProviderError`, or hang (to test timeouts). Its output goes
through the same validation as real output.

## Known limits (8A)

- The Anthropic adapter is unit-tested with an injected `fetch`; it was never run against the live API.
- Prompt-injection defense here is structural (no tools, trusted context, strict parsing, unknown keys
  rejected). The prompt text is not a security boundary. A dedicated injection test corpus is 8B.
- No policy pre-check, no preview, no calldata, no nonce, no HTTP endpoint, no UI, no persistence.
- Addresses are normalised to lowercase, not EIP-55 verified (same as Module 7B).
- Token registry is supplied by the caller; this package does not read the chain.
- Recipients are not checked against any allowlist (the policy does that, on chain; 8B pre-checks it).

## Interfaces 8B must use

Map `AiTransactionProposal` (`status === 'proposed'`) to a 7B `RequestPayload`: add the real Module 6
nonce, encode calldata from the typed operation, then run `parseRequest`, the policy pre-check and the
safe preview. The result is still only a request for the owner to review; signing and execution stay
in Modules 7C/7D.

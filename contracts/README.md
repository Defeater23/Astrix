# contracts/ (Foundry)

Module 05 completion adds `src/SentinelPolicy.sol` with Foundry tests (`test/`) and a deploy script.
**None of it has been compiled or run by the author** (no Foundry or network was available); treat
all tests as NOT RUN until you run `forge test`. See `../docs/POLICY_CONTRACT.md`. There is still
no Kernel/ERC-4337 adapter, so nothing in the web app is wired to this contract.

## Planned contents

| Module | Contract work                                                             |
| ------ | ------------------------------------------------------------------------- |
| 4      | Agent registration and lifecycle: in `SentinelPolicy` (unverified); account adapter pending |
| 5      | `SentinelPolicy` (limits, daily cap, allowlists): written, unverified     |
| 6-7    | Exact-operation validation and owner approval                             |

The account implementation and EntryPoint are chosen in `docs/SMART_ACCOUNT.md`. Dependencies
are added with `forge install` at a pinned tag or commit, never at a moving branch.

## Setup (PowerShell)

```powershell
# Install Foundry (see https://book.getfoundry.sh/getting-started/installation), then:
cd contracts
forge --version
anvil            # local chain on http://127.0.0.1:8545, chain ID 31337
```

## Read-only chain check

```powershell
.\scripts\check-chain.ps1 -RpcUrl http://127.0.0.1:8545
```

On a fresh Anvil chain, EntryPoint v0.7 is **not** present. Placing it at the canonical address
is an open item (see docs/SMART_ACCOUNT.md); the web app reports its absence rather than hiding it.

## Build and test

```powershell
cd contracts
forge install foundry-rs/forge-std@v1.9.4
forge build
forge test -vvv
```

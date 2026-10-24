// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISentinelPolicyRecorder {
    function account() external view returns (address);
    function validateAndRecord(address agent, address target, uint256 value, bytes calldata data) external;
}

/// @title  SentinelKernelHook
/// @notice ERC-7579 hook (module type 4, Kernel v3.3 `IHook` selectors) that enforces `SentinelPolicy`
///         for ONE agent on ONE Kernel account. UNAUDITED. NOT COMPILED OR RUN by the author (no Foundry in
///         the authoring environment); see docs/KERNEL_ADAPTER_PLAN.md for what must be verified.
/// @dev    Trust model (verified by reading Kernel 0.3.3 source, not by running it):
///         - Kernel stores the hook per validation entry (`ValidationConfig.hook`) and, for a UserOp
///           validated by that entry, calls `preCheck(msg.sender = EntryPoint, value, userOp.callData[4:])`
///           from `executeUserOp`. `msgSender` is therefore NOT the agent and is ignored here.
///         - The agent identity is structural: this contract is deployed with an immutable AGENT and is
///           installed only on the validation entry whose validator accepts that agent's signature. A
///           different agent needs a different validation entry AND a different hook instance.
///         - Only the immutable ACCOUNT may call any state-changing function, so third parties cannot
///           consume the agent's budget by calling `preCheck` directly.
///         - Fail closed: delegatecall, static, try (non-reverting) exec types, unknown modes, unknown
///           selectors, non-canonical encodings and empty or oversized batches revert.
///         - Spend is recorded in `preCheck` inside `executeUserOp`; if the execution reverts, Kernel
///           reverts `executeUserOp`, so the policy accounting rolls back with it.
contract SentinelKernelHook {
    error NotAccount();
    error ZeroAddress();
    error PolicyAccountMismatch();
    error NotInitialized();
    error NonZeroValue();
    error UnsupportedSelector();
    error UnsupportedMode();
    error NonCanonicalEncoding();
    error EmptyBatch();
    error BatchTooLarge();

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    uint256 internal constant MODULE_TYPE_HOOK = 4;
    uint256 public constant MAX_BATCH = 16;
    /// `execute(bytes32,bytes)`: Kernel's `execute(ExecMode,bytes)` with ExecMode = bytes32.
    bytes4 internal constant EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));

    ISentinelPolicyRecorder public immutable POLICY;
    address public immutable ACCOUNT;
    address public immutable AGENT;
    bool public initialized;

    constructor(address policy_, address account_, address agent_) {
        if (policy_ == address(0) || account_ == address(0) || agent_ == address(0)) revert ZeroAddress();
        // The policy must be bound to the same account this hook protects.
        if (ISentinelPolicyRecorder(policy_).account() != account_) revert PolicyAccountMismatch();
        POLICY = ISentinelPolicyRecorder(policy_);
        ACCOUNT = account_;
        AGENT = agent_;
    }

    modifier onlyAccount() {
        if (msg.sender != ACCOUNT) revert NotAccount();
        _;
    }

    // ------------------------------------------------------------ IModule

    function onInstall(bytes calldata) external payable onlyAccount {
        initialized = true; // idempotent: Kernel may force a re-install with the 0xff flag
    }

    function onUninstall(bytes calldata) external payable onlyAccount {
        initialized = false;
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return initialized && smartAccount == ACCOUNT;
    }

    // -------------------------------------------------------------- IHook

    /// @param msgData For Kernel `executeUserOp`: `userOp.callData[4:]`, i.e. the encoded call
    ///        `execute(bytes32 mode, bytes executionCalldata)`.
    function preCheck(address, uint256 msgValue, bytes calldata msgData)
        external
        payable
        onlyAccount
        returns (bytes memory)
    {
        if (!initialized) revert NotInitialized();
        if (msgValue != 0 || msg.value != 0) revert NonZeroValue();
        if (msgData.length < 4 + 64 || bytes4(msgData[0:4]) != EXECUTE_SELECTOR) revert UnsupportedSelector();

        (bytes32 mode, bytes memory execCd) = abi.decode(msgData[4:], (bytes32, bytes));
        // Require the exact canonical ABI encoding so that this decoder and Kernel's decoder cannot
        // disagree about what will be executed.
        if (keccak256(msgData) != keccak256(abi.encodeWithSelector(EXECUTE_SELECTOR, mode, execCd))) {
            revert NonCanonicalEncoding();
        }

        // mode layout: [callType 1][execType 1][unused 4][selector 4][payload 22]
        // Only plain default-exec CALL (0x00) or BATCH (0x01) with everything else zero is supported.
        if ((mode << 16) != bytes32(0)) revert UnsupportedMode();
        bytes1 callType = bytes1(mode);
        bytes1 execType = bytes1(mode << 8);
        if (execType != 0x00) revert UnsupportedMode(); // rejects "try" mode (failed calls would not revert)

        if (callType == 0x00) {
            if (execCd.length < 52) revert NonCanonicalEncoding();
            address target;
            uint256 value;
            assembly {
                target := shr(96, mload(add(execCd, 0x20)))
                value := mload(add(execCd, 0x34))
            }
            POLICY.validateAndRecord(AGENT, target, value, _tail(execCd, 52));
        } else if (callType == 0x01) {
            Execution[] memory execs = abi.decode(execCd, (Execution[]));
            if (keccak256(abi.encode(execs)) != keccak256(execCd)) revert NonCanonicalEncoding();
            if (execs.length == 0) revert EmptyBatch();
            if (execs.length > MAX_BATCH) revert BatchTooLarge();
            for (uint256 i = 0; i < execs.length; ++i) {
                POLICY.validateAndRecord(AGENT, execs[i].target, execs[i].value, execs[i].callData);
            }
        } else {
            revert UnsupportedMode(); // delegatecall (0xff), static (0xfe), unknown
        }
        return "";
    }

    function postCheck(bytes calldata) external payable onlyAccount {}

    function _tail(bytes memory b, uint256 start) internal pure returns (bytes memory out) {
        uint256 len = b.length - start;
        out = new bytes(len);
        for (uint256 i = 0; i < len; ++i) {
            out[i] = b[start + i];
        }
    }
}

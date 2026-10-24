// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISentinelPolicyRecorder2 {
    function account() external view returns (address);
    function validateAndRecord(address agent, address target, uint256 value, bytes calldata data) external;
}

interface ISentinelOwnerApproval {
    function POLICY() external view returns (address);
    function consume(address agent, bytes32 executionHash) external;
}

/// @title  SentinelApprovalKernelHook
/// @notice Variant of `SentinelKernelHook` (Module 06) for agents whose every execution needs a fresh,
///         owner-signed approval (Module 7C). It does the same policy enforcement and, in addition,
///         consumes an approval from `SentinelOwnerApproval` bound to keccak256 of the exact
///         `execute(bytes32,bytes)` call data. UNAUDITED. NOT COMPILED OR RUN by the author.
/// @dev    The decoding and fail-closed rules are copied from `SentinelKernelHook` on purpose so that the
///         verified Module 06 contract and its tests stay untouched. Any fix to one must be mirrored.
///         Order matters: the policy runs first, so a prohibited operation reverts with the policy's
///         error even when a valid approval exists, and the approval is NOT consumed (the whole call
///         frame reverts). The approval is consumed last, so a policy or execution revert restores it.
///         One hook instance per (agent, account); install it only on that agent's validation entry.
contract SentinelApprovalKernelHook {
    error NotAccount();
    error ZeroAddress();
    error PolicyAccountMismatch();
    error ApprovalPolicyMismatch();
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
    bytes4 internal constant EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));

    ISentinelPolicyRecorder2 public immutable POLICY;
    ISentinelOwnerApproval public immutable APPROVALS;
    address public immutable ACCOUNT;
    address public immutable AGENT;
    bool public initialized;

    constructor(address policy_, address approvals_, address account_, address agent_) {
        if (policy_ == address(0) || approvals_ == address(0) || account_ == address(0) || agent_ == address(0)) {
            revert ZeroAddress();
        }
        if (ISentinelPolicyRecorder2(policy_).account() != account_) revert PolicyAccountMismatch();
        if (ISentinelOwnerApproval(approvals_).POLICY() != policy_) revert ApprovalPolicyMismatch();
        POLICY = ISentinelPolicyRecorder2(policy_);
        APPROVALS = ISentinelOwnerApproval(approvals_);
        ACCOUNT = account_;
        AGENT = agent_;
    }

    modifier onlyAccount() {
        if (msg.sender != ACCOUNT) revert NotAccount();
        _;
    }

    // ------------------------------------------------------------ IModule
    function onInstall(bytes calldata) external payable onlyAccount {
        initialized = true;
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
        if (keccak256(msgData) != keccak256(abi.encodeWithSelector(EXECUTE_SELECTOR, mode, execCd))) {
            revert NonCanonicalEncoding();
        }

        if ((mode << 16) != bytes32(0)) revert UnsupportedMode();
        bytes1 callType = bytes1(mode);
        bytes1 execType = bytes1(mode << 8);
        if (execType != 0x00) revert UnsupportedMode();

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
            revert UnsupportedMode();
        }

        // Last: the owner's approval for exactly these bytes, single use.
        APPROVALS.consume(AGENT, keccak256(msgData));
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

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISentinelPolicyView {
    function owner() external view returns (address);
    function account() external view returns (address);
}

/// @title  SentinelOwnerApproval
/// @notice On-chain verification and single-use bookkeeping for OWNER approvals of agent operations
///         (Module 7C). The owner signs an EIP-712 `OwnerApproval` off-chain. Anyone may submit it;
///         this contract recovers the signer and accepts it only if the signer is the owner of the
///         bound `SentinelPolicy`. A `SentinelApprovalKernelHook` then consumes the approval, exactly
///         once, in the same call frame that executes the operation.
/// @dev    UNAUDITED. NOT COMPILED OR RUN by the author (no Foundry in the authoring environment).
///         Treat every property below as unproven until `forge test` has been run and recorded.
///
///         What an approval binds (all inside the signed digest):
///           - verifyingContract (this contract) and chainId (EIP-712 domain, read at verify time)
///           - account, agent, operationId, userOpNonce, executionHash, expiry
///         `executionHash` is keccak256 of the exact `execute(bytes32,bytes)` call data that Kernel will
///         run (`userOp.callData[4:]`), so mode, target, value and calldata are all bound.
///
///         Limits stated honestly:
///           - Only the policy owner EOA is supported as signer (ecrecover). No ERC-1271 / contract owners.
///           - `userOpNonce` is signed, but a hook cannot read the UserOperation nonce, so THIS contract
///             does not enforce it. The EntryPoint's nonce manager prevents UserOp replay; single use of
///             an approval is enforced here through `operationId` and consumption.
///           - Signer must equal `POLICY.owner()`. Nothing forces that to be the Kernel root owner; the
///             deployer must keep them the same.
///           - At most one live (unconsumed, unexpired) approval per (agent, executionHash).
contract SentinelOwnerApproval {
    // ------------------------------------------------------------------ types
    struct OwnerApproval {
        address account;
        address agent;
        bytes32 operationId;
        uint256 userOpNonce;
        bytes32 executionHash;
        uint64 expiry;
    }

    enum Status {
        None,
        Approved,
        Consumed,
        Revoked
    }

    struct Record {
        Status status;
        uint64 expiry;
        bytes32 slot;
    }

    // -------------------------------------------------------------- constants
    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "OwnerApproval(address account,address agent,bytes32 operationId,uint256 userOpNonce,bytes32 executionHash,uint64 expiry)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("SentinelOwnerApproval");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    /// Longest approval lifetime accepted at submission.
    uint256 public constant MAX_LIFETIME = 7 days;
    /// secp256k1 n / 2. Signatures with a larger `s` are malleable twins and are rejected.
    uint256 internal constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    // ---------------------------------------------------------------- storage
    ISentinelPolicyView public immutable POLICY;
    /// The only accepted signer: the owner of POLICY, captured at construction.
    address public immutable APPROVER;

    /// Hooks the owner allows to consume approvals.
    mapping(address => bool) public consumers;
    /// digest => record
    mapping(bytes32 => Record) public records;
    /// keccak256(agent, executionHash) => digest of the live approval, if any
    mapping(bytes32 => bytes32) public activeBySlot;
    /// operationId => ever submitted. Never cleared: an operationId is never reusable.
    mapping(bytes32 => bool) public operationIdUsed;

    // ----------------------------------------------------------------- errors
    error ZeroAddress();
    error NotApprover();
    error NotConsumer();
    error WrongAccount();
    error InvalidApproval();
    error ApprovalExpired();
    error ExpiryTooFar();
    error InvalidSignature();
    error OperationIdUsed();
    error SlotBusy();
    error NoApproval();
    error NotRevocable();

    // ----------------------------------------------------------------- events
    event ApprovalSubmitted(
        bytes32 indexed digest,
        address indexed agent,
        bytes32 indexed operationId,
        bytes32 executionHash,
        uint256 userOpNonce,
        uint64 expiry
    );
    event ApprovalConsumed(bytes32 indexed digest, address indexed agent, address indexed consumer);
    event ApprovalRevoked(bytes32 indexed digest);
    event ConsumerSet(address indexed consumer, bool allowed);

    // ------------------------------------------------------------ constructor
    constructor(address policy_) {
        if (policy_ == address(0)) revert ZeroAddress();
        POLICY = ISentinelPolicyView(policy_);
        address approver = ISentinelPolicyView(policy_).owner();
        if (approver == address(0)) revert ZeroAddress();
        APPROVER = approver;
    }

    modifier onlyApprover() {
        if (msg.sender != APPROVER) revert NotApprover();
        _;
    }

    // ---------------------------------------------------------------- digests
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function structHash(OwnerApproval memory a) public pure returns (bytes32) {
        return keccak256(
            abi.encode(APPROVAL_TYPEHASH, a.account, a.agent, a.operationId, a.userOpNonce, a.executionHash, a.expiry)
        );
    }

    /// @notice The EIP-712 digest the owner must sign, for the current chain and this contract.
    function digestOf(OwnerApproval memory a) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash(a)));
    }

    // -------------------------------------------------------------- owner admin
    function setConsumer(address consumer, bool allowed) external onlyApprover {
        if (consumer == address(0)) revert ZeroAddress();
        consumers[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @notice Owner cancels a submitted approval that has not been consumed.
    function revokeApproval(bytes32 digest) external onlyApprover {
        Record storage r = records[digest];
        if (r.status != Status.Approved) revert NotRevocable();
        r.status = Status.Revoked;
        if (activeBySlot[r.slot] == digest) delete activeBySlot[r.slot];
        emit ApprovalRevoked(digest);
    }

    // ------------------------------------------------------------- submission
    /// @notice Verifies the owner's signature and records the approval. Anyone may call; the
    ///         signature is the only authority.
    function submitApproval(OwnerApproval calldata a, bytes calldata signature) external returns (bytes32 digest) {
        _requireSubmittable(a);

        digest = digestOf(a);
        address signer = _recover(digest, signature);
        if (signer == address(0) || signer != APPROVER) revert InvalidSignature();

        bytes32 slot = _claimSlot(a);
        operationIdUsed[a.operationId] = true;
        records[digest] = Record({status: Status.Approved, expiry: a.expiry, slot: slot});
        activeBySlot[slot] = digest;
        emit ApprovalSubmitted(digest, a.agent, a.operationId, a.executionHash, a.userOpNonce, a.expiry);
    }

    /// Account, shape, time window and operationId freshness. Signature is checked separately.
    function _requireSubmittable(OwnerApproval calldata a) internal view {
        address account_ = POLICY.account();
        if (account_ == address(0) || a.account != account_) revert WrongAccount();
        if (a.agent == address(0) || a.executionHash == bytes32(0) || a.operationId == bytes32(0)) {
            revert InvalidApproval();
        }
        if (a.expiry <= block.timestamp) revert ApprovalExpired();
        if (a.expiry > block.timestamp + MAX_LIFETIME) revert ExpiryTooFar();
        if (operationIdUsed[a.operationId]) revert OperationIdUsed();
    }

    /// At most one live approval per (agent, executionHash).
    function _claimSlot(OwnerApproval calldata a) internal view returns (bytes32 slot) {
        slot = keccak256(abi.encode(a.agent, a.executionHash));
        bytes32 prior = activeBySlot[slot];
        if (prior != bytes32(0)) {
            Record storage p = records[prior];
            if (p.status == Status.Approved && p.expiry > block.timestamp) revert SlotBusy();
        }
    }

    // ------------------------------------------------------------ consumption
    /// @notice Marks the live approval for (agent, executionHash) as used. Reverts if there is none,
    ///         it is expired, revoked or already consumed. Callable only by an owner-allowed hook.
    function consume(address agent, bytes32 executionHash) external {
        if (!consumers[msg.sender]) revert NotConsumer();
        bytes32 slot = keccak256(abi.encode(agent, executionHash));
        bytes32 digest = activeBySlot[slot];
        if (digest == bytes32(0)) revert NoApproval();
        Record storage r = records[digest];
        if (r.status != Status.Approved) revert NoApproval();
        if (block.timestamp >= r.expiry) revert ApprovalExpired();
        r.status = Status.Consumed;
        delete activeBySlot[slot];
        emit ApprovalConsumed(digest, agent, msg.sender);
    }

    // ------------------------------------------------------------------ views
    function statusOf(bytes32 digest) external view returns (Status) {
        return records[digest].status;
    }

    // --------------------------------------------------------------- internals
    /// 65-byte (r, s, v) signature, v in {27, 28} (or {0, 1}), low-s only. Returns address(0) on any defect.
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > HALF_N) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}

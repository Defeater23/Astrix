// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title SentinelPolicy
/// @notice On-chain spending policy and agent-authority registry for a single owner and a single
///         smart account. The account calls `validateAndRecord` immediately before it executes an
///         agent-originated call; the call reverts (fail closed) unless the agent is authorized and
///         the call fits the owner's policy. Accounting is recorded in the same transaction as the
///         check, so a reverted execution rolls the accounting back.
/// @dev    UNAUDITED. Not yet adapted to any ERC-4337 account (Kernel v3 adapter is future work).
///         The policy only protects what the account routes through it. See docs/POLICY_CONTRACT.md.
contract SentinelPolicy {
    // ------------------------------------------------------------------ types

    enum AgentStatus {
        None,
        Active,
        Paused,
        Revoked
    }

    enum Kind {
        Native,
        Token,
        Call
    }

    struct Agent {
        AgentStatus status;
        uint64 expiry; // 0 = no expiry
    }

    struct Policy {
        bool configured;
        uint64 expiry; // 0 = no expiry
        uint256 perTxLimit; // native wei
        uint256 dailyLimit; // native wei per UTC calendar day
    }

    struct TokenLimit {
        bool allowed;
        uint256 perTxLimit; // token base units
        uint256 dailyLimit; // token base units per UTC calendar day
    }

    struct CallRule {
        bool allowed;
        bool checkAddressArg; // if true, the address argument must be an allowed recipient
        uint8 addressArgIndex; // zero-based index of the 32-byte argument word
    }

    // ---------------------------------------------------------------- constants

    bytes4 public constant ERC20_TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    uint256 public constant MAX_LIMIT = type(uint128).max;

    // ------------------------------------------------------------------ storage

    address public immutable owner;
    address public account;
    /// Contracts (e.g. a per-agent SentinelKernelHook) the owner has authorised to call `validateAndRecord`
    /// in addition to the bound account. Set only by the owner; see docs/KERNEL_ADAPTER_PLAN.md.
    mapping(address => bool) public enforcers;

    mapping(address => Agent) public agents;
    mapping(address => Policy) public policies;
    mapping(address => uint256) public policyVersion;

    mapping(address => mapping(address => bool)) public recipientAllowed;
    mapping(address => mapping(address => TokenLimit)) public tokenLimits;
    mapping(address => mapping(address => mapping(bytes4 => CallRule))) public callRules;

    /// agent => UTC day number => native wei spent
    mapping(address => mapping(uint256 => uint256)) public nativeSpent;
    /// agent => token => UTC day number => token base units spent
    mapping(address => mapping(address => mapping(uint256 => uint256))) public tokenSpent;

    // ------------------------------------------------------------------- errors

    error NotOwner();
    error NotAccount();
    error ZeroAddress();
    error AccountAlreadyBound();
    error InvalidAgent();
    error AgentAlreadyRegistered();
    error AgentUnknown();
    error AgentPaused();
    error AgentRevoked();
    error AgentExpired();
    error InvalidExpiry();
    error InvalidStatusTransition();
    error PolicyNotConfigured();
    error PolicyExpired();
    error InvalidLimits();
    error UnsupportedOperation();
    error MalformedCalldata();
    error RecipientNotAllowed(address recipient);
    error CallNotAllowed(address target, bytes4 selector);
    error TargetIsToken();
    error ForbiddenTarget();
    error PerTxLimitExceeded();
    error DailyLimitExceeded();

    // ------------------------------------------------------------------- events

    event AccountBound(address indexed account);
    event EnforcerSet(address indexed enforcer, bool allowed);
    event AgentRegistered(address indexed agent, uint64 expiry);
    event AgentStatusChanged(address indexed agent, AgentStatus status);
    event AgentExpirySet(address indexed agent, uint64 expiry);
    event PolicySet(address indexed agent, uint256 perTxLimit, uint256 dailyLimit, uint64 expiry, uint256 version);
    event RecipientSet(address indexed agent, address indexed recipient, bool allowed, uint256 version);
    event TokenLimitSet(
        address indexed agent, address indexed token, bool allowed, uint256 perTx, uint256 daily, uint256 version
    );
    event CallRuleSet(
        address indexed agent,
        address indexed target,
        bytes4 indexed selector,
        bool allowed,
        bool checkAddressArg,
        uint8 addressArgIndex,
        uint256 version
    );
    event SpendRecorded(address indexed agent, address indexed target, Kind kind, uint256 amount, uint256 day);

    // ---------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAccount() {
        if (account == address(0) || msg.sender != account) revert NotAccount();
        _;
    }

    modifier onlyRecorder() {
        if (msg.sender != account || account == address(0)) {
            if (!enforcers[msg.sender]) revert NotAccount();
        }
        _;
    }

    /// Agent must exist and must not be revoked (revocation is terminal).
    modifier manageable(address agent) {
        AgentStatus s = agents[agent].status;
        if (s == AgentStatus.None) revert AgentUnknown();
        if (s == AgentStatus.Revoked) revert AgentRevoked();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    // ------------------------------------------------------- owner: account bind

    /// @notice One-time binding of the smart account allowed to record spends. Cannot be changed.
    function bindAccount(address account_) external onlyOwner {
        if (account_ == address(0) || account_ == address(this) || account_ == owner) revert ZeroAddress();
        if (account != address(0)) revert AccountAlreadyBound();
        // An address that is (or was) an agent can never become the recorder, otherwise that agent
        // could call validateAndRecord directly.
        if (agents[account_].status != AgentStatus.None) revert InvalidAgent();
        account = account_;
        emit AccountBound(account_);
    }

    /// @notice Authorises (or removes) a recorder contract such as a Kernel hook. The enforcer itself is
    ///         responsible for authenticating the account and agent it serves; it is NOT a general
    ///         permission. An agent address can never be an enforcer, nor an enforcer an agent.
    function setEnforcer(address enforcer, bool allowed) external onlyOwner {
        if (enforcer == address(0) || enforcer == address(this) || enforcer == owner || enforcer == account) {
            revert ZeroAddress();
        }
        if (allowed && agents[enforcer].status != AgentStatus.None) revert InvalidAgent();
        enforcers[enforcer] = allowed;
        emit EnforcerSet(enforcer, allowed);
    }

    // ---------------------------------------------------- owner: agent lifecycle

    function registerAgent(address agent, uint64 expiry) external onlyOwner {
        if (agent == address(0) || agent == owner || agent == account || agent == address(this) || enforcers[agent]) revert InvalidAgent();
        if (agents[agent].status != AgentStatus.None) revert AgentAlreadyRegistered();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();
        agents[agent] = Agent({status: AgentStatus.Active, expiry: expiry});
        emit AgentRegistered(agent, expiry);
    }

    function pauseAgent(address agent) external onlyOwner {
        if (agents[agent].status != AgentStatus.Active) revert InvalidStatusTransition();
        agents[agent].status = AgentStatus.Paused;
        emit AgentStatusChanged(agent, AgentStatus.Paused);
    }

    function resumeAgent(address agent) external onlyOwner {
        if (agents[agent].status != AgentStatus.Paused) revert InvalidStatusTransition();
        agents[agent].status = AgentStatus.Active;
        emit AgentStatusChanged(agent, AgentStatus.Active);
    }

    /// @notice Terminal. A revoked address can never be registered again; rotate to a new address.
    function revokeAgent(address agent) external onlyOwner {
        AgentStatus s = agents[agent].status;
        if (s != AgentStatus.Active && s != AgentStatus.Paused) revert InvalidStatusTransition();
        agents[agent].status = AgentStatus.Revoked;
        emit AgentStatusChanged(agent, AgentStatus.Revoked);
    }

    function setAgentExpiry(address agent, uint64 expiry) external onlyOwner manageable(agent) {
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();
        agents[agent].expiry = expiry;
        emit AgentExpirySet(agent, expiry);
    }

    // ----------------------------------------------------- owner: policy updates

    /// @notice Sets native limits and policy expiry. Spend already recorded for the current day is
    ///         kept, so lowering the daily limit below today's spend blocks further native spend.
    function setPolicy(address agent, uint256 perTxLimit, uint256 dailyLimit, uint64 expiry)
        external
        onlyOwner
        manageable(agent)
    {
        if (dailyLimit < perTxLimit || dailyLimit > MAX_LIMIT) revert InvalidLimits();
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();
        policies[agent] = Policy({configured: true, expiry: expiry, perTxLimit: perTxLimit, dailyLimit: dailyLimit});
        uint256 v = ++policyVersion[agent];
        emit PolicySet(agent, perTxLimit, dailyLimit, expiry, v);
    }

    function setRecipient(address agent, address recipient, bool allowed) external onlyOwner manageable(agent) {
        if (recipient == address(0)) revert ZeroAddress();
        recipientAllowed[agent][recipient] = allowed;
        uint256 v = ++policyVersion[agent];
        emit RecipientSet(agent, recipient, allowed, v);
    }

    /// @notice Allows (or disallows) ERC-20 `transfer` on `token` with limits in token base units.
    ///         Only `transfer(address,uint256)` is ever supported on an allowed token.
    function setToken(address agent, address token, bool allowed, uint256 perTxLimit, uint256 dailyLimit)
        external
        onlyOwner
        manageable(agent)
    {
        if (token == address(0)) revert ZeroAddress();
        if (allowed && (dailyLimit < perTxLimit || dailyLimit > MAX_LIMIT)) revert InvalidLimits();
        tokenLimits[agent][token] = TokenLimit({allowed: allowed, perTxLimit: perTxLimit, dailyLimit: dailyLimit});
        uint256 v = ++policyVersion[agent];
        emit TokenLimitSet(agent, token, allowed, perTxLimit, dailyLimit, v);
    }

    /// @notice Allows (or disallows) one function selector on one non-token contract.
    function setCallRule(
        address agent,
        address target,
        bytes4 selector,
        bool allowed,
        bool checkAddressArg,
        uint8 addressArgIndex
    ) external onlyOwner manageable(agent) {
        if (target == address(0)) revert ZeroAddress();
        if (tokenLimits[agent][target].allowed) revert TargetIsToken();
        if (selector == bytes4(0)) revert UnsupportedOperation();
        callRules[agent][target][selector] =
            CallRule({allowed: allowed, checkAddressArg: checkAddressArg, addressArgIndex: addressArgIndex});
        uint256 v = ++policyVersion[agent];
        emit CallRuleSet(agent, target, selector, allowed, checkAddressArg, addressArgIndex, v);
    }

    // ------------------------------------------------------------- enforcement

    /// @notice Read-only dry run. Reverts with the same error the enforcing call would revert with.
    function check(address agent, address target, uint256 value, bytes calldata data)
        external
        view
        returns (Kind kind, uint256 amount)
    {
        return _evaluate(agent, target, value, data);
    }

    /// @notice Validates the call and records the spend atomically. Callable only by the bound
    ///         account, which must call it in the same call frame tree that executes the operation
    ///         so that a revert undoes the accounting.
    function validateAndRecord(address agent, address target, uint256 value, bytes calldata data)
        external
        onlyRecorder
    {
        (Kind kind, uint256 amount) = _evaluate(agent, target, value, data);
        uint256 day = block.timestamp / 1 days;
        if (kind == Kind.Token) {
            tokenSpent[agent][target][day] += amount;
        } else if (amount > 0) {
            nativeSpent[agent][day] += amount;
        }
        emit SpendRecorded(agent, target, kind, amount, day);
    }

    function _requireAuthorized(address agent) internal view returns (Policy memory p) {
        Agent memory a = agents[agent];
        if (a.status == AgentStatus.None) revert AgentUnknown();
        if (a.status == AgentStatus.Revoked) revert AgentRevoked();
        if (a.status == AgentStatus.Paused) revert AgentPaused();
        if (a.expiry != 0 && block.timestamp >= a.expiry) revert AgentExpired();

        p = policies[agent];
        if (!p.configured) revert PolicyNotConfigured();
        if (p.expiry != 0 && block.timestamp >= p.expiry) revert PolicyExpired();
    }

    function _evaluate(address agent, address target, uint256 value, bytes calldata data)
        internal
        view
        returns (Kind kind, uint256 amount)
    {
        Policy memory p = _requireAuthorized(agent);
        // The agent may never target this policy or the bound account itself, even if the owner
        // mistakenly allowlists them: that would be a path to self-escalation.
        if (target == address(this) || target == account) revert ForbiddenTarget();
        uint256 day = block.timestamp / 1 days;

        if (data.length == 0) {
            // Plain native transfer.
            if (value == 0) revert UnsupportedOperation();
            if (!recipientAllowed[agent][target]) revert RecipientNotAllowed(target);
            kind = Kind.Native;
            amount = value;
        } else {
            if (data.length < 4) revert UnsupportedOperation();
            bytes4 selector = bytes4(data[0:4]);
            if (tokenLimits[agent][target].allowed) {
                // ERC-20 transfer only; no ETH may accompany it. Token limits are in base units.
                if (value != 0) revert UnsupportedOperation();
                return (Kind.Token, _evalToken(agent, target, selector, data, day));
            }
            _evalCall(agent, target, selector, data);
            kind = Kind.Call;
            amount = value;
        }

        // Native limits apply to plain transfers and to any call that carries ETH.
        if (amount > 0) {
            if (amount > p.perTxLimit) revert PerTxLimitExceeded();
            if (nativeSpent[agent][day] + amount > p.dailyLimit) revert DailyLimitExceeded();
        }
    }

    function _evalToken(address agent, address token, bytes4 selector, bytes calldata data, uint256 day)
        internal
        view
        returns (uint256 tokenAmount)
    {
        if (selector != ERC20_TRANSFER || data.length != 68) revert UnsupportedOperation();
        uint256 toWord = uint256(bytes32(data[4:36]));
        if (toWord >> 160 != 0) revert MalformedCalldata();
        address to = address(uint160(toWord));
        tokenAmount = uint256(bytes32(data[36:68]));
        if (tokenAmount == 0) revert UnsupportedOperation();
        if (!recipientAllowed[agent][to]) revert RecipientNotAllowed(to);
        TokenLimit memory t = tokenLimits[agent][token];
        if (tokenAmount > t.perTxLimit) revert PerTxLimitExceeded();
        if (tokenSpent[agent][token][day] + tokenAmount > t.dailyLimit) revert DailyLimitExceeded();
    }

    function _evalCall(address agent, address target, bytes4 selector, bytes calldata data) internal view {
        CallRule memory r = callRules[agent][target][selector];
        if (!r.allowed) revert CallNotAllowed(target, selector);
        if (r.checkAddressArg) {
            uint256 start = 4 + 32 * uint256(r.addressArgIndex);
            if (data.length < start + 32) revert MalformedCalldata();
            uint256 word = uint256(bytes32(data[start:start + 32]));
            if (word >> 160 != 0) revert MalformedCalldata();
            if (!recipientAllowed[agent][address(uint160(word))]) revert RecipientNotAllowed(address(uint160(word)));
        }
    }
}

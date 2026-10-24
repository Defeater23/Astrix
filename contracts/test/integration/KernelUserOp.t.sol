// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint as AAEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {Kernel} from "kernel/Kernel.sol";
import {ECDSAValidator} from "kernel/validator/ECDSAValidator.sol";
import {ValidatorLib} from "kernel/utils/ValidationTypeLib.sol";
import {ValidationId} from "kernel/types/Types.sol";
import {IEntryPoint as KernelEntryPoint} from "kernel/interfaces/IEntryPoint.sol";
import {IValidator, IHook} from "kernel/interfaces/IERC7579Modules.sol";

import {SentinelPolicy} from "../../src/SentinelPolicy.sol";
import {SentinelKernelHook} from "../../src/SentinelKernelHook.sol";

/// REAL Kernel 0.3.3 + REAL EntryPoint (account-abstraction v0.7.x) on the in-process Foundry EVM.
/// No bundler process: `handleOps` is called directly, which is exactly what a bundler does on-chain.
/// Each agent has its OWN ECDSAValidator instance (ECDSAValidator keeps one owner per account) and its
/// OWN SentinelKernelHook instance. See docs/KERNEL_ADAPTER_PLAN.md.
/// NOTE: written without being compiled or executed by the author. Treat every test as NOT RUN until
/// `forge test --match-path 'test/integration/*' -vv` has been run and the output recorded.
contract KernelUserOpTest is Test {
    bytes4 constant EXEC = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes32 constant EVT_USEROP = keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");
    bytes32 constant SINGLE = bytes32(0);

    EntryPoint ep;
    Kernel impl;
    Kernel account;
    ECDSAValidator rootValidator;
    ECDSAValidator agentValidator;
    SentinelPolicy policy;
    SentinelKernelHook hook;

    address owner;
    uint256 agentPk = 0xA11CE;
    address agent;
    uint256 strangerPk = 0xBAD;
    address recipient = makeAddr("recipient");
    address bundler = makeAddr("bundler");

    function setUp() public {
        vm.warp(20_000 days + 12 hours);
        owner = makeAddr("owner");
        agent = vm.addr(agentPk);

        ep = new EntryPoint();
        impl = new Kernel(KernelEntryPoint(address(ep)));
        rootValidator = new ECDSAValidator();
        agentValidator = new ECDSAValidator();

        // Account with the owner as root validator.
        account = Kernel(payable(LibClone.deployERC1967(address(impl))));
        bytes[] memory none = new bytes[](0);
        account.initialize(
            ValidatorLib.validatorToIdentifier(IValidator(address(rootValidator))),
            IHook(address(0)),
            abi.encodePacked(owner),
            hex"",
            none
        );
        vm.deal(address(account), 50 ether);
        ep.depositTo{value: 10 ether}(address(account));

        // Policy bound to the Kernel account; per-agent hook registered as enforcer.
        policy = new SentinelPolicy(owner);
        vm.startPrank(owner);
        policy.bindAccount(address(account));
        policy.registerAgent(agent, 0);
        policy.setPolicy(agent, 1 ether, 3 ether, 0);
        policy.setRecipient(agent, recipient, true);
        vm.stopPrank();

        hook = new SentinelKernelHook(address(policy), address(account), agent);
        vm.prank(owner);
        policy.setEnforcer(address(hook), true);

        // Owner (root, direct call) installs the agent's validation entry: its own validator, the
        // per-agent hook, and ONLY the ERC-7579 `execute` selector.
        bytes memory initData = abi.encodePacked(
            address(hook), abi.encode(abi.encodePacked(agent), hex"00", abi.encodePacked(EXEC))
        );
        vm.prank(owner);
        account.installModule(1, address(agentValidator), initData);
    }

    // ------------------------------------------------------------------ helpers

    function _execCallData(bytes32 mode, bytes memory execCd) internal pure returns (bytes memory) {
        return abi.encodePacked(Kernel.executeUserOp.selector, abi.encodeWithSelector(EXEC, mode, execCd));
    }

    function _transferCallData(address to, uint256 amount) internal pure returns (bytes memory) {
        return _execCallData(SINGLE, abi.encodePacked(to, amount, bytes("")));
    }

    function _nonce(uint64) internal view returns (uint256) {
        uint192 key = uint192(
            ValidatorLib.encodeAsNonce(bytes1(0x00), bytes1(0x01), bytes20(address(agentValidator)), 0, 0) >> 64
        );
        return ep.getNonce(address(account), key);
    }

    function _op(bytes memory callData, uint256 nonce) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.nonce = nonce;
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(1_000_000), uint128(1_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(1 gwei)));
    }

    function _sign(PackedUserOperation memory op, uint256 pk) internal view returns (PackedUserOperation memory) {
        bytes32 h = ep.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        op.signature = abi.encodePacked(r, s, v);
        return op;
    }

    function _submit(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        ep.handleOps(ops, payable(bundler));
    }

    /// Submits and returns the `success` flag of the UserOperationEvent actually emitted by the EntryPoint.
    function _submitAndGetSuccess(PackedUserOperation memory op) internal returns (bool success) {
        vm.recordLogs();
        _submit(op);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == EVT_USEROP && logs[i].emitter == address(ep)) {
                (, success,,) = abi.decode(logs[i].data, (uint256, bool, uint256, uint256));
                found = true;
            }
        }
        assertTrue(found, "no UserOperationEvent emitted");
    }

    function _signedTransfer(address to, uint256 amount) internal view returns (PackedUserOperation memory) {
        return _sign(_op(_transferCallData(to, amount), _nonce(0)), agentPk);
    }

    function _day() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    // ------------------------------------------------------------- 1. valid op

    function test_validAgentUserOpExecutesAndRecordsSpend() public {
        uint256 nonceBefore = _nonce(0);
        assertTrue(_submitAndGetSuccess(_signedTransfer(recipient, 0.5 ether)));
        assertEq(recipient.balance, 0.5 ether);
        assertEq(policy.nativeSpent(agent, _day()), 0.5 ether);
        assertEq(_nonce(0), nonceBefore + 1);
    }

    function test_ownerRootStillWorksAndAgentCannotCallDirectly() public {
        vm.prank(owner);
        account.execute(bytes32(0), abi.encodePacked(recipient, uint256(1 ether), bytes("")));
        assertEq(recipient.balance, 1 ether);
        vm.prank(agent);
        vm.expectRevert();
        account.execute(bytes32(0), abi.encodePacked(recipient, uint256(1 ether), bytes("")));
    }

    // ------------------------------------------------- 2-6. validation-phase rejections

    function test_invalidSignatureRejected() public {
        PackedUserOperation memory op = _sign(_op(_transferCallData(recipient, 0.1 ether), _nonce(0)), strangerPk);
        vm.expectRevert(abi.encodeWithSelector(AAEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _submit(op);
        assertEq(recipient.balance, 0);
    }

    function test_wrongChainIdSignatureRejected() public {
        PackedUserOperation memory op = _op(_transferCallData(recipient, 0.1 ether), _nonce(0));
        uint256 realChain = block.chainid;
        vm.chainId(realChain + 1);
        op = _sign(op, agentPk); // signed over a hash that commits to the wrong chain id
        vm.chainId(realChain);
        vm.expectRevert(abi.encodeWithSelector(AAEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _submit(op);
        assertEq(recipient.balance, 0);
    }

    function test_alteredPayloadRejected() public {
        PackedUserOperation memory op = _signedTransfer(recipient, 0.1 ether);
        op.callData = _transferCallData(recipient, 0.9 ether); // altered after signing
        vm.expectRevert(abi.encodeWithSelector(AAEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _submit(op);
        assertEq(recipient.balance, 0);
    }

    function test_invalidNonceRejected() public {
        PackedUserOperation memory op = _sign(_op(_transferCallData(recipient, 0.1 ether), _nonce(0) + 1), agentPk);
        vm.expectRevert(abi.encodeWithSelector(AAEntryPoint.FailedOp.selector, 0, "AA25 invalid account nonce"));
        _submit(op);
    }

    function test_reusedNonceAndDuplicateSubmissionRejected() public {
        PackedUserOperation memory op = _signedTransfer(recipient, 0.5 ether);
        assertTrue(_submitAndGetSuccess(op));
        vm.expectRevert(abi.encodeWithSelector(AAEntryPoint.FailedOp.selector, 0, "AA25 invalid account nonce"));
        _submit(op); // byte-identical resubmission
        assertEq(recipient.balance, 0.5 ether); // executed exactly once
        assertEq(policy.nativeSpent(agent, _day()), 0.5 ether);
    }

    function test_agentCannotUseNonGrantedSelector() public {
        // callData[4:8] = installModule selector, which was never granted to the agent's validation entry.
        bytes memory cd = abi.encodePacked(
            Kernel.executeUserOp.selector,
            abi.encodeWithSelector(Kernel.installModule.selector, uint256(1), address(agentValidator), bytes(""))
        );
        PackedUserOperation memory op = _sign(_op(cd, _nonce(0)), agentPk);
        vm.expectRevert(AAEntryPoint.FailedOpWithRevert.selector);
        _submit(op);
    }

    // -------------------------------- 7-12. execution-phase rejections (op included, success=false)

    function test_overPerTxLimitFailsAndRollsBack() public {
        assertFalse(_submitAndGetSuccess(_signedTransfer(recipient, 1.1 ether)));
        assertEq(recipient.balance, 0);
        assertEq(policy.nativeSpent(agent, _day()), 0);
    }

    function test_unlistedRecipientFails() public {
        assertFalse(_submitAndGetSuccess(_signedTransfer(makeAddr("other"), 0.1 ether)));
        assertEq(policy.nativeSpent(agent, _day()), 0);
    }

    function test_agentCannotTargetOwnAccount() public {
        assertFalse(_submitAndGetSuccess(_signedTransfer(address(account), 0.1 ether)));
    }

    function test_delegatecallModeRejected() public {
        bytes memory cd = _execCallData(bytes32(bytes1(0xff)), abi.encodePacked(address(0xdead), bytes("")));
        assertFalse(_submitAndGetSuccess(_sign(_op(cd, _nonce(0)), agentPk)));
    }

    function test_tryModeRejected() public {
        bytes memory cd = _execCallData(bytes32(bytes2(0x0001)), abi.encodePacked(recipient, uint256(0.1 ether), bytes("")));
        assertFalse(_submitAndGetSuccess(_sign(_op(cd, _nonce(0)), agentPk)));
        assertEq(recipient.balance, 0);
    }

    function test_batchCannotSplitPastDailyLimit() public {
        SentinelKernelHook.Execution[] memory e = new SentinelKernelHook.Execution[](4);
        for (uint256 i; i < 4; ++i) {
            e[i] = SentinelKernelHook.Execution(recipient, 1 ether, "");
        }
        bytes memory cd = _execCallData(bytes32(bytes1(0x01)), abi.encode(e));
        assertFalse(_submitAndGetSuccess(_sign(_op(cd, _nonce(0)), agentPk)));
        assertEq(recipient.balance, 0);
        assertEq(policy.nativeSpent(agent, _day()), 0);
    }

    function test_batchWithinLimitsExecutesEveryCall() public {
        SentinelKernelHook.Execution[] memory e = new SentinelKernelHook.Execution[](2);
        e[0] = SentinelKernelHook.Execution(recipient, 0.4 ether, "");
        e[1] = SentinelKernelHook.Execution(recipient, 0.6 ether, "");
        bytes memory cd = _execCallData(bytes32(bytes1(0x01)), abi.encode(e));
        assertTrue(_submitAndGetSuccess(_sign(_op(cd, _nonce(0)), agentPk)));
        assertEq(recipient.balance, 1 ether);
        assertEq(policy.nativeSpent(agent, _day()), 1 ether);
    }

    function test_revokedAgentCannotExecute() public {
        vm.prank(owner);
        policy.revokeAgent(agent);
        assertFalse(_submitAndGetSuccess(_signedTransfer(recipient, 0.1 ether)));
        assertEq(recipient.balance, 0);
    }

    function test_expiredAgentCannotExecute() public {
        vm.prank(owner);
        policy.setAgentExpiry(agent, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 1 hours);
        assertFalse(_submitAndGetSuccess(_signedTransfer(recipient, 0.1 ether)));
    }

    function test_uninstalledAgentEntryCannotValidate() public {
        // Owner removes the agent's validation entry; its signatures stop validating.
        bytes memory deinit = hex"";
        vm.prank(owner);
        account.uninstallValidation(
            ValidatorLib.validatorToIdentifier(IValidator(address(agentValidator))), deinit, hex"00"
        );
        PackedUserOperation memory op = _signedTransfer(recipient, 0.1 ether);
        vm.expectRevert();
        _submit(op);
        assertEq(recipient.balance, 0);
    }
}

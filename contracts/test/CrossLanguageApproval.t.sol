// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SentinelPolicy} from "../src/SentinelPolicy.sol";
import {SentinelOwnerApproval} from "../src/SentinelOwnerApproval.sol";
import {SentinelApprovalKernelHook} from "../src/SentinelApprovalKernelHook.sol";

/// Module 7D cross-language test. NOT COMPILED OR RUN by the author (no Foundry available).
///
/// The constants below were produced by the TypeScript side (`features/authorization/typedData.ts`
/// and a deterministic test signature) for one request: a 0.5 ether native transfer to a fixture
/// recipient, chain 31337, nonce 7. This test checks that the reviewed, signed and executed bytes are
/// the same on both sides: the contract recomputes the same digest, accepts the TypeScript signature,
/// and the hook consumes the approval for exactly the TypeScript call data and for nothing else.
/// The "account" is a pranked address behaving like Kernel; this is NOT a real Kernel/EntryPoint test.
contract CrossLanguageApprovalTest is Test {
    uint256 constant OWNER_PK = 0xA11CE;
    string constant OWNER_TS = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
    uint256 constant ACCOUNT_N = 0xd0001;
    uint256 constant AGENT_N = 0xd0a01;
    uint256 constant RECIPIENT_N = 0xd0e01;
    uint256 constant VERIFYING_N = 0xd0b01;

    bytes32 constant TS_OPERATION_ID = 0x4e0a04663e3d866cdab7f6fcebaefab1e2161c83cbaa39ec0210b7be6858fdf8;
    bytes32 constant TS_EXECUTION_HASH = 0x17805a93d24470aceb7d21f90ffb2a6e2a2d53615be069ffe143907ad9db8f42;
    bytes32 constant TS_DIGEST = 0xa4e25eac132aa70e28f18a9268d14676c5fcbd5b5949965df8a353c4bcdf6bce;
    uint64 constant EXPIRY = 1800003600;
    uint256 constant NONCE = 7;
    bytes constant TS_CALLDATA =
        hex"e9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000d0e0100000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000";
    bytes constant TS_SIGNATURE =
        hex"2819ca00c790d4e54a1a44fd34ef6e9026992e2be19ae4020cc40d9d0f27be3517d8c33968d95f8f7a9c510ebb219ac7343494dc001aa93531775b1a5f55d1141b";

    bytes4 constant EXEC = bytes4(keccak256("execute(bytes32,bytes)"));

    SentinelPolicy policy;
    SentinelOwnerApproval approvals;
    SentinelApprovalKernelHook hook;

    address owner;
    address account = address(uint160(ACCOUNT_N));
    address agent = address(uint160(AGENT_N));
    address recipient = address(uint160(RECIPIENT_N));
    address verifying = address(uint160(VERIFYING_N));
    address entryPoint = makeAddr("entryPoint");

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_060);
        owner = vm.addr(OWNER_PK);

        policy = new SentinelPolicy(owner);
        // The approval contract must live at the address the TypeScript side signed for.
        deployCodeTo("SentinelOwnerApproval.sol:SentinelOwnerApproval", abi.encode(address(policy)), verifying);
        approvals = SentinelOwnerApproval(verifying);

        vm.startPrank(owner);
        policy.bindAccount(account);
        policy.registerAgent(agent, 0);
        policy.setPolicy(agent, 1 ether, 3 ether, 0);
        policy.setRecipient(agent, recipient, true);
        vm.stopPrank();

        hook = new SentinelApprovalKernelHook(address(policy), address(approvals), account, agent);
        vm.startPrank(owner);
        policy.setEnforcer(address(hook), true);
        approvals.setConsumer(address(hook), true);
        vm.stopPrank();
        vm.prank(account);
        hook.onInstall("");
    }

    function _message() internal view returns (SentinelOwnerApproval.OwnerApproval memory) {
        return SentinelOwnerApproval.OwnerApproval({
            account: account,
            agent: agent,
            operationId: TS_OPERATION_ID,
            userOpNonce: NONCE,
            executionHash: TS_EXECUTION_HASH,
            expiry: EXPIRY
        });
    }

    function _pre(bytes memory data) internal {
        vm.prank(account);
        hook.preCheck(entryPoint, 0, data);
    }

    // ------------------------------------------------------- the two sides agree

    function test_tsOwnerAddressMatchesFoundry() public view {
        assertEq(owner, vm.parseAddress(OWNER_TS));
    }

    function test_tsCallDataIsWhatKernelWouldExecute() public view {
        bytes memory expected = abi.encodeWithSelector(EXEC, bytes32(0), abi.encodePacked(recipient, uint256(0.5 ether), bytes("")));
        assertEq(keccak256(TS_CALLDATA), keccak256(expected));
        assertEq(keccak256(TS_CALLDATA), TS_EXECUTION_HASH);
    }

    function test_tsDigestMatchesContractDigest() public view {
        assertEq(approvals.digestOf(_message()), TS_DIGEST);
    }

    // ------------------------------------------------- reviewed == signed == executed

    function test_tsSignatureIsAcceptedAndExactBytesAreConsumed() public {
        bytes32 digest = approvals.submitApproval(_message(), TS_SIGNATURE);
        assertEq(digest, TS_DIGEST);
        assertEq(uint8(approvals.statusOf(digest)), uint8(SentinelOwnerApproval.Status.Approved));

        _pre(TS_CALLDATA);
        assertEq(uint8(approvals.statusOf(digest)), uint8(SentinelOwnerApproval.Status.Consumed));
        assertEq(policy.nativeSpent(agent, block.timestamp / 1 days), 0.5 ether);
    }

    function test_consumedApprovalCannotBeReplayed() public {
        approvals.submitApproval(_message(), TS_SIGNATURE);
        _pre(TS_CALLDATA);
        vm.prank(account);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        hook.preCheck(entryPoint, 0, TS_CALLDATA);
    }

    function test_alteredCallDataIsNotCoveredByTheApproval() public {
        approvals.submitApproval(_message(), TS_SIGNATURE);
        bytes memory altered = abi.encodeWithSelector(EXEC, bytes32(0), abi.encodePacked(recipient, uint256(0.6 ether), bytes("")));
        vm.prank(account);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        hook.preCheck(entryPoint, 0, altered);
    }

    function test_approvalWithoutSubmissionCannotExecute() public {
        vm.prank(account);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        hook.preCheck(entryPoint, 0, TS_CALLDATA);
    }

    // ------------------------------------------------------------ negative cases

    function test_alteredMessageWithTheSameSignatureIsRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _message();
        a.expiry = EXPIRY + 1;
        vm.expectRevert();
        approvals.submitApproval(a, TS_SIGNATURE);

        a = _message();
        a.userOpNonce = NONCE + 1;
        vm.expectRevert();
        approvals.submitApproval(a, TS_SIGNATURE);

        a = _message();
        a.executionHash = keccak256("something else");
        vm.expectRevert();
        approvals.submitApproval(a, TS_SIGNATURE);
    }

    function test_expiredApprovalIsRejected() public {
        vm.warp(EXPIRY);
        vm.expectRevert(SentinelOwnerApproval.ApprovalExpired.selector);
        approvals.submitApproval(_message(), TS_SIGNATURE);
    }

    function test_wrongChainIsRejected() public {
        vm.chainId(1);
        vm.expectRevert();
        approvals.submitApproval(_message(), TS_SIGNATURE);
    }

    function test_forgedSignatureIsRejected() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, TS_DIGEST);
        vm.expectRevert();
        approvals.submitApproval(_message(), abi.encodePacked(r, s, v));
    }

    function test_policyProhibitionBeatsApproval() public {
        // Remove the recipient after approval: the policy refuses and the approval is not consumed.
        approvals.submitApproval(_message(), TS_SIGNATURE);
        vm.prank(owner);
        policy.setRecipient(agent, recipient, false);
        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, recipient));
        hook.preCheck(entryPoint, 0, TS_CALLDATA);
        assertEq(uint8(approvals.statusOf(TS_DIGEST)), uint8(SentinelOwnerApproval.Status.Approved));
    }
}

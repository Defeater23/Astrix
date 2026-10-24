// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SentinelPolicy} from "../src/SentinelPolicy.sol";
import {SentinelOwnerApproval} from "../src/SentinelOwnerApproval.sol";
import {SentinelApprovalKernelHook} from "../src/SentinelApprovalKernelHook.sol";

/// Module 7C contract tests. NOT COMPILED OR RUN by the author (no Foundry available). Treat every test
/// as NOT RUN until you have run `forge test` and recorded the output. The "account" is a pranked address
/// that behaves like Kernel calling `preCheck(entryPoint, 0, userOp.callData[4:])`; these are NOT real
/// Kernel/EntryPoint integration tests.
contract SentinelOwnerApprovalTest is Test {
    SentinelPolicy policy;
    SentinelOwnerApproval approvals;
    SentinelApprovalKernelHook hook;

    uint256 ownerPk = 0xA11CE;
    uint256 otherPk = 0xB0B;
    address owner;
    address account = makeAddr("kernelAccount");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");
    address stranger = makeAddr("stranger");
    address entryPoint = makeAddr("entryPoint");

    uint256 constant START = 20_000 days + 12 hours;
    bytes4 constant EXEC = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes32 constant SINGLE = bytes32(0);
    bytes32 constant BATCH = bytes32(bytes1(0x01));
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    bytes32 constant TYPEHASH = keccak256(
        "OwnerApproval(address account,address agent,bytes32 operationId,uint256 userOpNonce,bytes32 executionHash,uint64 expiry)"
    );
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function setUp() public {
        vm.warp(START);
        owner = vm.addr(ownerPk);
        policy = new SentinelPolicy(owner);
        approvals = new SentinelOwnerApproval(address(policy));
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

    // ------------------------------------------------------------ helpers (independent of the contract)
    function _domain(uint256 chainId, address vc) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("SentinelOwnerApproval"), keccak256("1"), chainId, vc)
        );
    }

    function _digestFor(uint256 chainId, address vc, SentinelOwnerApproval.OwnerApproval memory a)
        internal
        pure
        returns (bytes32)
    {
        bytes32 sh = keccak256(
            abi.encode(TYPEHASH, a.account, a.agent, a.operationId, a.userOpNonce, a.executionHash, a.expiry)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domain(chainId, vc), sh));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _exec(bytes32 mode, bytes memory execCd) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXEC, mode, execCd);
    }

    function _transfer(uint256 amount) internal view returns (bytes memory) {
        return _exec(SINGLE, abi.encodePacked(recipient, amount, bytes("")));
    }

    function _approval(bytes32 opId, bytes memory msgData, uint256 lifetime)
        internal
        view
        returns (SentinelOwnerApproval.OwnerApproval memory)
    {
        return SentinelOwnerApproval.OwnerApproval({
            account: account,
            agent: agent,
            operationId: opId,
            userOpNonce: 7,
            executionHash: keccak256(msgData),
            expiry: uint64(block.timestamp + lifetime)
        });
    }

    function _submit(SentinelOwnerApproval.OwnerApproval memory a) internal returns (bytes32) {
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        return approvals.submitApproval(a, sig);
    }

    function _pre(bytes memory data) internal {
        vm.prank(account);
        hook.preCheck(entryPoint, 0, data);
    }

    // ------------------------------------------------------------ digest agreement
    function test_contractDigestMatchesIndependentComputation() public view {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        assertEq(approvals.digestOf(a), _digestFor(block.chainid, address(approvals), a));
    }

    /// Known answer shared with the TypeScript test (`typedData.test.ts`, "known-answer digest").
    /// If this fails and the TypeScript test passes, the two sides disagree about the scheme.
    function test_knownAnswerDigestMatchesTypeScript() public pure {
        SentinelOwnerApproval.OwnerApproval memory a = SentinelOwnerApproval.OwnerApproval({
            account: address(uint160(0xd0001)),
            agent: address(uint160(0xd0a01)),
            operationId: bytes32(uint256(0x1234)),
            userOpNonce: 7,
            executionHash: bytes32(uint256(0xabcdef)),
            expiry: 1_800_003_600
        });
        bytes32 got = _digestFor(11155111, address(uint160(0xd0b01)), a);
        assertEq(got, KNOWN_DIGEST);
    }

    // Computed by the TypeScript side (`digestOfMessage`, run under a pure-JS shim that reproduces the
    // EIP-712 specification's published "Mail" example digest). Not computed by Solidity: this test is
    // what proves or disproves that the two implementations agree.
    bytes32 constant KNOWN_DIGEST = 0x3905f6b2a64b9bad16a29dc729cc715d3759ebb0e6f5767e827df2066e54e3c1;

    // ------------------------------------------------------------ submission: positive
    function test_validApprovalIsRecorded() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes32 d = _submit(a);
        assertEq(uint8(approvals.statusOf(d)), uint8(SentinelOwnerApproval.Status.Approved));
        assertTrue(approvals.operationIdUsed(a.operationId));
    }

    function test_anyoneMaySubmitTheOwnersSignature() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        vm.prank(stranger);
        approvals.submitApproval(a, sig);
    }

    // ------------------------------------------------------------ submission: forged / altered
    function test_forgedSignatureRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(otherPk, _digestFor(block.chainid, address(approvals), a));
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_garbageSignatureRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, new bytes(65));
    }

    function test_wrongLengthSignatureRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, hex"1234");
    }

    function test_alteredExecutionHashRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        a.executionHash = keccak256(_transfer(0.9 ether)); // altered payload after signing
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_alteredExpiryRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        a.expiry += 1;
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_alteredUserOpNonceRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        a.userOpNonce = 8;
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_alteredAgentRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        a.agent = stranger;
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_wrongAccountRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        a.account = stranger;
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        vm.expectRevert(SentinelOwnerApproval.WrongAccount.selector);
        approvals.submitApproval(a, sig);
    }

    function test_wrongChainSignatureRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid + 1, address(approvals), a));
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_signatureForOtherVerifyingContractRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(0xBEEF), a));
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, sig);
    }

    function test_highSMalleatedSignatureRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        bytes32 s2 = bytes32(N - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        vm.expectRevert(SentinelOwnerApproval.InvalidSignature.selector);
        approvals.submitApproval(a, abi.encodePacked(r, s2, v2));
    }

    // ------------------------------------------------------------ submission: time and replay
    function test_expiredApprovalRejectedAtSubmission() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        vm.warp(a.expiry);
        vm.expectRevert(SentinelOwnerApproval.ApprovalExpired.selector);
        approvals.submitApproval(a, sig);
    }

    function test_lifetimeOverMaxRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a =
            _approval(bytes32(uint256(1)), _transfer(0.5 ether), 7 days + 1);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        vm.expectRevert(SentinelOwnerApproval.ExpiryTooFar.selector);
        approvals.submitApproval(a, sig);
    }

    function test_replayOfSameSignedApprovalRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        approvals.submitApproval(a, sig);
        vm.expectRevert(SentinelOwnerApproval.OperationIdUsed.selector);
        approvals.submitApproval(a, sig);
    }

    function test_reusedOperationIdWithDifferentPayloadRejected() public {
        _submit(_approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours));
        SentinelOwnerApproval.OwnerApproval memory b = _approval(bytes32(uint256(1)), _transfer(0.6 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), b));
        vm.expectRevert(SentinelOwnerApproval.OperationIdUsed.selector);
        approvals.submitApproval(b, sig);
    }

    function test_operationIdStaysUsedAfterConsumption() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        _pre(data);
        SentinelOwnerApproval.OwnerApproval memory again = _approval(bytes32(uint256(1)), data, 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), again));
        vm.expectRevert(SentinelOwnerApproval.OperationIdUsed.selector);
        approvals.submitApproval(again, sig);
    }

    function test_secondLiveApprovalForSameExecutionIsBusy() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        SentinelOwnerApproval.OwnerApproval memory b = _approval(bytes32(uint256(2)), data, 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), b));
        vm.expectRevert(SentinelOwnerApproval.SlotBusy.selector);
        approvals.submitApproval(b, sig);
    }

    function test_slotFreeAfterFirstApprovalExpires() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.warp(block.timestamp + 1 hours + 1);
        _submit(_approval(bytes32(uint256(2)), data, 1 hours));
    }

    function test_zeroFieldsRejected() public {
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(0), _transfer(0.5 ether), 1 hours);
        bytes memory sig = _sign(ownerPk, _digestFor(block.chainid, address(approvals), a));
        vm.expectRevert(SentinelOwnerApproval.InvalidApproval.selector);
        approvals.submitApproval(a, sig);
    }

    // ------------------------------------------------------------ owner admin
    function test_onlyOwnerSetsConsumer() public {
        vm.prank(stranger);
        vm.expectRevert(SentinelOwnerApproval.NotApprover.selector);
        approvals.setConsumer(stranger, true);
    }

    function test_onlyOwnerRevokes() public {
        bytes32 d = _submit(_approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours));
        vm.prank(stranger);
        vm.expectRevert(SentinelOwnerApproval.NotApprover.selector);
        approvals.revokeApproval(d);
    }

    function test_revokedApprovalCannotBeConsumed() public {
        bytes memory data = _transfer(0.5 ether);
        bytes32 d = _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.prank(owner);
        approvals.revokeApproval(d);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        _pre(data);
    }

    function test_cannotRevokeConsumedApproval() public {
        bytes memory data = _transfer(0.5 ether);
        bytes32 d = _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        _pre(data);
        vm.prank(owner);
        vm.expectRevert(SentinelOwnerApproval.NotRevocable.selector);
        approvals.revokeApproval(d);
    }

    function test_directConsumeByStrangerRejected() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.prank(stranger);
        vm.expectRevert(SentinelOwnerApproval.NotConsumer.selector);
        approvals.consume(agent, keccak256(data));
    }

    function test_removedConsumerCannotConsume() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.prank(owner);
        approvals.setConsumer(address(hook), false);
        vm.expectRevert(SentinelOwnerApproval.NotConsumer.selector);
        _pre(data);
    }

    // ------------------------------------------------------------ hook: execution gate
    function test_approvedTransferExecutesOnceAndRecordsSpend() public {
        bytes memory data = _transfer(0.5 ether);
        bytes32 d = _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        _pre(data);
        assertEq(policy.nativeSpent(agent, block.timestamp / 1 days), 0.5 ether);
        assertEq(uint8(approvals.statusOf(d)), uint8(SentinelOwnerApproval.Status.Consumed));
    }

    function test_noApprovalMeansNoExecution() public {
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        _pre(_transfer(0.5 ether));
    }

    function test_replayAfterConsumptionRejected() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        _pre(data);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        _pre(data);
    }

    function test_alteredPayloadNeedsFreshApproval() public {
        _submit(_approval(bytes32(uint256(1)), _transfer(0.5 ether), 1 hours));
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        _pre(_transfer(0.6 ether));
    }

    function test_expiredApprovalRejectedAtExecution() public {
        bytes memory data = _transfer(0.5 ether);
        SentinelOwnerApproval.OwnerApproval memory a = _approval(bytes32(uint256(1)), data, 1 hours);
        _submit(a);
        vm.warp(a.expiry);
        vm.expectRevert(SentinelOwnerApproval.ApprovalExpired.selector);
        _pre(data);
    }

    function test_approvalForOneAgentDoesNotAuthorizeAnother() public {
        address agent2 = makeAddr("agent2");
        vm.startPrank(owner);
        policy.registerAgent(agent2, 0);
        policy.setPolicy(agent2, 1 ether, 3 ether, 0);
        policy.setRecipient(agent2, recipient, true);
        vm.stopPrank();
        SentinelApprovalKernelHook hook2 =
            new SentinelApprovalKernelHook(address(policy), address(approvals), account, agent2);
        vm.startPrank(owner);
        policy.setEnforcer(address(hook2), true);
        approvals.setConsumer(address(hook2), true);
        vm.stopPrank();
        vm.prank(account);
        hook2.onInstall("");

        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours)); // approval names `agent`
        vm.prank(account);
        vm.expectRevert(SentinelOwnerApproval.NoApproval.selector);
        hook2.preCheck(entryPoint, 0, data);
    }

    function test_approvedBatchExecutes() public {
        SentinelApprovalKernelHook.Execution[] memory e = new SentinelApprovalKernelHook.Execution[](2);
        e[0] = SentinelApprovalKernelHook.Execution(recipient, 0.5 ether, "");
        e[1] = SentinelApprovalKernelHook.Execution(recipient, 0.5 ether, "");
        bytes memory data = _exec(BATCH, abi.encode(e));
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        _pre(data);
        assertEq(policy.nativeSpent(agent, block.timestamp / 1 days), 1 ether);
    }

    // ------------------------------------------------------------ prohibited stays prohibited
    function test_prohibitedRecipientRevertsEvenWithValidApproval() public {
        bytes memory data = _exec(SINGLE, abi.encodePacked(stranger, uint256(0.1 ether), bytes("")));
        bytes32 d = _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, stranger));
        _pre(data);
        assertEq(uint8(approvals.statusOf(d)), uint8(SentinelOwnerApproval.Status.Approved)); // not consumed
    }

    function test_overLimitRevertsEvenWithValidApproval() public {
        bytes memory data = _transfer(1.1 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        _pre(data);
    }

    function test_revokedAgentRevertsEvenWithValidApproval() public {
        bytes memory data = _transfer(0.5 ether);
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.prank(owner);
        policy.revokeAgent(agent);
        vm.expectRevert(SentinelPolicy.AgentRevoked.selector);
        _pre(data);
    }

    function test_delegatecallModeRevertsEvenWithValidApproval() public {
        bytes memory data = _exec(bytes32(bytes1(0xff)), abi.encodePacked(recipient, bytes("")));
        _submit(_approval(bytes32(uint256(1)), data, 1 hours));
        vm.expectRevert(SentinelApprovalKernelHook.UnsupportedMode.selector);
        _pre(data);
    }

    // ------------------------------------------------------------ construction and access
    function test_hookRejectsApprovalContractForOtherPolicy() public {
        SentinelPolicy other = new SentinelPolicy(owner);
        SentinelOwnerApproval otherApprovals = new SentinelOwnerApproval(address(other));
        vm.expectRevert(SentinelApprovalKernelHook.ApprovalPolicyMismatch.selector);
        new SentinelApprovalKernelHook(address(policy), address(otherApprovals), account, agent);
    }

    function test_hookPreCheckOnlyAccount() public {
        vm.prank(stranger);
        vm.expectRevert(SentinelApprovalKernelHook.NotAccount.selector);
        hook.preCheck(entryPoint, 0, _transfer(0.5 ether));
    }

    function test_approverIsPolicyOwner() public view {
        assertEq(approvals.APPROVER(), owner);
    }
}

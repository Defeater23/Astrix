// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SentinelPolicy} from "../src/SentinelPolicy.sol";
import {SentinelKernelHook} from "../src/SentinelKernelHook.sol";

/// Hook-level contract tests. The "account" is an address pranked to behave like Kernel calling
/// `preCheck(entryPoint, 0, userOp.callData[4:])`. These are NOT real Kernel/EntryPoint integration tests.
/// NOTE: written without being compiled or executed by the author (no Foundry available).
/// Treat every test here as NOT RUN until you have run `forge test` and recorded the output.
contract SentinelKernelHookTest is Test {
    SentinelPolicy policy;
    SentinelKernelHook hook;

    address owner = makeAddr("owner");
    address account = makeAddr("kernelAccount");
    address agent = makeAddr("agent");
    address recipient = makeAddr("recipient");
    address entryPoint = makeAddr("entryPoint");
    address stranger = makeAddr("stranger");

    uint256 constant START = 20_000 days + 12 hours;
    bytes4 constant EXEC = bytes4(keccak256("execute(bytes32,bytes)"));

    function setUp() public {
        vm.warp(START);
        policy = new SentinelPolicy(owner);
        vm.startPrank(owner);
        policy.bindAccount(account);
        policy.registerAgent(agent, 0);
        policy.setPolicy(agent, 1 ether, 3 ether, 0);
        policy.setRecipient(agent, recipient, true);
        vm.stopPrank();

        hook = new SentinelKernelHook(address(policy), account, agent);
        vm.prank(owner);
        policy.setEnforcer(address(hook), true);
        vm.prank(account);
        hook.onInstall("");
    }

    // ------------------------------------------------------------ helpers
    function _single(address t, uint256 v, bytes memory d) internal pure returns (bytes memory) {
        return abi.encodePacked(t, v, d);
    }

    function _call(bytes32 mode, bytes memory execCd) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXEC, mode, execCd);
    }

    function _pre(bytes memory data) internal {
        vm.prank(account);
        hook.preCheck(entryPoint, 0, data);
    }

    function _batch(uint256 n, uint256 each) internal view returns (bytes memory) {
        SentinelKernelHook.Execution[] memory e = new SentinelKernelHook.Execution[](n);
        for (uint256 i; i < n; ++i) {
            e[i] = SentinelKernelHook.Execution(recipient, each, "");
        }
        return abi.encode(e);
    }

    bytes32 constant SINGLE = bytes32(0);
    bytes32 constant BATCH = bytes32(bytes1(0x01));

    // ------------------------------------------------------- positive paths
    function test_singleNativeTransferRecordsSpend() public {
        _pre(_call(SINGLE, _single(recipient, 0.5 ether, "")));
        assertEq(policy.nativeSpent(agent, block.timestamp / 1 days), 0.5 ether);
    }

    function test_batchRecordsEachCall() public {
        _pre(_call(BATCH, _batch(3, 0.5 ether)));
        assertEq(policy.nativeSpent(agent, block.timestamp / 1 days), 1.5 ether);
    }

    // ------------------------------------------------------ policy still enforced
    function test_overPerTxLimitReverts() public {
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        _pre(_call(SINGLE, _single(recipient, 1.1 ether, "")));
    }

    function test_batchCannotSplitPastDailyLimit() public {
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _pre(_call(BATCH, _batch(4, 1 ether))); // 4 ether > 3 ether daily, each call alone is allowed
    }

    function test_unlistedRecipientReverts() public {
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, stranger));
        _pre(_call(SINGLE, _single(stranger, 0.1 ether, "")));
    }

    function test_cannotTargetAccount() public {
        vm.expectRevert(SentinelPolicy.ForbiddenTarget.selector);
        _pre(_call(SINGLE, _single(account, 0.1 ether, "")));
    }

    function test_revokedAgentReverts() public {
        vm.prank(owner);
        policy.revokeAgent(agent);
        vm.expectRevert(SentinelPolicy.AgentRevoked.selector);
        _pre(_call(SINGLE, _single(recipient, 0.1 ether, "")));
    }

    function test_removedEnforcerCannotRecord() public {
        vm.prank(owner);
        policy.setEnforcer(address(hook), false);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        _pre(_call(SINGLE, _single(recipient, 0.1 ether, "")));
    }

    // ------------------------------------------------------- unsafe modes fail closed
    function test_delegatecallModeRejected() public {
        vm.expectRevert(SentinelKernelHook.UnsupportedMode.selector);
        _pre(_call(bytes32(bytes1(0xff)), abi.encodePacked(recipient, bytes("")))); // decodeDelegate layout
    }

    function test_staticModeRejected() public {
        vm.expectRevert(SentinelKernelHook.UnsupportedMode.selector);
        _pre(_call(bytes32(bytes1(0xfe)), _single(recipient, 0.1 ether, "")));
    }

    function test_tryExecTypeRejected() public {
        bytes32 tryMode = bytes32(bytes2(0x0001));
        vm.expectRevert(SentinelKernelHook.UnsupportedMode.selector);
        _pre(_call(tryMode, _single(recipient, 0.1 ether, "")));
    }

    function test_nonZeroModeSelectorOrPayloadRejected() public {
        bytes32 dirty = bytes32(uint256(1));
        vm.expectRevert(SentinelKernelHook.UnsupportedMode.selector);
        _pre(_call(dirty, _single(recipient, 0.1 ether, "")));
    }

    function test_otherSelectorRejected() public {
        bytes memory d = abi.encodeWithSelector(bytes4(0xdeadbeef), SINGLE, _single(recipient, 0.1 ether, ""));
        vm.expectRevert(SentinelKernelHook.UnsupportedSelector.selector);
        _pre(d);
    }

    function test_nonCanonicalOuterEncodingRejected() public {
        bytes memory good = _call(SINGLE, _single(recipient, 0.1 ether, ""));
        vm.expectRevert(SentinelKernelHook.NonCanonicalEncoding.selector);
        _pre(abi.encodePacked(good, bytes32(uint256(1)))); // trailing junk
    }

    function test_emptyAndOversizedBatchRejected() public {
        vm.expectRevert(SentinelKernelHook.EmptyBatch.selector);
        _pre(_call(BATCH, _batch(0, 0)));
        vm.expectRevert(SentinelKernelHook.BatchTooLarge.selector);
        _pre(_call(BATCH, _batch(17, 1)));
    }

    function test_nonZeroValueRejected() public {
        vm.prank(account);
        vm.expectRevert(SentinelKernelHook.NonZeroValue.selector);
        hook.preCheck(entryPoint, 1, _call(SINGLE, _single(recipient, 0.1 ether, "")));
    }

    // ------------------------------------------------------- caller authentication
    function test_onlyAccountCanCallHookFunctions() public {
        bytes memory d = _call(SINGLE, _single(recipient, 0.1 ether, ""));
        vm.startPrank(stranger);
        vm.expectRevert(SentinelKernelHook.NotAccount.selector);
        hook.preCheck(entryPoint, 0, d);
        vm.expectRevert(SentinelKernelHook.NotAccount.selector);
        hook.onInstall("");
        vm.expectRevert(SentinelKernelHook.NotAccount.selector);
        hook.onUninstall("");
        vm.expectRevert(SentinelKernelHook.NotAccount.selector);
        hook.postCheck("");
        vm.stopPrank();
        // The agent itself cannot call it either.
        vm.prank(agent);
        vm.expectRevert(SentinelKernelHook.NotAccount.selector);
        hook.preCheck(entryPoint, 0, d);
    }

    function test_uninstalledHookFailsClosed() public {
        vm.prank(account);
        hook.onUninstall("");
        vm.expectRevert(SentinelKernelHook.NotInitialized.selector);
        _pre(_call(SINGLE, _single(recipient, 0.1 ether, "")));
        assertFalse(hook.isInitialized(account));
    }

    function test_moduleTypeIsHook() public view {
        assertTrue(hook.isModuleType(4));
        assertFalse(hook.isModuleType(1));
    }

    // -------------------------------------- policy recorder trust boundary (no weakening)
    function test_agentAndStrangerStillCannotRecordDirectly() public {
        vm.prank(agent);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        policy.validateAndRecord(agent, recipient, 0.1 ether, "");
        vm.prank(stranger);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        policy.validateAndRecord(agent, recipient, 0.1 ether, "");
    }

    function test_onlyOwnerSetsEnforcer() public {
        vm.prank(stranger);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setEnforcer(stranger, true);
    }

    function test_agentCannotBecomeEnforcerAndViceVersa() public {
        vm.prank(owner);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.setEnforcer(agent, true);
        vm.startPrank(owner);
        policy.setEnforcer(stranger, true);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.registerAgent(stranger, 0);
        vm.stopPrank();
    }

    function test_constructorRejectsPolicyAccountMismatch() public {
        vm.expectRevert(SentinelKernelHook.PolicyAccountMismatch.selector);
        new SentinelKernelHook(address(policy), stranger, agent);
    }
}

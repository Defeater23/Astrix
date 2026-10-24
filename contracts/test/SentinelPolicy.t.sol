// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SentinelPolicy} from "../src/SentinelPolicy.sol";
import {MockAccount, MockERC20, Sink} from "./mocks/Mocks.sol";

/// NOTE: written without being compiled or executed by the author (no Foundry available).
/// Treat every test here as NOT RUN until you have run `forge test` and recorded the output.
contract SentinelPolicyTest is Test {
    SentinelPolicy policy;
    MockAccount account;
    MockERC20 token; // 6 decimals, like USDC: limits are base units
    Sink sink;

    address owner;
    address agent;
    address recipient;
    address stranger;

    uint256 constant START = 20_000 days + 12 hours;
    uint256 constant PER_TX = 1 ether;
    uint256 constant DAILY = 3 ether;
    uint256 constant T_PER_TX = 100e6;
    uint256 constant T_DAILY = 250e6;

    function setUp() public {
        owner = makeAddr("owner");
        agent = makeAddr("agent");
        recipient = makeAddr("recipient");
        stranger = makeAddr("stranger");
        vm.warp(START);

        policy = new SentinelPolicy(owner);
        account = new MockAccount();
        account.setPolicy(policy);

        vm.startPrank(owner);
        policy.bindAccount(address(account));
        policy.registerAgent(agent, 0);
        policy.setPolicy(agent, PER_TX, DAILY, 0);
        policy.setRecipient(agent, recipient, true);
        vm.stopPrank();

        vm.deal(address(account), 100 ether);
        token = new MockERC20(6);
        token.mint(address(account), 1_000_000e6);
        vm.prank(owner);
        policy.setToken(agent, address(token), true, T_PER_TX, T_DAILY);
        sink = new Sink();
        vm.deal(address(sink), 0);
    }

    // ----------------------------------------------------------------- helpers

    function _native(uint256 amt) internal {
        account.execute(agent, recipient, amt, "");
    }

    function _tokenTransfer(address to, uint256 amt) internal {
        account.execute(agent, address(token), 0, abi.encodeWithSelector(MockERC20.transfer.selector, to, amt));
    }

    function _day() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _allowPing(bool checkArg, uint8 idx) internal {
        vm.prank(owner);
        policy.setCallRule(agent, address(sink), Sink.ping.selector, true, checkArg, idx);
    }

    // ------------------------------------------------------- setup / authority

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(SentinelPolicy.ZeroAddress.selector);
        new SentinelPolicy(address(0));
    }

    function test_bindAccountOnlyOnceAndOnlyOwner() public {
        SentinelPolicy p = new SentinelPolicy(owner);
        vm.prank(stranger);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        p.bindAccount(address(account));

        vm.startPrank(owner);
        vm.expectRevert(SentinelPolicy.ZeroAddress.selector);
        p.bindAccount(address(0));
        p.bindAccount(address(account));
        vm.expectRevert(SentinelPolicy.AccountAlreadyBound.selector);
        p.bindAccount(stranger);
        vm.stopPrank();
    }

    function test_agentCannotMutateOwnerAuthority() public {
        vm.startPrank(agent);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setPolicy(agent, 1000 ether, 1000 ether, 0);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setRecipient(agent, stranger, true);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setToken(agent, address(token), true, 1, 1);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setCallRule(agent, address(sink), Sink.ping.selector, true, false, 0);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setAgentExpiry(agent, 0);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.resumeAgent(agent);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.pauseAgent(agent);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.revokeAgent(agent);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.registerAgent(stranger, 0);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.bindAccount(stranger);
        vm.stopPrank();
    }

    function test_accountAndStrangerCannotMutatePolicy() public {
        vm.prank(address(account));
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setPolicy(agent, 1000 ether, 1000 ether, 0);
        vm.prank(stranger);
        vm.expectRevert(SentinelPolicy.NotOwner.selector);
        policy.setRecipient(agent, stranger, true);
    }

    function test_cannotRegisterPrivilegedOrDuplicateAgents() public {
        vm.startPrank(owner);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.registerAgent(address(0), 0);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.registerAgent(owner, 0);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.registerAgent(address(account), 0);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        policy.registerAgent(address(policy), 0);
        vm.expectRevert(SentinelPolicy.AgentAlreadyRegistered.selector);
        policy.registerAgent(agent, 0);
        vm.expectRevert(SentinelPolicy.InvalidExpiry.selector);
        policy.registerAgent(stranger, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_recordingOnlyByBoundAccount() public {
        vm.prank(agent);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        policy.validateAndRecord(agent, recipient, 1, "");
        vm.prank(owner);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        policy.validateAndRecord(agent, recipient, 1, "");
        vm.prank(stranger);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        policy.validateAndRecord(agent, recipient, 1, "");
    }

    function test_recordingFailsClosedIfAccountNeverBound() public {
        SentinelPolicy p = new SentinelPolicy(owner);
        vm.expectRevert(SentinelPolicy.NotAccount.selector);
        p.validateAndRecord(agent, recipient, 1, "");
    }

    function test_cannotBindAnAgentAsAccount() public {
        SentinelPolicy p = new SentinelPolicy(owner);
        vm.startPrank(owner);
        p.registerAgent(agent, 0);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector);
        p.bindAccount(agent);
        p.revokeAgent(agent);
        vm.expectRevert(SentinelPolicy.InvalidAgent.selector); // revoked agents stay excluded
        p.bindAccount(agent);
        vm.stopPrank();
    }

    function test_agentCannotTargetAccountOrPolicyEvenIfAllowlisted() public {
        vm.startPrank(owner);
        policy.setRecipient(agent, address(account), true);
        policy.setCallRule(agent, address(policy), SentinelPolicy.setRecipient.selector, true, false, 0);
        policy.setCallRule(agent, address(account), MockAccount.setPolicy.selector, true, false, 0);
        vm.stopPrank();

        vm.expectRevert(SentinelPolicy.ForbiddenTarget.selector);
        account.execute(agent, address(account), 1, "");
        vm.expectRevert(SentinelPolicy.ForbiddenTarget.selector);
        account.execute(
            agent, address(policy), 0, abi.encodeWithSelector(SentinelPolicy.setRecipient.selector, agent, stranger, true)
        );
        vm.expectRevert(SentinelPolicy.ForbiddenTarget.selector);
        account.execute(agent, address(account), 0, abi.encodeWithSelector(MockAccount.setPolicy.selector, address(1)));
    }

    // ---------------------------------------------------------- native limits

    function test_nativeTransferSucceedsAndIsRecorded() public {
        _native(0.5 ether);
        assertEq(recipient.balance, 0.5 ether);
        assertEq(policy.nativeSpent(agent, _day()), 0.5 ether);
    }

    function test_perTxBoundary() public {
        _native(PER_TX); // exactly at the limit
        assertEq(policy.nativeSpent(agent, _day()), PER_TX);
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        _native(PER_TX + 1);
    }

    function test_dailyCapBoundaryAndNextDayReset() public {
        _native(PER_TX);
        _native(PER_TX);
        _native(PER_TX); // exactly DAILY
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _native(1 wei);

        vm.warp((_day() + 1) * 1 days); // first second of the next UTC day
        _native(PER_TX);
        assertEq(policy.nativeSpent(agent, _day()), PER_TX);
    }

    function test_oneSecondBeforeMidnightStillCountsToday() public {
        vm.warp((_day() + 1) * 1 days - 1);
        _native(PER_TX);
        _native(PER_TX);
        _native(PER_TX);
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _native(1);
    }

    function test_sameBlockSequentialSpendsShareOneBudget() public {
        // Two operations in the same block, each under the per-tx limit, together over the daily cap.
        _native(PER_TX);
        _native(PER_TX);
        _native(PER_TX - 1);
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _native(2);
    }

    function test_unlistedRecipientBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, stranger));
        account.execute(agent, stranger, 1, "");
    }

    function test_removedRecipientBlocked() public {
        vm.prank(owner);
        policy.setRecipient(agent, recipient, false);
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, recipient));
        _native(1);
    }

    function test_zeroValuePlainCallUnsupported() public {
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        account.execute(agent, recipient, 0, "");
    }

    function test_shortCalldataUnsupported() public {
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        account.execute(agent, recipient, 0, hex"aabbcc");
    }

    // ------------------------------------------------------- agent state/expiry

    function test_unknownAgentBlocked() public {
        vm.expectRevert(SentinelPolicy.AgentUnknown.selector);
        account.execute(stranger, recipient, 1, "");
    }

    function test_policyNotConfiguredBlocked() public {
        address a2 = makeAddr("agent2");
        vm.startPrank(owner);
        policy.registerAgent(a2, 0);
        policy.setRecipient(a2, recipient, true);
        vm.stopPrank();
        vm.expectRevert(SentinelPolicy.PolicyNotConfigured.selector);
        account.execute(a2, recipient, 1, "");
    }

    function test_pauseResume() public {
        vm.prank(owner);
        policy.pauseAgent(agent);
        vm.expectRevert(SentinelPolicy.AgentPaused.selector);
        _native(1);
        vm.prank(owner);
        policy.resumeAgent(agent);
        _native(1);
    }

    function test_revocationIsTerminal() public {
        vm.startPrank(owner);
        policy.revokeAgent(agent);
        vm.expectRevert(SentinelPolicy.AgentRevoked.selector);
        policy.setPolicy(agent, 1, 1, 0);
        vm.expectRevert(SentinelPolicy.AgentAlreadyRegistered.selector);
        policy.registerAgent(agent, 0);
        vm.expectRevert(SentinelPolicy.InvalidStatusTransition.selector);
        policy.resumeAgent(agent);
        vm.stopPrank();
        vm.expectRevert(SentinelPolicy.AgentRevoked.selector);
        _native(1);
    }

    function test_agentExpiryBoundary() public {
        uint64 exp = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        policy.setAgentExpiry(agent, exp);
        vm.warp(exp - 1);
        _native(1);
        vm.warp(exp);
        vm.expectRevert(SentinelPolicy.AgentExpired.selector);
        _native(1);
    }

    function test_policyExpiryBoundary() public {
        uint64 exp = uint64(block.timestamp + 1 hours);
        vm.prank(owner);
        policy.setPolicy(agent, PER_TX, DAILY, exp);
        vm.warp(exp - 1);
        _native(1);
        vm.warp(exp);
        vm.expectRevert(SentinelPolicy.PolicyExpired.selector);
        _native(1);
    }

    function test_cannotSetPastExpiryOrBadLimits() public {
        uint256 tooBig = policy.MAX_LIMIT() + 1; // read before expectRevert so it is not the reverting call
        vm.startPrank(owner);
        vm.expectRevert(SentinelPolicy.InvalidExpiry.selector);
        policy.setAgentExpiry(agent, uint64(block.timestamp));
        vm.expectRevert(SentinelPolicy.InvalidLimits.selector);
        policy.setPolicy(agent, 2 ether, 1 ether, 0);
        vm.expectRevert(SentinelPolicy.InvalidLimits.selector);
        policy.setPolicy(agent, 1, tooBig, 0);
        vm.stopPrank();
    }

    // -------------------------------------------------------------- ERC-20

    function test_tokenTransferWithinLimitsAndDecimalsAreBaseUnits() public {
        _tokenTransfer(recipient, 100e6); // 100.000000 tokens == per-tx limit exactly
        assertEq(token.balanceOf(recipient), 100e6);
        assertEq(policy.tokenSpent(agent, address(token), _day()), 100e6);
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        _tokenTransfer(recipient, 100e6 + 1);
    }

    function test_tokenDailyCap() public {
        _tokenTransfer(recipient, 100e6);
        _tokenTransfer(recipient, 100e6);
        _tokenTransfer(recipient, 50e6); // exactly 250e6
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _tokenTransfer(recipient, 1);
        vm.warp((_day() + 1) * 1 days);
        _tokenTransfer(recipient, 100e6);
    }

    function test_tokenAndNativeBudgetsAreIndependent() public {
        _tokenTransfer(recipient, 100e6);
        _native(PER_TX);
        assertEq(policy.nativeSpent(agent, _day()), PER_TX);
        assertEq(policy.tokenSpent(agent, address(token), _day()), 100e6);
    }

    function test_tokenUnlistedRecipientBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, stranger));
        _tokenTransfer(stranger, 1);
    }

    function test_tokenApproveAndOtherSelectorsUnsupported() public {
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        account.execute(
            agent, address(token), 0, abi.encodeWithSelector(MockERC20.approve.selector, stranger, type(uint256).max)
        );
    }

    function test_tokenWrongLengthAndEthAttachedAndZeroAmountUnsupported() public {
        bytes memory good = abi.encodeWithSelector(MockERC20.transfer.selector, recipient, 1);
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        account.execute(agent, address(token), 0, abi.encodePacked(good, bytes1(0x00)));
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        account.execute(agent, address(token), 1, good);
        vm.expectRevert(SentinelPolicy.UnsupportedOperation.selector);
        _tokenTransfer(recipient, 0);
    }

    function test_tokenDirtyAddressWordMalformed() public {
        bytes memory dirty = abi.encodePacked(MockERC20.transfer.selector, bytes32(type(uint256).max), uint256(1));
        vm.expectRevert(SentinelPolicy.MalformedCalldata.selector);
        account.execute(agent, address(token), 0, dirty);
    }

    function test_unlistedTokenBlocked() public {
        MockERC20 other = new MockERC20(18);
        other.mint(address(account), 1e18);
        bytes memory d = abi.encodeWithSelector(MockERC20.transfer.selector, recipient, 1);
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.CallNotAllowed.selector, address(other), MockERC20.transfer.selector));
        account.execute(agent, address(other), 0, d);
    }

    function test_disallowedTokenBlocked() public {
        vm.prank(owner);
        policy.setToken(agent, address(token), false, 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelPolicy.CallNotAllowed.selector, address(token), MockERC20.transfer.selector)
        );
        _tokenTransfer(recipient, 1);
    }

    // ------------------------------------------------ contract calls/selectors

    function test_allowedContractCallSucceeds() public {
        _allowPing(false, 0);
        account.execute(agent, address(sink), 0, abi.encodeWithSelector(Sink.ping.selector, stranger));
        assertEq(sink.pings(), 1);
    }

    function test_unlistedContractAndSelectorBlocked() public {
        _allowPing(false, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelPolicy.CallNotAllowed.selector, address(sink), Sink.other.selector)
        );
        account.execute(agent, address(sink), 0, abi.encodeWithSelector(Sink.other.selector));
        Sink other = new Sink();
        vm.expectRevert(
            abi.encodeWithSelector(SentinelPolicy.CallNotAllowed.selector, address(other), Sink.ping.selector)
        );
        account.execute(agent, address(other), 0, abi.encodeWithSelector(Sink.ping.selector, recipient));
    }

    function test_addressParameterRestriction() public {
        _allowPing(true, 0);
        account.execute(agent, address(sink), 0, abi.encodeWithSelector(Sink.ping.selector, recipient));
        vm.expectRevert(abi.encodeWithSelector(SentinelPolicy.RecipientNotAllowed.selector, stranger));
        account.execute(agent, address(sink), 0, abi.encodeWithSelector(Sink.ping.selector, stranger));
    }

    function test_addressParameterShortOrDirtyCalldataMalformed() public {
        _allowPing(true, 0);
        vm.expectRevert(SentinelPolicy.MalformedCalldata.selector);
        account.execute(agent, address(sink), 0, abi.encodePacked(Sink.ping.selector));
        vm.expectRevert(SentinelPolicy.MalformedCalldata.selector);
        account.execute(agent, address(sink), 0, abi.encodePacked(Sink.ping.selector, bytes32(type(uint256).max)));
    }

    function test_callWithValueCountsAgainstNativeLimits() public {
        _allowPing(false, 0);
        bytes memory d = abi.encodeWithSelector(Sink.ping.selector, recipient);
        account.execute(agent, address(sink), PER_TX, d);
        assertEq(policy.nativeSpent(agent, _day()), PER_TX);
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        account.execute(agent, address(sink), PER_TX + 1, d);
    }

    function test_cannotAddCallRuleOnAllowedToken() public {
        vm.prank(owner);
        vm.expectRevert(SentinelPolicy.TargetIsToken.selector);
        policy.setCallRule(agent, address(token), MockERC20.approve.selector, true, false, 0);
    }

    // ------------------------------------------------------------- atomicity

    function test_failedExecutionRollsBackAccounting() public {
        vm.prank(owner);
        policy.setCallRule(agent, address(sink), Sink.boom.selector, true, false, 0);
        vm.expectRevert(bytes("boom"));
        account.execute(agent, address(sink), PER_TX, abi.encodeWithSelector(Sink.boom.selector));
        assertEq(policy.nativeSpent(agent, _day()), 0);
        _native(PER_TX); // full budget still available
    }

    // -------------------------------------------------------- policy mutation

    function test_loweringDailyLimitBelowSpentBlocksFurtherSpend() public {
        _native(PER_TX);
        _native(PER_TX);
        vm.prank(owner);
        policy.setPolicy(agent, PER_TX, 1 ether, 0); // below the 2 ether already spent today
        vm.expectRevert(SentinelPolicy.DailyLimitExceeded.selector);
        _native(1);
    }

    function test_raisingLimitsTakesEffectAndVersionIncrements() public {
        uint256 v0 = policy.policyVersion(agent);
        vm.prank(owner);
        policy.setPolicy(agent, 2 ether, 5 ether, 0);
        assertEq(policy.policyVersion(agent), v0 + 1);
        _native(2 ether);
    }

    function test_checkDoesNotChangeState() public {
        (SentinelPolicy.Kind k, uint256 amt) = policy.check(agent, recipient, 1 ether, "");
        assertEq(uint8(k), uint8(SentinelPolicy.Kind.Native));
        assertEq(amt, 1 ether);
        assertEq(policy.nativeSpent(agent, _day()), 0);
        vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
        policy.check(agent, recipient, 1 ether + 1, "");
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_perTxBoundary(uint256 amt) public {
        amt = bound(amt, 1, type(uint128).max);
        if (amt <= PER_TX) {
            _native(amt);
            assertEq(policy.nativeSpent(agent, _day()), amt);
        } else {
            vm.expectRevert(SentinelPolicy.PerTxLimitExceeded.selector);
            _native(amt);
        }
    }

    function testFuzz_dailySpendNeverExceedsCapAndMatchesSuccesses(uint256[6] memory amts) public {
        uint256 sum;
        for (uint256 i = 0; i < amts.length; i++) {
            uint256 amt = bound(amts[i], 1, PER_TX);
            try account.execute(agent, recipient, amt, "") {
                sum += amt;
            } catch {}
            assertLe(policy.nativeSpent(agent, _day()), DAILY);
        }
        assertEq(policy.nativeSpent(agent, _day()), sum);
        assertEq(recipient.balance, sum);
    }
}

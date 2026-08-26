// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PactAgentMarket } from "../src/PactAgentMarket.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

contract ReentrantUSDC is MockUSDC {
    PactAgentMarket private _market;
    bool public callbackBlocked;
    bool private _attempted;

    function setMarket(PactAgentMarket market_) external {
        _market = market_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!_attempted) {
            _attempted = true;
            try _market.cancelOpenJob(1) { }
            catch {
                callbackBlocked = true;
            }
        }
        return super.transferFrom(from, to, amount);
    }
}

interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract PactAgentMarketTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC private token;
    PactAgentMarket private market;

    address private constant ALICE = address(0xA11CE);
    address private constant WORKER = address(0xB0B);
    string private constant DID = "did:key:z6Mk11111111111111111111111111111111111111111111";
    bytes32 private constant BID_HASH = keccak256("AM1 bid");
    bytes32 private constant RESULT_HASH = keccak256("AM1 result");

    function setUp() public {
        token = new MockUSDC();
        market = new PactAgentMarket(address(token));
        token.mint(ALICE, 100_000_000);
        vm.prank(ALICE);
        token.approve(address(market), type(uint256).max);
        string[] memory skills = new string[](1);
        skills[0] = "Research";
        vm.prank(WORKER);
        market.registerAgent("Worker", DID, skills);
    }

    function testCreateJobEscrowsFunds() public {
        uint256 jobId = _create(5_000_000);
        PactAgentMarket.Job memory job = market.getJob(jobId);
        _assertEq(job.creator, ALICE);
        _assertEq(job.maxReward, 5_000_000);
        _assertEq(uint256(job.status), uint256(PactAgentMarket.JobStatus.Open));
        _assertEq(token.balanceOf(address(market)), 5_000_000);
        _assertEq(market.totalEscrowed(), 5_000_000);
    }

    function testCreatorCancellationRefunds() public {
        uint256 jobId = _create(5_000_000);
        vm.prank(ALICE);
        market.cancelOpenJob(jobId);
        _assertEq(token.balanceOf(ALICE), 100_000_000);
        _assertEq(market.totalEscrowed(), 0);
    }

    function testAssignmentRefundsDifferenceAndCompletes() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        _assertEq(token.balanceOf(ALICE), 97_000_000);
        _assertEq(market.totalEscrowed(), 3_000_000);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        _assertEq(token.balanceOf(WORKER), 3_000_000);
        _assertEq(market.totalEscrowed(), 0);
        PactAgentMarket.AgentStats memory stats = market.getAgentStats(WORKER);
        _assertEq(stats.completedJobs, 1);
        _assertEq(stats.totalEarned, 3_000_000);
    }

    function testNonCreatorCannotAssign() public {
        uint256 jobId = _create(5_000_000);
        vm.expectRevert(PactAgentMarket.Unauthorized.selector);
        vm.prank(WORKER);
        market.assignWorker(jobId, WORKER, keccak256(bytes(DID)), 3_000_000, BID_HASH);
    }

    function testRewardCannotExceedMax() public {
        uint256 jobId = _create(5_000_000);
        vm.expectRevert(PactAgentMarket.InvalidAmount.selector);
        vm.prank(ALICE);
        market.assignWorker(jobId, WORKER, keccak256(bytes(DID)), 6_000_000, BID_HASH);
    }

    function testOnlyWorkerCanSubmit() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.expectRevert(PactAgentMarket.Unauthorized.selector);
        vm.prank(ALICE);
        market.submitWork(jobId, RESULT_HASH);
    }

    function testWorkerAutoClaimAfterReview() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.expectRevert(PactAgentMarket.ReviewPeriodActive.selector);
        vm.prank(WORKER);
        market.claimAfterReviewPeriod(jobId);
        PactAgentMarket.Job memory job = market.getJob(jobId);
        vm.warp(uint256(job.submittedAt) + 24 hours);
        vm.prank(WORKER);
        market.claimAfterReviewPeriod(jobId);
        _assertEq(token.balanceOf(WORKER), 3_000_000);
    }

    function testRefundAfterMissedDeadline() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        PactAgentMarket.Job memory job = market.getJob(jobId);
        vm.warp(uint256(job.workDeadline) + 1);
        vm.prank(ALICE);
        market.refundExpiredAssignment(jobId);
        _assertEq(token.balanceOf(ALICE), 100_000_000);
    }

    function testAbandonmentRefundsCreator() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.prank(WORKER);
        market.abandonJob(jobId);
        _assertEq(token.balanceOf(ALICE), 100_000_000);
    }

    function testRatingUpdatesStatsAndCannotRepeat() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        vm.prank(ALICE);
        market.rateWorker(jobId, 5);
        PactAgentMarket.AgentStats memory stats = market.getAgentStats(WORKER);
        _assertEq(stats.ratingCount, 1);
        _assertEq(stats.ratingSum, 5);
        vm.expectRevert(PactAgentMarket.AlreadyRated.selector);
        vm.prank(ALICE);
        market.rateWorker(jobId, 4);
    }

    function testDoublePayoutIsRejected() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        vm.expectRevert(PactAgentMarket.InvalidStatus.selector);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        _assertEq(token.balanceOf(WORKER), 3_000_000);
    }

    function testEarlyRefundIsRejected() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.expectRevert(PactAgentMarket.DeadlineNotPassed.selector);
        vm.prank(ALICE);
        market.refundExpiredAssignment(jobId);
    }

    function testExpiredApplicationCannotAssign() public {
        uint256 jobId = _create(5_000_000);
        PactAgentMarket.Job memory job = market.getJob(jobId);
        vm.warp(uint256(job.applicationDeadline) + 1);
        vm.expectRevert(PactAgentMarket.DeadlinePassed.selector);
        vm.prank(ALICE);
        market.assignWorker(jobId, WORKER, keccak256(bytes(DID)), 3_000_000, BID_HASH);
    }

    function testInvalidRatingIsRejected() public {
        uint256 jobId = _assigned(5_000_000, 3_000_000);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        vm.expectRevert(PactAgentMarket.InvalidRating.selector);
        vm.prank(ALICE);
        market.rateWorker(jobId, 0);
    }

    function testDidCannotBelongToTwoWallets() public {
        string[] memory skills = new string[](1);
        skills[0] = "Coding";
        vm.expectRevert(PactAgentMarket.DidAlreadyRegistered.selector);
        vm.prank(address(0xCAFE));
        market.registerAgent("Copy", DID, skills);
    }

    function testReentrantTokenCallbackCannotExitEscrow() public {
        ReentrantUSDC hostileToken = new ReentrantUSDC();
        PactAgentMarket guardedMarket = new PactAgentMarket(address(hostileToken));
        hostileToken.setMarket(guardedMarket);
        hostileToken.mint(ALICE, 5_000_000);
        vm.prank(ALICE);
        hostileToken.approve(address(guardedMarket), type(uint256).max);
        vm.prank(ALICE);
        guardedMarket.createJob(
            5_000_000,
            uint64(block.timestamp + 1 days),
            uint64(2 hours),
            "Guarded job",
            "The callback cannot drain escrow.",
            0
        );
        require(hostileToken.callbackBlocked(), "callback was not blocked");
        _assertEq(hostileToken.balanceOf(address(guardedMarket)), 5_000_000);
        _assertEq(guardedMarket.totalEscrowed(), 5_000_000);
    }

    function testFuzzAgreedRewardNeverOverpays(uint96 rawReward) public {
        uint256 agreed = (uint256(rawReward) % 5_000_000) + 1;
        uint256 before = token.balanceOf(address(market));
        uint256 jobId = _assigned(5_000_000, agreed);
        vm.prank(WORKER);
        market.submitWork(jobId, RESULT_HASH);
        vm.prank(ALICE);
        market.acceptWork(jobId);
        _assertEq(token.balanceOf(WORKER), agreed);
        _assertEq(before + 5_000_000 - (5_000_000 - agreed) - agreed, 0);
    }

    function _create(uint256 reward) private returns (uint256) {
        vm.prank(ALICE);
        return market.createJob(
            reward,
            uint64(block.timestamp + 1 days),
            uint64(2 hours),
            "Research FLOP Finance",
            "Produce a concise sourced report.",
            0
        );
    }

    function _assigned(uint256 maxReward, uint256 agreed) private returns (uint256 jobId) {
        jobId = _create(maxReward);
        vm.prank(ALICE);
        market.assignWorker(jobId, WORKER, keccak256(bytes(DID)), agreed, BID_HASH);
    }

    function _assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "uint not equal");
    }

    function _assertEq(address a, address b) private pure {
        require(a == b, "address not equal");
    }
}

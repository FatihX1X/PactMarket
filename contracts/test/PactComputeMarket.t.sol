// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PactComputeMarket } from "../src/PactComputeMarket.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

interface VmComputeTest {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract ReentrantComputeUSDC is MockUSDC {
    PactComputeMarket private market;
    uint256 private requestId;

    function arm(PactComputeMarket market_, uint256 requestId_) external {
        market = market_;
        requestId = requestId_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (address(market) != address(0)) {
            try market.cancelOpenRequest(requestId) { } catch { }
        }
        return super.transfer(to, amount);
    }
}

contract PactComputeMarketTest {
    VmComputeTest private constant vm =
        VmComputeTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockUSDC private token;
    PactComputeMarket private market;
    address private constant BUYER = address(0xB0B);
    address private constant PROVIDER = address(0xA11CE);
    address private constant OTHER = address(0xBAD);
    string private constant DID = "did:key:z6Mk11111111111111111111111111111111111111111111";
    string private constant OTHER_DID = "did:key:z6Mk22222222222222222222222222222222222222222222";
    bytes32 private constant REQUIREMENTS_HASH = keccak256("requirements");
    bytes32 private constant OUTPUT_HASH = keccak256("output");
    bytes32 private constant RESULT_HASH = keccak256("result");
    bytes32 private constant QUOTE_HASH = keccak256("quote");
    bytes32 private constant ATTESTATION_HASH = keccak256("attestation");

    function setUp() public {
        token = new MockUSDC();
        market = new PactComputeMarket(address(token));
        token.mint(BUYER, 100_000_000);
        vm.prank(BUYER);
        token.approve(address(market), type(uint256).max);
        _register(PROVIDER, DID);
    }

    function testCreateRequestEscrowsAndConsumesBudget() public {
        vm.startPrank(BUYER);
        market.setBudgetPolicy(10_000_000, 20_000_000, false);
        uint256 requestId =
            _create(5_000_000, PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.stopPrank();

        PactComputeMarket.ComputeRequest memory request = market.getRequest(requestId);
        PactComputeMarket.BudgetPolicy memory policy = market.getBudgetPolicy(BUYER);
        _assertEq(request.maxBudget, 5_000_000);
        _assertEq(market.totalEscrowed(), 5_000_000);
        _assertEq(token.balanceOf(address(market)), 5_000_000);
        _assertEq(policy.spentToday, 5_000_000);
    }

    function testBudgetLimitsFailClosed() public {
        vm.startPrank(BUYER);
        market.setBudgetPolicy(4_000_000, 8_000_000, false);
        vm.expectRevert(PactComputeMarket.BudgetExceeded.selector);
        _create(5_000_000, PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.stopPrank();
    }

    function testConfidentialAndFlopNativeAreUnavailable() public {
        vm.startPrank(BUYER);
        vm.expectRevert(PactComputeMarket.ConfidentialWorkUnsupported.selector);
        market.createComputeRequest(
            5_000_000,
            uint64(block.timestamp + 1 days),
            2 hours,
            1 hours,
            2_000,
            REQUIREMENTS_HASH,
            bytes32(0),
            PactComputeMarket.ProofLevel.SelfAttested,
            "llama-3.1-8b",
            "Public benchmark inference",
            "eu-west",
            true
        );
        vm.expectRevert(PactComputeMarket.ProofLevelUnavailable.selector);
        _create(5_000_000, PactComputeMarket.ProofLevel.FlopNative, bytes32(0));
        vm.stopPrank();
    }

    function testWorkDurationIsBounded() public {
        vm.startPrank(BUYER);
        vm.expectRevert(PactComputeMarket.InvalidDuration.selector);
        market.createComputeRequest(
            5_000_000,
            uint64(block.timestamp + 1 days),
            31 days,
            1 hours,
            2_000,
            REQUIREMENTS_HASH,
            bytes32(0),
            PactComputeMarket.ProofLevel.SelfAttested,
            "llama-3.1-8b",
            "Public benchmark inference",
            "eu-west",
            false
        );
        vm.stopPrank();
    }

    function testAllowlistPolicyBlocksUnapprovedProvider() public {
        vm.prank(BUYER);
        uint256 requestId =
            _create(5_000_000, PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.prank(BUYER);
        market.setBudgetPolicy(0, 0, true);
        vm.prank(BUYER);
        vm.expectRevert(PactComputeMarket.ProviderNotAllowed.selector);
        market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), 3_000_000, QUOTE_HASH);

        vm.startPrank(BUYER);
        market.setAllowedProvider(PROVIDER, true);
        market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), 3_000_000, QUOTE_HASH);
        vm.stopPrank();
        _assertEq(token.balanceOf(BUYER), 97_000_000);
        _assertEq(market.totalEscrowed(), 3_000_000);
    }

    function testSelectionCannotUndercutRegisteredMinimumPrice() public {
        vm.prank(BUYER);
        uint256 requestId =
            _create(5_000_000, PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.prank(BUYER);
        vm.expectRevert(PactComputeMarket.InvalidAmount.selector);
        market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), 500_000, QUOTE_HASH);
    }

    function testOnlySelectedProviderCanSubmitAndExpectedHashIsEnforced() public {
        uint256 requestId = _assigned(PactComputeMarket.ProofLevel.SelfAttested, OUTPUT_HASH);
        vm.prank(OTHER);
        vm.expectRevert(PactComputeMarket.Unauthorized.selector);
        market.submitComputeResult(requestId, RESULT_HASH, OUTPUT_HASH, bytes32(0));

        vm.prank(PROVIDER);
        vm.expectRevert(PactComputeMarket.InvalidProof.selector);
        market.submitComputeResult(requestId, RESULT_HASH, keccak256("wrong"), bytes32(0));

        vm.prank(PROVIDER);
        market.submitComputeResult(requestId, RESULT_HASH, OUTPUT_HASH, bytes32(0));
        _assertEq(uint256(market.getRequest(requestId).status), 2);
    }

    function testExternalEvidenceRequiresAttestationHash() public {
        uint256 requestId = _assigned(PactComputeMarket.ProofLevel.ExternalAttested, bytes32(0));
        vm.prank(PROVIDER);
        vm.expectRevert(PactComputeMarket.InvalidProof.selector);
        market.submitComputeResult(requestId, RESULT_HASH, OUTPUT_HASH, bytes32(0));
        vm.prank(PROVIDER);
        market.submitComputeResult(requestId, RESULT_HASH, OUTPUT_HASH, ATTESTATION_HASH);
        _assertEq(market.getRequest(requestId).attestationHash, ATTESTATION_HASH);
    }

    function testBuyerAcceptsAndRatesOnce() public {
        uint256 requestId = _submitted();
        vm.prank(BUYER);
        market.acceptComputeResult(requestId);
        _assertEq(token.balanceOf(PROVIDER), 3_000_000);
        _assertEq(market.totalEscrowed(), 0);

        vm.prank(BUYER);
        market.rateProvider(requestId, 5);
        PactComputeMarket.ProviderStats memory stats = market.getProviderStats(PROVIDER);
        _assertEq(stats.completedRequests, 1);
        _assertEq(stats.totalEarned, 3_000_000);
        _assertEq(stats.ratingSum, 5);
        vm.prank(BUYER);
        vm.expectRevert(PactComputeMarket.AlreadyRated.selector);
        market.rateProvider(requestId, 4);
    }

    function testProviderClaimsAfterCustomReviewPeriod() public {
        uint256 requestId = _submitted();
        vm.prank(PROVIDER);
        vm.expectRevert(PactComputeMarket.ReviewPeriodActive.selector);
        market.claimAfterReviewPeriod(requestId);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(PROVIDER);
        market.claimAfterReviewPeriod(requestId);
        _assertEq(token.balanceOf(PROVIDER), 3_000_000);
    }

    function testExpiredAssignmentRefundsAndCannotPayTwice() public {
        uint256 requestId = _assigned(PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.warp(market.getRequest(requestId).workDeadline + 1);
        vm.prank(BUYER);
        market.refundExpiredRequest(requestId);
        _assertEq(token.balanceOf(BUYER), 100_000_000);
        _assertEq(market.totalEscrowed(), 0);
        vm.prank(BUYER);
        vm.expectRevert(PactComputeMarket.InvalidStatus.selector);
        market.refundExpiredRequest(requestId);
    }

    function testProviderCanAbandonAndRefundBuyer() public {
        uint256 requestId = _assigned(PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.prank(PROVIDER);
        market.abandonRequest(requestId);
        _assertEq(token.balanceOf(BUYER), 100_000_000);
        _assertEq(market.totalEscrowed(), 0);
    }

    function testDidCannotBeRegisteredTwice() public {
        vm.prank(OTHER);
        vm.expectRevert(PactComputeMarket.DidAlreadyRegistered.selector);
        market.registerProvider("Copy", DID, _models(), "A100 80GB", "eu-west", 1_000_000, 1);
    }

    function testReentrantRefundCannotExitTwice() public {
        ReentrantComputeUSDC hostile = new ReentrantComputeUSDC();
        PactComputeMarket hostileMarket = new PactComputeMarket(address(hostile));
        hostile.mint(BUYER, 5_000_000);
        vm.startPrank(BUYER);
        hostile.approve(address(hostileMarket), type(uint256).max);
        uint256 requestId = hostileMarket.createComputeRequest(
            5_000_000,
            uint64(block.timestamp + 1 days),
            2 hours,
            1 hours,
            2_000,
            REQUIREMENTS_HASH,
            bytes32(0),
            PactComputeMarket.ProofLevel.SelfAttested,
            "llama-3.1-8b",
            "Public benchmark inference",
            "eu-west",
            false
        );
        hostile.arm(hostileMarket, requestId);
        hostileMarket.cancelOpenRequest(requestId);
        vm.stopPrank();
        _assertEq(hostile.balanceOf(BUYER), 5_000_000);
        _assertEq(hostileMarket.totalEscrowed(), 0);
    }

    function testFuzzSelectedPriceNeverOverpays(uint96 rawPrice) public {
        uint256 price = uint256(rawPrice) % 5_000_001;
        vm.prank(BUYER);
        uint256 requestId =
            _create(5_000_000, PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.prank(BUYER);
        if (price < 1_000_000) {
            vm.expectRevert(PactComputeMarket.InvalidAmount.selector);
            market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), price, QUOTE_HASH);
        } else {
            market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), price, QUOTE_HASH);
            _assertEq(market.totalEscrowed(), price);
        }
    }

    function _submitted() private returns (uint256 requestId) {
        requestId = _assigned(PactComputeMarket.ProofLevel.SelfAttested, bytes32(0));
        vm.prank(PROVIDER);
        market.submitComputeResult(requestId, RESULT_HASH, OUTPUT_HASH, bytes32(0));
    }

    function _assigned(PactComputeMarket.ProofLevel proof, bytes32 expected)
        private
        returns (uint256 requestId)
    {
        vm.prank(BUYER);
        requestId = _create(5_000_000, proof, expected);
        vm.prank(BUYER);
        market.selectProvider(requestId, PROVIDER, keccak256(bytes(DID)), 3_000_000, QUOTE_HASH);
    }

    function _create(uint256 budget, PactComputeMarket.ProofLevel proof, bytes32 expected)
        private
        returns (uint256)
    {
        return market.createComputeRequest(
            budget,
            uint64(block.timestamp + 1 days),
            2 hours,
            1 hours,
            2_000,
            REQUIREMENTS_HASH,
            expected,
            proof,
            "llama-3.1-8b",
            "Public benchmark inference",
            "eu-west",
            false
        );
    }

    function _register(address account, string memory did) private {
        vm.prank(account);
        market.registerProvider("Provider", did, _models(), "A100 80GB", "eu-west", 1_000_000, 4);
    }

    function _models() private pure returns (string[] memory models) {
        models = new string[](2);
        models[0] = "llama-3";
        models[1] = "mistral";
    }

    function _assertEq(uint256 a, uint256 b) private pure {
        require(a == b, "not equal");
    }

    function _assertEq(bytes32 a, bytes32 b) private pure {
        require(a == b, "not equal");
    }
}

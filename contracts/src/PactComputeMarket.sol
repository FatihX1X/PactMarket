// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Non-custodial Base settlement for independently operated compute providers.
/// @dev Technocore coordinates signed quotes/results but is never a source of financial truth.
contract PactComputeMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_REVIEW_PERIOD = 1 hours;
    uint64 public constant MAX_REVIEW_PERIOD = 7 days;
    uint64 public constant MIN_WORK_DURATION = 5 minutes;
    uint64 public constant MAX_WORK_DURATION = 30 days;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_MODEL_REF_LENGTH = 96;
    uint256 public constant MAX_WORKLOAD_LENGTH = 2_000;
    uint256 public constant MAX_PROFILE_FIELD_LENGTH = 96;
    uint256 public constant MAX_MODEL_FAMILIES = 12;

    enum RequestStatus {
        Open,
        Assigned,
        Submitted,
        Completed,
        Cancelled,
        Refunded,
        Abandoned
    }

    enum ProofLevel {
        SelfAttested,
        ExternalAttested,
        FlopNative
    }

    struct ComputeRequest {
        address buyer;
        address provider;
        uint256 maxBudget;
        uint256 agreedPrice;
        uint64 quoteDeadline;
        uint64 workDuration;
        uint64 workDeadline;
        uint64 submittedAt;
        uint64 reviewPeriod;
        uint32 maxLatencyMs;
        bytes32 metadataHash;
        bytes32 requirementsHash;
        bytes32 expectedOutputHash;
        bytes32 providerDidHash;
        bytes32 acceptedQuoteHash;
        bytes32 resultHash;
        bytes32 outputHash;
        bytes32 attestationHash;
        ProofLevel requiredProof;
        RequestStatus status;
        bool rated;
    }

    struct ProviderStats {
        bytes32 didHash;
        uint64 completedRequests;
        uint64 ratingCount;
        uint256 totalEarned;
        uint256 ratingSum;
        uint256 minimumPrice;
        uint32 capacity;
        bool active;
    }

    struct BudgetPolicy {
        uint256 maxPerRequest;
        uint256 dailyLimit;
        uint256 spentToday;
        uint64 day;
        bool allowlistOnly;
    }

    IERC20 public immutable paymentToken;
    uint256 public nextRequestId = 1;
    uint256 public totalEscrowed;

    mapping(uint256 => ComputeRequest) private _requests;
    mapping(address => ProviderStats) private _providers;
    mapping(address => BudgetPolicy) private _budgetPolicies;
    mapping(address => mapping(address => bool)) public allowedProvider;
    mapping(address => bytes32) public walletToDidHash;
    mapping(bytes32 => address) public didHashToWallet;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDuration();
    error InvalidMetadata();
    error InvalidDid();
    error DidAlreadyRegistered();
    error ProviderNotRegistered();
    error Unauthorized();
    error InvalidStatus();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ReviewPeriodActive();
    error AlreadyRated();
    error InvalidRating();
    error BudgetExceeded();
    error ProviderNotAllowed();
    error EscrowTransferMismatch();
    error ConfidentialWorkUnsupported();
    error ProofLevelUnavailable();
    error InvalidProof();

    event ProviderRegistered(
        address indexed provider,
        bytes32 indexed didHash,
        string displayName,
        string did,
        string[] modelFamilies,
        string hardwareClass,
        string region,
        uint256 minimumPrice,
        uint32 capacity
    );
    event ProviderProfileUpdated(
        address indexed provider,
        bytes32 indexed didHash,
        string displayName,
        string did,
        string[] modelFamilies,
        string hardwareClass,
        string region,
        uint256 minimumPrice,
        uint32 capacity,
        bool active
    );
    event BudgetPolicyUpdated(
        address indexed buyer, uint256 maxPerRequest, uint256 dailyLimit, bool allowlistOnly
    );
    event ProviderPermissionUpdated(address indexed buyer, address indexed provider, bool allowed);
    event ComputeRequestCreated(
        uint256 indexed requestId,
        address indexed buyer,
        uint256 maxBudget,
        uint64 quoteDeadline,
        uint64 workDuration,
        uint64 reviewPeriod,
        uint32 maxLatencyMs,
        bytes32 metadataHash,
        bytes32 requirementsHash,
        bytes32 expectedOutputHash,
        ProofLevel requiredProof,
        string modelRef,
        string workload,
        string region
    );
    event ComputeRequestCancelled(uint256 indexed requestId, address indexed buyer, uint256 refund);
    event ProviderSelected(
        uint256 indexed requestId,
        address indexed provider,
        bytes32 indexed providerDidHash,
        uint256 agreedPrice,
        bytes32 quoteHash,
        uint64 workDeadline,
        uint256 buyerRefund
    );
    event ComputeResultSubmitted(
        uint256 indexed requestId,
        address indexed provider,
        bytes32 resultHash,
        bytes32 outputHash,
        bytes32 attestationHash,
        ProofLevel proofLevel
    );
    event ComputeRequestCompleted(
        uint256 indexed requestId, address indexed provider, uint256 payment
    );
    event ComputeRequestRefunded(uint256 indexed requestId, address indexed buyer, uint256 refund);
    event ComputeRequestAbandoned(
        uint256 indexed requestId, address indexed provider, uint256 refund
    );
    event ProviderRated(uint256 indexed requestId, address indexed provider, uint8 rating);

    constructor(address paymentToken_) {
        if (paymentToken_ == address(0)) revert InvalidAddress();
        paymentToken = IERC20(paymentToken_);
    }

    function registerProvider(
        string calldata displayName,
        string calldata did,
        string[] calldata modelFamilies,
        string calldata hardwareClass,
        string calldata region,
        uint256 minimumPrice,
        uint32 capacity
    ) external {
        if (walletToDidHash[msg.sender] != bytes32(0)) {
            revert DidAlreadyRegistered();
        }
        _validateProviderProfile(
            displayName, did, modelFamilies, hardwareClass, region, minimumPrice, capacity
        );
        bytes32 didHash = keccak256(bytes(did));
        if (didHashToWallet[didHash] != address(0)) revert DidAlreadyRegistered();
        walletToDidHash[msg.sender] = didHash;
        didHashToWallet[didHash] = msg.sender;
        _providers[msg.sender] = ProviderStats({
            didHash: didHash,
            completedRequests: 0,
            ratingCount: 0,
            totalEarned: 0,
            ratingSum: 0,
            minimumPrice: minimumPrice,
            capacity: capacity,
            active: true
        });
        emit ProviderRegistered(
            msg.sender,
            didHash,
            displayName,
            did,
            modelFamilies,
            hardwareClass,
            region,
            minimumPrice,
            capacity
        );
    }

    function updateProviderProfile(
        string calldata displayName,
        string calldata did,
        string[] calldata modelFamilies,
        string calldata hardwareClass,
        string calldata region,
        uint256 minimumPrice,
        uint32 capacity,
        bool active
    ) external {
        ProviderStats storage provider = _providers[msg.sender];
        if (provider.didHash == bytes32(0)) revert ProviderNotRegistered();
        _validateProviderProfile(
            displayName, did, modelFamilies, hardwareClass, region, minimumPrice, capacity
        );
        bytes32 newDidHash = keccak256(bytes(did));
        address currentOwner = didHashToWallet[newDidHash];
        if (currentOwner != address(0) && currentOwner != msg.sender) {
            revert DidAlreadyRegistered();
        }
        if (newDidHash != provider.didHash) {
            delete didHashToWallet[provider.didHash];
            didHashToWallet[newDidHash] = msg.sender;
            walletToDidHash[msg.sender] = newDidHash;
            provider.didHash = newDidHash;
        }
        provider.minimumPrice = minimumPrice;
        provider.capacity = capacity;
        provider.active = active;
        emit ProviderProfileUpdated(
            msg.sender,
            newDidHash,
            displayName,
            did,
            modelFamilies,
            hardwareClass,
            region,
            minimumPrice,
            capacity,
            active
        );
    }

    function setBudgetPolicy(uint256 maxPerRequest, uint256 dailyLimit, bool allowlistOnly)
        external
    {
        if (dailyLimit != 0 && maxPerRequest > dailyLimit) revert InvalidAmount();
        BudgetPolicy storage policy = _budgetPolicies[msg.sender];
        policy.maxPerRequest = maxPerRequest;
        policy.dailyLimit = dailyLimit;
        policy.allowlistOnly = allowlistOnly;
        emit BudgetPolicyUpdated(msg.sender, maxPerRequest, dailyLimit, allowlistOnly);
    }

    function setAllowedProvider(address provider, bool allowed) external {
        if (provider == address(0)) revert InvalidAddress();
        allowedProvider[msg.sender][provider] = allowed;
        emit ProviderPermissionUpdated(msg.sender, provider, allowed);
    }

    function createComputeRequest(
        uint256 maxBudget,
        uint64 quoteDeadline,
        uint64 workDuration,
        uint64 reviewPeriod,
        uint32 maxLatencyMs,
        bytes32 requirementsHash,
        bytes32 expectedOutputHash,
        ProofLevel requiredProof,
        string calldata modelRef,
        string calldata workload,
        string calldata region,
        bool confidential
    ) external nonReentrant returns (uint256 requestId) {
        if (confidential) revert ConfidentialWorkUnsupported();
        if (requiredProof == ProofLevel.FlopNative) revert ProofLevelUnavailable();
        if (maxBudget == 0) revert InvalidAmount();
        if (quoteDeadline <= block.timestamp) revert InvalidDeadline();
        if (workDuration < MIN_WORK_DURATION || workDuration > MAX_WORK_DURATION) {
            revert InvalidDuration();
        }
        if (reviewPeriod < MIN_REVIEW_PERIOD || reviewPeriod > MAX_REVIEW_PERIOD) {
            revert InvalidDuration();
        }
        if (
            maxLatencyMs == 0 || requirementsHash == bytes32(0) || bytes(modelRef).length == 0
                || bytes(modelRef).length > MAX_MODEL_REF_LENGTH || bytes(workload).length == 0
                || bytes(workload).length > MAX_WORKLOAD_LENGTH
                || bytes(region).length > MAX_PROFILE_FIELD_LENGTH
        ) revert InvalidMetadata();
        _consumeBudget(msg.sender, maxBudget);

        bytes32 metadataHash = keccak256(
            abi.encode(
                modelRef,
                workload,
                region,
                maxLatencyMs,
                requirementsHash,
                expectedOutputHash,
                requiredProof,
                quoteDeadline,
                workDuration,
                reviewPeriod,
                maxBudget
            )
        );
        requestId = nextRequestId++;
        ComputeRequest storage request = _requests[requestId];
        request.buyer = msg.sender;
        request.maxBudget = maxBudget;
        request.quoteDeadline = quoteDeadline;
        request.workDuration = workDuration;
        request.reviewPeriod = reviewPeriod;
        request.maxLatencyMs = maxLatencyMs;
        request.metadataHash = metadataHash;
        request.requirementsHash = requirementsHash;
        request.expectedOutputHash = expectedOutputHash;
        request.requiredProof = requiredProof;
        request.status = RequestStatus.Open;
        totalEscrowed += maxBudget;

        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), maxBudget);
        if (paymentToken.balanceOf(address(this)) - balanceBefore != maxBudget) {
            revert EscrowTransferMismatch();
        }
        emit ComputeRequestCreated(
            requestId,
            msg.sender,
            maxBudget,
            quoteDeadline,
            workDuration,
            reviewPeriod,
            maxLatencyMs,
            metadataHash,
            requirementsHash,
            expectedOutputHash,
            requiredProof,
            modelRef,
            workload,
            region
        );
    }

    function cancelOpenRequest(uint256 requestId) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        _onlyBuyer(request);
        if (request.status != RequestStatus.Open) revert InvalidStatus();
        request.status = RequestStatus.Cancelled;
        totalEscrowed -= request.maxBudget;
        paymentToken.safeTransfer(request.buyer, request.maxBudget);
        emit ComputeRequestCancelled(requestId, request.buyer, request.maxBudget);
    }

    function selectProvider(
        uint256 requestId,
        address provider,
        bytes32 providerDidHash,
        uint256 agreedPrice,
        bytes32 quoteHash
    ) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        _onlyBuyer(request);
        if (request.status != RequestStatus.Open) revert InvalidStatus();
        if (block.timestamp > request.quoteDeadline) revert DeadlinePassed();
        if (provider == address(0) || providerDidHash == bytes32(0) || quoteHash == bytes32(0)) {
            revert InvalidAddress();
        }
        ProviderStats storage profile = _providers[provider];
        if (!profile.active || profile.didHash != providerDidHash) revert ProviderNotRegistered();
        if (
            agreedPrice == 0 || agreedPrice > request.maxBudget
                || agreedPrice < profile.minimumPrice
        ) revert InvalidAmount();
        BudgetPolicy storage policy = _budgetPolicies[request.buyer];
        if (policy.allowlistOnly && !allowedProvider[request.buyer][provider]) {
            revert ProviderNotAllowed();
        }

        uint256 refund = request.maxBudget - agreedPrice;
        request.provider = provider;
        request.providerDidHash = providerDidHash;
        request.agreedPrice = agreedPrice;
        request.acceptedQuoteHash = quoteHash;
        request.workDeadline = uint64(block.timestamp + request.workDuration);
        request.status = RequestStatus.Assigned;
        if (refund != 0) {
            totalEscrowed -= refund;
            paymentToken.safeTransfer(request.buyer, refund);
        }
        emit ProviderSelected(
            requestId,
            provider,
            providerDidHash,
            agreedPrice,
            quoteHash,
            request.workDeadline,
            refund
        );
    }

    function submitComputeResult(
        uint256 requestId,
        bytes32 resultHash,
        bytes32 outputHash,
        bytes32 attestationHash
    ) external {
        ComputeRequest storage request = _request(requestId);
        if (request.status != RequestStatus.Assigned) revert InvalidStatus();
        if (msg.sender != request.provider) revert Unauthorized();
        if (block.timestamp > request.workDeadline) revert DeadlinePassed();
        if (resultHash == bytes32(0) || outputHash == bytes32(0)) revert InvalidMetadata();
        if (request.expectedOutputHash != bytes32(0) && request.expectedOutputHash != outputHash) {
            revert InvalidProof();
        }
        if (request.requiredProof == ProofLevel.ExternalAttested && attestationHash == bytes32(0)) {
            revert InvalidProof();
        }
        if (request.requiredProof == ProofLevel.SelfAttested && attestationHash != bytes32(0)) {
            revert InvalidProof();
        }
        request.resultHash = resultHash;
        request.outputHash = outputHash;
        request.attestationHash = attestationHash;
        request.submittedAt = uint64(block.timestamp);
        request.status = RequestStatus.Submitted;
        emit ComputeResultSubmitted(
            requestId, msg.sender, resultHash, outputHash, attestationHash, request.requiredProof
        );
    }

    function acceptComputeResult(uint256 requestId) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        _onlyBuyer(request);
        if (request.status != RequestStatus.Submitted) revert InvalidStatus();
        _complete(requestId, request);
    }

    function claimAfterReviewPeriod(uint256 requestId) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        if (request.status != RequestStatus.Submitted) revert InvalidStatus();
        if (msg.sender != request.provider) revert Unauthorized();
        if (block.timestamp < uint256(request.submittedAt) + request.reviewPeriod) {
            revert ReviewPeriodActive();
        }
        _complete(requestId, request);
    }

    function refundExpiredRequest(uint256 requestId) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        _onlyBuyer(request);
        if (request.status != RequestStatus.Assigned) revert InvalidStatus();
        if (block.timestamp <= request.workDeadline) revert DeadlineNotPassed();
        request.status = RequestStatus.Refunded;
        totalEscrowed -= request.agreedPrice;
        paymentToken.safeTransfer(request.buyer, request.agreedPrice);
        emit ComputeRequestRefunded(requestId, request.buyer, request.agreedPrice);
    }

    function abandonRequest(uint256 requestId) external nonReentrant {
        ComputeRequest storage request = _request(requestId);
        if (request.status != RequestStatus.Assigned) revert InvalidStatus();
        if (msg.sender != request.provider) revert Unauthorized();
        request.status = RequestStatus.Abandoned;
        totalEscrowed -= request.agreedPrice;
        paymentToken.safeTransfer(request.buyer, request.agreedPrice);
        emit ComputeRequestAbandoned(requestId, request.provider, request.agreedPrice);
    }

    function rateProvider(uint256 requestId, uint8 rating) external {
        ComputeRequest storage request = _request(requestId);
        _onlyBuyer(request);
        if (request.status != RequestStatus.Completed) revert InvalidStatus();
        if (request.rated) revert AlreadyRated();
        if (rating < 1 || rating > 5) revert InvalidRating();
        request.rated = true;
        ProviderStats storage provider = _providers[request.provider];
        provider.ratingCount += 1;
        provider.ratingSum += rating;
        emit ProviderRated(requestId, request.provider, rating);
    }

    function getRequest(uint256 requestId) external view returns (ComputeRequest memory) {
        return _request(requestId);
    }

    function getProviderStats(address provider) external view returns (ProviderStats memory) {
        return _providers[provider];
    }

    function getBudgetPolicy(address buyer) external view returns (BudgetPolicy memory policy) {
        policy = _budgetPolicies[buyer];
        uint64 today = uint64(block.timestamp / 1 days);
        if (policy.day != today) {
            policy.day = today;
            policy.spentToday = 0;
        }
    }

    function _consumeBudget(address buyer, uint256 amount) private {
        BudgetPolicy storage policy = _budgetPolicies[buyer];
        if (policy.maxPerRequest != 0 && amount > policy.maxPerRequest) revert BudgetExceeded();
        uint64 today = uint64(block.timestamp / 1 days);
        if (policy.day != today) {
            policy.day = today;
            policy.spentToday = 0;
        }
        if (policy.dailyLimit != 0 && policy.spentToday + amount > policy.dailyLimit) {
            revert BudgetExceeded();
        }
        policy.spentToday += amount;
    }

    function _complete(uint256 requestId, ComputeRequest storage request) private {
        request.status = RequestStatus.Completed;
        totalEscrowed -= request.agreedPrice;
        ProviderStats storage provider = _providers[request.provider];
        provider.completedRequests += 1;
        provider.totalEarned += request.agreedPrice;
        paymentToken.safeTransfer(request.provider, request.agreedPrice);
        emit ComputeRequestCompleted(requestId, request.provider, request.agreedPrice);
    }

    function _request(uint256 requestId) private view returns (ComputeRequest storage request) {
        request = _requests[requestId];
        if (request.buyer == address(0)) revert InvalidMetadata();
    }

    function _onlyBuyer(ComputeRequest storage request) private view {
        if (msg.sender != request.buyer) revert Unauthorized();
    }

    function _validateProviderProfile(
        string calldata displayName,
        string calldata did,
        string[] calldata modelFamilies,
        string calldata hardwareClass,
        string calldata region,
        uint256 minimumPrice,
        uint32 capacity
    ) private pure {
        bytes memory didBytes = bytes(did);
        bytes memory prefix = bytes("did:key:z6Mk");
        if (
            bytes(displayName).length == 0 || bytes(displayName).length > MAX_NAME_LENGTH
                || didBytes.length != 56 || modelFamilies.length == 0
                || modelFamilies.length > MAX_MODEL_FAMILIES || bytes(hardwareClass).length == 0
                || bytes(hardwareClass).length > MAX_PROFILE_FIELD_LENGTH
                || bytes(region).length > MAX_PROFILE_FIELD_LENGTH || minimumPrice == 0
                || capacity == 0
        ) revert InvalidMetadata();
        for (uint256 i; i < prefix.length; ++i) {
            if (didBytes[i] != prefix[i]) revert InvalidDid();
        }
        for (uint256 i = prefix.length; i < didBytes.length; ++i) {
            bytes1 character = didBytes[i];
            bool base58 = (character >= 0x31 && character <= 0x39)
                || (character >= 0x41 && character <= 0x48)
                || (character >= 0x4a && character <= 0x4e)
                || (character >= 0x50 && character <= 0x5a)
                || (character >= 0x61 && character <= 0x6b)
                || (character >= 0x6d && character <= 0x7a);
            if (!base58) revert InvalidDid();
        }
        for (uint256 i; i < modelFamilies.length; ++i) {
            uint256 length = bytes(modelFamilies[i]).length;
            if (length == 0 || length > MAX_PROFILE_FIELD_LENGTH) revert InvalidMetadata();
        }
    }
}

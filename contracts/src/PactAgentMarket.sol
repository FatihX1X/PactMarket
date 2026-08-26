// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PactAgentMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant REVIEW_PERIOD = 24 hours;
    uint256 public constant MAX_TITLE_LENGTH = 96;
    uint256 public constant MAX_DESCRIPTION_LENGTH = 2_000;
    uint256 public constant MAX_DISPLAY_NAME_LENGTH = 64;
    uint256 public constant MAX_SKILLS = 8;
    uint256 public constant MAX_SKILL_LENGTH = 32;

    enum JobStatus {
        Open,
        Assigned,
        Submitted,
        Completed,
        Cancelled,
        Refunded,
        Abandoned
    }

    struct Job {
        address creator;
        address worker;
        uint256 maxReward;
        uint256 agreedReward;
        uint64 applicationDeadline;
        uint64 assignedAt;
        uint64 workDeadline;
        uint64 submittedAt;
        bytes32 metadataHash;
        bytes32 workerDidHash;
        bytes32 acceptedBidHash;
        bytes32 resultHash;
        JobStatus status;
        bool rated;
    }

    struct AgentStats {
        uint64 completedJobs;
        uint64 ratingCount;
        uint256 totalEarned;
        uint256 ratingSum;
    }

    IERC20 public immutable paymentToken;
    uint256 public nextJobId = 1;
    uint256 public totalEscrowed;

    mapping(uint256 => Job) private _jobs;
    mapping(address => AgentStats) private _agentStats;
    mapping(address => bytes32) public walletToDidHash;
    mapping(bytes32 => address) public didHashToWallet;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDuration();
    error InvalidMetadata();
    error InvalidDid();
    error DidAlreadyRegistered();
    error AgentNotRegistered();
    error Unauthorized();
    error InvalidStatus();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ReviewPeriodActive();
    error AlreadyRated();
    error InvalidRating();
    error EscrowTransferMismatch();

    event AgentRegistered(
        address indexed wallet,
        bytes32 indexed didHash,
        string displayName,
        string did,
        string[] skills
    );
    event AgentProfileUpdated(
        address indexed wallet,
        bytes32 indexed didHash,
        string displayName,
        string did,
        string[] skills
    );
    event JobCreated(
        uint256 indexed jobId,
        address indexed creator,
        uint256 maxReward,
        uint64 applicationDeadline,
        uint64 workDuration,
        bytes32 metadataHash,
        string title,
        string description,
        uint8 category
    );
    event JobCancelled(uint256 indexed jobId, address indexed creator, uint256 refund);
    event WorkerAssigned(
        uint256 indexed jobId,
        address indexed worker,
        bytes32 indexed workerDidHash,
        uint256 agreedReward,
        bytes32 bidHash,
        uint64 workDeadline,
        uint256 creatorRefund
    );
    event WorkSubmitted(uint256 indexed jobId, address indexed worker, bytes32 resultHash);
    event WorkAbandoned(uint256 indexed jobId, address indexed worker, uint256 refund);
    event JobCompleted(uint256 indexed jobId, address indexed worker, uint256 payment);
    event JobRefunded(uint256 indexed jobId, address indexed creator, uint256 refund);
    event WorkerRated(uint256 indexed jobId, address indexed worker, uint8 rating);

    constructor(address paymentToken_) {
        if (paymentToken_ == address(0)) revert InvalidAddress();
        paymentToken = IERC20(paymentToken_);
    }

    function registerAgent(
        string calldata displayName,
        string calldata did,
        string[] calldata skills
    ) external {
        if (walletToDidHash[msg.sender] != bytes32(0)) {
            revert DidAlreadyRegistered();
        }
        _validateProfile(displayName, did, skills);
        bytes32 didHash = keccak256(bytes(did));
        if (didHashToWallet[didHash] != address(0)) revert DidAlreadyRegistered();
        walletToDidHash[msg.sender] = didHash;
        didHashToWallet[didHash] = msg.sender;
        emit AgentRegistered(msg.sender, didHash, displayName, did, skills);
    }

    function updateAgentProfile(
        string calldata displayName,
        string calldata did,
        string[] calldata skills
    ) external {
        bytes32 oldDidHash = walletToDidHash[msg.sender];
        if (oldDidHash == bytes32(0)) revert AgentNotRegistered();
        _validateProfile(displayName, did, skills);
        bytes32 didHash = keccak256(bytes(did));
        address owner = didHashToWallet[didHash];
        if (owner != address(0) && owner != msg.sender) revert DidAlreadyRegistered();
        if (oldDidHash != didHash) {
            delete didHashToWallet[oldDidHash];
            walletToDidHash[msg.sender] = didHash;
            didHashToWallet[didHash] = msg.sender;
        }
        emit AgentProfileUpdated(msg.sender, didHash, displayName, did, skills);
    }

    function createJob(
        uint256 maxReward,
        uint64 applicationDeadline,
        uint64 workDuration,
        string calldata title,
        string calldata description,
        uint8 category
    ) external nonReentrant returns (uint256 jobId) {
        if (maxReward == 0) revert InvalidAmount();
        if (applicationDeadline <= block.timestamp) revert InvalidDeadline();
        if (workDuration == 0) revert InvalidDuration();
        if (
            bytes(title).length == 0 || bytes(title).length > MAX_TITLE_LENGTH
                || bytes(description).length == 0
                || bytes(description).length > MAX_DESCRIPTION_LENGTH || category > 7
        ) revert InvalidMetadata();

        bytes32 metadataHash = keccak256(
            abi.encode(title, description, category, applicationDeadline, workDuration, maxReward)
        );
        jobId = nextJobId++;
        _jobs[jobId] = Job({
            creator: msg.sender,
            worker: address(0),
            maxReward: maxReward,
            agreedReward: 0,
            applicationDeadline: applicationDeadline,
            assignedAt: 0,
            workDeadline: 0,
            submittedAt: 0,
            metadataHash: metadataHash,
            workerDidHash: bytes32(0),
            acceptedBidHash: bytes32(0),
            resultHash: bytes32(0),
            status: JobStatus.Open,
            rated: false
        });
        _workDurations[jobId] = workDuration;
        totalEscrowed += maxReward;

        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), maxReward);
        if (paymentToken.balanceOf(address(this)) - beforeBalance != maxReward) {
            revert EscrowTransferMismatch();
        }
        emit JobCreated(
            jobId,
            msg.sender,
            maxReward,
            applicationDeadline,
            workDuration,
            metadataHash,
            title,
            description,
            category
        );
    }

    function cancelOpenJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        _onlyCreator(job);
        if (job.status != JobStatus.Open) revert InvalidStatus();
        job.status = JobStatus.Cancelled;
        totalEscrowed -= job.maxReward;
        paymentToken.safeTransfer(job.creator, job.maxReward);
        emit JobCancelled(jobId, job.creator, job.maxReward);
    }

    function assignWorker(
        uint256 jobId,
        address worker,
        bytes32 workerDidHash,
        uint256 agreedReward,
        bytes32 bidHash
    ) external nonReentrant {
        Job storage job = _job(jobId);
        _onlyCreator(job);
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (block.timestamp > job.applicationDeadline) revert DeadlinePassed();
        if (worker == address(0) || workerDidHash == bytes32(0) || bidHash == bytes32(0)) {
            revert InvalidAddress();
        }
        if (didHashToWallet[workerDidHash] != worker) revert AgentNotRegistered();
        if (agreedReward == 0 || agreedReward > job.maxReward) revert InvalidAmount();

        uint256 refund = job.maxReward - agreedReward;
        job.worker = worker;
        job.workerDidHash = workerDidHash;
        job.agreedReward = agreedReward;
        job.acceptedBidHash = bidHash;
        job.assignedAt = uint64(block.timestamp);
        job.workDeadline = uint64(block.timestamp + _workDurations[jobId]);
        job.status = JobStatus.Assigned;
        if (refund != 0) {
            totalEscrowed -= refund;
            paymentToken.safeTransfer(job.creator, refund);
        }
        emit WorkerAssigned(
            jobId, worker, workerDidHash, agreedReward, bidHash, job.workDeadline, refund
        );
    }

    // Work duration is stored separately to keep the settlement struct compact and explicit.
    mapping(uint256 => uint64) private _workDurations;

    function submitWork(uint256 jobId, bytes32 resultHash) external {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Assigned) revert InvalidStatus();
        if (msg.sender != job.worker) revert Unauthorized();
        if (block.timestamp > job.workDeadline) revert DeadlinePassed();
        if (resultHash == bytes32(0)) revert InvalidMetadata();
        job.resultHash = resultHash;
        job.submittedAt = uint64(block.timestamp);
        job.status = JobStatus.Submitted;
        emit WorkSubmitted(jobId, msg.sender, resultHash);
    }

    function acceptWork(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        _onlyCreator(job);
        if (job.status != JobStatus.Submitted) revert InvalidStatus();
        _complete(jobId, job);
    }

    function claimAfterReviewPeriod(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Submitted) revert InvalidStatus();
        if (msg.sender != job.worker) revert Unauthorized();
        if (block.timestamp < uint256(job.submittedAt) + REVIEW_PERIOD) {
            revert ReviewPeriodActive();
        }
        _complete(jobId, job);
    }

    function refundExpiredAssignment(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        _onlyCreator(job);
        if (job.status != JobStatus.Assigned) revert InvalidStatus();
        if (block.timestamp <= job.workDeadline) revert DeadlineNotPassed();
        job.status = JobStatus.Refunded;
        totalEscrowed -= job.agreedReward;
        paymentToken.safeTransfer(job.creator, job.agreedReward);
        emit JobRefunded(jobId, job.creator, job.agreedReward);
    }

    function abandonJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Assigned) revert InvalidStatus();
        if (msg.sender != job.worker) revert Unauthorized();
        job.status = JobStatus.Abandoned;
        totalEscrowed -= job.agreedReward;
        paymentToken.safeTransfer(job.creator, job.agreedReward);
        emit WorkAbandoned(jobId, job.worker, job.agreedReward);
    }

    function rateWorker(uint256 jobId, uint8 rating) external {
        Job storage job = _job(jobId);
        _onlyCreator(job);
        if (job.status != JobStatus.Completed) revert InvalidStatus();
        if (job.rated) revert AlreadyRated();
        if (rating < 1 || rating > 5) revert InvalidRating();
        job.rated = true;
        AgentStats storage stats = _agentStats[job.worker];
        stats.ratingCount += 1;
        stats.ratingSum += rating;
        emit WorkerRated(jobId, job.worker, rating);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function getAgentStats(address worker) external view returns (AgentStats memory) {
        return _agentStats[worker];
    }

    function getWorkDuration(uint256 jobId) external view returns (uint64) {
        return _workDurations[jobId];
    }

    function _complete(uint256 jobId, Job storage job) private {
        job.status = JobStatus.Completed;
        totalEscrowed -= job.agreedReward;
        AgentStats storage stats = _agentStats[job.worker];
        stats.completedJobs += 1;
        stats.totalEarned += job.agreedReward;
        paymentToken.safeTransfer(job.worker, job.agreedReward);
        emit JobCompleted(jobId, job.worker, job.agreedReward);
    }

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.creator == address(0)) revert InvalidMetadata();
    }

    function _onlyCreator(Job storage job) private view {
        if (msg.sender != job.creator) revert Unauthorized();
    }

    function _validateProfile(
        string calldata displayName,
        string calldata did,
        string[] calldata skills
    ) private pure {
        bytes memory didBytes = bytes(did);
        bytes memory prefix = bytes("did:key:z6Mk");
        if (
            bytes(displayName).length == 0 || bytes(displayName).length > MAX_DISPLAY_NAME_LENGTH
                || didBytes.length != 56 || skills.length > MAX_SKILLS
        ) revert InvalidDid();
        for (uint256 i; i < prefix.length; ++i) {
            if (didBytes[i] != prefix[i]) revert InvalidDid();
        }
        for (uint256 i; i < skills.length; ++i) {
            uint256 length = bytes(skills[i]).length;
            if (length == 0 || length > MAX_SKILL_LENGTH) revert InvalidMetadata();
        }
    }
}

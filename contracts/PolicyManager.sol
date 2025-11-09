// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title IMockRewardContract
 * @dev Interface for the MockRewardContract to check claim status
 */
interface IMockRewardContract {
    function hasUserClaimed(address user) external view returns (bool);
}

/**
 * @title PolicyManager
 * @dev A smart contract for managing insurance policies with USDC payments
 * @notice This contract allows users to create policies and claim payouts based on target contract events
 */
contract PolicyManager is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // USDC token contract (6 decimals)
    IERC20 public immutable usdcToken;
    
    // Constants for fee calculation (using 6 decimals for USDC)
    uint256 public constant FEE_PERCENTAGE = 20; // 20%
    uint256 public constant MIN_FEE = 200000; // 0.2 USDC (0.2 * 10^6)
    uint256 public constant MAX_FEE = 500000; // 0.5 USDC (0.5 * 10^6)
    uint256 public constant PERCENTAGE_DENOMINATOR = 100;

    // Policy status enumeration
    enum PolicyStatus {
        Active,
        Resolved
    }

    // Policy structure
    struct Policy {
        address user;
        address targetContract;
        uint256 creationTime;
        uint256 deadline;
        uint256 coverageAmount;
        uint256 feePaid;
        PolicyStatus status;
        bool compensated;
    }

    // Storage mappings
    mapping(bytes32 => Policy) public policies;
    
    // Mock claim tracking for MVP (will be replaced by event verification in production)
    mapping(bytes32 => bool) public mockClaimRegistered;
    mapping(address => mapping(address => uint256)) public lastClaimTime;

    // Events
    event PolicyCreated(
        bytes32 indexed policyId,
        address indexed user,
        address indexed target,
        uint256 deadline,
        uint256 coverage
    );
    
    event PolicyResolved(
        bytes32 indexed policyId,
        bool compensated
    );
    
    event MockClaimRegistered(
        bytes32 indexed policyId,
        address indexed user,
        address indexed targetContract
    );

    // Custom errors
    error InvalidUSDCAddress();
    error InvalidCoverageAmount();
    error InvalidDeadline();
    error InsufficientAllowance();
    error PolicyNotFound();
    error PolicyAlreadyResolved();
    error DeadlineNotPassed();
    error TransferFailed();

    /**
     * @dev Constructor to initialize the PolicyManager with USDC token address
     * @param _usdcToken Address of the USDC token contract
     */
    constructor(address _usdcToken) Ownable(msg.sender) {
        if (_usdcToken == address(0)) revert InvalidUSDCAddress();
        usdcToken = IERC20(_usdcToken);
    }

    /**
     * @dev Calculate the fee for a given coverage amount
     * @param coverageAmount The coverage amount in USDC (6 decimals)
     * @return fee The calculated fee amount
     */
    function calculateFee(uint256 coverageAmount) public pure returns (uint256 fee) {
        fee = (coverageAmount * FEE_PERCENTAGE) / PERCENTAGE_DENOMINATOR;
        
        // Apply min and max fee limits
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        } else if (fee > MAX_FEE) {
            fee = MAX_FEE;
        }
    }

    /**
     * @dev Create a new insurance policy
     * @param targetContract Address of the contract to monitor for claims
     * @param requestedDeadline Timestamp when the policy expires (ignored; set to 60s from now)
     * @param coverageAmount Amount of USDC coverage (6 decimals)
     * @return policyId The unique identifier for the created policy
     */
    function createPolicy(
        address targetContract,
        uint256 requestedDeadline,
        uint256 coverageAmount
    ) external nonReentrant whenNotPaused returns (bytes32 policyId) {
        // Validation
        if (targetContract == address(0)) revert InvalidUSDCAddress();
        if (coverageAmount == 0) revert InvalidCoverageAmount();
        // Use a fixed short deadline for testing/demo purposes
        uint256 deadline = block.timestamp + 60; // 60 ثانية بدل 86400
        if (deadline <= block.timestamp) revert InvalidDeadline();

        // Calculate fee and total payment required
        uint256 fee = calculateFee(coverageAmount);
        uint256 totalPayment = coverageAmount + fee;

        // Check allowance
        if (usdcToken.allowance(msg.sender, address(this)) < totalPayment) {
            revert InsufficientAllowance();
        }

        // Generate unique policy ID
        policyId = keccak256(abi.encodePacked(msg.sender, targetContract, block.timestamp));

        // Create policy
        policies[policyId] = Policy({
            user: msg.sender,
            targetContract: targetContract,
            creationTime: block.timestamp,
            deadline: deadline,
            coverageAmount: coverageAmount,
            feePaid: fee,
            status: PolicyStatus.Active,
            compensated: false
        });

        // Transfer USDC from user
        usdcToken.safeTransferFrom(msg.sender, address(this), totalPayment);

        emit PolicyCreated(policyId, msg.sender, targetContract, deadline, coverageAmount);
    }

    /**
     * @dev Verify and process payout for a policy
     * @param policyId The unique identifier of the policy
     */
    function verifyAndPayout(bytes32 policyId) external nonReentrant whenNotPaused {
        Policy storage policy = policies[policyId];
        
        // Validation
        if (policy.user == address(0)) revert PolicyNotFound();
        if (policy.status != PolicyStatus.Active) revert PolicyAlreadyResolved();
        if (block.timestamp <= policy.deadline) revert DeadlineNotPassed();
        if (policy.user != msg.sender) revert PolicyNotFound(); // Only policy owner can claim

        // Mark policy as resolved
        policy.status = PolicyStatus.Resolved;

        // Check if claim was registered by checking the target contract directly
        bool claimDetected = false;
        
        // Check if the target address has code (is a contract)
        address targetContract = policy.targetContract;
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(targetContract)
        }
        
        if (codeSize > 0) {
            // Try to check if the target contract has a hasUserClaimed function (for MockRewardContract)
            try IMockRewardContract(policy.targetContract).hasUserClaimed(policy.user) returns (bool claimed) {
                claimDetected = claimed;
            } catch {
                // If the target contract doesn't implement the interface, fall back to mock tracking
                claimDetected = mockClaimRegistered[policyId] || 
                               (lastClaimTime[policy.user][policy.targetContract] >= policy.creationTime &&
                                lastClaimTime[policy.user][policy.targetContract] <= policy.deadline);
            }
        } else {
            // Target is not a contract, use mock tracking only
            claimDetected = mockClaimRegistered[policyId] || 
                           (lastClaimTime[policy.user][policy.targetContract] >= policy.creationTime &&
                            lastClaimTime[policy.user][policy.targetContract] <= policy.deadline);
        }

        if (!claimDetected) {
            // No claim detected - pay full coverage
            policy.compensated = true;
            usdcToken.safeTransfer(policy.user, policy.coverageAmount);
        } else {
            // Claim was successful - refund only the fee
            policy.compensated = false;
            usdcToken.safeTransfer(policy.user, policy.feePaid);
        }

        emit PolicyResolved(policyId, policy.compensated);
    }

    /**
     * @dev Mock function to register a claim for testing purposes
     * @notice In production, this will be replaced by event verification logic
     * @param policyId The policy ID to register a claim for
     */
    function mockRegisterClaim(bytes32 policyId) external {
        Policy storage policy = policies[policyId];
        
        if (policy.user == address(0)) revert PolicyNotFound();
        if (policy.status != PolicyStatus.Active) revert PolicyAlreadyResolved();
        if (msg.sender != policy.user) revert PolicyNotFound();
        
        // Register the mock claim
        mockClaimRegistered[policyId] = true;
        lastClaimTime[policy.user][policy.targetContract] = block.timestamp;
        
        emit MockClaimRegistered(policyId, policy.user, policy.targetContract);
    }

    /**
     * @dev Get policy details
     * @param policyId The unique identifier of the policy
     * @return policy The policy struct
     */
    function getPolicy(bytes32 policyId) external view returns (Policy memory policy) {
        return policies[policyId];
    }

    /**
     * @dev Check if a policy exists
     * @param policyId The unique identifier of the policy
     * @return exists True if the policy exists
     */
    function policyExists(bytes32 policyId) external view returns (bool exists) {
        return policies[policyId].user != address(0);
    }

    /**
     * @dev Emergency withdrawal function for owner (only for unclaimed policies after deadline + grace period)
     * @param policyId The policy ID to withdraw funds from
     */
    function emergencyWithdraw(bytes32 policyId) external onlyOwner {
        Policy storage policy = policies[policyId];
        
        if (policy.user == address(0)) revert PolicyNotFound();
        if (policy.status != PolicyStatus.Active) revert PolicyAlreadyResolved();
        
        // Allow emergency withdrawal only after deadline + 30 days grace period
        if (block.timestamp <= policy.deadline + 30 days) revert DeadlineNotPassed();
        
        policy.status = PolicyStatus.Resolved;
        policy.compensated = false;
        
        // Transfer funds to owner
        uint256 totalAmount = policy.coverageAmount + policy.feePaid;
        usdcToken.safeTransfer(owner(), totalAmount);
        
        emit PolicyResolved(policyId, false);
    }

    /**
     * @dev Pause the contract (only owner)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause the contract (only owner)
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Get contract's USDC balance
     * @return balance The current USDC balance
     */
    function getContractBalance() external view returns (uint256 balance) {
        return usdcToken.balanceOf(address(this));
    }
}
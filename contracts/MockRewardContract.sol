// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title MockRewardContract
 * @dev A mock contract that simulates a reward system for testing PolicyManager
 * @notice This contract emits RewardClaimed events when users claim rewards
 */
contract MockRewardContract {
    // Event emitted when a user claims a reward
    event RewardClaimed(address indexed user);
    
    // Mapping to track if a user has claimed
    mapping(address => bool) public hasClaimed;
    
    // Mock reward amount (for testing purposes)
    uint256 public constant REWARD_AMOUNT = 1000000; // 1 USDC worth in wei (6 decimals)
    
    /**
     * @dev Allows a user to claim a reward
     * @notice Emits RewardClaimed event when called
     */
    function claim() external {
        require(!hasClaimed[msg.sender], "Already claimed");
        
        hasClaimed[msg.sender] = true;
        
        // Emit the event that PolicyManager will listen for
        emit RewardClaimed(msg.sender);
    }
    
    /**
     * @dev Check if a user has claimed their reward
     * @param user Address to check
     * @return bool True if user has claimed, false otherwise
     */
    function hasUserClaimed(address user) external view returns (bool) {
        return hasClaimed[user];
    }
    
    /**
     * @dev Reset claim status for testing purposes
     * @param user Address to reset
     */
    function resetClaim(address user) external {
        hasClaimed[user] = false;
    }
}
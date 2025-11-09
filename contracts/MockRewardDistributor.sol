// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockRewardDistributor
 * @dev A mock contract that simulates a reward distribution system
 * This contract emits RewardClaimed events to test PolicyManager's verification logic
 */
contract MockRewardDistributor {
    event RewardClaimed(address indexed user, uint256 amount, uint256 timestamp);
    
    mapping(address => bool) public hasUserClaimed;
    mapping(address => uint256) public claimedAmounts;
    
    /**
     * @dev Simulates a user claiming rewards
     * @param amount The amount of rewards claimed
     */
    function claimRewards(uint256 amount) external {
        require(!hasUserClaimed[msg.sender], "User has already claimed rewards");
        
        hasUserClaimed[msg.sender] = true;
        claimedAmounts[msg.sender] = amount;
        
        emit RewardClaimed(msg.sender, amount, block.timestamp);
    }
    
    /**
     * @dev Allows the contract owner to simulate a claim for any user (for testing)
     * @param user The user address to simulate a claim for
     * @param amount The amount of rewards claimed
     */
    function simulateClaim(address user, uint256 amount) external {
        hasUserClaimed[user] = true;
        claimedAmounts[user] = amount;
        
        emit RewardClaimed(user, amount, block.timestamp);
    }
    
    /**
     * @dev Reset a user's claim status (for testing purposes)
     * @param user The user address to reset
     */
    function resetUserClaim(address user) external {
        hasUserClaimed[user] = false;
        claimedAmounts[user] = 0;
    }
    
    /**
     * @dev Get the total number of claims made
     */
    function getTotalClaims() external view returns (uint256) {
        // This is a simplified implementation
        // In a real contract, you'd track this properly
        return 0;
    }
}
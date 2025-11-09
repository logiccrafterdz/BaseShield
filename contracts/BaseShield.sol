// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BaseShield
 * @dev A basic example contract optimized for Base network
 * @notice This contract demonstrates basic functionality with OpenZeppelin security features
 */
contract BaseShield is Ownable, ReentrancyGuard, Pausable {
    uint256 private _counter;
    
    event CounterIncremented(uint256 newValue, address indexed incrementer);
    event CounterReset(uint256 previousValue);
    
    /**
     * @dev Constructor sets the initial owner
     */
    constructor() Ownable(msg.sender) {
        _counter = 0;
    }
    
    /**
     * @dev Increment the counter by 1
     * @notice This function can be called by anyone when not paused
     */
    function increment() external whenNotPaused nonReentrant {
        _counter += 1;
        emit CounterIncremented(_counter, msg.sender);
    }
    
    /**
     * @dev Get the current counter value
     * @return The current counter value
     */
    function getCounter() external view returns (uint256) {
        return _counter;
    }
    
    /**
     * @dev Reset the counter to zero (only owner)
     * @notice Only the contract owner can reset the counter
     */
    function resetCounter() external onlyOwner {
        uint256 previousValue = _counter;
        _counter = 0;
        emit CounterReset(previousValue);
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
}
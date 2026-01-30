import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { PolicyManager, MockERC20, MockRewardContract } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PolicyManager - Comprehensive Tests", function () {
  let policyManager: PolicyManager;
  let mockUSDC: MockERC20;
  let mockRewardContract: MockRewardContract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let maliciousUser: SignerWithAddress;

  // Realistic USDC values (6 decimals)
  const COVERAGE_AMOUNT = 1_000_000; // 1 USDC
  const EXPECTED_FEE = 200_000; // 0.2 USDC (20% of 1 USDC)
  const INITIAL_USDC_BALANCE = hre.ethers.parseUnits("10000", 6); // 10,000 USDC for testing
  const DEADLINE_OFFSET = 7 * 24 * 60 * 60; // 7 days in seconds

  // Helper function to extract policy ID from transaction
  async function getPolicyIdFromTx(tx: any): Promise<string> {
    const receipt = await tx.wait();
    const policyCreatedEvent = receipt?.logs.find(
      (log: any) => log.topics[0] === policyManager.interface.getEvent("PolicyCreated").topicHash
    );

    if (!policyCreatedEvent) {
      throw new Error("PolicyCreated event not found");
    }

    const decodedEvent = policyManager.interface.decodeEventLog(
      "PolicyCreated",
      policyCreatedEvent.data,
      policyCreatedEvent.topics
    );

    return decodedEvent.policyId;
  }

  beforeEach(async function () {
    [owner, user1, user2, maliciousUser] = await hre.ethers.getSigners();

    // Deploy mock USDC token (6 decimals)
    mockUSDC = await hre.ethers.deployContract("MockERC20", ["Mock USDC", "USDC", 6], owner);
    await mockUSDC.waitForDeployment();

    // Deploy mock reward contract
    mockRewardContract = await hre.ethers.deployContract("MockRewardContract", [], owner);
    await mockRewardContract.waitForDeployment();

    // Deploy PolicyManager
    policyManager = await hre.ethers.deployContract("PolicyManager", [await mockUSDC.getAddress()], owner);
    await policyManager.waitForDeployment();

    // Mint USDC to users
    await mockUSDC.mint(user1.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(user2.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(maliciousUser.address, INITIAL_USDC_BALANCE);
  });

  describe("1. Successful Policy Creation", function () {
    it("Should create policy with correct storage, events, and USDC transfer", async function () {
      const currentTime = await time.latest();
      const deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Approve USDC transfer
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);

      // Get initial balances
      const initialUserBalance = await mockUSDC.balanceOf(user1.address);
      const initialContractBalance = await mockUSDC.balanceOf(await policyManager.getAddress());

      // Create policy and capture transaction
      const tx = await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get the actual policy ID from the event
      const actualPolicyId = await getPolicyIdFromTx(tx);

      // Check PolicyCreated event
      await expect(tx)
        .to.emit(policyManager, "PolicyCreated")
        .withArgs(
          actualPolicyId,
          user1.address,
          await mockRewardContract.getAddress(),
          deadline,
          COVERAGE_AMOUNT
        );

      // Check policy storage
      const policy = await policyManager.policies(actualPolicyId);
      expect(policy.user).to.equal(user1.address);
      expect(policy.targetContract).to.equal(await mockRewardContract.getAddress());
      expect(policy.deadline).to.equal(deadline);
      expect(policy.coverageAmount).to.equal(COVERAGE_AMOUNT);
      expect(policy.feePaid).to.equal(EXPECTED_FEE);
      expect(policy.status).to.equal(0); // PolicyStatus.Active
      expect(policy.compensated).to.equal(false);

      // Check USDC transfers
      const finalUserBalance = await mockUSDC.balanceOf(user1.address);
      const finalContractBalance = await mockUSDC.balanceOf(await policyManager.getAddress());

      expect(finalUserBalance).to.equal(initialUserBalance - BigInt(totalCost));
      expect(finalContractBalance).to.equal(initialContractBalance + BigInt(totalCost));
    });
  });

  describe("2. User Claims Reward Before Deadline", function () {
    let policyId: string;
    let deadline: number;

    beforeEach(async function () {
      const currentTime = await time.latest();
      deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Create policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      policyId = await getPolicyIdFromTx(tx);
    });

    it("Should refund only fee when user claims reward before deadline", async function () {
      // User claims reward from the mock contract
      await mockRewardContract.connect(user1).claim();

      // Verify the claim was registered
      expect(await mockRewardContract.hasUserClaimed(user1.address)).to.be.true;

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      // Get initial balance
      const initialBalance = await mockUSDC.balanceOf(user1.address);

      // Call verifyAndPayout
      const tx = await policyManager.connect(user1).verifyAndPayout(policyId);

      // Check PolicyResolved event (compensated = false because claim was successful)
      await expect(tx)
        .to.emit(policyManager, "PolicyResolved")
        .withArgs(policyId, false);

      // Check that only fee was refunded
      const finalBalance = await mockUSDC.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance + BigInt(EXPECTED_FEE));

      // Check policy status
      const policy = await policyManager.policies(policyId);
      expect(policy.status).to.equal(1); // PolicyStatus.Resolved
      expect(policy.compensated).to.equal(false);
    });
  });

  describe("3. User Does NOT Claim Reward", function () {
    let policyId: string;
    let deadline: number;

    beforeEach(async function () {
      const currentTime = await time.latest();
      deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Create policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      policyId = await getPolicyIdFromTx(tx);
    });

    it("Should pay full coverage when user does NOT claim reward", async function () {
      // Verify user has not claimed
      expect(await mockRewardContract.hasUserClaimed(user1.address)).to.be.false;

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      // Get initial balance
      const initialBalance = await mockUSDC.balanceOf(user1.address);

      // Call verifyAndPayout
      const tx = await policyManager.connect(user1).verifyAndPayout(policyId);

      // Check PolicyResolved event (compensated = true because no claim was made)
      await expect(tx)
        .to.emit(policyManager, "PolicyResolved")
        .withArgs(policyId, true);

      // Check that full coverage was paid
      const finalBalance = await mockUSDC.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance + BigInt(COVERAGE_AMOUNT));

      // Check policy status
      const policy = await policyManager.policies(policyId);
      expect(policy.status).to.equal(1); // PolicyStatus.Resolved
      expect(policy.compensated).to.equal(true);
    });
  });

  describe("4. Attempt to Verify Before Deadline", function () {
    let policyId: string;
    let deadline: number;

    beforeEach(async function () {
      const currentTime = await time.latest();
      deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Create policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      policyId = await getPolicyIdFromTx(tx);
    });

    it("Should revert when trying to verify before deadline", async function () {
      // Try to verify before deadline (should revert)
      await expect(
        policyManager.connect(user1).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "DeadlineNotPassed");

      // Verify policy is still active
      const policy = await policyManager.policies(policyId);
      expect(policy.status).to.equal(0); // PolicyStatus.Active
    });
  });

  describe("5. Attempt to Verify Same Policy Twice", function () {
    let policyId: string;
    let deadline: number;

    beforeEach(async function () {
      const currentTime = await time.latest();
      deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Create policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      policyId = await getPolicyIdFromTx(tx);
    });

    it("Should revert when trying to verify same policy twice", async function () {
      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      // First verification should succeed
      await policyManager.connect(user1).verifyAndPayout(policyId);

      // Verify policy is resolved
      const policy = await policyManager.policies(policyId);
      expect(policy.status).to.equal(1); // PolicyStatus.Resolved

      // Second verification should revert
      await expect(
        policyManager.connect(user1).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyAlreadyResolved");
    });
  });

  describe("6. Malicious User Attempts", function () {
    let deadline: number;

    beforeEach(async function () {
      const currentTime = await time.latest();
      deadline = currentTime + DEADLINE_OFFSET;
    });

    it("Should ensure msg.sender is always the insured (policy owner)", async function () {
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // User1 creates a policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      await policyManager.connect(user1).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Generate policy ID for user1's policy
      const currentTime = await time.latest();
      const policyId = hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ["address", "address", "uint256"],
          [user1.address, await mockRewardContract.getAddress(), currentTime]
        )
      );

      // Verify the policy was created with user1 as the owner
      const policy = await policyManager.policies(policyId);
      expect(policy.user).to.equal(user1.address);

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      // Malicious user tries to verify user1's policy (should revert)
      await expect(
        policyManager.connect(maliciousUser).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");

      // User2 tries to verify user1's policy (should also revert)
      await expect(
        policyManager.connect(user2).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");

      // Only user1 should be able to verify their own policy
      await expect(
        policyManager.connect(user1).verifyAndPayout(policyId)
      ).to.not.be.reverted;
    });

    it("Should prevent creating policies with someone else's address as target", async function () {
      // This test ensures that the policy creation logic is secure
      // The policy is always created with msg.sender as the user
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      // Malicious user tries to create policy
      await mockUSDC.connect(maliciousUser).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(maliciousUser).createPolicy(
        await mockRewardContract.getAddress(),
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      const policyId = await getPolicyIdFromTx(tx);

      // Verify the policy was created with maliciousUser as the owner (not someone else)
      const policy = await policyManager.policies(policyId);
      expect(policy.user).to.equal(maliciousUser.address);
      expect(policy.user).to.not.equal(user1.address);
      expect(policy.user).to.not.equal(user2.address);
    });
  });

  describe("Edge Cases and Additional Security", function () {
    it("Should handle non-existent policy verification", async function () {
      const fakePolicyId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake"));

      await expect(
        policyManager.connect(user1).verifyAndPayout(fakePolicyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");
    });

    it("Should correctly calculate fees for edge amounts", async function () {
      // Test with minimum coverage that results in minimum fee
      const minCoverageForMinFee = 1_000_000; // 1 USDC -> 0.2 USDC fee (20%)
      const expectedMinFee = 200_000; // 0.2 USDC

      const calculatedFee = await policyManager.calculateFee(minCoverageForMinFee);
      expect(calculatedFee).to.equal(expectedMinFee);
    });

    it("Should handle reward contract without interface gracefully", async function () {
      // Create a policy with a regular address (not implementing IMockRewardContract)
      const currentTime = await time.latest();
      const deadline = currentTime + DEADLINE_OFFSET;
      const totalCost = COVERAGE_AMOUNT + EXPECTED_FEE;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalCost);
      const tx = await policyManager.connect(user1).createPolicy(
        user2.address, // Using a regular address as target
        deadline,
        COVERAGE_AMOUNT
      );

      // Get policy ID from transaction
      const policyId = await getPolicyIdFromTx(tx);

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      // Should not revert and should fall back to mock tracking (no claim detected)
      const initialBalance = await mockUSDC.balanceOf(user1.address);
      await policyManager.connect(user1).verifyAndPayout(policyId);

      // Should receive full coverage since no claim was detected
      const finalBalance = await mockUSDC.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance + BigInt(COVERAGE_AMOUNT));
    });
  });
});

import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { PolicyManager, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PolicyManager", function () {
  let policyManager: PolicyManager;
  let mockUSDC: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let targetContract: SignerWithAddress;

  const INITIAL_USDC_BALANCE = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
  const COVERAGE_AMOUNT = hre.ethers.parseUnits("100", 6); // 100 USDC
  const MIN_FEE = hre.ethers.parseUnits("0.2", 6); // 0.2 USDC
  const MAX_FEE = hre.ethers.parseUnits("0.5", 6); // 0.5 USDC

  beforeEach(async function () {
    [owner, user1, user2, targetContract] = await hre.ethers.getSigners();

    // Deploy mock USDC token
    const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20Factory.deploy("Mock USDC", "USDC", 6);

    // Deploy PolicyManager
    const PolicyManagerFactory = await hre.ethers.getContractFactory("PolicyManager");
    policyManager = await PolicyManagerFactory.deploy(await mockUSDC.getAddress());

    // Mint USDC to users
    await mockUSDC.mint(user1.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(user2.address, INITIAL_USDC_BALANCE);
  });

  describe("Deployment", function () {
    it("Should set the correct USDC token address", async function () {
      expect(await policyManager.usdcToken()).to.equal(await mockUSDC.getAddress());
    });

    it("Should set the correct owner", async function () {
      expect(await policyManager.owner()).to.equal(owner.address);
    });

    it("Should revert with invalid USDC address", async function () {
      const PolicyManagerFactory = await hre.ethers.getContractFactory("PolicyManager");
      await expect(
        PolicyManagerFactory.deploy(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(policyManager, "InvalidUSDCAddress");
    });
  });

  describe("Fee Calculation", function () {
    it("Should calculate 20% fee correctly (within limits)", async function () {
      const coverageAmount = hre.ethers.parseUnits("2", 6); // 2 USDC
      const expectedFee = hre.ethers.parseUnits("0.4", 6); // 0.4 USDC (20%)
      
      expect(await policyManager.calculateFee(coverageAmount)).to.equal(expectedFee);
    });

    it("Should apply minimum fee when calculated fee is too low", async function () {
      const coverageAmount = hre.ethers.parseUnits("0.5", 6); // 0.5 USDC
      const calculatedFee = (coverageAmount * 20n) / 100n; // 0.1 USDC
      
      expect(calculatedFee).to.be.lt(MIN_FEE);
      expect(await policyManager.calculateFee(coverageAmount)).to.equal(MIN_FEE);
    });

    it("Should apply maximum fee when calculated fee is too high", async function () {
      const coverageAmount = hre.ethers.parseUnits("10", 6); // 10 USDC
      const calculatedFee = (coverageAmount * 20n) / 100n; // 2 USDC
      
      expect(calculatedFee).to.be.gt(MAX_FEE);
      expect(await policyManager.calculateFee(coverageAmount)).to.equal(MAX_FEE);
    });
  });

  describe("Policy Creation", function () {
    it("Should create a policy successfully", async function () {
      const deadline = (await time.latest()) + 86400; // 1 day from now
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      // Approve USDC transfer
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);

      // Create policy
      const tx = await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          return policyManager.interface.parseLog(log as any)?.name === "PolicyCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      // Verify USDC was transferred
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        INITIAL_USDC_BALANCE - totalPayment
      );
      expect(await mockUSDC.balanceOf(await policyManager.getAddress())).to.equal(totalPayment);
    });

    it("Should revert with invalid target contract", async function () {
      const deadline = (await time.latest()) + 86400;
      
      await expect(
        policyManager.connect(user1).createPolicy(
          hre.ethers.ZeroAddress,
          deadline,
          COVERAGE_AMOUNT
        )
      ).to.be.revertedWithCustomError(policyManager, "InvalidUSDCAddress");
    });

    it("Should revert with zero coverage amount", async function () {
      const deadline = (await time.latest()) + 86400;
      
      await expect(
        policyManager.connect(user1).createPolicy(
          targetContract.address,
          deadline,
          0
        )
      ).to.be.revertedWithCustomError(policyManager, "InvalidCoverageAmount");
    });

    it("Should revert with past deadline", async function () {
      const pastDeadline = (await time.latest()) - 3600; // 1 hour ago
      
      await expect(
        policyManager.connect(user1).createPolicy(
          targetContract.address,
          pastDeadline,
          COVERAGE_AMOUNT
        )
      ).to.be.revertedWithCustomError(policyManager, "InvalidDeadline");
    });

    it("Should revert with insufficient allowance", async function () {
      const deadline = (await time.latest()) + 86400;
      
      // Don't approve or approve insufficient amount
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), COVERAGE_AMOUNT);
      
      await expect(
        policyManager.connect(user1).createPolicy(
          targetContract.address,
          deadline,
          COVERAGE_AMOUNT
        )
      ).to.be.revertedWithCustomError(policyManager, "InsufficientAllowance");
    });
  });

  describe("Policy Verification and Payout", function () {
    let policyId: string;
    let deadline: number;

    beforeEach(async function () {
      deadline = (await time.latest()) + 86400; // 1 day from now
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      // Approve and create policy
      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);
      const tx = await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = policyManager.interface.parseLog(log as any);
          return parsed?.name === "PolicyCreated";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = policyManager.interface.parseLog(event as any);
        policyId = parsed?.args[0];
      }
    });

    it("Should payout full coverage when no claim is detected", async function () {
      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      const initialBalance = await mockUSDC.balanceOf(user1.address);
      
      await policyManager.connect(user1).verifyAndPayout(policyId);

      // Should receive full coverage amount
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        initialBalance + COVERAGE_AMOUNT
      );

      // Check policy is resolved and compensated
      const policy = await policyManager.getPolicy(policyId);
      expect(policy.status).to.equal(1); // PolicyStatus.Resolved = 1
      expect(policy.compensated).to.be.true;
    });

    it("Should refund only fee when claim is detected", async function () {
      // Register a mock claim
      await policyManager.connect(user1).mockRegisterClaim(policyId);

      // Fast forward past deadline
      await time.increaseTo(deadline + 1);

      const initialBalance = await mockUSDC.balanceOf(user1.address);
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      
      await policyManager.connect(user1).verifyAndPayout(policyId);

      // Should receive only the fee back
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(
        initialBalance + fee
      );

      // Check policy is resolved but not compensated
      const policy = await policyManager.getPolicy(policyId);
      expect(policy.status).to.equal(1); // PolicyStatus.Resolved = 1
      expect(policy.compensated).to.be.false;
    });

    it("Should revert if deadline has not passed", async function () {
      await expect(
        policyManager.connect(user1).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "DeadlineNotPassed");
    });

    it("Should revert if policy doesn't exist", async function () {
      const fakePolicyId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake"));
      
      await time.increaseTo(deadline + 1);
      
      await expect(
        policyManager.connect(user1).verifyAndPayout(fakePolicyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");
    });

    it("Should revert if policy already resolved", async function () {
      await time.increaseTo(deadline + 1);
      
      // First payout
      await policyManager.connect(user1).verifyAndPayout(policyId);
      
      // Second payout should fail
      await expect(
        policyManager.connect(user1).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyAlreadyResolved");
    });

    it("Should revert if non-owner tries to claim", async function () {
      await time.increaseTo(deadline + 1);
      
      await expect(
        policyManager.connect(user2).verifyAndPayout(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");
    });
  });

  describe("Mock Claim Registration", function () {
    let policyId: string;

    beforeEach(async function () {
      const deadline = (await time.latest()) + 86400;
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);
      const tx = await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = policyManager.interface.parseLog(log as any);
          return parsed?.name === "PolicyCreated";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = policyManager.interface.parseLog(event as any);
        policyId = parsed?.args[0];
      }
    });

    it("Should register mock claim successfully", async function () {
      await expect(policyManager.connect(user1).mockRegisterClaim(policyId))
        .to.emit(policyManager, "MockClaimRegistered")
        .withArgs(policyId, user1.address, targetContract.address);

      expect(await policyManager.mockClaimRegistered(policyId)).to.be.true;
    });

    it("Should revert if non-owner tries to register claim", async function () {
      await expect(
        policyManager.connect(user2).mockRegisterClaim(policyId)
      ).to.be.revertedWithCustomError(policyManager, "PolicyNotFound");
    });
  });

  describe("Administrative Functions", function () {
    it("Should allow owner to pause and unpause", async function () {
      await policyManager.connect(owner).pause();
      expect(await policyManager.paused()).to.be.true;

      await policyManager.connect(owner).unpause();
      expect(await policyManager.paused()).to.be.false;
    });

    it("Should prevent policy creation when paused", async function () {
      await policyManager.connect(owner).pause();

      const deadline = (await time.latest()) + 86400;
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);

      await expect(
        policyManager.connect(user1).createPolicy(
          targetContract.address,
          deadline,
          COVERAGE_AMOUNT
        )
      ).to.be.revertedWithCustomError(policyManager, "EnforcedPause");
    });

    it("Should return correct contract balance", async function () {
      const deadline = (await time.latest()) + 86400;
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);
      await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      expect(await policyManager.getContractBalance()).to.equal(totalPayment);
    });
  });

  describe("Policy Queries", function () {
    it("Should return correct policy details", async function () {
      const deadline = (await time.latest()) + 86400;
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);
      const tx = await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = policyManager.interface.parseLog(log as any);
          return parsed?.name === "PolicyCreated";
        } catch {
          return false;
        }
      });

      let policyId: string = "";
      if (event) {
        const parsed = policyManager.interface.parseLog(event as any);
        policyId = parsed?.args[0];
      }

      const policy = await policyManager.getPolicy(policyId);
      expect(policy.user).to.equal(user1.address);
      expect(policy.targetContract).to.equal(targetContract.address);
      expect(policy.deadline).to.equal(deadline);
      expect(policy.coverageAmount).to.equal(COVERAGE_AMOUNT);
      expect(policy.feePaid).to.equal(fee);
      expect(policy.status).to.equal(0); // PolicyStatus.Active = 0
      expect(policy.compensated).to.be.false;
    });

    it("Should correctly identify if policy exists", async function () {
      const fakePolicyId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake"));
      expect(await policyManager.policyExists(fakePolicyId)).to.be.false;

      const deadline = (await time.latest()) + 86400;
      const fee = await policyManager.calculateFee(COVERAGE_AMOUNT);
      const totalPayment = COVERAGE_AMOUNT + fee;

      await mockUSDC.connect(user1).approve(await policyManager.getAddress(), totalPayment);
      const tx = await policyManager.connect(user1).createPolicy(
        targetContract.address,
        deadline,
        COVERAGE_AMOUNT
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = policyManager.interface.parseLog(log as any);
          return parsed?.name === "PolicyCreated";
        } catch {
          return false;
        }
      });

      let policyId: string = "";
      if (event) {
        const parsed = policyManager.interface.parseLog(event as any);
        policyId = parsed?.args[0];
      }

      expect(await policyManager.policyExists(policyId)).to.be.true;
    });
  });
});

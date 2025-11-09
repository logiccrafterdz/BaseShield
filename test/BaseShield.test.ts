import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { BaseShield } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BaseShield", function () {
  let baseShield: BaseShield;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    // Get signers
    [owner, user1, user2] = await hre.ethers.getSigners();

    // Deploy the contract
    const BaseShieldFactory = await hre.ethers.getContractFactory("BaseShield");
    baseShield = await BaseShieldFactory.deploy();
    await baseShield.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await baseShield.owner()).to.equal(owner.address);
    });

    it("Should initialize counter to 0", async function () {
      expect(await baseShield.getCounter()).to.equal(0);
    });

    it("Should not be paused initially", async function () {
      expect(await baseShield.paused()).to.equal(false);
    });
  });

  describe("Counter functionality", function () {
    it("Should increment counter", async function () {
      await baseShield.increment();
      expect(await baseShield.getCounter()).to.equal(1);
    });

    it("Should emit CounterIncremented event", async function () {
      await expect(baseShield.increment())
        .to.emit(baseShield, "CounterIncremented")
        .withArgs(1, owner.address);
    });

    it("Should allow multiple increments", async function () {
      await baseShield.increment();
      await baseShield.increment();
      await baseShield.connect(user1).increment();
      
      expect(await baseShield.getCounter()).to.equal(3);
    });

    it("Should reset counter (owner only)", async function () {
      await baseShield.increment();
      await baseShield.increment();
      
      await expect(baseShield.resetCounter())
        .to.emit(baseShield, "CounterReset")
        .withArgs(2);
      
      expect(await baseShield.getCounter()).to.equal(0);
    });

    it("Should not allow non-owner to reset counter", async function () {
      await expect(baseShield.connect(user1).resetCounter())
        .to.be.revertedWithCustomError(baseShield, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });
  });

  describe("Pausable functionality", function () {
    it("Should allow owner to pause", async function () {
      await baseShield.pause();
      expect(await baseShield.paused()).to.equal(true);
    });

    it("Should allow owner to unpause", async function () {
      await baseShield.pause();
      await baseShield.unpause();
      expect(await baseShield.paused()).to.equal(false);
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(baseShield.connect(user1).pause())
        .to.be.revertedWithCustomError(baseShield, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should not allow increment when paused", async function () {
      await baseShield.pause();
      await expect(baseShield.increment())
        .to.be.revertedWithCustomError(baseShield, "EnforcedPause");
    });

    it("Should allow increment after unpause", async function () {
      await baseShield.pause();
      await baseShield.unpause();
      await baseShield.increment();
      expect(await baseShield.getCounter()).to.equal(1);
    });
  });

  describe("Access control", function () {
    it("Should transfer ownership", async function () {
      await baseShield.transferOwnership(user1.address);
      expect(await baseShield.owner()).to.equal(user1.address);
    });

    it("Should allow new owner to reset counter", async function () {
      await baseShield.increment();
      await baseShield.transferOwnership(user1.address);
      
      await baseShield.connect(user1).resetCounter();
      expect(await baseShield.getCounter()).to.equal(0);
    });
  });
});

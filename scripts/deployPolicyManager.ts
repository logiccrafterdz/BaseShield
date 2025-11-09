import hre from "hardhat";
import { getAddress } from "ethers";

async function main() {
  console.log("Deploying PolicyManager to network:", hre.network.name);

  // Official Circle USDC on Base Sepolia (checksummed)
  const USDC_ADDRESS = getAddress("0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897");

  let usdcAddress = "";
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    usdcAddress = ""; // will deploy mock below
  } else {
    usdcAddress = USDC_ADDRESS;
  }

  // Deploy mock USDC for local networks
  if (!usdcAddress && (hre.network.name === "localhost" || hre.network.name === "hardhat")) {
    console.log("Deploying Mock USDC for local testing...");
    
    const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockERC20Factory.deploy("Mock USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    
    usdcAddress = await mockUSDC.getAddress();
    console.log("Mock USDC deployed to:", usdcAddress);

    // Mint some tokens to the deployer for testing
    const [deployer] = await hre.ethers.getSigners();
    const mintAmount = hre.ethers.parseUnits("100000", 6); // 100,000 USDC
    await mockUSDC.mint(deployer.address, mintAmount);
    console.log(`Minted ${hre.ethers.formatUnits(mintAmount, 6)} USDC to deployer:`, deployer.address);
  }

  if (!usdcAddress) {
    throw new Error(`USDC address not found for network: ${hre.network.name}`);
  }

  console.log("Using USDC address:", usdcAddress);

  // Deploy PolicyManager
  const PolicyManagerFactory = await hre.ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManagerFactory.deploy(usdcAddress);

  await policyManager.waitForDeployment();
  const policyManagerAddress = await policyManager.getAddress();

  console.log("PolicyManager deployed to:", policyManagerAddress);
  console.log("Transaction hash:", policyManager.deploymentTransaction()?.hash);

  // Verify the contract on BaseScan (if API key is provided and not on local network)
  if (process.env.BASESCAN_API_KEY && hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("Waiting for block confirmations...");
    await policyManager.deploymentTransaction()?.wait(5);
    
    console.log("Verifying contract on BaseScan...");
    try {
      await hre.run("verify:verify", {
        address: policyManagerAddress,
        constructorArguments: [usdcAddress],
      });
      console.log("Contract verified successfully");
    } catch (error) {
      console.log("Error verifying contract:", error);
    }
  }

  // Return deployed addresses for reference
  const deployedAddresses = {
    policyManager: policyManagerAddress,
    usdc: usdcAddress,
    network: hre.network.name
  };

  console.log("\n=== Deployment Summary ===");
  console.log("Network:", deployedAddresses.network);
  console.log("PolicyManager:", deployedAddresses.policyManager);
  console.log("USDC:", deployedAddresses.usdc);
  console.log("========================\n");

  // Save deployment info to a file for reference
  const fs = require('fs');
  const path = require('path');
  
  const deploymentInfo = {
    timestamp: new Date().toISOString(),
    network: hre.network.name,
    contracts: deployedAddresses
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${hre.network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Deployment info saved to: ${deploymentFile}`);

  return deployedAddresses;
}

main()
  .then((addresses) => {
    console.log("Deployment completed successfully!");
    console.log("Deployed addresses:", addresses);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
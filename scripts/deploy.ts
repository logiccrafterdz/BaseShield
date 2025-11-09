import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const BaseShield = await hre.ethers.getContractFactory("BaseShield");
  const baseShield = await BaseShield.deploy();

  await baseShield.waitForDeployment();
  const contractAddress = await baseShield.getAddress();

  console.log("BaseShield deployed to:", contractAddress);
  console.log("Transaction hash:", baseShield.deploymentTransaction()?.hash);

  // Verify the contract on BaseScan (if API key is provided)
  if (process.env.BASESCAN_API_KEY) {
    console.log("Waiting for block confirmations...");
    await baseShield.deploymentTransaction()?.wait(5);
    
    console.log("Verifying contract on BaseScan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [],
      });
      console.log("Contract verified successfully");
    } catch (error) {
      console.log("Error verifying contract:", error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
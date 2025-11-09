import hre from "hardhat";
import { ethers, getAddress } from "ethers";
import { PolicyManager, MockERC20, MockRewardDistributor } from "../typechain-types";

// Official Circle USDC on Base Sepolia (checksummed)
const USDC_ADDRESS = getAddress("0x6Ac3aB54Dc5019A2e57eCcb214337FF5bbD52897");

// Minimal ERC-20 ABI for safe balance reads
const MINIMAL_ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)"
];

// Simple sleep helper for testnet delays
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main() {
    // Safety check for deploy credentials
    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.trim() === "" || process.env.PRIVATE_KEY === "your_private_key_here") {
        console.error("❌ Missing PRIVATE_KEY. Set it in .env before deploying.");
        throw new Error("Missing PRIVATE_KEY env var");
    }

    console.log("🚀 Starting BaseShield Deployment and Simulation");
    console.log("=" .repeat(60));
    
    // Get deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log(`📋 Deployer address: ${deployer.address}`);
    
    // Track initial balance
    const initialBalance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`💰 Initial ETH balance: ${hre.ethers.formatEther(initialBalance)} ETH`);

    // If on testnet and no ETH, skip deployment gracefully
    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat" && initialBalance === 0n) {
        console.log("\n⚠️ No ETH on Base Sepolia for deployer.");
        console.log("   Skipping on-chain deployments. Fund ETH to proceed.");
        console.log("\n✅ Environment validated. Nothing to deploy without funds.\n");
        return;
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("📦 DEPLOYING CONTRACTS");
    console.log("=".repeat(60));
    
    // 1. Deploy PolicyManager
    console.log("\n1️⃣ Deploying PolicyManager...");
    const PolicyManagerFactory = await hre.ethers.getContractFactory("PolicyManager");
    
    // Use unified USDC for testnet, deploy mock for local
    let usdcAddress = USDC_ADDRESS;
    let policyManager: PolicyManager;
    let policyManagerAddress: string;
    
    // 2. Deploy MockRewardDistributor
    console.log("\n2️⃣ Deploying MockRewardDistributor...");
    const MockRewardDistributorFactory = await hre.ethers.getContractFactory("MockRewardDistributor");
    const mockRewardDistributor = await MockRewardDistributorFactory.deploy() as MockRewardDistributor;
    await mockRewardDistributor.waitForDeployment();
    const mockRewardDistributorAddress = await mockRewardDistributor.getAddress();
    console.log(`✅ MockRewardDistributor deployed to: ${mockRewardDistributorAddress}`);
    console.log("MockRewardDistributor deployed to:", mockRewardDistributorAddress);
    
    // 3. Deploy Mock USDC for local testing
    let usdcWrite: MockERC20 | ethers.Contract | null = null;
    
    if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
        console.log("\n3️⃣ Deploying Mock USDC for local testing...");
        const MockERC20Factory = await hre.ethers.getContractFactory("MockERC20");
        const mockUsdc = await MockERC20Factory.deploy(
            "USD Coin", 
            "USDC", 
            6  // 6 decimals like real USDC
        ) as MockERC20;
        await mockUsdc.waitForDeployment();
        usdcAddress = await mockUsdc.getAddress();
        console.log(`✅ Mock USDC deployed to: ${usdcAddress}`);
        
        // Deploy PolicyManager with mock USDC
        policyManager = await PolicyManagerFactory.deploy(usdcAddress) as PolicyManager;
        await policyManager.waitForDeployment();
        policyManagerAddress = await policyManager.getAddress();
        console.log(`✅ PolicyManager deployed to: ${policyManagerAddress}`);
        console.log("PolicyManager deployed to:", policyManagerAddress);
        
        // Local write-capable USDC (mock)
        usdcWrite = await hre.ethers.getContractAt("MockERC20", usdcAddress) as MockERC20;
    } else {
        // Deploy PolicyManager with real USDC for Base Sepolia
        policyManager = await PolicyManagerFactory.deploy(usdcAddress) as PolicyManager;
        await policyManager.waitForDeployment();
        policyManagerAddress = await policyManager.getAddress();
        console.log(`✅ PolicyManager deployed to: ${policyManagerAddress}`);
        console.log("PolicyManager deployed to:", policyManagerAddress);
        
        // Testnet write-capable USDC (approve only) will be created lazily if needed
        usdcWrite = null;
    }
    
    // 4. Mint test USDC for local testing
    if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
        const mintAmount = hre.ethers.parseUnits("1000", 6); // 1000 USDC
        console.log("\n4️⃣ Minting test USDC...");
        const mintTx = await (usdcWrite as MockERC20)!.mint(deployer.address, mintAmount);
        await mintTx.wait();
        console.log(`✅ Minted ${hre.ethers.formatUnits(mintAmount, 6)} USDC to deployer`);
    }
    
    // Safe USDC balance check using minimal ABI
    const usdcReader = new ethers.Contract(usdcAddress, MINIMAL_ERC20_ABI, deployer);
    let usdcBalance: bigint;
    try {
        const rawBalance = await usdcReader.balanceOf(deployer.address);
        if (typeof rawBalance === 'bigint' && rawBalance >= 0n) {
            usdcBalance = rawBalance;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data — assuming 0.");
        usdcBalance = 0n;
    }
    console.log(`💳 Current USDC balance: ${hre.ethers.formatUnits(usdcBalance, 6)} USDC`);
    
    console.log("\n" + "=".repeat(60));
    console.log("🛡️ CREATING POLICIES");
    console.log("=".repeat(60));

    // Note: simulation gating will occur after computing the required amount
    
    // 5. Create first policy (no claim scenario)
    const coverageAmount = hre.ethers.parseUnits("1", 6); // 1 USDC coverage
    const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    
    console.log("\n5️⃣ Creating first policy (no claim scenario)...");
    // Manual fee calculation: 20% of coverage, min 0.2 USDC, max 0.5 USDC
    const minFee = hre.ethers.parseUnits("0.2", 6);
    const maxFee = hre.ethers.parseUnits("0.5", 6);
    let fee = (coverageAmount * 20n) / 100n;
    if (fee < minFee) fee = minFee;
    if (fee > maxFee) fee = maxFee;
    const totalCost = coverageAmount + fee;
    console.log(`   Target Contract: ${mockRewardDistributorAddress}`);
    console.log(`   Coverage Amount: ${hre.ethers.formatUnits(coverageAmount, 6)} USDC`);
    console.log(`   Fee: ${hre.ethers.formatUnits(fee, 6)} USDC`);
    console.log(`   Total Cost: ${hre.ethers.formatUnits(totalCost, 6)} USDC`);
    console.log(`   Deadline: ${new Date(deadline * 1000).toLocaleString()}`);
    
    // Gate simulation on a fixed minimum USDC balance (1.2 USDC)
    const MIN_REQUIRED_USDC = hre.ethers.parseUnits("1.2", 6);
    if (usdcBalance < MIN_REQUIRED_USDC) {
        console.log("\n⚠️ Insufficient USDC for simulation.");
        console.log(`   Required: ${hre.ethers.formatUnits(MIN_REQUIRED_USDC, 6)} USDC`);
        console.log(`   Available: ${hre.ethers.formatUnits(usdcBalance, 6)} USDC`);
        console.log("   Skipping simulation steps. Contracts remain deployed.");
        console.log("\n💼 Contract Addresses:");
        console.log(`   PolicyManager: ${policyManagerAddress}`);
        console.log(`   MockRewardDistributor: ${mockRewardDistributorAddress}`);
        console.log(`   USDC: ${usdcAddress}`);
        console.log("\n✅ Deployment completed successfully (simulation skipped).\n");
        return;
    }

    // Ensure we have a write-capable USDC instance for approvals
    if (!usdcWrite) {
        usdcWrite = new ethers.Contract(
            usdcAddress,
            ["function approve(address spender, uint256 amount) external returns (bool)"],
            deployer
        );
    }

    // Approve USDC for policy creation
    console.log("\n   💰 Approving USDC...");
    const approveTx1 = await (usdcWrite as ethers.Contract)!.approve(policyManagerAddress, totalCost);
    await approveTx1.wait();
    console.log("   ✅ USDC approved");
    
    // Create the policy
    console.log("\n   📝 Creating policy...");
    const createPolicyTx1 = await policyManager.createPolicy(
        mockRewardDistributorAddress,
        deadline,
        coverageAmount
    );
    const receipt1 = await createPolicyTx1.wait();
    
    // Extract policy ID from event
    let policyId1: string = "";
    if (receipt1 && receipt1.logs) {
        for (const log of receipt1.logs) {
            try {
                const parsed = policyManager.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data
                });
                if (parsed && parsed.name === "PolicyCreated") {
                    policyId1 = parsed.args.policyId;
                    break;
                }
            } catch (e) {
                // Skip logs that can't be parsed
            }
        }
    }
    
    console.log(`   ✅ Policy created with ID: ${policyId1}`);
    console.log(`   🔗 Transaction hash: ${createPolicyTx1.hash}`);
    
    // Check updated balance
    let newUsdcBalance: bigint;
    try {
        const rawNewBalance = await usdcReader.balanceOf(deployer.address);
        if (typeof rawNewBalance === 'bigint' && rawNewBalance >= 0n) {
            newUsdcBalance = rawNewBalance;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data — assuming previous value.");
        newUsdcBalance = usdcBalance;
    }
    console.log(`💳 Updated USDC balance: ${hre.ethers.formatUnits(newUsdcBalance, 6)} USDC`);
    console.log(`💸 USDC spent: ${hre.ethers.formatUnits(usdcBalance - newUsdcBalance, 6)} USDC`);
    
    console.log("\n" + "=".repeat(60));
    console.log("⏰ SIMULATING TIME PASSAGE");
    console.log("=".repeat(60));
    
    if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
        console.log("\n⏰ Fast-forwarding time by 24 hours + 1 minute...");
        await hre.network.provider.send("evm_increaseTime", [86460]); // 24 hours + 1 minute
        await hre.network.provider.send("evm_mine");
        console.log("✅ Time advanced");
    } else {
        console.log("\n⏰ On Base Sepolia — waiting ~65s for on-chain deadline (60s)");
        await sleep(65000);
        console.log("✅ Wait complete; proceeding to verification...");
    }
    
    // Get current block info
    const currentBlock = await hre.ethers.provider.getBlock("latest");
    console.log(`📊 Current block timestamp: ${currentBlock?.timestamp}`);
    console.log(`📊 Current time: ${new Date((currentBlock?.timestamp || 0) * 1000).toLocaleString()}`);
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ VERIFYING AND CLAIMING PAYOUTS");
    console.log("=".repeat(60));
    
    // 6. Verify first policy (should get full payout - no claims detected)
    console.log("\n6️⃣ Verifying first policy (no claim scenario)...");
    console.log(`   Policy ID: ${policyId1}`);
    
    let balanceBeforeVerify1: bigint;
    try {
        const rawBefore1 = await usdcReader.balanceOf(deployer.address);
        if (typeof rawBefore1 === 'bigint' && rawBefore1 >= 0n) {
            balanceBeforeVerify1 = rawBefore1;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data before verify — assuming 0.");
        balanceBeforeVerify1 = 0n;
    }
    
    const verifyTx1 = await policyManager.verifyAndPayout(policyId1);
    await verifyTx1.wait();
    
    let finalUsdcBalance1: bigint;
    try {
        const rawFinal1 = await usdcReader.balanceOf(deployer.address);
        if (typeof rawFinal1 === 'bigint' && rawFinal1 >= 0n) {
            finalUsdcBalance1 = rawFinal1;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data after verify — assuming 0.");
        finalUsdcBalance1 = 0n;
    }
    const payout1 = finalUsdcBalance1 - balanceBeforeVerify1;
    
    console.log(`   ✅ Verification completed`);
    console.log(`   🔗 Transaction hash: ${verifyTx1.hash}`);
    console.log(`💰 Payout received: ${hre.ethers.formatUnits(payout1, 6)} USDC`);
    console.log(`💳 Final USDC balance: ${hre.ethers.formatUnits(finalUsdcBalance1, 6)} USDC`);
    
    // 7. Create second policy (with claim scenario)
    console.log("\n7️⃣ Creating second policy for claim scenario...");
    
    const coverageAmount2 = hre.ethers.parseUnits("2", 6); // 2 USDC coverage
    
    // Get current blockchain time for deadline calculation
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const latestBlockTime = latestBlock?.timestamp || Math.floor(Date.now() / 1000);
    const deadline2 = latestBlockTime + 86400; // 24 hours from current blockchain time
    
    // Manual fee calculation for second policy
    const minFee2 = hre.ethers.parseUnits("0.2", 6);
    const maxFee2 = hre.ethers.parseUnits("0.5", 6);
    let fee2 = (coverageAmount2 * 20n) / 100n;
    if (fee2 < minFee2) fee2 = minFee2;
    if (fee2 > maxFee2) fee2 = maxFee2;
    const totalCost2 = coverageAmount2 + fee2;
    
    console.log(`   Target Contract: ${mockRewardDistributorAddress}`);
    console.log(`   Coverage Amount: ${hre.ethers.formatUnits(coverageAmount2, 6)} USDC`);
    console.log(`   Fee: ${hre.ethers.formatUnits(fee2, 6)} USDC`);
    console.log(`   Total Cost: ${hre.ethers.formatUnits(totalCost2, 6)} USDC`);
    console.log(`   Deadline: ${new Date(deadline2 * 1000).toLocaleString()}`);
    
    // Approve USDC for second policy
    console.log("\n   💰 Approving USDC for second policy...");
    const approveTx2 = await (usdcWrite as ethers.Contract)!.approve(policyManagerAddress, totalCost2);
    await approveTx2.wait();
    console.log("   ✅ USDC approved");
    
    // Create the second policy
    console.log("\n   📝 Creating second policy...");
    const createPolicyTx2 = await policyManager.createPolicy(
        mockRewardDistributorAddress,
        deadline2,
        coverageAmount2
    );
    const receipt2 = await createPolicyTx2.wait();
    
    // Extract policy ID from event
    let policyId2: string = "";
    if (receipt2 && receipt2.logs) {
        for (const log of receipt2.logs) {
            try {
                const parsed = policyManager.interface.parseLog({
                    topics: log.topics as string[],
                    data: log.data
                });
                if (parsed && parsed.name === "PolicyCreated") {
                    policyId2 = parsed.args.policyId;
                    break;
                }
            } catch (e) {
                // Skip logs that can't be parsed
            }
        }
    }
    
    console.log(`   ✅ Second policy created with ID: ${policyId2}`);
    console.log(`   🔗 Transaction hash: ${createPolicyTx2.hash}`);
    
    // 8. Simulate a reward claim for the second policy
    console.log("\n8️⃣ Simulating reward claim...");
    await mockRewardDistributor.simulateClaim(deployer.address, hre.ethers.parseUnits("100", 18));
    console.log("   ✅ Reward claim simulated");
    
    // Fast forward time again for second policy
    if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
        await hre.network.provider.send("evm_increaseTime", [86460]);
        await hre.network.provider.send("evm_mine");
        console.log("   ⏰ Time advanced for second policy");
    } else {
        console.log("   ⏰ On Base Sepolia — waiting ~65s for second policy deadline (60s)");
        await sleep(65000);
        console.log("   ✅ Wait complete for second policy");
    }
    
    // 9. Verify second policy (should get only fee refund - claim detected)
    console.log("\n9️⃣ Verifying second policy (claim detected scenario)...");
    console.log(`   Policy ID: ${policyId2}`);
    
    let balanceBeforeVerify2: bigint;
    try {
        const rawBefore2 = await usdcReader.balanceOf(deployer.address);
        if (typeof rawBefore2 === 'bigint' && rawBefore2 >= 0n) {
            balanceBeforeVerify2 = rawBefore2;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data before second verify — assuming 0.");
        balanceBeforeVerify2 = 0n;
    }
    
    const verifyTx2 = await policyManager.verifyAndPayout(policyId2);
    await verifyTx2.wait();
    
    let balanceAfterVerify2: bigint;
    try {
        const rawAfter2 = await usdcReader.balanceOf(deployer.address);
        if (typeof rawAfter2 === 'bigint' && rawAfter2 >= 0n) {
            balanceAfterVerify2 = rawAfter2;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data after second verify — assuming previous.");
        balanceAfterVerify2 = balanceBeforeVerify2;
    }
    const payout2 = balanceAfterVerify2 - balanceBeforeVerify2;
    
    console.log(`   ✅ Verification completed`);
    console.log(`   🔗 Transaction hash: ${verifyTx2.hash}`);
    console.log(`💰 Payout received: ${hre.ethers.formatUnits(payout2, 6)} USDC`);
    console.log(`💳 Final USDC balance: ${hre.ethers.formatUnits(balanceAfterVerify2, 6)} USDC`);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL SUMMARY");
    console.log("=".repeat(60));
    
    // Final balance check
    const finalEthBalance = await hre.ethers.provider.getBalance(deployer.address);
    let finalUsdcBalance: bigint;
    try {
        const rawFinal = await usdcReader.balanceOf(deployer.address);
        if (typeof rawFinal === 'bigint' && rawFinal >= 0n) {
            finalUsdcBalance = rawFinal;
        } else {
            throw new Error("Invalid balance response");
        }
    } catch (err) {
        console.log("⚠️ USDC balance query failed or returned empty data — assuming 0.");
        finalUsdcBalance = 0n;
    }
    
    console.log("\n💼 Contract Addresses:");
    console.log(`   PolicyManager: ${policyManagerAddress}`);
    console.log(`   MockRewardDistributor: ${mockRewardDistributorAddress}`);
    console.log(`   USDC: ${usdcAddress}`);
    
    console.log("\n💰 Final Balances:");
    console.log(`   ETH: ${hre.ethers.formatEther(initialBalance)} → ${hre.ethers.formatEther(finalEthBalance)} ETH`);
    console.log(`   ETH spent: ${hre.ethers.formatEther(initialBalance - finalEthBalance)} ETH`);
    console.log(`   Final USDC: ${hre.ethers.formatUnits(finalUsdcBalance, 6)} USDC`);
    
    console.log("\n🎯 Policy Results:");
    console.log(`   Policy 1 (No Claim): ${hre.ethers.formatUnits(payout1, 6)} USDC payout`);
    console.log(`   Policy 2 (Claim Detected): ${hre.ethers.formatUnits(payout2, 6)} USDC payout`);
    
    console.log("\n🎉 Simulation completed successfully!");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
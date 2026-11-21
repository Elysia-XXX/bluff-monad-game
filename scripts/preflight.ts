import { ethers } from "hardhat";

const ACTION_WINDOW_SECONDS = 15 * 60;
const REVEAL_WINDOW_SECONDS = 10 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("MONAD_PRIVATE_KEY is missing or invalid");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 10_143n) {
    throw new Error(`Wrong network: expected chainId 10143, got ${network.chainId}`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  const Factory = await ethers.getContractFactory("BluffGame");
  const deployment = await Factory.getDeployTransaction(ACTION_WINDOW_SECONDS, REVEAL_WINDOW_SECONDS);
  const gasEstimate = await ethers.provider.estimateGas({ ...deployment, from: deployer.address });
  const feeData = await ethers.provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (feePerGas === null) throw new Error("RPC did not return fee data");

  const estimatedCost = gasEstimate * feePerGas;
  const safetyCost = estimatedCost * 2n;
  console.log("PREFLIGHT_OK=true");
  console.log("DEPLOYER_ADDRESS=" + deployer.address);
  console.log("CHAIN_ID=" + network.chainId.toString());
  console.log("BALANCE_MON=" + ethers.formatEther(balance));
  console.log("GAS_ESTIMATE=" + gasEstimate.toString());
  console.log("FEE_PER_GAS_WEI=" + feePerGas.toString());
  console.log("ESTIMATED_COST_MON=" + ethers.formatEther(estimatedCost));
  console.log("SAFETY_2X_COST_MON=" + ethers.formatEther(safetyCost));
  console.log("BALANCE_SUFFICIENT=" + (balance >= safetyCost));

  if (balance < safetyCost) throw new Error("Insufficient MON for deployment with 2x safety margin");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

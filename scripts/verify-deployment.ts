import { ethers } from "hardhat";

async function main() {
  const address = process.env.BLUFF_CONTRACT_ADDRESS;
  const txHash = process.env.BLUFF_DEPLOY_TX;
  if (!address || !ethers.isAddress(address)) throw new Error("BLUFF_CONTRACT_ADDRESS is missing or invalid");
  if (!txHash || !ethers.isHexString(txHash, 32)) throw new Error("BLUFF_DEPLOY_TX is missing or invalid");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 10_143n) throw new Error(`Wrong chainId: ${network.chainId}`);

  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("Deployment receipt not found");
  if (receipt.status !== 1) throw new Error("Deployment transaction reverted");
  if (receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`Receipt contract address mismatch: ${receipt.contractAddress}`);
  }

  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error("No contract bytecode at deployed address");

  const game = await ethers.getContractAt("BluffGame", address);
  const actionWindow = await game.actionWindow();
  const revealWindow = await game.revealWindow();
  console.log("VERIFY_OK=true");
  console.log("CHAIN_ID=" + network.chainId.toString());
  console.log("RECEIPT_STATUS=" + receipt.status);
  console.log("BLOCK_NUMBER=" + receipt.blockNumber);
  console.log("CONTRACT_ADDRESS=" + address);
  console.log("CODE_BYTES=" + ((code.length - 2) / 2));
  console.log("ACTION_WINDOW_SECONDS=" + actionWindow.toString());
  console.log("REVEAL_WINDOW_SECONDS=" + revealWindow.toString());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

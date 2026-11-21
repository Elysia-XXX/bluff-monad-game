import { ethers } from "hardhat";

const ACTION_WINDOW_SECONDS = 15 * 60;
const REVEAL_WINDOW_SECONDS = 10 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("MONAD_PRIVATE_KEY is missing. Set it only in your local environment; never commit it.");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 10_143n) {
    throw new Error(`Refusing to deploy: expected Monad Testnet chainId 10143, got ${network.chainId}`);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "MON");
  console.log("Windows:", ACTION_WINDOW_SECONDS, "seconds action /", REVEAL_WINDOW_SECONDS, "seconds reveal");

  const Factory = await ethers.getContractFactory("BluffGame");
  // No gas price is hardcoded: the connected Monad RPC estimates current fees.
  const game = await Factory.deploy(ACTION_WINDOW_SECONDS, REVEAL_WINDOW_SECONDS);
  console.log("Deployment tx:", game.deploymentTransaction()?.hash);
  await game.waitForDeployment();

  const address = await game.getAddress();
  console.log("BluffGame:", address);
  console.log("Explorer:", `https://testnet.monadvision.com/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

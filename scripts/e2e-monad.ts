import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0xAe3f56228405Eb3DACf7c2eE0991511900ef1BC4";
const FUNDING_AMOUNT = ethers.parseEther("0.15");

async function main() {
  const [bluffer] = await ethers.getSigners();
  if (!bluffer) throw new Error("MONAD_PRIVATE_KEY is missing");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 10_143n) throw new Error(`Wrong chainId ${network.chainId}`);
  const code = await ethers.provider.getCode(CONTRACT_ADDRESS);
  if (code === "0x") throw new Error("BluffGame bytecode is missing");
  const balance = await ethers.provider.getBalance(bluffer.address);
  if (balance < ethers.parseEther("1")) throw new Error("Deployer balance is below the 1 MON safety floor");

  const game = await ethers.getContractAt("BluffGame", CONTRACT_ADDRESS);
  const nextGameId = await game.nextGameId();
  console.log("E2E_PREFLIGHT_OK=true");
  console.log("CHAIN_ID=" + network.chainId);
  console.log("BLUFFER_ADDRESS=" + bluffer.address);
  console.log("BLUFFER_BALANCE_MON=" + ethers.formatEther(balance));
  console.log("NEXT_GAME_ID=" + nextGameId);
  console.log("CONTRACT_CODE_BYTES=" + ((code.length - 2) / 2));

  if (process.env.E2E_SEND_TRANSACTIONS !== "true") {
    console.log("TRANSACTIONS_SENT=false");
    console.log("Set E2E_SEND_TRANSACTIONS=true only after reviewing this preflight.");
    return;
  }

  // The challenger key exists only in memory and is never logged or persisted.
  const challenger = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("CHALLENGER_ADDRESS=" + challenger.address);

  const fundingTx = await bluffer.sendTransaction({ to: challenger.address, value: FUNDING_AMOUNT });
  const fundingReceipt = await fundingTx.wait();
  if (fundingReceipt?.status !== 1) throw new Error("Challenger funding reverted");
  console.log("FUND_TX=" + fundingTx.hash);

  const secretChoice = 1; // TRAP
  const challengerAction = 1; // EXPOSE
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "address", "address", "uint8", "bytes32"],
      [nextGameId, network.chainId, CONTRACT_ADDRESS, bluffer.address, secretChoice, salt],
    ),
  );

  const createTx = await game.createGame(nextGameId, challenger.address, commitment);
  const createReceipt = await createTx.wait();
  if (createReceipt?.status !== 1) throw new Error("createGame reverted");
  console.log("CREATE_TX=" + createTx.hash);

  const challengerGame = game.connect(challenger);
  const actionTx = await challengerGame.chooseAction(nextGameId, challengerAction);
  const actionReceipt = await actionTx.wait();
  if (actionReceipt?.status !== 1) throw new Error("chooseAction reverted");
  console.log("ACTION_TX=" + actionTx.hash);

  const revealTx = await game.reveal(nextGameId, secretChoice, salt);
  const revealReceipt = await revealTx.wait();
  if (revealReceipt?.status !== 1) throw new Error("reveal reverted");
  console.log("REVEAL_TX=" + revealTx.hash);

  const result = await game.getGameResult(nextGameId);
  if (result.blufferScore !== 0n || result.challengerScore !== 4n || result.reason !== 1n) {
    throw new Error(`Unexpected result ${result.blufferScore}:${result.challengerScore}, reason=${result.reason}`);
  }
  console.log("GAME_ID=" + nextGameId);
  console.log("SECRET=TRAP");
  console.log("ACTION=EXPOSE");
  console.log("BLUFFER_SCORE=" + result.blufferScore);
  console.log("CHALLENGER_SCORE=" + result.challengerScore);
  console.log("FINISH_REASON=" + result.reason);
  console.log("E2E_RESULT_OK=true");

  try {
    const remaining = await ethers.provider.getBalance(challenger.address);
    const fees = await ethers.provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (maxFeePerGas) {
      const gasLimit = 21_000n;
      const reserve = maxFeePerGas * gasLimit;
      if (remaining > reserve) {
        const sweep = await challenger.sendTransaction({
          to: bluffer.address,
          value: remaining - reserve,
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
        });
        await sweep.wait();
        console.log("CLEANUP_TX=" + sweep.hash);
      }
    }
  } catch {
    console.log("CLEANUP_SKIPPED=true");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

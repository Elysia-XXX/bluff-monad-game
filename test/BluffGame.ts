import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("BluffGame", function () {
  const ACTION_WINDOW = 300;
  const REVEAL_WINDOW = 300;
  const TREASURE = 0;
  const TRAP = 1;
  const TRUST = 0;
  const EXPOSE = 1;

  async function fixture() {
    const [bluffer, challenger, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BluffGame");
    const game = await Factory.deploy(ACTION_WINDOW, REVEAL_WINDOW);
    await game.waitForDeployment();
    const address = await game.getAddress();
    const { chainId } = await ethers.provider.getNetwork();
    return { game, address, chainId, bluffer, challenger, stranger };
  }

  function commitment(
    gameId: bigint,
    chainId: bigint,
    contractAddress: string,
    bluffer: string,
    secret: number,
    salt: string,
  ) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "address", "address", "uint8", "bytes32"],
        [gameId, chainId, contractAddress, bluffer, secret, salt],
      ),
    );
  }

  async function create(secret = TREASURE, forcedSalt?: string) {
    const ctx = await fixture();
    const salt = forcedSalt ?? ethers.randomBytes(32);
    const hash = commitment(0n, ctx.chainId, ctx.address, ctx.bluffer.address, secret, salt);
    await ctx.game.createGame(0, ctx.challenger.address, hash);
    return { ...ctx, salt: ethers.hexlify(salt), secret, hash };
  }

  const outcomes = [
    { secret: TREASURE, action: TRUST, bluffer: 2, challenger: 2 },
    { secret: TREASURE, action: EXPOSE, bluffer: 3, challenger: 0 },
    { secret: TRAP, action: TRUST, bluffer: 4, challenger: 0 },
    { secret: TRAP, action: EXPOSE, bluffer: 0, challenger: 4 },
  ];

  for (const row of outcomes) {
    it(`settles secret=${row.secret}, action=${row.action}`, async function () {
      const { game, challenger, salt } = await create(row.secret);
      await game.connect(challenger).chooseAction(0, row.action);
      await expect(game.reveal(0, row.secret, salt))
        .to.emit(game, "GameFinished")
        .withArgs(0, row.bluffer, row.challenger, 1);
      expect(await game.getGameResult(0)).to.deep.equal([row.bluffer, row.challenger, 1]);
    });
  }

  it("rejects a wrong salt", async function () {
    const { game, challenger, secret } = await create(TRAP);
    await game.connect(challenger).chooseAction(0, EXPOSE);
    await expect(game.reveal(0, secret, ethers.randomBytes(32))).to.be.revertedWithCustomError(
      game,
      "CommitmentMismatch",
    );
  });

  it("restricts action to the designated challenger", async function () {
    const { game, stranger } = await create();
    await expect(game.connect(stranger).chooseAction(0, TRUST)).to.be.revertedWithCustomError(
      game,
      "NotChallenger",
    );
  });

  it("prevents reveal before the challenger acts", async function () {
    const { game, salt, secret } = await create();
    await expect(game.reveal(0, secret, salt)).to.be.revertedWithCustomError(game, "InvalidStatus");
  });

  it("prevents repeated actions and repeated settlement", async function () {
    const { game, challenger, salt, secret } = await create();
    await game.connect(challenger).chooseAction(0, TRUST);
    await expect(game.connect(challenger).chooseAction(0, EXPOSE)).to.be.revertedWithCustomError(
      game,
      "InvalidStatus",
    );
    await game.reveal(0, secret, salt);
    await expect(game.reveal(0, secret, salt)).to.be.revertedWithCustomError(game, "InvalidStatus");
    await expect(game.settleTimeout(0)).to.be.revertedWithCustomError(game, "InvalidStatus");
  });

  it("isolates commitments by game id", async function () {
    const ctx = await fixture();
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const hashForGameZero = commitment(0n, ctx.chainId, ctx.address, ctx.bluffer.address, TRAP, salt);
    await ctx.game.createGame(0, ctx.challenger.address, hashForGameZero);
    await ctx.game.createGame(1, ctx.challenger.address, hashForGameZero);
    await ctx.game.connect(ctx.challenger).chooseAction(1, EXPOSE);
    await expect(ctx.game.reveal(1, TRAP, salt)).to.be.revertedWithCustomError(
      ctx.game,
      "CommitmentMismatch",
    );
  });

  it("settles challenger no-action timeout with no score", async function () {
    const { game } = await create();
    const stored = await game.getGame(0);
    await expect(game.settleTimeout(0)).to.be.revertedWithCustomError(game, "DeadlineNotPassed");
    await time.increaseTo(stored.actionDeadline + 1n);
    await expect(game.settleTimeout(0)).to.emit(game, "GameTimedOut").withArgs(0, 2);
    expect(await game.getGameResult(0)).to.deep.equal([0, 0, 2]);
  });

  it("awards challenger when bluffer misses reveal deadline", async function () {
    const { game, challenger } = await create(TRAP);
    await game.connect(challenger).chooseAction(0, TRUST);
    const stored = await game.getGame(0);
    await time.increaseTo(stored.revealDeadline + 1n);
    await expect(game.settleTimeout(0)).to.emit(game, "GameTimedOut").withArgs(0, 3);
    expect(await game.getGameResult(0)).to.deep.equal([0, 4, 3]);
  });

  it("rejects invalid enum values and invalid room creation", async function () {
    const { game, challenger, bluffer } = await create();
    await expect(game.connect(challenger).chooseAction(0, 2)).to.be.revertedWithCustomError(
      game,
      "InvalidAction",
    );
    await expect(game.createGame(1, ethers.ZeroAddress, ethers.ZeroHash)).to.be.revertedWithCustomError(
      game,
      "ZeroAddress",
    );
    await expect(game.createGame(1, bluffer.address, ethers.id("x"))).to.be.revertedWithCustomError(
      game,
      "SelfChallenge",
    );
  });

  it("rejects a stale expected game id before creating a room", async function () {
    const { game, challenger } = await create();
    await expect(game.createGame(0, challenger.address, ethers.id("stale")))
      .to.be.revertedWithCustomError(game, "UnexpectedGameId")
      .withArgs(0, 1);
    expect(await game.nextGameId()).to.equal(1);
  });

  it("rejects an invalid secret before hashing during reveal", async function () {
    const { game, challenger, salt } = await create();
    await game.connect(challenger).chooseAction(0, TRUST);
    await expect(game.reveal(0, 2, salt)).to.be.revertedWithCustomError(game, "InvalidSecretChoice");
  });
});

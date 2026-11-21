import { createPublicClient, defineChain, http, parseAbi, type Address } from "viem";

export const MONAD_CHAIN_ID = 10_143;
export const MONAD_CHAIN_HEX = "0x279f";
export const RPC_URL = "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = "https://testnet.monadvision.com";
export const CONTRACT_ADDRESS = "0xAe3f56228405Eb3DACf7c2eE0991511900ef1BC4" as Address;

export const monadTestnet = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
  testnet: true,
});

export const bluffGameAbi = parseAbi([
  "error GameNotFound(uint256 gameId)",
  "error NotBluffer()",
  "error NotChallenger()",
  "error InvalidStatus(uint8 expected, uint8 actual)",
  "error InvalidAction()",
  "error InvalidSecretChoice()",
  "error DeadlinePassed(uint256 deadline)",
  "error DeadlineNotPassed(uint256 deadline)",
  "error CommitmentMismatch()",
  "error UnexpectedGameId(uint256 expected, uint256 actual)",
  "function nextGameId() view returns (uint256)",
  "function createGame(uint256 expectedGameId, address challenger, bytes32 commitment) returns (uint256 gameId)",
  "function chooseAction(uint256 gameId, uint8 action)",
  "function reveal(uint256 gameId, uint8 secretChoice, bytes32 salt)",
  "function settleTimeout(uint256 gameId)",
  "function getGame(uint256 gameId) view returns ((address bluffer, address challenger, bytes32 commitment, uint64 actionDeadline, uint64 revealDeadline, uint8 status, uint8 action, uint8 revealedSecret, uint8 finishReason, uint8 blufferScore, uint8 challengerScore) game)",
  "function getGameResult(uint256 gameId) view returns (uint8 blufferScore, uint8 challengerScore, uint8 reason)",
  "event GameCreated(uint256 indexed gameId, address indexed bluffer, address indexed challenger, bytes32 commitment, uint256 actionDeadline)",
  "event ActionChosen(uint256 indexed gameId, address indexed challenger, uint8 action, uint256 revealDeadline)",
  "event GameRevealed(uint256 indexed gameId, uint8 secretChoice, uint8 action)",
  "event GameFinished(uint256 indexed gameId, uint8 blufferScore, uint8 challengerScore, uint8 reason)",
]);

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }),
});

export type GameView = {
  bluffer: Address;
  challenger: Address;
  commitment: `0x${string}`;
  actionDeadline: bigint;
  revealDeadline: bigint;
  status: number;
  action: number;
  revealedSecret: number;
  finishReason: number;
  blufferScore: number;
  challengerScore: number;
};

export const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "未连接";

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const contractUrl = `${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`;

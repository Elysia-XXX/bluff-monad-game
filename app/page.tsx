"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWalletClient,
  custom,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  bluffGameAbi,
  CONTRACT_ADDRESS,
  contractUrl,
  EXPLORER_URL,
  GameView,
  MONAD_CHAIN_HEX,
  monadTestnet,
  publicClient,
  shortAddress,
  txUrl,
} from "@/lib/bluff";

type LocalSecret = { gameId: string; choice: 0 | 1; salt: Hex; bluffer: Address; createdAt: number };
type PlayMode = "demo" | "chain";
type DemoStage = "secret" | "action" | "reveal" | "finished";

const STATUS = ["不存在", "等待挑战者", "等待揭晓", "已结束"];
const FINISH_REASON = ["未结束", "正常揭晓", "挑战者超时", "设局者超时"];
const SECRET = ["TREASURE · 宝藏", "TRAP · 陷阱"];
const ACTION = ["TRUST · 相信", "EXPOSE · 揭穿"];

function demoScores(secret: 0 | 1, action: 0 | 1) {
  if (secret === 0 && action === 0) return [2, 2] as const;
  if (secret === 0 && action === 1) return [3, 0] as const;
  if (secret === 1 && action === 0) return [4, 0] as const;
  return [0, 4] as const;
}

function secretKey(gameId: string, bluffer: string) {
  return `bluff:secret:${CONTRACT_ADDRESS.toLowerCase()}:${gameId}:${bluffer.toLowerCase()}`;
}

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/user rejected|rejected the request|4001/i.test(text)) return "你取消了钱包操作。";
  if (/insufficient funds/i.test(text)) return "测试 MON 不足，请先从官方 Faucet 领取。";
  if (/UnexpectedGameId/i.test(text)) return "房间编号已被其他交易占用，请重新创建并生成新承诺。";
  if (/NotChallenger/i.test(text)) return "当前钱包不是本局指定挑战者。";
  if (/NotBluffer/i.test(text)) return "当前钱包不是本局设局者。";
  if (/CommitmentMismatch/i.test(text)) return "秘密或 salt 与链上承诺不匹配。";
  if (/InvalidStatus/i.test(text)) return "当前游戏阶段不允许此操作，请刷新链上状态。";
  if (/DeadlinePassed/i.test(text)) return "操作期限已过，可调用超时结算。";
  if (/DeadlineNotPassed/i.test(text)) return "链上截止时间尚未到达。";
  if (/timeout|timed out/i.test(text)) return "RPC 请求超时，请稍后刷新；不要重复提交未知状态交易。";
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export default function Home() {
  const [playMode, setPlayMode] = useState<PlayMode>("demo");
  const [demoStage, setDemoStage] = useState<DemoStage>("secret");
  const [demoSecret, setDemoSecret] = useState<0 | 1>(0);
  const [demoAction, setDemoAction] = useState<0 | 1>(0);
  const [account, setAccount] = useState<Address>();
  const [chainOk, setChainOk] = useState(false);
  const [challenger, setChallenger] = useState("");
  const [secretChoice, setSecretChoice] = useState<0 | 1>(0);
  const [gameId, setGameId] = useState("");
  const [game, setGame] = useState<GameView>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [lastTx, setLastTx] = useState<Hex>();
  const [now, setNow] = useState(() => Date.now());

  const [demoBlufferScore, demoChallengerScore] = demoScores(demoSecret, demoAction);

  function resetDemo() {
    setDemoStage("secret");
    setDemoSecret(0);
    setDemoAction(0);
  }

  const role = useMemo(() => {
    if (!account || !game) return "观战者";
    if (account.toLowerCase() === game.bluffer.toLowerCase()) return "设局者";
    if (account.toLowerCase() === game.challenger.toLowerCase()) return "挑战者";
    return "观战者";
  }, [account, game]);

  const localSecret = useMemo(() => {
    if (!game || !gameId || typeof window === "undefined") return undefined;
    const saved = localStorage.getItem(secretKey(gameId, game.bluffer));
    if (!saved) return undefined;
    try { return JSON.parse(saved) as LocalSecret; } catch { return undefined; }
  }, [game, gameId, now]);

  const switchToMonad = useCallback(async () => {
    if (!window.ethereum) throw new Error("未检测到浏览器钱包，请安装 MetaMask 或兼容钱包。");
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_CHAIN_HEX }] });
    } catch (switchError) {
      if ((switchError as { code?: number }).code !== 4902) throw switchError;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MONAD_CHAIN_HEX,
          chainName: "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: ["https://testnet-rpc.monad.xyz"],
          blockExplorerUrls: [EXPLORER_URL],
        }],
      });
    }
    setChainOk(true);
  }, []);

  const requireWallet = useCallback(async () => {
    if (!window.ethereum) throw new Error("未检测到浏览器钱包，请安装 MetaMask 或兼容钱包。");
    const raw = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
    if (!raw[0]) throw new Error("钱包没有返回账户。");
    await switchToMonad();
    const selected = getAddress(raw[0]);
    setAccount(selected);
    const walletClient = createWalletClient({ account: selected, chain: monadTestnet, transport: custom(window.ethereum) });
    return { selected, walletClient };
  }, [switchToMonad]);

  const connectWallet = useCallback(async () => {
    setError("");
    try {
      await requireWallet();
      setNotice("钱包已连接 Monad Testnet。");
    } catch (e) { setError(friendlyError(e)); }
  }, [requireWallet]);

  const refreshGame = useCallback(async (idText = gameId, quiet = false) => {
    if (!/^\d+$/.test(idText)) {
      if (!quiet) setError("请输入有效的数字房间 ID。");
      return;
    }
    try {
      const value = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: bluffGameAbi,
        functionName: "getGame",
        args: [BigInt(idText)],
      });
      setGame(value as unknown as GameView);
      setError("");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("game", idText);
        window.history.replaceState({}, "", url);
      }
    } catch (e) {
      setGame(undefined);
      if (!quiet) setError(`无法读取房间：${friendlyError(e)}`);
    }
  }, [gameId]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("game");
    if (id && /^\d+$/.test(id)) { setGameId(id); void refreshGame(id, true); }
    const hydrate = async () => {
      if (!window.ethereum) return;
      const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
      const chain = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (accounts[0]) setAccount(getAddress(accounts[0]));
      setChainOk(chain.toLowerCase() === MONAD_CHAIN_HEX);
    };
    void hydrate();
  }, [refreshGame]);

  useEffect(() => {
    if (!/^\d+$/.test(gameId)) return;
    const poll = window.setInterval(() => void refreshGame(gameId, true), 4_000);
    return () => window.clearInterval(poll);
  }, [gameId, refreshGame]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, []);

  async function createGame() {
    setError(""); setNotice(""); setBusy("create");
    try {
      if (!isAddress(challenger)) throw new Error("挑战者地址格式无效。");
      const { selected, walletClient } = await requireWallet();
      if (getAddress(challenger) === selected) throw new Error("不能挑战自己，请填写另一个钱包地址。");
      const expectedGameId = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: bluffGameAbi, functionName: "nextGameId" });
      const saltBytes = new Uint8Array(32);
      crypto.getRandomValues(saltBytes);
      const salt = toHex(saltBytes) as Hex;
      const commitment = keccak256(encodeAbiParameters(
        [
          { type: "uint256" }, { type: "uint256" }, { type: "address" },
          { type: "address" }, { type: "uint8" }, { type: "bytes32" },
        ],
        [expectedGameId, BigInt(monadTestnet.id), CONTRACT_ADDRESS, selected, secretChoice, salt],
      ));
      const { request } = await publicClient.simulateContract({
        account: selected, address: CONTRACT_ADDRESS, abi: bluffGameAbi,
        functionName: "createGame", args: [expectedGameId, getAddress(challenger), commitment],
      });
      const hash = await walletClient.writeContract(request);
      const saved: LocalSecret = { gameId: expectedGameId.toString(), choice: secretChoice, salt, bluffer: selected, createdAt: Date.now() };
      localStorage.setItem(secretKey(saved.gameId, selected), JSON.stringify(saved));
      setLastTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("创建房间交易已回滚。");
      const id = expectedGameId.toString();
      setGameId(id);
      await refreshGame(id);
      setNotice(`房间 #${id} 已上链。秘密恢复信息仅保存在当前浏览器，请勿清理数据。`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  }

  async function chooseAction(action: 0 | 1) {
    setError(""); setNotice(""); setBusy(action === 0 ? "trust" : "expose");
    try {
      const { selected, walletClient } = await requireWallet();
      const id = BigInt(gameId);
      const { request } = await publicClient.simulateContract({
        account: selected, address: CONTRACT_ADDRESS, abi: bluffGameAbi,
        functionName: "chooseAction", args: [id, action],
      });
      const hash = await walletClient.writeContract(request);
      setLastTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("挑战者行动交易已回滚。");
      await refreshGame();
      setNotice(`${ACTION[action]} 已确认上链。`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  }

  async function revealGame() {
    setError(""); setNotice(""); setBusy("reveal");
    try {
      if (!localSecret) throw new Error("当前浏览器没有本局秘密信息，无法揭晓。请使用创建房间时的浏览器数据恢复。");
      const { selected, walletClient } = await requireWallet();
      const { request } = await publicClient.simulateContract({
        account: selected, address: CONTRACT_ADDRESS, abi: bluffGameAbi,
        functionName: "reveal", args: [BigInt(gameId), localSecret.choice, localSecret.salt],
      });
      const hash = await walletClient.writeContract(request);
      setLastTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("揭晓交易已回滚。");
      await refreshGame();
      setNotice("秘密已验证，合约已完成最终结算。");
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  }

  async function settleTimeout() {
    setError(""); setNotice(""); setBusy("timeout");
    try {
      const { selected, walletClient } = await requireWallet();
      const { request } = await publicClient.simulateContract({
        account: selected, address: CONTRACT_ADDRESS, abi: bluffGameAbi,
        functionName: "settleTimeout", args: [BigInt(gameId)],
      });
      const hash = await walletClient.writeContract(request);
      setLastTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("超时结算交易已回滚。");
      await refreshGame();
      setNotice("超时结算已确认上链。");
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  }

  function remaining(deadline: bigint) {
    const seconds = Number(deadline) - Math.floor(now / 1000);
    if (seconds <= 0) return "已到期";
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  const deadline = game?.status === 1 ? game.actionDeadline : game?.status === 2 ? game.revealDeadline : 0n;
  const winner = game?.status === 3
    ? game.blufferScore === game.challengerScore ? "平局" : game.blufferScore > game.challengerScore ? "设局者胜出" : "挑战者胜出"
    : "";

  return (
    <main className="grid-overlay min-h-screen px-4 py-5 sm:px-7 lg:px-10">
      {(notice || error) && (
        <div role="status" className={`fixed right-4 top-4 z-50 max-w-sm rounded-2xl border px-5 py-4 text-sm shadow-2xl backdrop-blur-xl ${error ? "border-rose-400/40 bg-rose-950/90 text-rose-100" : "border-emerald-400/40 bg-emerald-950/90 text-emerald-100"}`}>
          <b className="block">{error ? "操作未完成" : "操作成功"}</b>
          <span className="mt-1 block leading-6">{error || notice}</span>
          <button className="mt-2 text-xs underline" onClick={() => { setError(""); setNotice(""); }}>关闭</button>
        </div>
      )}
      <header className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 border-b border-violet-300/10 pb-5">
        <div className="flex items-center gap-4">
          <div className="rounded-xl border border-violet-400/40 bg-violet-500/15 px-3 py-2 font-black tracking-[.22em] text-violet-200">BLUFF</div>
          <div><p className="text-sm font-bold text-white">暗箱博弈</p><p className="text-xs text-slate-400">谎言自由，承诺不可篡改</p></div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-xl border border-white/10 bg-black/25 p-1">
            <button onClick={() => setPlayMode("demo")} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${playMode === "demo" ? "bg-violet-500 text-white" : "text-slate-400 hover:text-white"}`}>无钱包试玩</button>
            <button onClick={() => setPlayMode("chain")} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${playMode === "chain" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-white"}`}>链上实战</button>
          </div>
          <a href={contractUrl} target="_blank" rel="noreferrer" className="rounded-full border border-fuchsia-400/20 px-3 py-2 text-xs text-fuchsia-200 hover:border-fuchsia-300/50">Monad Testnet · 10143</a>
          {playMode === "chain" && <button onClick={connectWallet} className={chainOk ? "btn-secondary" : "btn-danger"}>{account ? shortAddress(account) : "连接钱包"}</button>}
        </div>
      </header>

      <section className="mx-auto grid max-w-[1440px] gap-6 py-7 lg:grid-cols-[.88fr_1.12fr]">
        <div className="panel rounded-3xl p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div><p className="text-xs font-black tracking-[.2em] text-cyan-300">ONCHAIN MIND GAME</p><h1 className="mt-2 text-3xl font-black sm:text-5xl">你敢相信吗？</h1></div>
            <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300">{playMode === "demo" ? "互动试玩 · 不上链" : game ? STATUS[game.status] : "未载入房间"}</span>
          </div>
          <div className={`vault ${playMode === "demo" ? `vault-${demoStage} vault-choice-${demoSecret}` : game?.status === 3 ? `vault-finished vault-choice-${game.revealedSecret}` : "vault-idle"}`} aria-label="神秘保险箱">
            <span className="vault-status">
              {playMode === "demo"
                ? demoStage === "secret" ? "选择秘密" : demoStage === "action" ? "秘密已锁定" : demoStage === "reveal" ? "等待揭晓" : SECRET[demoSecret]
                : game?.status === 3 && game.finishReason === 1 ? SECRET[game.revealedSecret] : "COMMITTED"}
            </span>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-2 text-center text-xs text-slate-400">
            <div><b className="block text-base text-violet-200">承诺</b>秘密上锁</div>
            <div><b className="block text-base text-cyan-200">抉择</b>相信或揭穿</div>
            <div><b className="block text-base text-rose-200">揭晓</b>合约结算</div>
          </div>
        </div>

        <div className="space-y-5">
          {playMode === "demo" && (
            <section className="panel rounded-3xl p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[.16em] text-amber-300">INTERACTIVE DEMO · 本地试玩</p>
                  <h2 className="mt-2 text-2xl font-black">
                    {demoStage === "secret" ? "设局者：选择暗箱内容" : demoStage === "action" ? "挑战者：相信还是揭穿？" : demoStage === "reveal" ? "答案已经锁定" : "真相揭晓"}
                  </h2>
                </div>
                <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100">试玩数据不上链</span>
              </div>

              {demoStage === "secret" && (
                <div className="mt-6">
                  <p className="text-sm leading-6 text-slate-400">先替设局者选择宝藏或陷阱。点击卡片会立即改变保险箱状态。</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {[0, 1].map((choice) => (
                      <button key={choice} onClick={() => setDemoSecret(choice as 0 | 1)} className={`demo-choice rounded-2xl border p-5 text-left ${demoSecret === choice ? "is-selected" : ""}`}>
                        <span className={`text-2xl ${choice === 0 ? "text-cyan-200" : "text-rose-200"}`}>{choice === 0 ? "◆" : "⚠"}</span>
                        <b className="mt-3 block">{SECRET[choice]}</b>
                        <span className="mt-1 block text-sm text-slate-500">{choice === 0 ? "也许真诚才是最深的诱导" : "让对手走进你布下的陷阱"}</span>
                      </button>
                    ))}
                  </div>
                  <button className="btn-primary mt-5 w-full" onClick={() => setDemoStage("action")}>锁定秘密</button>
                </div>
              )}

              {demoStage === "action" && (
                <div className="mt-6">
                  <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-center">
                    <span className="text-sm text-violet-200">秘密已锁进保险箱，挑战者看不到答案</span>
                    <div className="mx-auto mt-3 h-2 w-2/3 overflow-hidden rounded-full bg-black/40"><div className="h-full w-full animate-pulse bg-gradient-to-r from-violet-500 via-cyan-400 to-rose-500" /></div>
                  </div>
                  <p className="mt-5 text-sm text-slate-400">现在站在挑战者立场做决定：</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button className="btn-secondary min-h-24 text-lg" onClick={() => { setDemoAction(0); setDemoStage("reveal"); }}>TRUST<br /><span className="text-sm font-normal">选择相信</span></button>
                    <button className="btn-danger min-h-24 text-lg" onClick={() => { setDemoAction(1); setDemoStage("reveal"); }}>EXPOSE<br /><span className="text-sm font-normal">当场揭穿</span></button>
                  </div>
                </div>
              )}

              {demoStage === "reveal" && (
                <div className="mt-8 text-center">
                  <p className="text-sm text-slate-400">挑战者选择了</p>
                  <p className="mt-2 text-3xl font-black text-cyan-200">{ACTION[demoAction]}</p>
                  <p className="mt-4 text-sm text-slate-500">答案不能再修改。点击按钮打开保险箱。</p>
                  <button className="btn-primary mt-6 w-full py-4 text-lg" onClick={() => setDemoStage("finished")}>打开保险箱</button>
                </div>
              )}

              {demoStage === "finished" && (
                <div className="demo-reveal mt-6 rounded-3xl border border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-500/15 to-cyan-500/10 p-6 text-center">
                  <p className="text-xs font-bold tracking-[.2em] text-fuchsia-200">REVEALED</p>
                  <p className={`mt-3 text-3xl font-black ${demoSecret === 0 ? "text-cyan-200" : "text-rose-200"}`}>{SECRET[demoSecret]}</p>
                  <p className="mt-2 text-slate-300">挑战者选择：{ACTION[demoAction]}</p>
                  <div className="mt-6 flex justify-center gap-12">
                    <div><b className="text-4xl text-violet-200">{demoBlufferScore}</b><span className="block text-sm text-slate-500">设局者</span></div>
                    <div><b className="text-4xl text-cyan-200">{demoChallengerScore}</b><span className="block text-sm text-slate-500">挑战者</span></div>
                  </div>
                  <p className="mt-5 text-xs text-amber-200/70">这是本地交互试玩，不是链上交易结果。</p>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button className="btn-secondary" onClick={resetDemo}>再玩一次</button>
                    <button className="btn-primary" onClick={() => setPlayMode("chain")}>进入链上实战</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {playMode === "chain" && <>
          <section className="panel rounded-3xl p-5 sm:p-7">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-xs font-bold tracking-[.16em] text-slate-500">ROOM TERMINAL</p><h2 className="mt-1 text-xl font-black">进入链上房间</h2></div>
              {game && <span className="text-sm text-slate-400">你的身份：<b className="text-white">{role}</b></span>}
            </div>
            <div className="flex gap-2">
              <input className="field" inputMode="numeric" placeholder="输入 gameId，例如 0" value={gameId} onChange={(e) => setGameId(e.target.value.trim())} />
              <button className="btn-secondary shrink-0" onClick={() => void refreshGame()}>读取</button>
            </div>
          </section>

          {!game && (
            <section className="panel rounded-3xl p-5 sm:p-7">
              <p className="text-xs font-bold tracking-[.16em] text-violet-300">BLUFFER · 设局者</p>
              <h2 className="mt-2 text-2xl font-black">创建一场暗箱对决</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">秘密与随机 salt 只保存在当前浏览器。创建后不要清理网站数据。</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[0, 1].map((choice) => (
                  <button key={choice} onClick={() => setSecretChoice(choice as 0 | 1)} className={`rounded-2xl border p-4 text-left transition ${secretChoice === choice ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
                    <b className={choice === 0 ? "text-cyan-200" : "text-rose-200"}>{SECRET[choice]}</b>
                    <span className="mt-1 block text-xs text-slate-500">{choice === 0 ? "真诚也可能是一种诱饵" : "让对手相信你的谎言"}</span>
                  </button>
                ))}
              </div>
              <label className="mt-5 block text-sm font-bold text-slate-300">指定挑战者地址</label>
              <input className="field mt-2 font-mono text-sm" placeholder="0x…" value={challenger} onChange={(e) => setChallenger(e.target.value.trim())} />
              <button className="btn-primary mt-4 w-full" disabled={!!busy} onClick={createGame}>{busy === "create" ? "等待钱包与链上确认…" : "生成承诺并创建房间"}</button>
            </section>
          )}

          {game && (
            <section className="panel rounded-3xl p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-bold tracking-[.16em] text-cyan-300">GAME #{gameId}</p><h2 className="mt-1 text-2xl font-black">{STATUS[game.status]}</h2></div>
                {deadline > 0n && <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-right"><span className="block text-xs text-slate-500">链上截止倒计时</span><b className="font-mono text-lg">{remaining(deadline)}</b></div>}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-violet-400/15 bg-violet-500/5 p-4"><span className="text-xs text-slate-500">设局者</span><b className="mt-1 block font-mono text-sm">{shortAddress(game.bluffer)}</b></div>
                <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/5 p-4"><span className="text-xs text-slate-500">挑战者</span><b className="mt-1 block font-mono text-sm">{shortAddress(game.challenger)}</b></div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4"><span className="text-xs text-slate-500">链上 Commitment</span><code className="mt-1 block break-all text-xs text-slate-300">{game.commitment}</code></div>

              {game.status === 1 && role === "挑战者" && (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button className="btn-secondary" disabled={!!busy} onClick={() => chooseAction(0)}>{busy === "trust" ? "确认中…" : "TRUST · 相信"}</button>
                  <button className="btn-danger" disabled={!!busy} onClick={() => chooseAction(1)}>{busy === "expose" ? "确认中…" : "EXPOSE · 揭穿"}</button>
                </div>
              )}

              {game.status === 2 && role === "设局者" && (
                <div className="mt-5">
                  <div className={`mb-3 rounded-xl border p-3 text-sm ${localSecret ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-rose-400/25 bg-rose-500/10 text-rose-200"}`}>
                    {localSecret ? "已在当前浏览器找到秘密恢复信息。" : "未找到秘密恢复信息，不能安全 reveal。"}
                  </div>
                  <button className="btn-primary w-full" disabled={!!busy || !localSecret} onClick={revealGame}>{busy === "reveal" ? "验证承诺并结算中…" : "揭晓秘密"}</button>
                </div>
              )}

              {(game.status === 1 || game.status === 2) && deadline > 0n && Number(deadline) <= Math.floor(now / 1000) && (
                <button className="btn-danger mt-4 w-full" disabled={!!busy} onClick={settleTimeout}>{busy === "timeout" ? "结算中…" : "执行链上超时结算"}</button>
              )}

              {game.status === 3 && (
                <div className="mt-5 rounded-2xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/10 to-cyan-500/10 p-5 text-center">
                  <p className="text-xs font-bold tracking-[.18em] text-fuchsia-200">{FINISH_REASON[game.finishReason]}</p>
                  {game.finishReason === 1 && <p className="mt-2 text-lg font-black">{SECRET[game.revealedSecret]} · {ACTION[game.action]}</p>}
                  <p className="mt-3 text-3xl font-black">{winner}</p>
                  <div className="mt-4 flex justify-center gap-8"><div><b className="text-3xl text-violet-200">{game.blufferScore}</b><span className="block text-xs text-slate-500">设局者</span></div><div><b className="text-3xl text-cyan-200">{game.challengerScore}</b><span className="block text-xs text-slate-500">挑战者</span></div></div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button className="btn-secondary flex-1" onClick={() => navigator.clipboard.writeText(window.location.href)}>复制房间链接</button>
                <button className="btn-secondary flex-1" onClick={() => { setGame(undefined); setGameId(""); setNotice(""); setError(""); }}>再开一局</button>
              </div>
            </section>
          )}

          {lastTx && (
            <section className="panel rounded-2xl p-4 text-sm">
              {lastTx && <a className="mt-2 block break-all font-mono text-xs text-cyan-300 underline" href={txUrl(lastTx)} target="_blank" rel="noreferrer">交易：{lastTx}</a>}
            </section>
          )}
          </>}
        </div>
      </section>
      <footer className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-3 border-t border-white/5 py-5 text-xs text-slate-600"><span>积分仅用于游戏，不代表任何资产价值。</span><a href={contractUrl} target="_blank" rel="noreferrer" className="hover:text-cyan-300">Contract {shortAddress(CONTRACT_ADDRESS)}</a></footer>
    </main>
  );
}

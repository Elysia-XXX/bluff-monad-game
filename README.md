# BLUFF — 暗箱博弈

BLUFF 是一款运行在 Monad Testnet 上的双人心理博弈。设局者可以说谎，但无法在看到挑战者选择后修改已经提交的秘密。合约使用 Commit–Reveal 验证承诺并完成权威计分，不涉及真实资产、下注、NFT 或后端数据库。

## 已部署合约

- Network: Monad Testnet (`chainId: 10143`)
- Contract: [`0xAe3f56228405Eb3DACf7c2eE0991511900ef1BC4`](https://testnet.monadvision.com/address/0xAe3f56228405Eb3DACf7c2eE0991511900ef1BC4)
- Deploy tx: [`0xdda2…40cf`](https://testnet.monadvision.com/tx/0xdda2db19ce1d935323773ead6ab33f8108868286f516abb9a9c7438372f440cf)
- Deploy block: `81510993`
- Action window: 15 minutes
- Reveal window: 10 minutes

旧地址 `0x3e93…17A5` 已被修正版取代。修正版将 `expectedGameId` 原子绑定到 `createGame`，避免并发创建房间时 commitment 使用过期 gameId。

## 游戏规则

| 设局者秘密 | 挑战者选择 | 结果 |
| --- | --- | --- |
| TREASURE | TRUST | 双方各 +2 |
| TREASURE | EXPOSE | 设局者 +3 |
| TRAP | TRUST | 设局者 +4 |
| TRAP | EXPOSE | 挑战者 +4 |

积分没有代币价值。合约不会接收或转移游戏资产。

## Commit–Reveal

浏览器使用 `crypto.getRandomValues` 生成 32 字节 salt，并计算：

```text
keccak256(abi.encode(gameId, chainId, contractAddress, playerA, secretChoice, salt))
```

创建房间时只有 commitment 上链。原始秘密与 salt 保存在创建者浏览器的 `localStorage`，直到挑战者行动后才通过 `reveal` 提交。请勿在揭晓前清理浏览器数据。

## 本地运行

要求 Node.js 20+。当前验证环境为 Node.js 24。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。浏览器需要安装兼容 EIP-1193 的钱包并切换到 Monad Testnet。

生产验证：

```bash
npm run typecheck
npm run build
npm test
```

## 合约开发与部署

复制 `.env.example` 为 `.env`，仅使用测试网专用账户：

```ini
MONAD_PRIVATE_KEY=0x...
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
```

`.env` 已加入 `.gitignore`，严禁提交私钥。

```bash
npm run compile
npm run preflight:monad
npm run deploy:monad
```

部署脚本不硬编码 gas price，由 RPC 提供当前费用数据。

## 测试结果

`npm test` 当前包含 14 项合约测试，覆盖：

- 四种计分组合
- 错误 salt
- 非指定挑战者
- 提前 reveal
- 重复行动与重复结算
- 跨 gameId commitment 重放
- 两类超时
- 无效枚举
- 过期 expectedGameId 竞态

### 真实双钱包游戏

Monad Testnet Game `#0` 已完成 `TRAP + EXPOSE`，最终设局者 `0`、挑战者 `4`。

- [Create game](https://testnet.monadvision.com/tx/0xf48d597e587594410e52deed82da1055390b4f72a3a687caefaf585d2cee583c)
- [Choose EXPOSE](https://testnet.monadvision.com/tx/0x1ce8c3e47e8679badb2254941e222832a21bb55e6ef277d2ec6007a22f9715ac)
- [Reveal TRAP](https://testnet.monadvision.com/tx/0xba3c0882567e80713eee0d94303887bb5764304a5a98d2d810649f69e2621a29)

公开证据保存在 `deployments/e2e-game-0.json`。临时挑战者私钥没有打印或持久化。

## 五分钟现场演示

1. **0:00–0:40 — 定位**：说明 BLUFF 是双人心理博弈，玩家可以说谎，但不能事后修改承诺。
2. **0:40–1:20 — 合约证据**：打开 MonadVision 合约页，展示真实地址、部署交易和 `GameCreated`/`GameFinished` 事件。
3. **1:20–2:10 — 设局者**：钱包 A 选择 TREASURE 或 TRAP，填写钱包 B，创建房间；强调链上只有 commitment。
4. **2:10–3:00 — 挑战者**：钱包 B 打开房间链接，确认 commitment 已上链，选择 TRUST 或 EXPOSE。
5. **3:00–3:50 — 揭晓**：钱包 A 使用浏览器本地 secret + salt reveal，等待交易确认，展示合约结算分数。
6. **3:50–4:25 — 防作弊**：解释 commitment 绑定 gameId、chainId、合约地址和设局者；展示错误 salt 测试与超时规则。
7. **4:25–5:00 — 愿景**：BLUFF 可作为 Web3 社区互动、公平对抗小游戏和可组合心理博弈协议的基础模块。

## 已知限制

- 秘密恢复信息只保存在创建房间的浏览器；清理数据后无法 reveal，只能等待超时。
- 当前没有复杂匹配、聊天、数据库或跨设备秘密同步。
- 公共 RPC 可能限流；前端使用轮询而非 WebSocket。
- 测试网积分没有资产价值，项目未进行正式安全审计。
- 当前只验证了功能正确性，不声称验证 Monad 并行执行性能。

## 后续方向

- 可导出的加密秘密备份与跨设备恢复
- 社区锦标赛和无资产排行榜
- 可嵌入 DAO、直播和社群活动的房间组件
- 更多非零和博弈规则，但继续保持结算可验证、无托管

## 技术栈

Next.js App Router、React、TypeScript、Tailwind CSS、viem、Solidity 0.8.28、Hardhat。所有链上交互使用 Monad Testnet 和测试 MON。

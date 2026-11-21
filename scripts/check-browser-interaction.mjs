import { writeFileSync } from "node:fs";

const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const pages = await fetch(`${endpoint}/json`).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes("127.0.0.1:3001"));
if (!page) throw new Error("BLUFF preview page not found in Edge DevTools");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const handler = pending.get(message.id);
  if (handler) {
    pending.delete(message.id);
    handler(message);
  }
});

function command(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

await command("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1_000));

const evaluation = await command("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const buttons = [...document.querySelectorAll("button")];
    const trap = buttons.find((button) => button.textContent.includes("TRAP"));
    const treasure = buttons.find((button) => button.textContent.includes("TREASURE"));
    const before = { trap: trap?.className, treasure: treasure?.className };
    trap?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = { trap: trap?.className, treasure: treasure?.className };
    const chainMode = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("链上实战"));
    chainMode?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const connect = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("连接钱包"));
    connect?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      before,
      after,
      walletErrorVisible: document.body.innerText.includes("未检测到浏览器钱包"),
      ethereumInjected: Boolean(window.ethereum),
    };
  })()`,
});

const result = evaluation.result?.result?.value;
console.log(JSON.stringify(result, null, 2));
if (!result || result.before.trap === result.after.trap) throw new Error("TRAP click did not update React state");
if (!result.walletErrorVisible) throw new Error("Missing-wallet click did not show an error");
console.log("BROWSER_INTERACTION_OK=true");

const demoRun = await command("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const button = (text) => [...document.querySelectorAll("button")].find((item) => item.textContent.includes(text));
    button("关闭")?.click();
    await delay(100);
    button("无钱包试玩")?.click();
    await delay(150);
    button("锁定秘密")?.click();
    await delay(150);
    button("EXPOSE")?.click();
    await delay(150);
    button("打开保险箱")?.click();
    await delay(700);
    return {
      revealed: document.body.innerText.includes("REVEALED"),
      trap: document.body.innerText.includes("TRAP · 陷阱"),
      scores: document.body.innerText.includes("设局者") && document.body.innerText.includes("挑战者"),
      disclaimer: document.body.innerText.includes("不是链上交易结果"),
    };
  })()`,
});
const demoResult = demoRun.result?.result?.value;
console.log(JSON.stringify({ demo: demoResult }, null, 2));
if (!demoResult?.revealed || !demoResult?.trap || !demoResult?.scores || !demoResult?.disclaimer) {
  throw new Error("Full demo flow did not reach the revealed result");
}
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync("outputs/demo-finished.png", Buffer.from(screenshot.result.data, "base64"));
console.log("FULL_DEMO_FLOW_OK=true");
socket.close();

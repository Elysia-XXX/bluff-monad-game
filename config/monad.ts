export const monadTestnet = {
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  testnet: true,
} as const;

export const bluffGameDeployment = {
  address: "0xAe3f56228405Eb3DACf7c2eE0991511900ef1BC4",
  transactionHash: "0xdda2db19ce1d935323773ead6ab33f8108868286f516abb9a9c7438372f440cf",
  blockNumber: 81_510_993n,
} as const;

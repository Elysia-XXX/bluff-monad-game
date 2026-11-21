import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLUFF — 暗箱博弈",
  description: "Monad Testnet 上的双人 Commit–Reveal 心理博弈",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

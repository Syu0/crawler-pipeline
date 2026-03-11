import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoughDiamond Dashboard",
  description: "Control room for Coupang → Qoo10 automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

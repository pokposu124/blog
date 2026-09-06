import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "투자 테제 반박 도구",
  description: "강세 테제를 입력하면 그 테제를 무너뜨리는 논거를 돌려준다.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

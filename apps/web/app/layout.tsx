import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EntornoSeguro Stage 3 Demo",
  description: "Signup -> setup -> import -> preview -> dispatch -> training -> timeline -> risk review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

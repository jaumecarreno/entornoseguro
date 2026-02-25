import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EntornoSeguro Stage 1 Demo",
  description: "Signup -> setup -> import -> campaign preview + training preview + timeline mock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

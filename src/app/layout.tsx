import { Inter } from "next/font/google";
import "@/styles/tailwind.css";
import "@/styles/global.css";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

export const metadata = {
  title: "WASM Benchmarks",
  description: "WebAssembly compression and allocation benchmarks",
};

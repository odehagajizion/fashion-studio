import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MvendyWendy Studio | Owner Dashboard",
  description: "A workspace for managing customers, garment orders, production, and payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

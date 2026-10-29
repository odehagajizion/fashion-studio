import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MvendyWendy Studio | Owner Workspace",
  description: "Manage fashion studio customers, garment orders, production, and payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

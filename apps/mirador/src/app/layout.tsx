import type { Metadata } from "next";
import { publicSans, robotoMono } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "mirador — rama inspector",
  description:
    "Live SSR preview & inspector for the rama git-graph layout engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

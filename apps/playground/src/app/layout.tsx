import type { Metadata, Viewport } from "next";
import { publicSans, robotoMono } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trazo Playground",
  description:
    "Live SSR preview & playground for the trazo code-to-diagram engine.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${publicSans.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

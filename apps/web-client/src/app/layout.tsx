import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Naina",
  description: "AI Voice Concierge",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} font-sans h-full overflow-hidden`}>
      <body className="h-full w-full overflow-hidden bg-[#f5f4f8] text-[#1e1b2b] min-w-[1024px] min-h-[600px] font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

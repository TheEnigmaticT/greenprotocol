import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const libreBaskerville = Libre_Baskerville({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "GreenChemistry.ai — AI-Powered Green Chemistry Protocol Optimizer",
  description: "Paste your chemistry protocol and get AI-powered green chemistry recommendations with an Impact Scoreboard. Built on the 12 Principles of Green Chemistry.",
  openGraph: {
    title: "GreenChemistry.ai — AI-Powered Green Chemistry Protocol Optimizer",
    description: "Paste your chemistry protocol and get AI-powered green chemistry recommendations with an Impact Scoreboard.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GreenChemistry.ai",
    description: "AI-powered green chemistry protocol optimizer",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${ibmPlexMono.variable} ${libreBaskerville.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

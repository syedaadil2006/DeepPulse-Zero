import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeepPulse-Zero",
  description: "Is there blood behind the face? Real-time sub-dermal liveness and deepfake interception, 100% in your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* browser-side font load: next/font's server download fails behind TLS-intercepting networks */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen bg-ink font-sans text-bone antialiased">
        <div className="grain pointer-events-none fixed inset-0 z-50" aria-hidden />
        {children}
      </body>
    </html>
  );
}

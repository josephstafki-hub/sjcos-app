import type { Metadata, Viewport } from "next";
import { Newsreader, Mulish, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Serif — all headings, display, editorial italic
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

// Sans — base UI + body
const mulish = Mulish({
  variable: "--font-mulish",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Mono — spec labels, numbers, timestamps, breadcrumbs
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SJC OS",
  description: "Business operating system for SJ Carpentry LLC",
  // Installed-to-home-screen behavior on iOS, which ignores the web manifest's
  // `display` field and reads these instead.
  appleWebApp: {
    capable: true,
    title: "SJC OS",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the app paint under the notch / home indicator; the shell uses
  // safe-area insets so nothing important lands there.
  viewportFit: "cover",
  themeColor: "#283021", // forest — status bar tint when installed
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${mulish.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}

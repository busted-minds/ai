import type { Metadata, Viewport } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const themeScript = `
try {
  var theme = localStorage.getItem('bmai-theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch (_) { document.documentElement.dataset.theme = 'dark'; }
`;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Busted Minds AI", template: "%s · Busted Minds AI" },
  description: "Brilliant answers with sharp instincts, unreasonable confidence, and one Busted Minds Account.",
  applicationName: "Busted Minds AI",
  authors: [{ name: "Busted Minds", url: "https://bustedminds.us.kg/" }],
  creator: "Busted Minds",
  icons: { icon: "/brand/bmai-logo-light.png", apple: "/brand/bmai-logo-light.png" },
  openGraph: {
    title: "Busted Minds AI",
    description: "The sharpest mind in the room. Usually because it invited itself.",
    siteName: "Busted Minds AI",
    type: "website",
    images: [{ url: "/brand/bmai-logo-light.png", width: 512, height: 512, alt: "Busted Minds AI" }],
  },
  twitter: { card: "summary", title: "Busted Minds AI", description: "Ask better. Think sharper." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b0b0d" }, { media: "(prefers-color-scheme: light)", color: "#f4f1eb" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}


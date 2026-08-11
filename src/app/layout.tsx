import type { Metadata, Viewport } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const siteUrl = "https://ai.bustedminds.us.kg";
const siteTitle = "Busted Minds AI — AI Chat & Thought Partner";
const siteDescription =
  "Chat with Busted Minds AI for sharp answers, clearer thinking, coding help, research, and honest feedback.";

const themeScript = `
try {
  var theme = localStorage.getItem('bmai-theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch (_) { document.documentElement.dataset.theme = 'dark'; }
`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: siteTitle, template: "%s · Busted Minds AI" },
  description: siteDescription,
  applicationName: "Busted Minds AI",
  authors: [{ name: "Busted Minds", url: "https://bustedminds.us.kg/" }],
  creator: "Busted Minds",
  publisher: "Busted Minds",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/brand/bmai-logo-light.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/brand/bmai-logo-light.png", type: "image/png", sizes: "512x512" }],
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    siteName: "Busted Minds AI",
    type: "website",
    images: [{ url: "/brand/bmai-og.png", width: 1200, height: 630, alt: "Busted Minds AI — AI Chat & Thought Partner" }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [{ url: "/brand/bmai-og.png", alt: "Busted Minds AI — AI Chat & Thought Partner" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0a0d10" }, { media: "(prefers-color-scheme: light)", color: "#f3f0e9" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}

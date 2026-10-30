import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_NAME, APP_VERSION } from "@/lib/version";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} · Top Up Game via WhatsApp`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Top up Valorant, PUBG, Genshin Impact, Mobile Legends, dan game lain di Nexa Store. Pilih nominal, isi data akun, pesan langsung via WhatsApp.",
  keywords: [
    "top up game",
    "nexa store",
    "valorant points",
    "pubg uc",
    "mobile legends diamonds",
    "top up murah",
  ],
  openGraph: {
    title: `${APP_NAME} · Top Up Game via WhatsApp`,
    description:
      "Pilih game, pilih nominal, pesan via WhatsApp. Harga tampil adalah harga akhir.",
    siteName: APP_NAME,
    type: "website",
  },
  // v1.21.0: PWA — manifest (installable + syarat push iOS 16.4+) dan ikon.
  // v1.22.3: favicon di-cache browser secara agresif — query ?v memaksa
  // pengambilan ulang setiap rilis (memperbaiki ikon Z scaffold yang nyangkut).
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: `/logo.svg?v=${APP_VERSION}`, type: "image/svg+xml" },
      { url: `/logo.png?v=${APP_VERSION}`, sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/logo.png", sizes: "256x256", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1b1f" },
  ],
};

/** v1.21.0: pasang palet warna tersimpan SEBELUM paint pertama (anti-flash).
 *  Amber (bawaan) tidak memasang atribut apa pun — desain dasar tak berubah. */
const PALETTE_BOOT = `(function(){try{var p=localStorage.getItem("nexa-palette");if(p==="emerald"||p==="violet"||p==="rose"||p==="sunset")document.documentElement.setAttribute("data-palette",p)}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} font-sans antialiased bg-background text-foreground`}
        data-app-version={APP_VERSION}
      >
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT }} />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Ruthie } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { Providers } from "@/components/providers";
import { SplashScreen } from "@/components/splash-screen";

const ruthie = Ruthie({
  variable: "--font-ruthie",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Talos",
  description: "The operating system for autonomous agent corporations on Pharos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ruthie.variable} h-full antialiased bg-background`}>
      <head>
        {/* Resolve the persisted/preferred theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('talos-theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(_){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-mono">
        <SplashScreen />
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-border py-8 px-6">
            <div className="max-w-7xl mx-auto flex items-center justify-center text-sm text-muted">
              <span className="font-ruthie text-2xl text-nav-accent">Talos</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

import "./globals.css";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  title: "eSpace Dev Hub",
  description:
    "A personal performance dashboard and evidence tracker for eSpace engineers.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body>
        {children}
        <Toaster
          theme="light"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
              color: "var(--fg)",
              borderRadius: "4px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            },
          }}
        />
      </body>
    </html>
  );
}

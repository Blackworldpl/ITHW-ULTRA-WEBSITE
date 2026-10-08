import type { Metadata, Viewport } from "next";
import { BrandIntro } from "@/components/brand";
import Script from 'next/script';
import {ThemeProvider} from '@/components/theme';
import "./globals.css";
import "./industrial.css";
import "./light.css";
import "./devices.css";
import "./warehouse.css";
export const metadata: Metadata = {
  title: "IT HARDWARE ROBAKOWO · System zarządzania sprzętem",
  description: "IT Hardware Robakowo — urządzenia, magazyn i historia w jednym systemie.",
  icons: { icon: "/brand/ith-mark.svg", apple: "/brand/ith-mark.svg" },
};
export const viewport: Viewport = { themeColor: "#090d12", colorScheme: "dark light" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" data-theme="dark" suppressHydrationWarning>
      <body><Script id="ith-theme-init" strategy="beforeInteractive">{`try{var t=localStorage.getItem('ith-theme');var l=t==='light'||t==='system'&&matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.dataset.theme=l?'light':'dark';document.documentElement.style.colorScheme=l?'light':'dark';}catch(e){}`}</Script><ThemeProvider><BrandIntro/>{children}</ThemeProvider></body>
    </html>
  );
}

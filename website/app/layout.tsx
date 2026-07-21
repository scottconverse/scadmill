import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RELEASE } from "../lib/release";

export const metadata: Metadata = {
  metadataBase: new URL("https://scadmill.com"),
  title: { default: "ScadMill — OpenSCAD, without losing the code", template: "%s · ScadMill" },
  description: "A source-first OpenSCAD workbench for Windows with a real editor, interactive geometry, project tools, and optional AI.",
  openGraph: { title: "ScadMill — OpenSCAD, without losing the code", description: `Windows public beta ${RELEASE.version}`, images: [{ url: "/og.png", width: 1731, height: 909 }] },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#07111f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

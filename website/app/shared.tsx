import Link from "next/link";
import { RELEASE } from "../lib/release";

export function Header() {
  return <header className="site-header"><div className="shell nav"><Link className="brand" href="/"><span className="brand-mark">S</span><span>ScadMill</span></Link><nav aria-label="Primary"><Link href="/#how-it-works">How it works</Link><Link href="/manual">Manual</Link><Link href="/architecture">Architecture</Link><a href={RELEASE.github}>GitHub</a></nav><a className="nav-download" href={RELEASE.download}>Download <span>{RELEASE.version}</span></a></div></header>;
}

export function ReleaseBar() {
  return <div className="release-bar"><div className="shell"><span>WINDOWS BETA</span><p>{RELEASE.version} is public, signed, and release-tested.</p><a href={RELEASE.releasePage}>View release →</a></div></div>;
}

export function Footer() {
  return <footer><div className="shell footer-grid"><div><div className="brand"><span className="brand-mark">S</span><span>ScadMill</span></div><p>Source-first OpenSCAD workbench.</p></div><div><strong>Product</strong><Link href="/manual">User manual</Link><Link href="/architecture">Architecture</Link><a href={RELEASE.releasePage}>Release notes</a></div><div><strong>Project</strong><a href={RELEASE.github}>Source on GitHub</a><a href={`${RELEASE.github}/blob/main/PRIVACY.md`}>Privacy</a><a href={`${RELEASE.github}/security/advisories/new`}>Report a vulnerability</a></div><div className="version-stamp"><span>PUBLIC BETA</span><strong>{RELEASE.version}</strong><small>Windows x64 · Apache-2.0</small></div></div></footer>;
}

export function ArchitectureMap() {
  return <div className="architecture-map" role="img" aria-label="ScadMill architecture: a user interacts with the desktop workbench, which uses local storage and an out-of-process OpenSCAD engine; optional AI requests go directly to the configured provider."><div className="arch-node person"><small>YOU</small><strong>Model source</strong></div><span className="arch-arrow">→</span><div className="arch-node app"><small>SCADMILL DESKTOP</small><strong>Editor · Viewer · Projects</strong><em>Typed application ports</em></div><div className="arch-branches"><span>↙</span><span>↓</span><span>↘</span></div><div className="arch-targets"><div className="arch-node"><small>LOCAL</small><strong>Files & settings</strong></div><div className="arch-node engine"><small>OUT OF PROCESS</small><strong>OpenSCAD engine</strong></div><div className="arch-node optional"><small>OPTIONAL</small><strong>Your AI provider</strong></div></div></div>;
}

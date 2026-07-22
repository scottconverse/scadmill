import Link from "next/link";
import { ArchitectureMap, Footer, Header, ReleaseBar } from "./shared";
import { RELEASE } from "../lib/release";

const capabilities = [
  ["Write the source", "A real OpenSCAD editor with projects, tabs, completions, diagnostics, formatting, and Customizer controls."],
  ["See the geometry", "Preview or fully render through the official OpenSCAD engine, then inspect, measure, annotate, animate, and compare."],
  ["Keep control", "Your project files stay yours. AI is optional, provider-direct, and every proposed source change can be reviewed."],
];

export default function Home() {
  return (
    <main>
      <Header />
      <ReleaseBar />
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">Source-first CAD for people who make things</p>
          <h1>OpenSCAD,<br /><em>without losing the code.</em></h1>
          <p className="lede">ScadMill brings editing, live geometry, project tools, Customizer controls, and optional AI into one focused Windows workbench. OpenSCAD remains the rendering authority.</p>
          <div className="actions">
            <a className="button primary" href={RELEASE.download}>Download Windows beta</a>
            <Link className="button secondary" href="/manual">Read the manual</Link>
          </div>
          <p className="fine">Signed 64-bit Windows installer · {RELEASE.sizeHuman} · Version {RELEASE.version}</p>
        </div>
        <div className="hero-visual" aria-label="A source model becoming rendered geometry">
          <div className="code-card"><span>01</span><code>difference() {'{'}</code><span>02</span><code>  cube([40, 30, 12]);</code><span>03</span><code>  translate([20,15,-1])</code><span>04</span><code>    cylinder(h=14, r=5);</code><span>05</span><code>{'}'}</code></div>
          <div className="model-card"><div className="model-cube"><i /><i /><i /></div><p>FULL RENDER · 3D</p></div>
        </div>
      </section>

      <section className="proof-strip"><div className="shell proof-grid">
        <div><strong>Signed</strong><span>Windows Authenticode</span></div>
        <div><strong>Lifecycle-tested</strong><span>Signed setup + isolated runtime</span></div>
        <div><strong>Local-first</strong><span>No ScadMill telemetry</span></div>
        <div><strong>Open source</strong><span>Apache-2.0</span></div>
      </div></section>

      <section className="section shell" id="how-it-works">
        <div className="section-heading"><p className="eyebrow">How it works</p><h2>One workbench. Two clear responsibilities.</h2><p>ScadMill owns the working experience; the unmodified OpenSCAD executable owns geometry evaluation. That separation keeps the model source portable and the engine boundary honest.</p></div>
        <div className="cap-grid">{capabilities.map(([title, body], i) => <article key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
      </section>

      <section className="section architecture-section" id="architecture"><div className="shell">
        <div className="section-heading light"><p className="eyebrow">Architecture</p><h2>Designed around a boundary you can understand.</h2><p>The desktop shell coordinates editor state, local files, and a typed engine adapter. OpenSCAD runs out of process. Optional network features are explicit rather than ambient.</p></div>
        <ArchitectureMap />
        <div className="architecture-notes"><p><strong>Local by default.</strong> Source, projects, renders, settings, and recovery data stay on the machine. ScadMill has no telemetry.</p><p><strong>Provider-direct AI.</strong> If enabled, selected context goes directly to the provider you configure; ScadMill operates no AI proxy.</p><p><strong>Exact engine pin.</strong> This beta requires the separately downloaded official OpenSCAD {RELEASE.engineVersion} snapshot and rejects other versions for rendering.</p></div>
        <Link className="text-link light" href="/architecture">Explore the full architecture →</Link>
      </div></section>

      <section className="section shell honesty">
        <div className="section-heading"><p className="eyebrow">An honest beta</p><h2>Useful now. Still clearly a beta.</h2></div>
        <div className="honesty-grid"><div><h3>What ships today</h3><ul><li>Windows 10/11 x64 desktop application</li><li>Editing, projects, native rendering and full-quality export</li><li>History, batch export, libraries, navigation, split editing, section view, and camera bookmarks</li><li>Printability, slicer handoff, engine pins, headless CLI, color/multipart 3MF, and design-time manufacturing estimates</li><li>Optional AI assistance and local MCP bridge</li></ul></div><div><h3>What does not</h3><ul><li>No public browser app yet</li><li>No macOS or Linux beta installers yet</li><li>OpenSCAD is a separate required download</li><li>Manufacturing estimates are advisory and do not replace a real slicer profile</li></ul></div></div>
      </section>

      <section className="section shell download-card" id="download"><div><p className="eyebrow">Public beta · {RELEASE.version}</p><h2>Build the model. Keep the source.</h2><p>Start with the signed Windows installer, then follow the two-minute engine setup in the manual.</p></div><div className="download-actions"><a className="button primary" href={RELEASE.download}>Download {RELEASE.filename}</a><a className="text-link" href={RELEASE.releasePage}>Release notes and checksum →</a></div></section>
      <Footer />
    </main>
  );
}

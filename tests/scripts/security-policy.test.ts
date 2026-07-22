import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("public beta security policy", () => {
  it("uses GitHub private vulnerability reporting without inventing an SLA or bounty", async () => {
    const [security, questions, readme, changelog, windowsBeta, privacy, faq, userGuide] = await Promise.all([
      readFile(resolve(repositoryRoot, "SECURITY.md"), "utf8"),
      readFile(resolve(repositoryRoot, "spec/QUESTIONS.md"), "utf8"),
      readFile(resolve(repositoryRoot, "README.md"), "utf8"),
      readFile(resolve(repositoryRoot, "CHANGELOG.md"), "utf8"),
      readFile(resolve(repositoryRoot, "docs/WINDOWS-BETA.md"), "utf8"),
      readFile(resolve(repositoryRoot, "PRIVACY.md"), "utf8"),
      readFile(resolve(repositoryRoot, "docs/FAQ.md"), "utf8"),
      readFile(resolve(repositoryRoot, "docs/USER-GUIDE.md"), "utf8"),
    ]);

    expect(security).toContain(
      "https://github.com/scottconverse/scadmill/security/advisories/new",
    );
    expect(security).toContain("Do not open a public issue");
    expect(security).toContain("latest public Windows beta");
    expect(security).toContain("currently `0.1.0-beta.2`");
    expect(security).toContain("Do not include API keys, access tokens, passwords");
    expect(security).toContain("ScadMill does not currently offer a bug bounty");
    expect(security).toContain("does not promise a response or remediation deadline");

    expect(questions).toContain("## Q-0039 — Resolved 2026-07-19 — owner-directed");
    expect(questions).toContain(
      "Use GitHub private vulnerability reporting and publish `SECURITY.md` without a bug bounty or response-time SLA.",
    );
    expect(questions).not.toContain(
      "| Open/actionable — public beta security policy | Q-0039 |",
    );
    expect(readme).not.toContain("owner resolution of the private security-reporting question");
    expect(changelog).not.toContain("owner resolution of Q-0039's private security-reporting route");
    expect(windowsBeta).not.toContain("owner resolution of the private security-reporting question");

    const publicReleaseDocuments = [readme, changelog, windowsBeta, privacy, faq, userGuide];
    for (const document of publicReleaseDocuments) {
      expect(document).not.toContain("unpublished `0.1.0-beta.2`");
      expect(document).not.toContain("There is no public ScadMill download yet");
    }
    expect(readme).toContain("releases/tag/v0.1.0-beta.2");
    expect(windowsBeta).toContain("49C107B1648D918B7DAF16B47B4F3BAD0500EDB160D8E734E6C400E7E2578A91");
    expect(faq).toContain("C:\\Users\\YOUR_USER\\AppData\\Local\\ScadMill\\scadmill.exe");
    expect(userGuide).toContain("C:\\Users\\YOUR_USER\\AppData\\Local\\ScadMill\\scadmill.exe");
  });
});

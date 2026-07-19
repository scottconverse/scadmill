# Windows beta rollback plan

This plan applies to the first public ScadMill release, `0.1.0-beta.1`.

The product owner, Scott Converse, is the human go/no-go and withdrawal decision-maker. The implementer may stop a candidate automatically when a gate fails, but may not publish, withdraw, delete, or replace a public release without the owner's explicit decision.

## Previous release

There is no previous public ScadMill release. `0.1.0-beta.1` is the first public beta, so rollback cannot honestly mean reinstalling an older supported build.

## Before publication

Any failed release gate is a no-go. Keep the GitHub release as a draft, do not create the public tag, and do not distribute its installer. Repair the candidate on a new commit and repeat the affected gate plus the final release gate.

## After publication

If a security, data-loss, installation, or release-evidence defect is confirmed:

1. Mark the GitHub release **withdrawn — do not install** at the top of its notes and remove it from the latest-release position. Preserve the immutable tag, installer hash, signature evidence, and gate records for traceability unless the owner directs a legally required removal.
2. Publish a repository security advisory when the defect has security impact. Otherwise open a public blocking issue that states the affected version, symptoms, and safe workaround.
3. Tell installed users to close ScadMill and uninstall it through **Windows Settings → Apps → Installed apps → ScadMill → Uninstall**. Project `.scad` files and user-selected project folders are outside the application install directory; users should still back them up before recovery work.
4. Revert the defective change on a new branch or implement the smallest forward fix. Never move or rewrite the published `0.1.0-beta.1` tag.
5. Produce `0.1.0-beta.2` or the next appropriate version from a new commit. Run the complete release gate, including the literal N-2 soak, exact signed-installer lifecycle, Windows Sandbox walkthrough, isolated similarity gate, visitor audit, and strict-zero final review.
6. Publish the replacement only after owner go/no-go. Link the withdrawn release to the replacement and state whether any user settings or project data require migration.

## Recovery verification

The replacement candidate must prove install over the withdrawn beta where supported, clean uninstall/reinstall, first launch, `.scad` file association, settings/recovery behavior, and preservation of user-owned project files. A rollback is not complete until the public release page and download links point only to a candidate whose retained hash matches the independently verified installer.

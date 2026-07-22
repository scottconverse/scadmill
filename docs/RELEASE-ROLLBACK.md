# Windows beta rollback plan

This plan applies to the current public ScadMill release, `0.1.0-beta.2`. The version-specific copy is [RELEASE-ROLLBACK-0.1.0-beta.2.md](RELEASE-ROLLBACK-0.1.0-beta.2.md).

The product owner, Scott Converse, is the human go/no-go and withdrawal decision-maker. The implementer may stop a candidate automatically when a gate fails, but may not publish, withdraw, delete, or replace a public release without the owner's explicit decision.

## Previous release

The previous public release is `0.1.0-beta.1`. A downgrade is permitted only when the confirmed defect does not also affect beta.1 and the incident notice explains beta.2 application-state compatibility limits.

## Before publication

Before publication, any failed release gate is a no-go. After publication, use the withdrawal procedure below; never replace assets or move a published tag in place.

## After publication

If a security, data-loss, installation, or release-evidence defect is confirmed:

1. Mark the GitHub release **withdrawn — do not install** at the top of its notes and remove it from the latest-release position. Preserve the immutable tag, installer hash, signature evidence, and gate records for traceability unless the owner directs a legally required removal.
2. Publish a repository security advisory when the defect has security impact. Otherwise open a public blocking issue that states the affected version, symptoms, and safe workaround.
3. Tell installed users to close ScadMill and uninstall it through **Windows Settings → Apps → Installed apps → ScadMill → Uninstall**. Project `.scad` files and user-selected project folders are outside the application install directory; users should still back them up before recovery work.
4. Revert the defective change on a new branch or implement the smallest forward fix. Never move or rewrite the published `0.1.0-beta.2` tag.
5. Produce the next appropriate version from a new commit. Run the complete release gate, including the one-hour literal N-2 soak, exact signed-installer lifecycle, Windows Sandbox walkthrough, isolated similarity gate, visitor audit, and strict-zero final review.
6. Publish the replacement only after owner go/no-go. Link the withdrawn release to the replacement and state whether any user settings or project data require migration.

## Recovery verification

The replacement candidate must prove install over the withdrawn beta where supported, clean uninstall/reinstall, first launch, `.scad` file association, settings/recovery behavior, and preservation of user-owned project files. A rollback is not complete until the public release page and download links point only to a candidate whose retained hash matches the independently verified installer.

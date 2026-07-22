# ScadMill 0.1.0-beta.3 rollback plan

**Status:** Candidate plan. It becomes the release-specific rollback record only if beta.3 is published.

Scott Converse is the release owner. Withdraw beta.3 when a confirmed defect risks project data, executes unintended code, exposes secrets, misrepresents manufacturing output, breaks install/update/uninstall, or invalidates published signature, hash, source, license, or gate evidence.

## Withdrawal

1. Mark the GitHub release **withdrawn - do not install** and remove it from the latest-release position.
2. Preserve the immutable tag, installer, checksums, signatures, provenance, and evidence unless a legal or security requirement requires restricted access.
3. Update the product site and documentation to direct users to the last qualified release or a fixed forward replacement.
4. Tell affected users what data may be at risk and how to preserve ordinary project files before uninstalling.

## Downgrade boundary

OpenSCAD source projects and user-selected assets remain ordinary files. Application-managed settings, recovery data, caches, installed-library metadata, history, and project pins may not be understood by beta.2. Do not promise in-place state downgrade compatibility.

## Forward repair

Fix the defect in a new commit and version. Repeat the complete hosted CI, similarity, one-hour soak, performance, signed-installer, cleanroom walkthrough, public-surface, and strict-zero gates. Never replace beta.3 assets or move its tag in place.

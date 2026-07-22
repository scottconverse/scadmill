# ScadMill 0.1.0-beta.2 rollback plan

This plan applies to the published Windows `0.1.0-beta.2` prerelease. The previous public release is [`0.1.0-beta.1`](https://github.com/scottconverse/scadmill/releases/tag/v0.1.0-beta.1).

## Authority and trigger

Scott Converse is the release owner. Withdraw beta.2 when a confirmed defect risks project data, executes unintended code, exposes secrets, misrepresents manufacturing output, breaks install/update/uninstall, or invalidates the published signature, hash, source, or license evidence.

## Withdrawal

1. Mark the beta.2 GitHub release **withdrawn — do not install** and remove it from the latest-release position without moving or rewriting its tag.
2. Change the product site and README download links back to beta.1 only if beta.1 is unaffected by the defect. Otherwise remove the supported download and state that no safe public build is available.
3. Preserve beta.2's tag, installer, checksums, signatures, provenance, and evidence unless a legal or security requirement demands restricted access.
4. Publish a short impact statement naming affected versions, affected data or workflows, and the safest immediate action. Do not speculate about unverified impact.

## Downgrade boundary

OpenSCAD source projects and user-selected project assets remain ordinary files and should be backed up before any install or downgrade. Beta.2 adds application-state, cache, library-manifest, history, and project-pin records that beta.1 does not understand. Do not promise in-place downgrade compatibility for those app-managed records. Users returning to beta.1 should uninstall beta.2, preserve project folders separately, and clear or archive beta.2 application state when directed by the incident notice.

## Forward repair

Fix the defect on a new commit and version. Run the complete release gate again: hosted CI, isolated similarity gate, one-hour literal soak, Radeon 780M profile, strict-zero review, exact signed-installer verification, and a clean Windows Sandbox install/update/uninstall walkthrough. Never replace beta.2 assets or move its tag in place.

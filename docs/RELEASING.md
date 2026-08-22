# Releasing

This describes how a version of RoonWishlist gets tagged and released. It is a
permanent process description — it should stay accurate regardless of which feature
happens to be in flight, per [`AGENTS.md`](../AGENTS.md)'s rule that in-repo docs
describe the software as it is, not the state of one branch.

## Versioning scheme

RoonWishlist uses [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`),
applied pragmatically for a single-maintainer personal extension rather than a
published library with a stable API contract:

- **MAJOR** — `1.0.0` was cut when the [v1.0 milestone](https://github.com/Zesseth/RoonWishlist/milestone/1)
  closed (see below). Afterwards it is reserved for any change that breaks an existing
  install in a way the user must act on (e.g. a renamed/removed environment variable
  or HTTP API endpoint with no fallback, a required manual migration step).
- **MINOR** — a new user-facing feature or acceptance-criteria set from a closed
  GitHub issue (e.g. nightly automation, configurable logging). Safe to update into
  without any manual step beyond the normal `install.sh`/`bootstrap.sh` re-run.
- **PATCH** — bug fixes, documentation, internal refactors, and dependency bumps with
  no behavior change a user would need to know about.

The single version number lives in **`package.json`** (`"version"`) and nowhere else —
`index.js` reads it from there (`require("./package.json").version`) for both the Roon
`display_version` and the `/status` HTTP response, so there is exactly one place to
change per release.

### What 1.0 meant

The [v1.0 milestone](https://github.com/Zesseth/RoonWishlist/milestone/1) was the
project's own definition of "feature-complete for a first real release" — see the epic
issue [#10](https://github.com/Zesseth/RoonWishlist/issues/10). It closed on
2026-08-21 and `v1.0.0` was tagged at that point; releases before it were `0.x.y`,
which SemVer treats as "anything may still change". Later work is planned under the
[v2.0 milestone](https://github.com/Zesseth/RoonWishlist/milestone/2), but a milestone
name is not a version promise: each release still takes the MAJOR/MINOR/PATCH it earns
under the scheme above.

## Release process

1. **Confirm `main` is what you want to release.** All work lands on `main` through a
   merged PR (see `AGENTS.md` — direct pushes to `main` are not allowed).
2. **Bump the version** in `package.json` (and `package-lock.json`'s top-level
   `version`/`packages[""].version` fields, which `npm version` keeps in sync
   automatically — see below). Decide MAJOR/MINOR/PATCH using the scheme above.
3. **Update `CHANGELOG.md`**: move the `[Unreleased]` section's contents under a new
   `## [x.y.z] - YYYY-MM-DD` heading, and start a fresh empty `[Unreleased]` section.
   Add the compare-link reference at the bottom (see existing entries for the format).
4. **Commit** the version bump + changelog together, e.g.:
   ```bash
   npm version patch -m "Release v%s"   # or: minor / major
   ```
   `npm version` updates `package.json`/`package-lock.json` and creates the commit +
   git tag (`vX.Y.Z`) in one step. If the changelog edit is not already staged, amend
   it into the same commit before tagging, or tag manually instead:
   ```bash
   git commit -am "Release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```
5. **Push the commit and the tag**:
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```
6. **Create the GitHub release** from the tag, with the changelog section for this
   version as the release notes:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '$d')
   ```
   (Or open the tag on GitHub's *Releases* page and paste the same section in by hand
   — simpler than the `sed` one-liner if you're not scripting it.)
7. **Verify an install/update actually picks it up**: on a spare machine or an
   `--instance test` install (see `README.md#running-a-second-instance`), re-run
   `bootstrap.sh`/`install.sh` (or `git pull && npm ci` manually) and confirm
   `GET /status` reports the new `version` and Roon's extension list shows it too.

There is no separate build/packaging step — `install.sh`/`bootstrap.sh` install
straight from a git checkout (`npm ci`), so "the release" *is* the tagged commit; there
is nothing further to compile or bundle.

## Extension Manager listing (optional, not yet done)

Some Roon extension authors additionally list their extension in
[The Appgineer's community Extension Manager repository](https://github.com/TheAppgineer/roon-extension-repository),
which lets users install/update extensions from inside Roon itself instead of a
terminal. This has been evaluated and deliberately **not** done for RoonWishlist:

- The Extension Manager repository's entries are written for **Docker-image-based**
  extensions (a `repo`/`tags` pair pointing at a published container image on a
  registry). RoonWishlist ships as a systemd-managed Node.js checkout, matching how
  it needs direct filesystem access to scan the user's music library — an install
  path the Extension Manager's model does not naturally cover without also
  maintaining and publishing a Docker image.
- `bootstrap.sh`/`install.sh` already give a one-line terminal install with the same
  end state (a running, self-updating systemd service), which is the actual goal this
  optional acceptance criterion was chasing.

If this changes (e.g. RoonWishlist gains a maintained Docker image for another
reason), revisit this section and the PR that submits the repository.json entry.

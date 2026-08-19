# Development Priority - RoonWishlist

> **Purpose:** Track what to work on next. This file complements GitHub Issues.
> **Update this** when starting new work or when priorities change.

---

## 🚀 High Priority (Do Next)

These are ready to implement and have clear acceptance criteria.

| # | Issue | Description | GitHub Label | Branch | Notes |
|---|-------|-------------|--------------|--------|-------|
| 24 | Add Qobuz location setting | Allow users to set Qobuz region for better search results | `P0` | - | Currently defaults to France |
| 25 | Remove "Add an album" from Web UI | Simplify UI - manage wishlist only via Roon tags | `P0` | `feat/ui-cleanup` | Combined with #26 |
| 26 | Rename UI sections | "Wishlist" & "Low-quality albums" with proper functionality | `P0` | `feat/ui-cleanup` | Combined with #25 |

**Next action:** Merge `feat/ui-cleanup` to main, then start #24

---

## ⚡ Medium Priority (After High Priority)

These need some design decisions or have dependencies.

| # | Issue | Description | GitHub Label | Depends On | Notes |
|---|-------|-------------|--------------|------------|-------|
| 2 | Nightly automation | Schedule store link refresh and low-quality scans | `P1` | - | User configurable in Settings |
| 1 | Roon library & browse integration | Add `node-roon-api-browse` for real Roon integration | `P1` | - | **Most significant unfinished piece** |
| 7 | CI (GitHub Actions) | Install + lint + tests on PRs | `P1` | #6 | Requires workflow scope |
| 6 | Unit tests | Tests for `search.js` and `lossless_checker.js` | `P1` | - | wishlist tests done |

---

## 📝 Low Priority / Backlog

Nice to have, but not critical for core functionality.

| # | Issue | Description | GitHub Label | Notes |
|---|-------|-------------|--------------|-------|
| 8 | Configuration & logging | Configurable port, log levels, env variables | `P2` | Currently hardcoded |
| 9 | Distribution & documentation | Install instructions, versioning, release process | `P2` | For extension manager |
| 4 | Harden data layer | Atomic writes, schema versioning, migrations | `P2` | Current atomic writes work |
| 11 | Tag wishlist albums in Roon | Keep Roon tags in sync with wishlist | `P2` | Depends on #1 |
| 3 | Harden search providers | Already using APIs, needs mocked HTTP tests | `P2` | See #6 |

---

## ✅ Recently Completed

| # | Issue | Description | Completed | Branch |
|---|-------|-------------|-----------|--------|
| 23 | Update testing.md documentation | Clean up and split testing docs | 2026-06-25 | main |
| 22 | Add low-quality scan to wishlist | Manual scan + web UI section | 2026-06-25 | feat/ui-cleanup |
| 20 | Import Wishlist-tagged albums | Sync Roon tags to wishlist | 2026-06-22 | main |
| 5 | Web UI for wishlist management | Initial UI implementation | 2026-06-22 | main |

---

## 🔄 In Progress / Branch Status

| Branch | Issue(s) | Status | PR |
|--------|----------|--------|-----|
| `feat/ui-cleanup` | #25, #26 | **Ready for review** | - |
| `main` | All merged | ✅ Current | - |

---

## 📊 GitHub Sync

**How this relates to GitHub:**
- All open issues are in GitHub: https://github.com/Zesseth/RoonWishlist/issues
- Use GitHub **Milestones** for release planning
- Use GitHub **Labels** for categorization (enhancement, bug, documentation, etc.)
- Use **Priority** labels (P0, P1, P2) if available

**Current GitHub Labels:**
- `documentation` - Documentation tasks
- `enhancement` - New features
- `testing` - Test-related tasks
- `ui` - User interface changes
- `cleanup` - Code cleanup

---

## 📊 GitHub Priority Labels

Use these labels in GitHub to track priority:

| Label | Color | Use For |
|-------|-------|---------|
| `P0` | 🔴 Red | **High Priority** - Do next |
| `P1` | 🟡 Orange | **Medium Priority** - After P0 |
| `P2` | 🟢 Green | **Low Priority** - Backlog |

**How to apply:**
```bash
# Add P0 label to issue #24
gh issue edit 24 --add-label P0

# Add P1 label to issue #2
gh issue edit 2 --add-label P1
```

---

## 🎯 Recommended Workflow

1. **Pick from High Priority** - Start with #24 (Qobuz location)
2. **Create feature branch** - `git checkout -b feat/[issue-number]-description`
3. **Reference the issue** - Link to GitHub issue in commit messages
4. **Update this file** - Move to In Progress, then to Completed
5. **Open PR** - For review before merging to main

---

## 🔗 Quick Links

- **GitHub Issues:** https://github.com/Zesseth/RoonWishlist/issues
- **Milestones:** https://github.com/Zesseth/RoonWishlist/milestones
- **Labels:** https://github.com/Zesseth/RoonWishlist/labels

---

*Last updated: 2026-06-25*

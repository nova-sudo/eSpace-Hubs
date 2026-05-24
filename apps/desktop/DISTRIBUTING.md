# Distributing the Companion

How releases get cut, signed, and shipped. The audience here is
whoever is on rotation for desktop-app releases.

## TL;DR — cut a release

```bash
cd apps/desktop
npm version patch        # or minor / major
git tag desktop-v$(node -p "require('./package.json').version")
git push --follow-tags
```

That tag push fires `.github/workflows/release-desktop.yml`, which
builds the installer on every OS, signs (when secrets are configured),
and uploads everything to a **draft** GitHub Release. Smoke-test on
each platform, then click *Publish*.

The moment the release is no longer a draft, every running companion
sees the new `latest{,-mac,-linux}.yml` on its next 6-hour polling
tick and starts downloading the diff. Users get a native restart
notification once it's ready.

## Versioning

* `package.json` version is the source of truth.
* Tag format **must** be `desktop-v<version>` exactly — the workflow
  trigger matches on that prefix.
* Don't reuse a version. electron-updater hashes the `latest.yml` and
  refuses to install the same version twice; if you ship a broken
  v1.2.0 you publish v1.2.1, not "v1.2.0 take two."

## Secrets — what to set and where

Settings → Secrets and variables → Actions, on the `nova-sudo/eSpaceDev`
repo. All optional — without them the build still completes, just
unsigned/un-notarized.

| Secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Base64 of your Authenticode `.pfx`, OR an `https://…` URL the runner can fetch from. |
| `WIN_CSC_KEY_PASSWORD` | Password protecting the `.pfx`. |
| `MAC_CSC_LINK` | Base64 of your Developer ID Application `.p12`. |
| `MAC_CSC_KEY_PASSWORD` | Password protecting the `.p12`. |
| `APPLE_ID` | Apple ID email the cert is tied to. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com — **not** your Apple-ID login password. |
| `APPLE_TEAM_ID` | 10-character team id from your Apple Developer account. |

The workflow file routes each secret to the right matrix job, so
`WIN_CSC_LINK` is only exposed to the Windows runner, etc.

## Acquiring the certificates

### Windows Authenticode

Buy from a CA that issues for individual developers (DigiCert, Sectigo,
SSL.com — usually $80–$300/yr for an OV cert; $300–$600/yr for an EV
cert). EV is what suppresses SmartScreen warnings entirely; OV warns
the first few thousand installs before "reputation" builds.

After purchase you get a `.pfx` (or `.p12`) file + a password:

```bash
# convert to base64 for the GitHub secret
base64 < your-cert.pfx | pbcopy   # macOS
certutil -encode your-cert.pfx out.b64   # Windows
```

Paste the base64 into `WIN_CSC_LINK`, the password into
`WIN_CSC_KEY_PASSWORD`.

> [!NOTE]
> Update `publisherName` in `apps/desktop/electron-builder.yml` to match
> the cert's **Common Name** exactly. A mismatch makes SmartScreen warn
> "unknown publisher" even though the signature is valid.

### macOS Developer ID + notarization

1. Sign up for Apple Developer ($99/yr).
2. From Apple Developer → Certificates, request a "Developer ID
   Application" certificate. Download as `.p12`.
3. Base64-encode and paste into `MAC_CSC_LINK`; password into
   `MAC_CSC_KEY_PASSWORD`.
4. Generate an app-specific password at <https://appleid.apple.com>.
   Paste into `APPLE_APP_SPECIFIC_PASSWORD`. Set `APPLE_ID` to the
   Apple ID email + `APPLE_TEAM_ID` to your 10-char team id.

electron-builder calls `xcrun notarytool` automatically when all three
Apple secrets are present.

### Linux

Nothing. AppImages don't sign in any common way; users execute the
file directly. SHA-512 hashes in `latest-linux.yml` keep
electron-updater's integrity check honest.

## Local dry-run

You can build (but not sign or publish) locally to validate the
manifest before pushing a tag:

```bash
cd apps/desktop
npm run dist            # Windows .exe only (matches the local OS)
# or
npm run dist:all        # cross-build all three (mac/win/linux) — may need extra tools per host
```

To validate the `electron-updater` codepath without involving a real
release: build, install the produced installer, bump the version,
build again, copy the output (including `latest.yml`) onto a local
web server, and set `apps/desktop/.env`:

```
APPIMAGE_URL=http://localhost:8000/
```

Then patch `auto-update.ts` to point at that URL. Out of scope for
this doc; ask whoever owns auto-update.

## Rollback

There's no "unship" button. If a release goes bad:

1. Publish a `desktop-v<next>` immediately that re-disables the broken
   code path. Auto-update picks it up.
2. For users already on the bad version who can't reach the network,
   keep the prior installer downloadable on the Release page — they
   can re-install over the bad version.

## What the workflow doesn't do

* Run tests. There are no desktop-app tests yet; add a `npm test` step
  before `npm run release` once we have a real test suite.
* Notify Slack / a channel on release. Add a final step if/when we
  want that.
* Stamp the `latest.yml` with anything beyond version + SHA-512. If we
  ever want phased rollouts we'll wire `stagingPercentage` from
  electron-updater.

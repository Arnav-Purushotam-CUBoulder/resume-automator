# Resume Automator

A Git-backed LaTeX resume management desktop app for macOS.

## What this app does

- Maintains a global component catalog for:
  - Header/location
  - Experience
  - Education
  - Skills
  - Projects
  - Open Source contributions
- Stores multiple resume variants with section-level composition and ordering.
- Supports resume-specific block overrides and point overrides (detached from future global edits).
- Generates LaTeX using your exact resume macro/style structure.
- Compiles changed resumes and keeps commit history for snapshots.
- Provides history browsing and historical PDF re-render.
- Syncs compiled PDFs to a user-configured folder (iCloud folder path supported).

## Stack

- Frontend: React + Vite + Monaco Editor
- Backend: Node.js + Express + TypeScript
- Desktop: Electron + electron-builder
- Versioning: Git CLI (backend-managed content repo)

## Development

```bash
npm install
npm run dev:backend
npm run dev:frontend
```

Backend API runs on `http://127.0.0.1:4100`.

## Desktop run

```bash
npm run desktop:dev
```

## Production build

```bash
npm run build
npm run desktop:build
```

Artifacts:

- `release/mac-arm64/Resume Automator.app`
- `release/Resume Automator-0.1.0-arm64.dmg`
- `release/Resume Automator-0.1.0-arm64-mac.zip`

## LaTeX compilation

The app uses existing, reliable tooling and does not implement a custom compiler.

Compile fallback order:

1. `latexmk`
2. `pdflatex`
3. Docker (`blang/latex:ctanfull`)

If none are available, compile endpoints return an actionable error.

## PDF sync (iCloud-ready)

In-app tab: `PDF Sync`

- Set your export directory path (for iCloud Drive this can be your iCloud folder path).
- On successful compile, changed resumes replace only their corresponding PDF file.
- Existing compiled PDFs are synced once when you save the folder path.

## Notes

- Runtime data is kept under `backend/storage` during local dev.
- In packaged Electron app, runtime storage is redirected to app user data.

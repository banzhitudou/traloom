# Traloom 0.2.3 security update

## Changes

- API keys are stored only when operating-system secure storage is available. There is no plaintext fallback. Unreadable legacy keys require re-entry.
- Changing a model endpoint or protocol cannot reuse a saved key. Model destinations require native, per-project authorization before keys or text are sent. HTTP is restricted to local/LAN services, and redirects are disabled.
- Existing project files are checked read-only for SQLite headers and required Traloom tables before replacing the active connection. Empty, unrelated and symlink files are rejected.
- External resources referenced by older projects require explicit native authorization. Automatic legacy document-directory scanning has been removed; embedded resources remain supported.
- IPC requests are restricted to the registered main window and its main frame. Model configuration, assignment, paragraph status and alignment inputs receive additional validation; model saves and alignment commits are transactional.
- The renderer now uses sandboxing, context isolation and a content security policy. External links are limited to HTTP/HTTPS. Release packages disable Node environment/inspection switches and require validated ASAR contents.
- Electron and build/test dependencies have been upgraded. The unused legacy XLSX dictionary importer and its vulnerable dependency have been removed. Existing stored dictionaries are not deleted.

## Compatibility and limitations

- Manuscript files and real translation projects are not migration/test targets. Existing project schemas and embedded resources are retained.
- On another computer, operating-system encrypted keys may need to be entered again. Portable project files should not be treated as portable credentials.
- Older external PDF references may show a permission prompt. Relinking the PDF embeds it in the project.
- This update does not provide Apple Developer ID signing or notarization.
- Production dependency audit: zero known vulnerabilities on 2026-10-08. The full development dependency audit still reports 15 findings (5 high, 10 moderate) in Tailwind/build-tool dependency chains. These are not claimed fixed; they require further compatible tooling work. Electron, though a development dependency, is shipped as the runtime and has been upgraded separately.

## Verification

- TypeScript checks and production compilation passed.
- 38 test files / 158 checks passed, including credential reuse, secure-storage failure, IPC frame authorization, malformed IDs and read-only project preflight.
- A synthetic legacy project opened and remained movable; an invalid-file open preserved the active connection and the invalid file contents. No real manuscript project was used.
- Electron 44.7.0 download completed and matched the official SHA-256: `e04e411b58a0a14375dd21b0ab4a378fd38930a702e4e20e322fee4849404c0b`.
- SQLite was rebuilt for Electron 44.7.0. Legacy-project opening/moving, project transfer, revision-history and PDF-recognition runtime tests all passed with this runtime.
- Sandboxed renderer, preload IPC, interface mounting, actual offline OCR recognition, PDF worker text extraction and nonblank canvas rendering passed on Electron 44.7.0.
- The Mac ARM64 app passed strict/deep ad-hoc signature verification. Release fuses were inspected; Node environment/inspection switches are disabled and ASAR validation is enabled. The ASAR archive contains no manuscript PDFs, DOCX files or translation project databases.
- The DMG passed CRC verification and read-only mount testing; the mounted app signature and version were checked. SHA-256: `ae15fc3f8aa63c501861b7a9611cbf8b30dfa02b02a90e50480efdf882e544ed`.
- The installed app was updated to 0.2.3 and the previously open project and PDF were visibly restored. The old app and a consistent read-only project snapshot are retained outside the source repository in the local install-backup directory.

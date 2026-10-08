# Traloom

English | [简体中文](README.md)

**AI-assisted translation, crafted by you.**

Traloom (pronounced tra-LOOM) is a local desktop workspace for translating books with a PDF reference, paragraph editing, terminology checks, notes, revision history, and bilingual exports. Its name combines translation and loom: AI offers references; the translator shapes the final text.

## Features

- Start a project from a PDF, using its text layer or bundled offline OCR.
- Edit translations alongside the PDF; adjust regions and reorder, merge, or split paragraphs.
- Maintain terminology manually and review inconsistent translations across a book.
- Preview replacements and apply them individually or in batches.
- Track untranslated, pending review, uncertain, and approved paragraphs.
- Keep paragraph notes, project notes, and revision history.
- Configure your own model provider and 1–5 named translation reference profiles with custom instructions.
- Export DOCX tables or paragraph layouts, and HTML with original, Chinese, and bilingual views.
- Move newly created projects as a single `.twproj` file containing the PDF and project data.

## Status And Limitations

This is an early version, primarily verified on Apple Silicon macOS. The interface is primarily Simplified Chinese. Windows build configuration exists, but release packages need separate validation. No official download has been published yet.

The bundled OCR model currently supports English only. Other languages can be extracted from PDFs with a text layer. Complex layouts, OCR results, and AI output require human review.

## Quick Start

Use Node.js 22 or a newer supported version, and npm. SQLite native modules are rebuilt for Electron during installation; some platforms require local compilation tools.

```sh
npm ci
npm run dev
```

Create a project and select a PDF. A project file is created next to the PDF without overwriting it. Review recognized paragraphs and edit translations. AI features are optional: configure your provider and reference profiles in Settings before using them.

Development uses the separate `translation-workbench-dev` application data directory. Open a copy when testing existing projects.

```sh
npm test
npm run typecheck
npm run build
```

Tests generate their own fixtures and do not require a real manuscript.

## Packaging

```sh
npm run build:mac
npm run build:win
```

On Apple Silicon macOS, `npm run package:mac:local` builds an ad-hoc-signed local application under `dist/local/`. Public distribution still requires platform testing, signing, and notarization where applicable.

## Project Data And Privacy

Project data is stored locally. AI features send relevant text and context to the model provider you configure. Provider fees and data policies apply; local storage does not make every feature offline.

New `.twproj` files embed the PDF and project resources. Older projects can still reference external files and may need their PDF relinked. To back up manually, quit the application first, then copy the project file. Keep external PDFs for legacy projects that still depend on them. There are no automatic backups.

Projects can contain copyrighted books, private translations, notes, and model configuration. Never publish them or API keys in the source repository. The software license does not license user content.

For compatibility, Traloom retains the existing application identifier, `translation-workbench` installed data directory, and `.twproj` extension.

## Contributing And License

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [release checklist](docs/release-preparation.md).

Software is licensed under [MIT](LICENSE). Bundled dictionaries, OCR resources, and dependencies retain their own notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

# Traloom

English | [简体中文](README.md)

**From a PDF to a Chinese manuscript ready for editorial handoff.**

Traloom is an open-source, AI-assisted desktop translation workspace. Keep the original PDF, your translation, terminology, notes, and review progress together, so you can spend more time on the text and less time moving it between apps.

Built for translating books, magazines, illustrated publications, and technical manuals into Simplified Chinese. Translate by hand, ask AI for alternatives, or combine both. **You choose the wording. You approve the result.**

[Download Mac preview](https://github.com/banzhitudou/traloom/releases) · [Try a demo PDF](docs/demo-pdfs.md) · [Features](#more-than-generating-a-translation) · [Run from source](#run-from-source) · [Report an issue](https://github.com/banzhitudou/traloom/issues)

> Early development. This page describes the current source tree; published installers may not include every feature yet. Primarily verified on Apple Silicon macOS. The interface is mainly Simplified Chinese, and translation output currently targets Simplified Chinese. AI vision recognition and whole-page segmentation are experimental.

## One PDF, One Connected Workflow

**Choose a PDF → Check the source → Translate and refine → Unify terminology → Review → Export**

Start with just a PDF. You do not need to prepare a termbase, extracted text, or supporting documents first. A project file is created next to the PDF without overwriting it. Add terminology as you work, and configure AI later if you need it.

## English and Japanese: Recognition Support

**Traloom is not Japanese-only. Bundled offline OCR supports both English and Japanese. Horizontal English remains the default.**

| Recognition method | Current scope | Model service required? |
| --- | --- | --- |
| Bundled English OCR | Horizontal printed English, using `eng`; the default option | No, runs locally |
| Bundled Japanese OCR | Horizontal printed Japanese with `jpn`, or vertical Japanese with `jpn_vert`; select the matching direction | No, runs locally |
| PDF text-layer extraction | Reads existing PDF text rather than performing OCR; depends on font encoding, text-layer quality, and layout | No, runs locally |
| AI vision recognition (experimental) | English, Japanese, and other language support depends on the configured image-capable model; no universal language or accuracy guarantee | Yes, uploads selected images and may incur fees |

Local OCR models for other scanned languages are not bundled. Page rotation is not vertical-English OCR support. Mixed Japanese layouts, ruby text, handwriting, and blurry scans need review. These are **source-recognition capabilities**, not interface or translation-language settings: the interface is mainly Simplified Chinese, and AI translation currently targets Simplified Chinese.

## More Than Generating a Translation

### Translate with the original page in view

Which illustration does a caption refer to? Is a phrase a heading, body text, or a note in the margin?

Work beside the PDF and see the regions associated with each paragraph. Add missed regions, adjust recognition bounds, and reorder, merge, or split paragraphs when the initial extraction needs correction.

- Navigate by PDF page, book page, or paragraph number.
- Use spread views, page rotation, and zoom while checking the source.
- Extract PDF text where available, with bundled offline OCR for English and horizontal or vertical Japanese.

Review OCR carefully, especially numbers, units, small print, ruby text, and complex layouts. Bundled OCR does not support every language.

### Give AI your instructions, not a fixed house style

Different publications call for different voices. Save **1–5 named translation reference profiles**, each with its own instructions, and request the number of alternatives you need.

- Inspect and edit the default instructions, or restore their built-in settings.
- No fixed reader age or genre is assumed.
- Connect a compatible model service of your choice; assign different models to reference generation, line-break cleanup, and vision recognition.
- Matched project terminology is included in reference-generation instructions.

**AI is optional.** Source review, manual translation, terminology, review states, and export do not require a model. AI models are not bundled with the application.

### Try a few paragraphs before processing a book

Run line-break cleanup and draft translation independently from **Project → Batch processing**. Choose an eligible range, try ten paragraphs or another sample size, or select representative passages.

- Review trial results before adopting them or continuing with the remaining paragraphs.
- Choose a saved reference profile for draft translation. Adopted drafts are marked for review, not automatically approved.
- Existing translations are skipped by default; writes check for intervening manual changes.
- Pause and resume work with task records stored in the project. Interrupted requests with unknown results are not retried automatically.
- Restore initial recognized source text individually or by range where a usable baseline exists. Merged paragraphs and other unsupported cases are skipped; this is not a universal undo function.

Trials call your model provider and may cost money. Line-break cleanup works within paragraphs; it does not merge or reorder the book's paragraphs.

### Keep terminology consistent without flattening every exception

Find places that may need attention after a book has already been translated, not just while writing its first draft.

- Build a project glossary manually, with categories for names, places, technical terms, and more.
- See source occurrence counts and filter entries with translations that do not use the standard term.
- Review highlighted source terms and identifiable old translations before individual or batch replacement.
- Edit a glossary entry directly from the consistency-check workflow.
- Accept a context-specific translation when it is intentional.
- Prefer phrases over component words, with support for some regular English plural forms.

Consistency checks flag passages for human review. They do not determine translation quality, and old-translation highlighting cannot identify every possible phrasing.

### Separate written, reviewed, and approved

Track **untranslated, pending review, uncertain, and approved** paragraphs. Filter by state and continue working through that queue.

Everyday translation edits are saved automatically. Keep paragraph notes, project notes, and revision history with the manuscript, and search source and translation text when you need to find a passage again.

### Hand off something an editor or designer can use

**DOCX for reading and editing**

- Side-by-side tables or a paragraph layout without tables.
- Alternating source and Chinese paragraphs in bilingual paragraph output.
- A locator column for paragraph IDs and book pages in table output.
- Page-range export, optional notes, a delivery version number, and project details such as book titles and translator name when supplied.

**HTML for page-based review and layout handoff**

- Open the exported file in a browser without installing Traloom.
- Switch between Chinese, source, and bilingual views.
- Turn pages with the arrow keys, search, jump by page, fit the page or width, and zoom independently.
- Collapse the comparison sidebar to give the page more room.
- Click a translated block to copy its text; use paragraph IDs and page references to locate it.
- Export only the pages and notes needed for the handoff.

HTML is a reading and handoff preview, not a press-ready publication. It does not promise exact layout reproduction or a native desktop-publishing project.

### Take the project with you

New **`.twproj` files** embed the original PDF, recognition resources, translations, terminology, notes, and revision history. Move the file and reopen it to continue.

Projects stay on your computer. For a manual backup, quit the app before copying the project file. Legacy projects may still depend on external PDFs, and API keys may need to be entered again on another computer.

## How It Differs from Established CAT Tools

CAT means computer-assisted translation. Established tools have substantial experience in translation-memory reuse, many file formats, and team localization workflows. Traloom takes a narrower approach: **a connected personal workflow around a PDF, from checking the original page to handing off a Chinese manuscript.**

| Your immediate task | Traloom's focus |
| --- | --- |
| Start with only an original PDF | One PDF-based project entry point; build supporting material as you go |
| Check context in illustrated pages | Link PDF regions, paragraph IDs, book pages, and translations |
| Use language models without a fixed writing style | Choose your provider and reference instructions; retain editorial control |
| Unify terminology after drafting a book | Consistency review, replacement previews, accepted exceptions, and review states |
| Share source and translation with an editor or designer | Bilingual DOCX and navigable HTML with copyable text |

This compares workflow priorities, not exclusive features or product benchmarks. Traloom **does not currently provide a full translation-memory system, TMX/XLIFF exchange, or real-time multi-user collaboration**. It is not presented as a replacement for mature CAT systems where those capabilities are required. [Background on translation memory](https://joint-research-centre.ec.europa.eu/language-technology-resources/dgt-translation-memory_en).

## Experimental AI Vision Recognition

Use an image-capable model for difficult regions, or open **Project → AI whole-page recognition and segmentation (experimental)** for page-level text, bounding boxes, and reading-order previews.

Select a page range or a small trial, then inspect and edit the preview. **Pages with existing paragraphs are comparison-only and cannot be overwritten or re-segmented.** Empty, unrecognized pages require explicit per-page adoption.

Missing text, wrong characters, inaccurate boxes, and incorrect reading order remain possible. Do not adopt a whole book without checking it. Selected region or page images are uploaded to your configured service and may incur fees. See the [vision guide](docs/vision-ocr.md).

## Get Started

1. Download a Mac preview from [Releases](https://github.com/banzhitudou/traloom/releases), or run the source below.
2. Create a project from a PDF and check the recognized paragraphs and regions.
3. Translate manually, or configure a model and reference profiles in Settings.
4. Try a small batch, refine the wording, check terminology, and review.
5. Export the required page range as DOCX or HTML.

The [demo guide](docs/demo-pdfs.md) links to original demonstration PDFs with single pages, spreads, rotated text, and image-only notes. They contain no private manuscript, project, or model credentials.

Mac preview installers are ad-hoc signed, not Apple Developer ID signed or notarized. macOS security or Keychain prompts may appear. Windows build configuration exists, but release packages still require separate validation.

## Local Storage Is Not Offline AI

- **Open-source software; separate provider costs.** Code is MIT-licensed. Model pricing and data policies depend on your provider.
- **Manual work and bundled OCR can run offline.** AI features transmit the relevant source, context, terminology, or images to your configured service.
- **Projects are private working material.** They may contain an entire copyrighted book, unpublished translations, and personal notes. Do not publish projects or API keys in a public repository.
- **Auto-save is not backup.** Back up manually; the application does not create scheduled backup copies.
- **Content rights remain separate.** The software license does not grant rights to imported books, images, or other materials.

## Run from Source

Use Node.js 22.12 or a newer supported version, preferably Node.js 24 LTS, and npm. Installation rebuilds SQLite native modules for Electron; some platforms need local compilation tools.

```sh
npm ci
npm run dev
```

Development uses a separate `translation-workbench-dev` application-data directory. Open a copy when testing an existing project.

```sh
npm test
npm run typecheck
npm run build
```

Tests use synthetic fixtures, not real manuscripts. Packaging:

```sh
npm run build:mac
npm run build:win
```

On Apple Silicon macOS, `npm run package:mac:local` creates an ad-hoc-signed local test app under `dist/local/`. Public distribution still needs platform validation, signing, and notarization where applicable.

For compatibility, Traloom retains its original application identifier, installed `translation-workbench` data directory, and `.twproj` extension.

## Learn More and Contribute

[Batch processing](docs/batch-processing.md) · [Japanese OCR](docs/japanese-ocr.md) · [Vision recognition](docs/vision-ocr.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Release checklist](docs/release-preparation.md)

Feedback, workflow suggestions, and contributions are welcome. Use self-made examples and remove private content, keys, and personal information before sharing screenshots or projects.

Pronounced **tra-LOOM**, the name combines translation and loom: AI offers references; the translator crafts the final text.

Software: [MIT](LICENSE). Dictionaries, OCR models, and other bundled resources retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

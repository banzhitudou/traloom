# AI vision OCR

AI vision OCR is opt-in and separate from offline OCR. Assign an image-capable
model in Settings > model assignments. The software cannot infer capability
from a model name; use the generated test image before sending manuscript images.

- PDF region editing: AI vision recognition produces editable text for review.
  Confirm the region edit to save. Paragraph identity and translation are preserved.
- Batch processing: choose AI vision recognition and a range or a small trial.
  Paragraphs with translations or without usable coordinates are skipped.
  Every result requires explicit adoption. Source or coordinate changes invalidate
  stale candidates. Pause/close prevents the next paragraph request; an in-flight
  paragraph may finish and incur fees.
- Each run asks permission before sending cropped images to the configured server.
  Offline OCR never falls back to a paid model automatically.
- Images and generation evidence are embedded in the portable project. They may
  increase project size. API credentials and base64 images are not copied into
  generation metadata; image resources are referenced by hash.
- Original recognition recovery remains available. Review numbers, units, vertical
  reading order and unreadable characters before adoption. A vision model can
  hallucinate. The application rejects malformed or truncated JSON output.

## Whole-page recognition and segmentation (experimental)

Choose AI whole-page recognition when creating a project, or open it from the
project menu. It never starts uploading automatically. Select a PDF page range
and a small trial before confirming the destination, model and possible charges.
Each approval covers at most 50 pages. The per-run output limit defaults to 8192
tokens and does not change the stored model configuration.

Full-page images are limited to a 4096-pixel edge and 8 megapixels. Results include
an equal-size coordinate guide overlay to help localization. The model is told
not to transcribe guide labels, and out-of-page coordinates remain rejected.
Original PDF files are never changed. Preview candidates include
text, bounding boxes, block types and reading order. Review and edit these in the
preview before explicitly adopting each page. Complex tables are not reconstructed.
Layout instructions follow content regions and their columns, keeping product
labels and parameters together rather than sorting the whole page by text rows.
Nearby PDF text geometry can refine bounds when at least 95% of a block's text
matches; incomplete, garbled or distant matches leave the model's box unchanged.
This local calibration never replaces recognized text or changes reading order.
The preview reports the number of calibrated bounds. Re-recognizing a page asks
for fresh upload consent and preserves the previous candidate for comparison.
Pages with existing paragraphs or recognition records are comparison-only: they
cannot be overwritten, even if the preview is edited. Only empty, unrecognized
pages can be adopted, and their source snapshot is checked again before writing.

Candidates and image evidence travel with the portable project. Local recognition
is paused while using this workflow. Closing or pausing prevents subsequent
requests; an in-flight request may still incur charges. Interrupted requests are
marked as failed on reopening, never retried automatically. Invalid or truncated
output is retained as failure evidence and cannot be adopted.

OpenAI-compatible Chat Completions, Responses and Anthropic Messages image inputs
are supported; provider-specific document OCR endpoints are not yet supported.

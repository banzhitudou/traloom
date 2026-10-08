# Third-party resources

## ECDICT

`src/main/assets/ecdict-core.json` is a reduced dictionary generated from ECDICT. The local build script is `scripts/build-core-dictionary.py`. Upstream: https://github.com/skywind3000/ECDICT

The accompanying upstream notice is retained in `src/main/assets/ECDICT-LICENSE.md` and included in application builds. It identifies an MIT license and its copyright holder. Preserve that notice when distributing the dictionary.

## Offline OCR

`resources/ocr` contains Tesseract.js 7 worker code, Tesseract.js-core builds, and the English LSTM integer language model from `@tesseract.js-data/eng@1.0.0/4.0.0_best_int`. These resources are bundled for offline recognition. Copyright and Apache-2.0 notices are retained alongside the resources. Sources: https://github.com/naptha/tesseract.js and https://github.com/tesseract-ocr/tessdata_best.

## Packages

Exact dependency versions are recorded in `package-lock.json`. Packages retain their individual licenses. Before public distribution, review the complete production dependency inventory, including bundled runtimes and native modules.

No privately imported name/place dictionaries, book manuscripts, project databases, or book illustrations are supplied as application resources.

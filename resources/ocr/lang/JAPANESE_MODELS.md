# Japanese OCR model provenance

Source: https://github.com/tesseract-ocr/tessdata_fast

Downloaded from the official repository on 2026-10-14. The models retain the Apache-2.0 license in this directory's LICENSE file. These are LSTM-only fast models, used with engine mode 1. Gzip compression changes the resource container, not the trained model.

| Model | Uncompressed SHA-256 | Bundled gzip SHA-256 |
| --- | --- | --- |
| jpn | 1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d | 89315ab939cfc4d8e67ad52983933619098e4112009919412b3b4709de8d35e6 |
| jpn_vert | bf1e2640954691797e2dc14f38533e601b59ee37958698ae0f0b81dc6f09c71b | ad87494089701227a5d90279917eba3d003ce48682dda4e545f7e49b5de8ecb8 |

Files: `jpn.traineddata.gz` for horizontal Japanese and `jpn_vert.traineddata.gz` for vertical Japanese. English remains the default for existing projects.

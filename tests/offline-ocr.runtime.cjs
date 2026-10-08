const assert = require('assert/strict');
const path = require('path');
const { createWorker } = require('tesseract.js');
(async () => {
  const worker = await createWorker('eng', 1, { langPath: path.resolve('resources/ocr/lang'), cacheMethod: 'none' });
  try {
    const result = await worker.recognize(path.resolve('tests/fixtures/ocr-garden.png'));
    assert.match(result.data.text, /A small garden/i);
    console.log('Offline English OCR model recognizes synthetic image without downloading assets.');
  } finally { await worker.terminate(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

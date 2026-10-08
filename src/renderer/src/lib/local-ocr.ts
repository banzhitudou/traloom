import { createWorker, type LoggerMessage } from 'tesseract.js'

export function createLocalOcr(logger?: (message: LoggerMessage) => void) {
  return createWorker('eng', 1, {
    workerPath: 'workbench-ocr://local/worker.min.js',
    corePath: 'workbench-ocr://local/core',
    langPath: 'workbench-ocr://local/lang',
    gzip: true,
    logger
  })
}

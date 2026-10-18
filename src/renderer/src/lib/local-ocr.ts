import { createWorker, type LoggerMessage } from 'tesseract.js'
import { DEFAULT_OCR, ocrModel, validateOcrSettings, type OcrSettings } from '@shared/ocr-settings'

export function createLocalOcr(logger?: (message: LoggerMessage) => void, settings: OcrSettings = DEFAULT_OCR) {
  return createWorker(ocrModel(validateOcrSettings(settings)), 1, {
    workerPath: 'workbench-ocr://local/worker.min.js',
    corePath: 'workbench-ocr://local/core',
    langPath: 'workbench-ocr://local/lang',
    gzip: true,
    logger
  })
}

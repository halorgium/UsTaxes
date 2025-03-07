import { PDFDocument } from 'pdf-lib'
import { create1040 } from '../irsForms/Main'
import { Either, isLeft, isRight, right } from 'ustaxes/core/util'
import log from 'ustaxes/core/log'
import { combinePdfs, PDFDownloader } from 'ustaxes/core/pdfFiller/pdfHandler'
import { Information } from 'ustaxes/core/data'
import { insertFormDataToPdfs } from 'ustaxes/core/irsForms'
import { F1040Error } from 'ustaxes/forms/errors'

export { create1040 }

export const create1040PDFs =
  (state: Information) =>
  async (
    downloader: PDFDownloader
  ): Promise<Either<F1040Error[], PDFDocument[]>> => {
    if (state.taxPayer !== undefined) {
      const f1040Result = create1040(state)
      // Get data and pdf links applicable to the model state
      if (isLeft(f1040Result)) {
        return Promise.reject(f1040Result)
      }

      const [, forms] = f1040Result.right

      return right(await insertFormDataToPdfs(forms, downloader))
    }

    log.error('Attempt to create pdf with no data, will be empty')
    return right([])
  }

export const create1040PDF =
  (state: Information) =>
  async (
    downloader: PDFDownloader
  ): Promise<Either<F1040Error[], Uint8Array>> => {
    const pdfResult = await create1040PDFs(state)(downloader)
    if (isRight(pdfResult)) {
      const pdf = await combinePdfs(pdfResult.right)
      const bytes = await pdf.save()
      return right(bytes)
    } else {
      return Promise.resolve(pdfResult)
    }
  }

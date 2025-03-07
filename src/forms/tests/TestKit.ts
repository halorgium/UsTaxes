/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import fc, { Parameters } from 'fast-check'
import { Information } from 'ustaxes/core/data'
import Form from 'ustaxes/core/irsForms/Form'
import { run } from 'ustaxes/core/util'
import * as arbitraries from 'ustaxes/core/tests/arbitraries'
import { localPDFs } from 'ustaxes/core/tests/LocalForms'
import fs from 'fs/promises'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { insertFormDataToPdfs } from 'ustaxes/core/irsForms'
import { TaxYear, TaxYears } from 'ustaxes/data'
import { CreateForms, yearFormBuilder } from '../YearForms'
import { PDFDownloader } from 'ustaxes/core/pdfFiller/pdfHandler'

const logsDir = path.resolve(__dirname, '../../../logs/errors')

export default class TestKit {
  year: TaxYear
  downloader: PDFDownloader
  arbitaries: arbitraries.Arbitraries
  builder: CreateForms
  constructor(year: TaxYear) {
    this.year = year
    this.downloader = localPDFs(year)
    this.arbitaries = new arbitraries.Arbitraries(TaxYears[year])
    this.builder = yearFormBuilder(year).setDownloader(this.downloader)
  }

  /**
   * This is used when there is some error generated in a test
   * The calculated forms will be used to generate a return and
   * saved to the /logs directory in the project root.
   */
  log1040 = async (info: Information, logstr?: string): Promise<void> => {
    try {
      const builder = this.builder.build(info)
      const pdfs = await builder.f1040Pdfs()
      const saveDirName = `Errors ${new Date().getUTCHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}`
      const saveDir = path.resolve(logsDir, saveDirName)
      await fs.mkdir(saveDir, { recursive: true })
      await run(pdfs).fold(
        (e: string[]) =>
          fs.writeFile(path.resolve(saveDir, 'failure.txt'), e.join('\n')),
        (pdfs) =>
          Promise.all(
            pdfs.map(async (pdf, i) => {
              fs.writeFile(
                path.resolve(saveDir, pdf.getTitle() ?? `Form ${i}`),
                await pdf.save()
              )
            })
          )
      )
      await fs.writeFile(
        path.resolve(saveDir, 'info.json'),
        JSON.stringify(info, null, 2)
      )
      if (logstr !== undefined) {
        await fs.writeFile(
          path.resolve(saveDir, 'error.txt'),
          logstr?.toString()
        )
      }
    } catch (e) {
      console.info('Got another error trying to log testing error')
      console.error(e)
      console.error('Giving up!')
      throw e
    }
  }

  /**
   * Run a property test on generated PDFs
   * **Must** be awaited
   */
  with1040Pdfs = async (
    f: (pdfs: PDFDocument[], info: Information) => void,
    params: Parameters<[Information]> = {
      // This might take a long time as many pdfs have to be rendered
      // So by default just run for 1 minute max and hope
      interruptAfterTimeLimit: 60 * 1000
    }
  ): Promise<void> =>
    await this.with1040Assert(async (forms, info) => {
      const pdfs = await insertFormDataToPdfs(forms, this.downloader)
      f(pdfs, info)
    }, params)

  with1040Property = (
    f: (forms: Form[], info: Information) => Promise<void>
  ): fc.IAsyncPropertyWithHooks<[Information]> =>
    fc.asyncProperty(
      this.arbitaries.information(),
      async (information): Promise<void> => {
        const builder = this.builder.build(information)
        await run(builder.f1040()).fold(
          async (e: string[]): Promise<void> => {
            expect(e).not.toEqual([])
          },
          (forms: Form[]): Promise<void> => {
            return f(forms, information)
          }
        )
      }
    )

  /**
   * Run a property test on 1040 data.
   * Must** be awaited.
   */
  with1040Assert = async (
    f: (forms: Form[], info: Information) => Promise<void>,
    params: Parameters<[Information]> = {}
  ): Promise<void> => {
    let lastCallWithInfo: Information | undefined
    await fc
      .assert(
        this.with1040Property(async (forms, info) => {
          await f(forms, info).catch((e) => {
            // Save the last failing test info for logging
            lastCallWithInfo = info
            // Hand it back to fc's assert.
            // We're only saving the last form data after
            // fast-check has done its shrinking. So we need
            // fast-check to catch this exception and decide
            // whether to run it again.
            throw e
          })
        }),
        params
      )
      .catch(async (e) => {
        console.error('Trying to log errors.')
        if (lastCallWithInfo !== undefined) {
          await this.log1040(lastCallWithInfo, e)
        } else {
          console.error('trying to log error but no info is available')
        }
        throw e
      })
  }
}

interface Access<A, B> {
  [k: string]: A | (() => B)
}

export const showForm = (f: Access<unknown, number>): string => {
  return Object.keys(f)
    .filter((k) => k.startsWith('l'))
    .map((k) => {
      if (typeof f[k] === 'function') {
        return `${k}=${(f[k] as () => number)()}`
      }
    })
    .join('\n')
}

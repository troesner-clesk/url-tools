import { defineEventHandler } from 'h3'
import { toHttpError } from '../../../crawler/api-helpers'
import { listCrawls } from '../../../crawler/queries'

export default defineEventHandler(() => {
  try {
    return { crawls: listCrawls() }
  } catch (error) {
    throw toHttpError(error)
  }
})

import { defineEventHandler } from 'h3'
import { ISSUE_CATALOG } from '../../crawler/catalog'

/** All checks of the Site Audit with explanations (same data as in each crawl file). */
export default defineEventHandler(() => ({ issues: ISSUE_CATALOG }))

import { defineEventHandler } from 'h3'
import { crawlIdParam } from '../../../../crawler/api-helpers'
import {
  type CrawlLogEntry,
  type CrawlProgress,
  getCrawlJob,
} from '../../../../crawler/engine'
import { listCrawls } from '../../../../crawler/queries'

/**
 * Server-Sent Events for a running crawl: `progress`, `log` and a final
 * `done`. Works with a plain EventSource. For finished crawls it sends
 * `done` right away.
 */
export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (name: string, data: unknown) => {
    if (!res.writableEnded)
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const job = getCrawlJob(crawlId)
  if (!job?.isRunning) {
    const summary = listCrawls().find((crawl) => crawl.crawlId === crawlId)
    send('done', job?.progress ?? summary ?? { crawlId, status: 'unknown' })
    res.end()
    return
  }

  for (const entry of job.recentLogs.slice(-50)) send('log', entry)
  send('progress', job.progress)

  const onProgress = (progress: CrawlProgress) => send('progress', progress)
  const onLog = (entry: CrawlLogEntry) => send('log', entry)
  const onDone = (progress: CrawlProgress) => {
    send('done', progress)
    cleanup()
    res.end()
  }
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n')
  }, 15_000)
  const cleanup = () => {
    clearInterval(keepAlive)
    job.off('progress', onProgress)
    job.off('log', onLog)
    job.off('done', onDone)
  }
  job.on('progress', onProgress)
  job.on('log', onLog)
  job.on('done', onDone)
  res.on('close', cleanup)
  // Keep the handler pending; the response is ended by onDone or the client.
  return new Promise<void>((resolve) => res.on('close', () => resolve()))
})

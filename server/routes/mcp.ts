import {
  defineEventHandler,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import { handleMcpMessage, RPC_ERRORS, rpcError } from '../mcp/protocol'

/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses):
 *   claude mcp add --transport http url-tools http://localhost:3000/mcp
 * Host/Origin are checked by server/middleware/local-guard.ts.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    setResponseStatus(event, 405)
    setResponseHeader(event, 'Allow', 'POST')
    return {
      error:
        'This MCP endpoint is stateless: send JSON-RPC messages with POST. No SSE stream is offered.',
    }
  }

  let message: unknown
  try {
    message = JSON.parse((await readRawBody(event, 'utf8')) ?? '')
  } catch {
    setResponseHeader(event, 'Content-Type', 'application/json')
    return rpcError(null, RPC_ERRORS.parse, 'Parse error')
  }

  const responses = Array.isArray(message)
    ? (await Promise.all(message.map((m) => handleMcpMessage(m)))).filter(
        (r) => r !== null,
      )
    : [await handleMcpMessage(message)].filter((r) => r !== null)

  if (responses.length === 0) {
    setResponseStatus(event, 202)
    event.node.res.end()
    return
  }
  setResponseHeader(event, 'Content-Type', 'application/json')
  return Array.isArray(message) ? responses : responses[0]
})

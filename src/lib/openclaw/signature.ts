import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedHeaders {
  workerId: string
  timestamp: string
  nonce: string
  signature: string
}

function canonicalPayload(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: string,
) {
  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  return [timestamp, nonce, method.toUpperCase(), path, bodyHash].join('\n')
}

export function signRequest(args: {
  workerId: string
  secret: string
  timestamp: number
  nonce: string
  method: string
  path: string
  rawBody: string
}): SignedHeaders {
  const timestamp = String(args.timestamp)
  const signature = createHmac('sha256', args.secret)
    .update(canonicalPayload(timestamp, args.nonce, args.method, args.path, args.rawBody))
    .digest('hex')
  return { workerId: args.workerId, timestamp, nonce: args.nonce, signature: `sha256=${signature}` }
}

export function verifyRequest(args: {
  headers: SignedHeaders
  secret: string
  nowSeconds: number
  method: string
  path: string
  rawBody: string
  toleranceSeconds?: number
}): boolean {
  const timestamp = Number(args.headers.timestamp)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(args.nowSeconds - timestamp) > (args.toleranceSeconds ?? 300)) return false
  const presented = args.headers.signature.replace(/^sha256=/, '').toLowerCase()
  const expected = createHmac('sha256', args.secret)
    .update(
      canonicalPayload(
        args.headers.timestamp,
        args.headers.nonce,
        args.method,
        args.path,
        args.rawBody,
      ),
    )
    .digest('hex')
  if (presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
}

export function signedHeadersToHttp(headers: SignedHeaders): Record<string, string> {
  return {
    'X-WACRM-Worker-Id': headers.workerId,
    'X-WACRM-Timestamp': headers.timestamp,
    'X-WACRM-Nonce': headers.nonce,
    'X-WACRM-Signature': headers.signature,
  }
}

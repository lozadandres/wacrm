import { randomUUID } from 'node:crypto'
import { buildSignatureHeader, verifySignatureHeader } from '@/lib/webhooks/sign'
import type { CommercialAgentRequest, CommercialAgentResponse } from './types'
import { parseCommercialAgentResponse } from './validate'

export function commercialAgentConfigured() {
  return Boolean(process.env.OPENCLAW_COMMERCIAL_WEBHOOK_URL && process.env.OPENCLAW_COMMERCIAL_SECRET)
}

export async function callCommercialAgent(
  payload: CommercialAgentRequest,
): Promise<CommercialAgentResponse> {
  const url = process.env.OPENCLAW_COMMERCIAL_WEBHOOK_URL
  const secret = process.env.OPENCLAW_COMMERCIAL_SECRET
  if (!url || !secret) throw new Error('OpenClaw commercial agent is not configured')

  const rawBody = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Signature': buildSignatureHeader(rawBody, secret, timestamp),
        'X-Wacrm-Request-Id': randomUUID(),
      },
      body: rawBody,
      signal: controller.signal,
    })
    const responseText = await response.text()
    if (!response.ok) throw new Error(`OpenClaw returned HTTP ${response.status}`)
    const responseSignature = response.headers.get('x-wacrm-signature')
    if (
      !responseSignature ||
      !verifySignatureHeader(
        responseSignature,
        responseText,
        secret,
        Math.floor(Date.now() / 1000),
      )
    ) {
      throw new Error('OpenClaw response signature is invalid')
    }
    return parseCommercialAgentResponse(JSON.parse(responseText))
  } finally {
    clearTimeout(timer)
  }
}

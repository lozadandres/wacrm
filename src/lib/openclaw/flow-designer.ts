import { randomUUID } from 'node:crypto'
import { buildSignatureHeader, verifySignatureHeader } from '@/lib/webhooks/sign'

export interface FlowProposal {
  schema_version: '1.0'
  name: string
  description: string
  trigger: Record<string, unknown>
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  assumptions: string[]
  risks: string[]
}

export async function requestFlowProposal(payload: Record<string, unknown>): Promise<FlowProposal> {
  const url = process.env.OPENCLAW_FLOW_DESIGNER_WEBHOOK_URL
  const secret = process.env.OPENCLAW_FLOW_DESIGNER_SECRET
  if (!url || !secret) throw new Error('OpenClaw flow designer is not configured')
  const rawBody = JSON.stringify(payload)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Signature': buildSignatureHeader(rawBody, secret, Math.floor(Date.now() / 1000)),
        'X-Wacrm-Request-Id': randomUUID(),
      },
      body: rawBody,
      signal: controller.signal,
    })
    const responseText = await response.text()
    const responseSignature = response.headers.get('x-wacrm-signature')
    if (!response.ok) throw new Error(`Flow designer returned HTTP ${response.status}`)
    if (!responseSignature || !verifySignatureHeader(
      responseSignature, responseText, secret, Math.floor(Date.now() / 1000),
    )) throw new Error('Flow designer response signature is invalid')
    const parsed = JSON.parse(responseText) as Partial<FlowProposal>
    if (
      parsed.schema_version !== '1.0' || typeof parsed.name !== 'string' ||
      !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) ||
      !parsed.trigger || typeof parsed.trigger !== 'object'
    ) throw new Error('Flow proposal failed schema validation')
    return parsed as FlowProposal
  } finally {
    clearTimeout(timer)
  }
}

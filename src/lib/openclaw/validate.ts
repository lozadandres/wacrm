import type { CommercialAgentResponse, WorkerResult } from './types'

const STAGE_CODES = new Set([
  'NEW_LEAD', 'IN_CONVERSATION', 'MISSING_DATA', 'ADDRESS_VALIDATION',
  'WAITING_CONFIRMATION', 'CUSTOMER_CONFIRMED', 'HUMAN_REVIEW',
])

export function parseCommercialAgentResponse(value: unknown): CommercialAgentResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid agent response')
  const row = value as Record<string, unknown>
  const reply = row.reply as Record<string, unknown> | undefined
  if (row.schema_version !== '1.0' || !reply || typeof reply.text !== 'string') {
    throw new Error('Agent response is missing schema_version or reply.text')
  }
  if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1) {
    throw new Error('Agent confidence must be between 0 and 1')
  }
  if (!Array.isArray(row.requested_actions) || !Array.isArray(row.missing_fields)) {
    throw new Error('Agent response actions/fields must be arrays')
  }
  for (const action of row.requested_actions as Array<Record<string, unknown>>) {
    if (action.type === 'REQUEST_STAGE_CHANGE' && !STAGE_CODES.has(String(action.target))) {
      throw new Error('Agent requested an unknown stage')
    }
    if (!['REQUEST_STAGE_CHANGE', 'REQUEST_HUMAN_HANDOFF'].includes(String(action.type))) {
      throw new Error('Agent requested an unsupported action')
    }
  }
  return value as CommercialAgentResponse
}

export function parseWorkerResult(value: unknown): WorkerResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid worker result')
  const row = value as Record<string, unknown>
  if (
    row.schema_version !== '1.0' ||
    typeof row.job_id !== 'string' ||
    !['succeeded', 'failure'].includes(String(row.status)) ||
    typeof row.observed_at !== 'string'
  ) {
    throw new Error('Worker result failed schema validation')
  }
  if (row.status === 'succeeded') {
    const dropi = row.dropi as Record<string, unknown> | undefined
    if (!dropi || typeof dropi.order_reference !== 'string') {
      throw new Error('Successful result requires a Dropi order reference')
    }
  } else if (typeof row.error_code !== 'string') {
    throw new Error('Failed result requires error_code')
  }
  return value as WorkerResult
}

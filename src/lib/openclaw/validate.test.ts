import { describe, expect, it } from 'vitest'
import { parseCommercialAgentResponse, parseWorkerResult } from './validate'

describe('OpenClaw response validation', () => {
  it('accepts a bounded commercial response', () => {
    expect(parseCommercialAgentResponse({
      schema_version: '1.0',
      reply: { text: '¿Confirmas tu pedido?', message_type: 'free_form' },
      intent: 'REQUEST_CONFIRMATION', extracted_data: {}, missing_fields: [],
      requested_actions: [{ type: 'REQUEST_STAGE_CHANGE', target: 'WAITING_CONFIRMATION' }],
      confidence: 0.97, requires_human_review: false,
    }).confidence).toBe(0.97)
  })

  it('rejects unknown stages and incomplete worker successes', () => {
    expect(() => parseCommercialAgentResponse({
      schema_version: '1.0', reply: { text: 'x' }, intent: 'x', extracted_data: {},
      missing_fields: [], requested_actions: [{ type: 'REQUEST_STAGE_CHANGE', target: 'PAID' }],
      confidence: 1, requires_human_review: false,
    })).toThrow(/unknown stage/)
    expect(() => parseWorkerResult({
      schema_version: '1.0', job_id: 'job', status: 'succeeded', observed_at: new Date().toISOString(),
    })).toThrow(/Dropi order reference/)
  })
})

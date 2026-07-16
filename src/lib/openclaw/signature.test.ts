import { describe, expect, it } from 'vitest'
import { signRequest, verifyRequest } from './signature'

describe('OpenClaw request signatures', () => {
  const input = {
    workerId: 'dropi-01', secret: 'test-secret', timestamp: 1_700_000_000,
    nonce: 'nonce-1', method: 'POST', path: '/api/jobs/lease', rawBody: '{"a":1}',
  }

  it('accepts an authentic request', () => {
    const headers = signRequest(input)
    expect(verifyRequest({
      headers, secret: input.secret, nowSeconds: input.timestamp,
      method: input.method, path: input.path, rawBody: input.rawBody,
    })).toBe(true)
  })

  it('rejects tampering and expired timestamps', () => {
    const headers = signRequest(input)
    expect(verifyRequest({
      headers, secret: input.secret, nowSeconds: input.timestamp,
      method: input.method, path: input.path, rawBody: '{}',
    })).toBe(false)
    expect(verifyRequest({
      headers, secret: input.secret, nowSeconds: input.timestamp + 301,
      method: input.method, path: input.path, rawBody: input.rawBody,
    })).toBe(false)
  })
})

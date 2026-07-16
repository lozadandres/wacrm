import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { verifyRequest, type SignedHeaders } from './signature'

export interface WorkerContext {
  id: string
  workerKey: string
  accountId: string
  capabilities: string[]
}

export async function authenticateWorkerRequest(
  request: Request,
  rawBody: string,
): Promise<WorkerContext> {
  const secret = process.env.OPENCLAW_WORKER_SECRET
  if (!secret) throw new WorkerAuthError('Worker integration is not configured', 503)
  const headers: SignedHeaders = {
    workerId: request.headers.get('x-wacrm-worker-id') ?? '',
    timestamp: request.headers.get('x-wacrm-timestamp') ?? '',
    nonce: request.headers.get('x-wacrm-nonce') ?? '',
    signature: request.headers.get('x-wacrm-signature') ?? '',
  }
  if (!headers.workerId || !headers.nonce || !verifyRequest({
    headers,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
    method: request.method,
    path: new URL(request.url).pathname,
    rawBody,
  })) {
    throw new WorkerAuthError('Invalid worker signature', 401)
  }

  const db = supabaseAdmin()
  const { error: nonceError } = await db.from('integration_nonces').insert({
    nonce: headers.nonce,
    worker_key: headers.workerId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (nonceError) throw new WorkerAuthError('Request nonce was already used', 409)

  const { data: worker } = await db
    .from('integration_workers')
    .select('id, worker_key, account_id, capabilities')
    .eq('worker_key', headers.workerId)
    .eq('is_active', true)
    .maybeSingle()
  if (!worker) throw new WorkerAuthError('Unknown or disabled worker', 401)
  return {
    id: worker.id,
    workerKey: worker.worker_key,
    accountId: worker.account_id,
    capabilities: worker.capabilities ?? [],
  }
}

export class WorkerAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function workerErrorResponse(error: unknown) {
  if (error instanceof WorkerAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('[openclaw worker]', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

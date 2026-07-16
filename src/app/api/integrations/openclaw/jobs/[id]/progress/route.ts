import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { authenticateWorkerRequest, workerErrorResponse } from '@/lib/openclaw/worker-auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawBody = await request.text()
  try {
    const worker = await authenticateWorkerRequest(request, rawBody)
    const { id } = await params
    const body = JSON.parse(rawBody) as {
      status?: 'running' | 'awaiting_approval'
      message?: string
      metadata?: Record<string, unknown>
    }
    if (!body.status || !['running', 'awaiting_approval'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid progress status' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { data: current } = await db.from('integration_jobs')
      .select('status').eq('id', id).eq('account_id', worker.accountId)
      .eq('leased_by', worker.id).maybeSingle()
    if (!current || !['leased', 'running', 'awaiting_approval'].includes(current.status)) {
      return NextResponse.json({ error: 'Job is not active for this worker' }, { status: 409 })
    }
    await db.from('integration_jobs').update({
      status: body.status,
      last_heartbeat_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    }).eq('id', id)
    await db.from('integration_job_events').insert({
      account_id: worker.accountId,
      job_id: id,
      event_type: 'progress',
      previous_status: current.status,
      new_status: body.status,
      message: body.message ?? null,
      metadata: body.metadata ?? {},
      actor_type: 'worker',
      actor_id: worker.workerKey,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return workerErrorResponse(error)
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawBody = ''
  try {
    const worker = await authenticateWorkerRequest(request, rawBody)
    const { id } = await params
    const { data: job } = await supabaseAdmin().from('integration_jobs')
      .select('id, status, result, error_code').eq('id', id)
      .eq('account_id', worker.accountId).eq('leased_by', worker.id).maybeSingle()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json({ job })
  } catch (error) {
    return workerErrorResponse(error)
  }
}

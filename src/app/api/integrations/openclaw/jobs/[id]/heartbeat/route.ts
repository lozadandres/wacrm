import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { authenticateWorkerRequest, workerErrorResponse } from '@/lib/openclaw/worker-auth'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawBody = await request.text()
  try {
    const worker = await authenticateWorkerRequest(request, rawBody)
    const { id } = await params
    const db = supabaseAdmin()
    const now = new Date()
    const { data: job, error } = await db
      .from('integration_jobs')
      .update({
        status: 'running',
        last_heartbeat_at: now.toISOString(),
        lease_expires_at: new Date(now.getTime() + 120_000).toISOString(),
      })
      .eq('id', id)
      .eq('account_id', worker.accountId)
      .eq('leased_by', worker.id)
      .in('status', ['leased', 'running'])
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!job) return NextResponse.json({ error: 'Job not leased by this worker' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return workerErrorResponse(error)
  }
}

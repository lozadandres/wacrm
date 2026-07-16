import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { authenticateWorkerRequest, workerErrorResponse } from '@/lib/openclaw/worker-auth'

export async function POST(request: Request) {
  const rawBody = await request.text()
  try {
    const worker = await authenticateWorkerRequest(request, rawBody)
    const parsed = rawBody ? JSON.parse(rawBody) as { lease_seconds?: number } : {}
    const leaseSeconds = Math.min(Math.max(Number(parsed.lease_seconds) || 120, 30), 900)
    const { data, error } = await supabaseAdmin().rpc('lease_next_integration_job', {
      p_worker_id: worker.id,
      p_lease_seconds: leaseSeconds,
    })
    if (error) throw error
    return NextResponse.json({ job: data?.[0] ?? null })
  } catch (error) {
    return workerErrorResponse(error)
  }
}

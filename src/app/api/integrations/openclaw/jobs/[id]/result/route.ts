import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { authenticateWorkerRequest, workerErrorResponse } from '@/lib/openclaw/worker-auth'
import { parseWorkerResult } from '@/lib/openclaw/validate'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawBody = await request.text()
  try {
    const worker = await authenticateWorkerRequest(request, rawBody)
    const { id } = await params
    const result = parseWorkerResult(JSON.parse(rawBody))
    if (result.job_id !== id) {
      return NextResponse.json({ error: 'job_id does not match route' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { data: current } = await db
      .from('integration_jobs')
      .select('id, account_id, deal_id, status, attempt_count, max_attempts')
      .eq('id', id)
      .eq('account_id', worker.accountId)
      .eq('leased_by', worker.id)
      .maybeSingle()
    if (!current) return NextResponse.json({ error: 'Job not found or not owned' }, { status: 404 })
    if (['succeeded', 'permanent_error', 'cancelled'].includes(current.status)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const succeeded = result.status === 'succeeded'
    const nextStatus = succeeded
      ? 'succeeded'
      : result.retryable && current.attempt_count < current.max_attempts
        ? 'retryable_error'
        : 'permanent_error'
    const { error } = await db.from('integration_jobs').update({
      status: nextStatus,
      result,
      completed_at: succeeded || nextStatus === 'permanent_error' ? new Date().toISOString() : null,
      error_code: result.error_code ?? null,
      error_message: result.message ?? null,
      lease_expires_at: null,
    }).eq('id', id)
    if (error) throw error

    await db.from('integration_job_events').insert({
      account_id: worker.accountId,
      job_id: id,
      event_type: succeeded ? 'completed' : 'failed',
      previous_status: current.status,
      new_status: nextStatus,
      message: result.message ?? null,
      metadata: result,
      actor_type: 'worker',
      actor_id: worker.workerKey,
    })
    if (current.deal_id) await updateDealFromResult(db, current.deal_id, result)
    return NextResponse.json({ ok: true, status: nextStatus })
  } catch (error) {
    return workerErrorResponse(error)
  }
}

async function updateDealFromResult(
  db: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  result: ReturnType<typeof parseWorkerResult>,
) {
  const targetName = result.status === 'succeeded'
    ? result.dropi?.tracking_number ? 'Guía generada' : 'Pedido creado'
    : result.human_action_required ? 'Novedad logística' : null
  if (!targetName) return
  const { data: deal } = await db.from('deals').select('pipeline_id').eq('id', dealId).maybeSingle()
  if (!deal) return
  const { data: stage } = await db.from('pipeline_stages')
    .select('id').eq('pipeline_id', deal.pipeline_id).eq('name', targetName).maybeSingle()
  if (stage) await db.from('deals').update({ stage_id: stage.id }).eq('id', dealId)
}

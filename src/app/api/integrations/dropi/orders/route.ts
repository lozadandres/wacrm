import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const REQUIRED_ORDER_FIELDS = [
  'customer_name', 'phone_e164', 'department', 'city', 'address',
  'product_reference', 'quantity', 'cod_amount',
] as const

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null) as {
      deal_id?: string
      customer_confirmed?: boolean
      requires_human_approval?: boolean
    } | null
    if (!body?.deal_id || body.customer_confirmed !== true) {
      return NextResponse.json(
        { error: 'deal_id and explicit customer_confirmed=true are required' },
        { status: 400 },
      )
    }
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, pipeline_id, stage_id, status, agent_extracted_data, stage:pipeline_stages(name)')
      .eq('id', body.deal_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (dealError) throw dealError
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    const stage = deal.stage as unknown as { name?: string } | null
    if (stage?.name !== 'Confirmado por cliente') {
      return NextResponse.json({ error: 'Deal must be confirmed by the customer first' }, { status: 409 })
    }
    const order = (deal.agent_extracted_data ?? {}) as Record<string, unknown>
    const missing = REQUIRED_ORDER_FIELDS.filter((field) => {
      const value = order[field]
      return value === null || value === undefined || value === ''
    })
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Order data is incomplete', missing_fields: missing }, { status: 422 })
    }
    const normalized = {
      schema_version: '1.0',
      order: { internal_order_id: deal.id, ...order },
      automation: {
        requires_human_approval: body.requires_human_approval !== false,
        max_attempts: 3,
      },
    }
    const idempotencyKey = createHash('sha256')
      .update(JSON.stringify([accountId, deal.id, normalized.order]))
      .digest('hex')
    const { data: job, error } = await supabase.from('integration_jobs').insert({
      account_id: accountId,
      deal_id: deal.id,
      job_type: 'CREATE_DROPI_ORDER',
      payload: normalized,
      idempotency_key: idempotencyKey,
      created_by_user_id: userId,
    }).select('id, status').single()
    if (error?.code === '23505') {
      const { data: existing } = await supabase.from('integration_jobs')
        .select('id, status').eq('account_id', accountId)
        .eq('idempotency_key', idempotencyKey).single()
      return NextResponse.json({ job: existing, duplicate: true })
    }
    if (error) throw error
    const { data: queueStage } = await supabase.from('pipeline_stages')
      .select('id').eq('pipeline_id', deal.pipeline_id).eq('name', 'En cola para Dropi').maybeSingle()
    if (queueStage) await supabase.from('deals').update({ stage_id: queueStage.id }).eq('id', deal.id)
    await supabase.from('integration_job_events').insert({
      account_id: accountId,
      job_id: job.id,
      event_type: 'created',
      new_status: 'pending',
      actor_type: 'user',
      actor_id: userId,
    })
    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

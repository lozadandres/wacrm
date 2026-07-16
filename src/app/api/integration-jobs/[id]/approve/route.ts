import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null) as { approved?: boolean; reason?: string } | null
    if (typeof body?.approved !== 'boolean') {
      return NextResponse.json({ error: 'approved boolean is required' }, { status: 400 })
    }
    const { data: current } = await supabase.from('integration_jobs')
      .select('status, result').eq('id', id).eq('account_id', accountId).maybeSingle()
    if (!current) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (current.status !== 'awaiting_approval') {
      return NextResponse.json({ error: 'Job is not awaiting approval' }, { status: 409 })
    }
    const nextStatus = body.approved ? 'running' : 'cancelled'
    await supabase.from('integration_jobs').update({
      status: nextStatus,
      result: { ...(current.result ?? {}), human_approval: body.approved, approval_reason: body.reason },
      completed_at: body.approved ? null : new Date().toISOString(),
    }).eq('id', id)
    await supabase.from('integration_job_events').insert({
      account_id: accountId,
      job_id: id,
      event_type: body.approved ? 'approved' : 'rejected',
      previous_status: current.status,
      new_status: nextStatus,
      message: body.reason ?? null,
      actor_type: 'user',
      actor_id: userId,
    })
    return NextResponse.json({ ok: true, status: nextStatus })
  } catch (error) {
    return toErrorResponse(error)
  }
}

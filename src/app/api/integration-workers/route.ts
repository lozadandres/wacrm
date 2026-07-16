import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const CAPABILITIES = new Set([
  'CREATE_DROPI_ORDER', 'VERIFY_DROPI_ORDER', 'SYNC_DROPI_ORDER_STATUS',
  'FETCH_DROPI_TRACKING', 'RECONCILE_DROPI_ORDERS',
])

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase.from('integration_workers')
      .select('id, worker_key, name, capabilities, is_active, last_seen_at, created_at')
      .eq('account_id', accountId).order('created_at')
    if (error) throw error
    return NextResponse.json({ workers: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null) as {
      worker_key?: string
      name?: string
      capabilities?: string[]
    } | null
    const workerKey = body?.worker_key?.trim() ?? ''
    const name = body?.name?.trim() ?? ''
    const capabilities = body?.capabilities ?? []
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(workerKey) || !name) {
      return NextResponse.json({ error: 'Valid worker_key and name are required' }, { status: 400 })
    }
    if (capabilities.length === 0 || capabilities.some((item) => !CAPABILITIES.has(item))) {
      return NextResponse.json({ error: 'Invalid worker capabilities' }, { status: 400 })
    }
    const { data, error } = await supabase.from('integration_workers').insert({
      account_id: accountId,
      worker_key: workerKey,
      name,
      capabilities,
    }).select('id, worker_key, name, capabilities, is_active').single()
    if (error) throw error
    return NextResponse.json({ worker: data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

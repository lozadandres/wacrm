import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase.from('integration_jobs')
      .select('id, deal_id, job_type, status, attempt_count, error_code, error_message, created_at, updated_at')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(100)
    if (error) throw error
    return NextResponse.json({ jobs: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

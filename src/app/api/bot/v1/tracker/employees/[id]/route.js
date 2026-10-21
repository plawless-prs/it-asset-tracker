// Bot API — one employee (read-only). [id] = employee uuid.
//   GET (assets:read) the employee + the assets currently assigned to them.
// See docs/bot-api.md.
import { requireBotScope, botJson, botFail } from '../../../../../../../lib/botAuth'
import { cleanId, isUuid } from '../../../../../../../lib/botHelpdesk'
import { ASSET_LIST_COLUMNS, EMPLOYEE_COLUMNS, shapeAsset, shapeEmployee } from '../../../../../../../lib/botTracker'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'assets:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const id = cleanId(rawId)
  if (!isUuid(id)) return botFail(auth, req, 400, 'invalid_param', 'Employee id must be a uuid.', { id })

  const [emp, assets] = await Promise.all([
    admin.from('employees').select(EMPLOYEE_COLUMNS).eq('id', id).maybeSingle(),
    admin.from('assets').select(ASSET_LIST_COLUMNS).eq('assigned_employee_id', id).order('id', { ascending: true }),
  ])
  const failed = [emp, assets].find(r => r.error)
  if (failed) {
    console.error('bot employee detail:', failed.error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load employee.', { id })
  }
  if (!emp.data) return botFail(auth, req, 404, 'not_found', 'Employee not found.', { id })

  return botJson(auth, req, {
    data: { employee: shapeEmployee(emp.data), assets: (assets.data || []).map(shapeAsset) },
  }, { count: 1, params: { id } })
}

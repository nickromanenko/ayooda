import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const dashboardLayout = readFileSync(join(root, 'app/dashboard/layout.tsx'), 'utf8')
const adminLayout = readFileSync(join(root, 'app/admin/layout.tsx'), 'utf8')
const sidebar = readFileSync(join(root, 'components/dashboard/Sidebar.tsx'), 'utf8')
const proxy = readFileSync(join(root, 'proxy.ts'), 'utf8')
const users = readFileSync(join(root, 'app/admin/users/page.tsx'), 'utf8')
const workspaces = readFileSync(join(root, 'app/admin/workspaces/page.tsx'), 'utf8')

test('platform administration is separate from workspace roles and server guarded', () => {
  assert.match(adminLayout, /verifySessionCookie\(sessionCookie, true\)/)
  assert.match(adminLayout, /platformRole !== 'admin'/)
  assert.match(proxy, /\/admin\/:path\*/)
  assert.match(dashboardLayout, /isPlatformAdmin=\{platformRole === 'admin'\}/)
})

test('only administrators receive the workspace-to-admin navigation link', () => {
  assert.match(sidebar, /isPlatformAdmin && renderLink\(\{ label: 'Admin'/)
  assert.match(sidebar, /isPlatformAdmin && <Link href="\/admin"/)
})

test('admin directories are bounded, searchable, filterable, and paginated', () => {
  assert.match(users, /limit: '25'/)
  assert.match(users, /Name, email, or exact UID/)
  assert.match(users, /Load more/)
  assert.match(workspaces, /limit: '25'/)
  assert.match(workspaces, /Workspace name or exact ID/)
  assert.match(workspaces, /All subscriptions/)
})

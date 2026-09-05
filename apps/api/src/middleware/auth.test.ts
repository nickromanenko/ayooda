import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { AuthVariables } from './auth'
import { requirePlatformAdmin } from './auth'

describe('requirePlatformAdmin', () => {
  function appFor(platformRole?: 'admin') {
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', async (c, next) => {
      c.set('platformRole', platformRole)
      await next()
    })
    app.get('/', requirePlatformAdmin, (c) => c.json({ ok: true }))
    return app
  }

  test('allows a platform administrator', async () => {
    const response = await appFor('admin').request('/')
    expect(response.status).toBe(200)
  })

  test('rejects a normal workspace user', async () => {
    const response = await appFor().request('/')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Platform administrator access required' })
  })
})

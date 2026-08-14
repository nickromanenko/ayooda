import { Hono } from 'hono'
import { runSweep, secretMatches } from '../lib/skills/sweep'

const internal = new Hono()

/** POST /internal/sweep — called by Cloud Scheduler. Not part of the public API. */
internal.post('/sweep', async (c) => {
  if (!secretMatches(c.req.header('x-sweep-secret') ?? '', process.env.SWEEP_SECRET ?? '')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json(await runSweep())
})

export default internal

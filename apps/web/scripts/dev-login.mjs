#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'
import nextEnv from '@next/env'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

nextEnv.loadEnvConfig(process.cwd())

if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  throw new Error('Development login is disabled in production.')
}

const args = process.argv.slice(2)
const printOnly = args.includes('--print')
const destinationArg = args.find((arg) => arg.startsWith('--from='))
const identity = args.find((arg) => !arg.startsWith('--')) ?? process.env.DEV_AUTH_USER
const destination = destinationArg?.slice('--from='.length) || '/dashboard'

if (!identity) {
  console.error('Usage: pnpm dev:login -- <email-or-uid> [--from=/dashboard/...] [--print]')
  console.error('You can also set DEV_AUTH_USER in apps/web/.env.local.')
  process.exit(1)
}

if (!destination.startsWith('/') || destination.startsWith('//')) {
  throw new Error('--from must be an app-relative path beginning with a single slash.')
}

const appUrl = new URL(process.env.DEV_APP_URL ?? 'http://localhost:3000')
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
if (appUrl.protocol !== 'http:' || !localHosts.has(appUrl.hostname)) {
  throw new Error('DEV_APP_URL must use http://localhost, http://127.0.0.1, or http://[::1].')
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured.')

if (getApps().length === 0) {
  const options = { projectId }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    options.credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
  }
  initializeApp(options)
}

const adminAuth = getAuth()
const user = identity.includes('@')
  ? await adminAuth.getUserByEmail(identity)
  : await adminAuth.getUser(identity)
const customToken = await adminAuth.createCustomToken(user.uid, { localDevLogin: true })

const loginUrl = new URL('/login', appUrl)
loginUrl.hash = new URLSearchParams({ devToken: customToken, from: destination }).toString()

if (printOnly) {
  console.log(loginUrl.toString())
  console.error('This URL is a short-lived login credential. Do not share it.')
  process.exit(0)
}

const opener = process.platform === 'darwin'
  ? { command: 'open', args: [loginUrl.toString()] }
  : process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'start', '', loginUrl.toString()] }
    : { command: 'xdg-open', args: [loginUrl.toString()] }

const child = spawn(opener.command, opener.args, { detached: true, stdio: 'ignore' })
child.once('error', (error) => {
  console.error(`Could not open the browser: ${error.message}`)
  console.error('Run the command again with --print and open the URL manually.')
  process.exitCode = 1
})
child.once('spawn', () => {
  child.unref()
  console.log(`Opened a local development session for ${user.email ?? user.uid}.`)
})

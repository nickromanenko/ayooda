import type { Metadata } from 'next'
import Link from 'next/link'
import { ResourceCTA, ResourcePage, resourceStyles } from '@/components/marketing/ResourcePage'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'Authenticated widget visitors — Ayooda',
  description: 'Securely identify signed-in customers in the Ayooda support widget using short-lived server-signed JWTs.',
}

const serverExample = `import { SignJWT } from 'jose'

// This endpoint must require your normal application authentication.
export async function createAyoodaIdentityToken(user) {
  const secret = new TextEncoder().encode(
    process.env.AYOODA_IDENTITY_SECRET
  )

  return new SignJWT({
    name: user.name,       // optional
    email: user.email,     // optional
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)   // required: stable ID in your system
    .setAudience('ayooda-widget:YOUR_CHANNEL_ID')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret)
}

// Example endpoint response. Replace this with your auth framework.
export async function GET(request: Request) {
  const user = await requireAuthenticatedUser(request)
  const identityToken = await createAyoodaIdentityToken(user)
  return Response.json({ identityToken })
}

// Never accept a user ID from the request body and sign it directly.`

const htmlExample = `<script>
  // Queue commands while the async widget bundle is loading.
  window.Ayooda = window.Ayooda || function (...args) {
    (window.Ayooda.q = window.Ayooda.q || []).push(args)
  }

  fetch('/api/ayooda-identity', { credentials: 'include' })
    .then(response => {
      if (!response.ok) throw new Error('Could not load widget identity')
      return response.json()
    })
    .then(({ identityToken }) => {
      window.Ayooda('boot', { identityToken })
    })
</script>
<script
  src="https://cdn.ayooda.live/widget.js"
  data-agent-id="YOUR_CHANNEL_ID"
  async
></script>`

const nextInstallExample = `// app/layout.tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return <html><body>
    {children}
    <Script id="ayooda-queue" strategy="beforeInteractive">{
      \`window.Ayooda=window.Ayooda||function(...args){
        (window.Ayooda.q=window.Ayooda.q||[]).push(args)
      }\`
    }</Script>
    <Script
      src="https://cdn.ayooda.live/widget.js"
      data-agent-id="YOUR_CHANNEL_ID"
      strategy="afterInteractive"
    />
  </body></html>
}`

const nextExample = `// app/components/AyoodaIdentity.tsx
'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    Ayooda?: (...args: unknown[]) => void
  }
}

export function AyoodaIdentity({ userId }: { userId: string }) {
  useEffect(() => {
    let active = true

    fetch('/api/ayooda-identity')
      .then(response => {
        if (!response.ok) throw new Error('Could not load widget identity')
        return response.json()
      })
      .then(({ identityToken }) => {
        if (active) window.Ayooda?.('boot', { identityToken })
      })
      .catch(error => console.error('[Ayooda]', error))

    return () => {
      active = false
      window.Ayooda?.('shutdown')
    }
  }, [userId])

  return null
}`

const angularInstallExample = `<!-- src/index.html, before </body> -->
<script>
  window.Ayooda = window.Ayooda || function (...args) {
    (window.Ayooda.q = window.Ayooda.q || []).push(args)
  }
</script>
<script
  src="https://cdn.ayooda.live/widget.js"
  data-agent-id="YOUR_CHANNEL_ID"
  async
></script>`

const angularExample = `// ayooda-identity.service.ts
import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'

declare global {
  interface Window { Ayooda?: (...args: unknown[]) => void }
}

@Injectable({ providedIn: 'root' })
export class AyoodaIdentityService {
  constructor(private http: HttpClient) {}

  boot() {
    this.http.get<{ identityToken: string }>('/api/ayooda-identity')
      .subscribe(({ identityToken }) =>
        window.Ayooda?.('boot', { identityToken })
      )
  }

  update(identityToken: string) {
    window.Ayooda?.('update', { identityToken })
  }

  shutdown() {
    window.Ayooda?.('shutdown')
  }
}`

function Code({ children }: { children: string }) {
  return <pre className={styles.code}><code>{children}</code></pre>
}

export default function WidgetIdentityGuidePage() {
  return (
    <ResourcePage
      eyebrow="Widget identity"
      title="Recognize signed-in customers securely."
      lede="Connect your application’s authenticated users to Ayooda without exposing a signing secret or trusting identity data supplied by the browser."
    >
      <nav className={styles.toc} aria-label="On this page">
        <strong>On this page</strong>
        <div>
          <a href="#how-it-works">How it works</a>
          <a href="#token">Create a token</a>
          <a href="#browser">Initialize the widget</a>
          <a href="#frameworks">Framework examples</a>
          <a href="#lifecycle">Lifecycle</a>
          <a href="#checklist">Production checklist</a>
          <a href="#troubleshooting">Troubleshooting</a>
        </div>
      </nav>

      <section className={resourceStyles.grid} aria-label="Identity benefits">
        {[
          ['Trusted identity', 'Name, email, and customer ID are accepted only after a valid server signature.'],
          ['Conversation continuity', 'The same customer can continue their latest conversation in another browser or on another device.'],
          ['Guest compatible', 'Allow guests alongside signed-in customers, or require authentication for every conversation.'],
          ['Safe logout', 'A shutdown command revokes the browser session and clears the customer conversation from the widget.'],
        ].map(([title, body]) => <article key={title} className={resourceStyles.card}><div className={resourceStyles.cardTop}><h2 className={resourceStyles.cardTitle}>{title}</h2></div><p className={resourceStyles.cardBody}>{body}</p></article>)}
      </section>

      <section id="how-it-works" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>How it works</h2>
        <ol className={resourceStyles.steps}>
          <li className={resourceStyles.step}><div><strong>Enable authenticated visitors</strong><span>Open the agent’s Deploy page, enable identity verification, and copy the signing secret. Only workspace owners can manage this secret.</span></div></li>
          <li className={resourceStyles.step}><div><strong>Sign identity on your server</strong><span>After your application authenticates a user, issue a short-lived HS256 JWT. The secret must never be sent to the browser.</span></div></li>
          <li className={resourceStyles.step}><div><strong>Boot the widget with the JWT</strong><span>The widget exchanges the JWT for an opaque 24-hour browser session. The original JWT is not used for chat requests.</span></div></li>
          <li className={resourceStyles.step}><div><strong>Shut down on logout</strong><span>Call the shutdown command before completing logout, especially on shared devices.</span></div></li>
        </ol>
        <aside className={styles.warning}><strong>Never sign tokens in frontend code.</strong><span>Anyone who can read the signing secret can impersonate any customer. Keep it in a server-side secret manager or environment variable.</span></aside>
      </section>

      <section id="token" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Create the identity token</h2>
        <p className={styles.copy}>Install <code>jose</code> on your server, then create an authenticated endpoint in your application that returns <code>{`{ "identityToken": "…" }`}</code> for the currently signed-in user. Generate a fresh token on each authenticated page load or login.</p>
        <Code>{serverExample}</Code>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Field</th><th>Required</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td><code>alg</code></td><td>Yes</td><td><code>HS256</code></td></tr>
              <tr><td><code>sub</code></td><td>Yes</td><td>A stable customer ID from your system. Do not use a changing session ID.</td></tr>
              <tr><td><code>aud</code></td><td>Yes</td><td><code>ayooda-widget:YOUR_CHANNEL_ID</code></td></tr>
              <tr><td><code>iat</code></td><td>Yes</td><td>Issued-at time as a Unix timestamp.</td></tr>
              <tr><td><code>exp</code></td><td>Yes</td><td>Expiry as a Unix timestamp, no more than 15 minutes after <code>iat</code>.</td></tr>
              <tr><td><code>name</code></td><td>No</td><td>Customer display name, up to 120 characters.</td></tr>
              <tr><td><code>email</code></td><td>No</td><td>A valid customer email address.</td></tr>
            </tbody>
          </table>
        </div>
        <p className={styles.note}>Use the exact channel ID shown in the agent’s Deploy page. Tokens signed for one widget cannot be used with another widget.</p>
      </section>

      <section id="browser" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Initialize the browser widget</h2>
        <p className={styles.copy}>Install the queue before requesting the token. This makes initialization reliable whether the async widget bundle finishes loading before or after your authentication request.</p>
        <Code>{htmlExample}</Code>
        <p className={styles.note}>Your <code>/api/ayooda-identity</code> endpoint must use your existing application session and must not accept an arbitrary user ID from the request body.</p>
      </section>

      <section id="frameworks" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Single-page applications</h2>
        <p className={styles.copy}>Load <code>widget.js</code> once in the root layout. Do not load a new script tag after every route change.</p>
        <details className={styles.details} open><summary>Next.js App Router</summary><div><p>Add the queue and widget script once in <code>app/layout.tsx</code>.</p><Code>{nextInstallExample}</Code><p className={styles.codeLead}>Mount this client component beside your authentication provider so it changes only when the signed-in user changes.</p><Code>{nextExample}</Code></div></details>
        <details className={styles.details}><summary>Angular</summary><div><p>Add the queue and widget script once to <code>src/index.html</code>.</p><Code>{angularInstallExample}</Code><p className={styles.codeLead}>Call <code>boot()</code> after authentication succeeds and <code>shutdown()</code> from your logout flow.</p><Code>{angularExample}</Code></div></details>
      </section>

      <section id="lifecycle" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Lifecycle reference</h2>
        <div className={styles.commandList}>
          <article><code>Ayooda(&apos;boot&apos;, {`{ identityToken }`})</code><p>Verify the current signed-in customer and restore their latest conversation. Call this after login or on the initial authenticated page load.</p></article>
          <article><code>Ayooda(&apos;update&apos;, {`{ identityToken }`})</code><p>Refresh changed customer details or safely switch identity after obtaining a newly signed token.</p></article>
          <article><code>Ayooda(&apos;shutdown&apos;)</code><p>Revoke the widget session, close live updates, and clear the customer’s visible conversation. Call this before your application finishes logout.</p></article>
        </div>
        <h3 className={styles.subheading}>Guest and authenticated modes</h3>
        <p className={styles.copy}>With <strong>Require authentication</strong> off, visitors without a token remain anonymous while signed-in visitors receive verified identity and continuity. With it on, the composer stays disabled until a valid boot or update command succeeds.</p>
        <h3 className={styles.subheading}>Secret rotation</h3>
        <p className={styles.copy}>After rotating in the Deploy page, copy the new secret into your server configuration and deploy it. The previous secret remains accepted for one hour to prevent downtime. Existing browser sessions continue until logout or their 24-hour expiry.</p>
      </section>

      <section id="checklist" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Production checklist</h2>
        <ul className={styles.checklist}>
          <li><span>01</span><div><strong>Restrict allowed domains</strong><p>Add every production hostname in the widget’s Security settings. Include each subdomain explicitly or use a supported wildcard.</p></div></li>
          <li><span>02</span><div><strong>Protect the token endpoint</strong><p>Require your normal application authentication, use HTTPS, and derive the user from the authenticated server session—not browser input.</p></div></li>
          <li><span>03</span><div><strong>Keep the secret server-side</strong><p>Store it in a secret manager or protected environment variable. Exclude it from frontend bundles, source control, analytics, and logs.</p></div></li>
          <li><span>04</span><div><strong>Test customer isolation</strong><p>Confirm two different customer IDs cannot see one another’s history, while the same ID can resume on another browser.</p></div></li>
          <li><span>05</span><div><strong>Test logout on a shared device</strong><p>Verify that calling <code>shutdown</code> removes the previous customer’s messages before the next person signs in.</p></div></li>
          <li><span>06</span><div><strong>Update your privacy notice</strong><p>Explain the customer data sent to your support provider and send only the optional identity fields your team needs.</p></div></li>
        </ul>
      </section>

      <section id="troubleshooting" className={resourceStyles.section}>
        <h2 className={resourceStyles.sectionTitle}>Troubleshooting</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Symptom</th><th>What to check</th></tr></thead>
            <tbody>
              <tr><td>Invalid identity token</td><td>Confirm the HS256 secret, exact audience, current server clock, and a lifetime of 15 minutes or less.</td></tr>
              <tr><td>Authentication required</td><td>Call <code>boot</code> after login and confirm the token endpoint returned successfully.</td></tr>
              <tr><td>Authenticated visitors are not enabled</td><td>Enable <strong>Verify signed-in customers</strong> in the agent’s Deploy page.</td></tr>
              <tr><td>Widget does not load</td><td>Allow <code>https://cdn.ayooda.live</code> in <code>script-src</code> and the API origin shown in your browser Network panel in <code>connect-src</code>.</td></tr>
              <tr><td>Wrong customer after logout</td><td>Call <code>shutdown</code> before clearing your application session, then call <code>boot</code> for the next user.</td></tr>
            </tbody>
          </table>
        </div>
        <aside className={styles.privacy}><strong>Privacy note</strong><span>Verified names, emails, and external IDs become part of the customer conversation record and may be included in support-ticket deliveries. Reflect this in your privacy notice and send only the fields your support team needs.</span></aside>
      </section>

      <ResourceCTA title="Configure authenticated visitors" body="Open your agents, choose Deploy, and enable authenticated visitors in the widget settings." href="/dashboard/agents" label="Open agents" />
      <p className={styles.footerLink}>Looking for tool integration instead? <Link href="/docs/mcp">Read the MCP guide</Link>.</p>
    </ResourcePage>
  )
}

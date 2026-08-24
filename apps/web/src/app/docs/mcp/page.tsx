import type { Metadata } from 'next'
import { ResourceCTA, ResourcePage, resourceStyles as styles } from '@/components/marketing/ResourcePage'

export const metadata: Metadata = {
  title: 'MCP guide — Ayooda',
  description: 'Connect a Model Context Protocol server to an Ayooda support agent.',
}

export default function McpGuidePage() {
  return (
    <ResourcePage
      eyebrow="Model Context Protocol"
      title="Bring MCP tools into customer conversations."
      lede="Ayooda discovers tools from remote MCP servers, converts their input schemas for the agent runtime, and makes each connection available only to the agent you choose."
    >
      <section className={styles.grid} aria-label="MCP capabilities">
        {[
          ['Transports', 'Streamable HTTP and SSE endpoints are supported over public HTTPS.'],
          ['Authentication', 'Connect without auth, with a bearer token, or with a custom secret header.'],
          ['Safety', 'Private and unsafe network targets are blocked, redirects are rejected, and calls use hard timeouts.'],
          ['Isolation', 'A failing MCP server is skipped for that turn without taking down the rest of the agent.'],
        ].map(([title, body]) => (
          <article key={title} className={styles.card}>
            <div className={styles.cardTop}><h2 className={styles.cardTitle}>{title}</h2></div>
            <p className={styles.cardBody}>{body}</p>
          </article>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Connect an MCP server</h2>
        <ol className={styles.steps}>
          <li className={styles.step}><div><strong>Open the agent’s MCP tab</strong><span>From the dashboard, choose an agent and open MCP in its navigation.</span></div></li>
          <li className={styles.step}><div><strong>Add the server URL</strong><span>Enter a public HTTPS Streamable HTTP or SSE endpoint and choose its authentication method.</span></div></li>
          <li className={styles.step}><div><strong>Test tool discovery</strong><span>Ayooda connects live and lists the tools the server exposes before you enable it.</span></div></li>
          <li className={styles.step}><div><strong>Save and test the agent</strong><span>Use the Test tab to confirm when the agent selects the tools and how their results affect its reply.</span></div></li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What the agent receives</h2>
        <div className={styles.card}>
          <p className={styles.cardBody}>
            Tool names are namespaced by server to prevent collisions. JSON Schema inputs are translated into validated runtime parameters, and tool results are returned to the model as conversation context. Customer tools keep precedence if two integrations expose the same runtime name.
          </p>
        </div>
      </section>

      <ResourceCTA
        title="Try MCP with an Ayooda agent"
        body="Start with a free workspace, add your server, verify its tools, and exercise them in the isolated sandbox."
        label="Start free"
      />
    </ResourcePage>
  )
}

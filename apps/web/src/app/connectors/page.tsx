import type { Metadata } from 'next'
import { TOOL_BUNDLES } from '@ayooda/shared'
import { ResourceCTA, ResourcePage, resourceStyles as styles } from '@/components/marketing/ResourcePage'

export const metadata: Metadata = {
  title: 'Connectors — Ayooda',
  description: 'Browse Ayooda’s built-in support, commerce, CRM, payments, knowledge, and automation connectors.',
}

export default function ConnectorsPage() {
  return (
    <ResourcePage
      eyebrow="Connector catalog"
      title="Give your agent the tools to finish the job."
      lede="Install a provider once and Ayooda adds its supported read and write actions together. Write actions stay opt-in, require explicit customer confirmation, and can be tested before going live."
    >
      <section aria-label="Available connectors" className={styles.grid}>
        {TOOL_BUNDLES.map((bundle) => (
          <article key={bundle.id} className={styles.card}>
            <div className={styles.cardTop}>
              <h2 className={styles.cardTitle}>{bundle.label}</h2>
              <span className={styles.badge}>{bundle.category}</span>
            </div>
            <p className={styles.cardBody}>{bundle.description}</p>
            <p className={styles.cardMeta}>{bundle.templateIds.length} {bundle.templateIds.length === 1 ? 'action' : 'actions'} included</p>
          </article>
        ))}
        <article className={styles.card}>
          <div className={styles.cardTop}>
            <h2 className={styles.cardTitle}>Custom REST API</h2>
            <span className={styles.badge}>Custom</span>
          </div>
          <p className={styles.cardBody}>Define guarded read or write actions for any public HTTPS JSON API, with encrypted bearer or header credentials.</p>
          <p className={styles.cardMeta}>GET · POST · PUT · PATCH · DELETE</p>
        </article>
        <article className={styles.card}>
          <div className={styles.cardTop}>
            <h2 className={styles.cardTitle}>Model Context Protocol</h2>
            <span className={styles.badge}>MCP</span>
          </div>
          <p className={styles.cardBody}>Connect Streamable HTTP or SSE MCP servers and expose their discovered tools to a specific Ayooda agent.</p>
          <p className={styles.cardMeta}>Bearer · custom header · no auth</p>
        </article>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How connections stay controlled</h2>
        <ol className={styles.steps}>
          <li className={styles.step}><div><strong>Scoped per agent</strong><span>Each agent receives only the tools you connect to it.</span></div></li>
          <li className={styles.step}><div><strong>Secrets stay server-side</strong><span>Credentials are encrypted at rest and removed from every API response.</span></div></li>
          <li className={styles.step}><div><strong>Writes are explicit</strong><span>Write tools are disabled by default and their descriptions require confirmation before execution.</span></div></li>
          <li className={styles.step}><div><strong>Test before deployment</strong><span>Use the agent sandbox to exercise connected tools without adding test traffic to customer analytics.</span></div></li>
        </ol>
      </section>

      <ResourceCTA
        title="Connect your first provider"
        body="Create an agent, open its Tools tab, and install a complete provider bundle in one guided flow."
        label="Create an agent"
      />
    </ResourcePage>
  )
}

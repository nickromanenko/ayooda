import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import styles from './LegalPage.module.css'

export type LegalSection = {
  id: string
  title: string
  content: React.ReactNode
}

export function LegalPage({
  eyebrow,
  title,
  summary,
  effectiveDate,
  highlights,
  sections,
}: {
  eyebrow: string
  title: string
  summary: string
  effectiveDate: string
  highlights: Array<{ title: string; body: string }>
  sections: LegalSection[]
}) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className="container">
          <nav className={styles.nav} aria-label="Legal page navigation">
            <Link href="/" className={styles.brand} aria-label="Ayooda home">
              <svg className={styles.brandMark} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="4" fill="var(--accent)" />
                <path d="M2.5 12h6M15.5 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Ayooda
            </Link>
            <div className={styles.navActions}>
              <ThemeToggle />
              <Link href="/" className={styles.backLink}>
                <ArrowLeft size={14} aria-hidden="true" />
                <span className={styles.backLabel}>Back to home</span>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="container">
        <section className={styles.hero}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.summary}>{summary}</p>
          <p className={styles.updated}>Effective and last updated: {effectiveDate}</p>
        </section>

        <section className={styles.highlights} aria-label={`${title} at a glance`}>
          {highlights.map((highlight) => (
            <article className={styles.highlight} key={highlight.title}>
              <h2>{highlight.title}</h2>
              <p>{highlight.body}</p>
            </article>
          ))}
        </section>

        <div className={styles.layout}>
          <aside className={styles.contents}>
            <p>On this page</p>
            <nav aria-label={`${title} contents`}>
              {sections.map((section, index) => (
                <a href={`#${section.id}`} key={section.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>

          <article className={styles.document}>
            {sections.map((section, index) => (
              <section id={section.id} className={styles.section} key={section.id}>
                <div className={styles.sectionNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
                <div>
                  <h2>{section.title}</h2>
                  <div className={styles.prose}>{section.content}</div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerRow}>
            <span>© 2026 Ayooda · All rights reserved</span>
            <nav aria-label="Legal links">
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Use</Link>
              <a href="mailto:legal@ayooda.live">legal@ayooda.live</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}

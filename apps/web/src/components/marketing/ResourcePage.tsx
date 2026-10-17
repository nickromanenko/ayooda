import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import styles from './ResourcePage.module.css'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { AyoodaMark } from '@/components/brand/AyoodaMark'

export function ResourcePage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string
  title: string
  lede: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.page}>
      <header className="container">
        <nav className={styles.nav} aria-label="Resource navigation">
          <Link href="/" className={styles.brand} aria-label="Ayooda home">
            <AyoodaMark className={styles.brandMark} />
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
      </header>
      <main className="container">
        <section className={styles.hero}>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lede}>{lede}</p>
        </section>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  )
}

export function ResourceCTA({ title, body, href = '/signup', label = 'Start free' }: { title: string; body: string; href?: string; label?: string }) {
  return (
    <section className={styles.callout}>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <Link href={href} className={styles.primaryLink}>
        {label} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  )
}

export { styles as resourceStyles }

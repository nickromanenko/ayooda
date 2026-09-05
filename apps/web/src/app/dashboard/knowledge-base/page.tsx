'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BookOpen, ChevronRight, Copy, Search, X } from 'lucide-react'
import type { KnowledgeBaseArticle } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { knowledgeBaseSearchText } from '@/lib/knowledge-base'
import MarkdownMessage from '@/components/dashboard/MarkdownMessage'
import { Loading } from '@/components/dashboard/Loading'
import styles from './page.module.css'

function KnowledgeBaseContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedSlug = searchParams.get('article') ?? ''
  const [articles, setArticles] = useState<KnowledgeBaseArticle[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError('')
      try {
        const response = await apiRequest('/knowledge-base')
        const body = await response.json().catch(() => ({})) as { articles?: KnowledgeBaseArticle[]; error?: string }
        if (!response.ok) throw new Error(body.error ?? 'Could not load the knowledge base.')
        if (!cancelled) setArticles(body.articles ?? [])
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the knowledge base.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const categories = useMemo(() => ['All', ...new Set(articles.map((article) => article.category).sort())], [articles])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return articles.filter((article) =>
      (category === 'All' || article.category === category)
      && (!needle || knowledgeBaseSearchText(article).includes(needle)))
  }, [articles, category, query])
  const selected = articles.find((article) => article.slug === selectedSlug) ?? null
  const related = selected
    ? selected.relatedArticleIds.map((id) => articles.find((article) => article.articleId === id)).filter((article): article is KnowledgeBaseArticle => Boolean(article))
    : []

  function selectArticle(slug: string) {
    router.replace(`/dashboard/knowledge-base?article=${encodeURIComponent(slug)}`, { scroll: false })
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (loading) return <Loading label="Loading the knowledge base…" pad="80px 0" />

  return (
    <div className={styles.page} data-detail={Boolean(selected)}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Help center</span><h1>Knowledge Base</h1><p>Clear guidance for every part of the Ayooda dashboard.</p></div>
        <span className={styles.articleCount}>{articles.length} article{articles.length === 1 ? '' : 's'}</span>
      </header>

      {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>Retry</button></div>}

      {!error && articles.length === 0 && <div className={styles.error}><p>No published articles are available yet.</p><small>Run the knowledge-base importer, then reload this page.</small></div>}

      {!error && articles.length > 0 && <div className={styles.workspace}>
        <aside className={styles.browser} aria-label="Knowledge base articles">
          <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all help…" aria-label="Search knowledge base" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}</label>
          <div className={styles.categories} aria-label="Article categories">
            {categories.map((name) => <button type="button" key={name} data-active={category === name} onClick={() => setCategory(name)}>{name}</button>)}
          </div>
          <div className={styles.results}>
            {filtered.length === 0 ? <div className={styles.empty}><Search size={20} /><p>No articles match that search.</p><button type="button" onClick={() => { setQuery(''); setCategory('All') }}>Clear search and filters</button></div> : filtered.map((article) => (
              <button type="button" key={article.articleId} className={styles.articleRow} data-active={selected?.articleId === article.articleId} onClick={() => selectArticle(article.slug)}>
                <span className={styles.rowIcon}><BookOpen size={15} /></span><span><strong>{article.title}</strong><small>{article.summary}</small></span><ChevronRight size={14} />
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.articlePanel} aria-label={selected ? selected.title : 'Knowledge base welcome'}>
          {selected ? <>
            <div className={styles.articleToolbar}>
              <button type="button" className={styles.back} onClick={() => router.replace('/dashboard/knowledge-base', { scroll: false })}><ArrowLeft size={14} /> All articles</button>
              <button type="button" className={styles.copy} onClick={() => void copyLink()}><Copy size={13} /> {copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div className={styles.articleMeta}><span>{selected.category}</span><span>{selected.route.replace(':agentId', 'your agent')}</span></div>
            <MarkdownMessage content={selected.bodyMarkdown} className={styles.markdown} />
            {related.length > 0 && <section className={styles.related}><h2>Related articles</h2><div>{related.map((article) => <button type="button" key={article.articleId} onClick={() => selectArticle(article.slug)}>{article.title}<ChevronRight size={13} /></button>)}</div></section>}
            <footer className={styles.articleFooter}>Still need help? Use <Link href="/dashboard/copilot">Copilot</Link> with a team agent or contact your workspace owner.</footer>
          </> : <div className={styles.welcome}><span><BookOpen size={24} /></span><h2>How can we help?</h2><p>Search the full documentation or choose an article. Use “Help for this page” in the dashboard navigation to jump directly to the relevant guide.</p></div>}
        </section>
      </div>}
    </div>
  )
}

export default function KnowledgeBasePage() {
  return <Suspense fallback={<Loading label="Loading the knowledge base…" pad="80px 0" />}><KnowledgeBaseContent /></Suspense>
}

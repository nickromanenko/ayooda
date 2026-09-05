import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const articleDirectories = ['dashboard', 'admin']
const pageDirectories = [
  { directory: path.join(root, 'apps/web/src/app/dashboard'), prefix: '/dashboard' },
  { directory: path.join(root, 'apps/web/src/app/admin'), prefix: '/admin' },
]
const requiredFields = [
  'article_id', 'title', 'slug', 'category', 'route', 'roles', 'summary',
  'keywords', 'related_articles', 'status', 'updated_at',
]

function fail(message) {
  throw new Error(`[knowledge-base] ${message}`)
}

function parseScalar(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim()
    return body ? body.split(',').map((item) => item.trim()) : []
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseArticle(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/)
  if (!match) fail(`${file} must contain YAML frontmatter and an article body`)

  const metadata = Object.fromEntries(match[1].split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf(':')
    if (separator < 1) fail(`${file} has invalid frontmatter line: ${line}`)
    return [line.slice(0, separator), parseScalar(line.slice(separator + 1))]
  }))

  for (const field of requiredFields) {
    if (metadata[field] === undefined || metadata[field] === '') fail(`${file} is missing ${field}`)
  }
  if (!match[2].trimStart().startsWith('# ')) fail(`${file} body must start with a level-one heading`)
  return { file, metadata }
}

async function collectPageRoutes(directory, prefix, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const routes = []
  if (entries.some((entry) => entry.isFile() && entry.name === 'page.tsx')) {
    const suffix = relative
      .split(path.sep)
      .filter(Boolean)
      .map((part) => part.startsWith('[') && part.endsWith(']') ? `:${part.slice(1, -1)}` : part)
      .join('/')
    routes.push(`${prefix}${suffix ? `/${suffix}` : ''}`)
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(...await collectPageRoutes(path.join(directory, entry.name), prefix, path.join(relative, entry.name)))
    }
  }
  return routes
}

function assertUnique(articles, field) {
  const seen = new Map()
  for (const article of articles) {
    const value = article.metadata[field]
    if (seen.has(value)) fail(`${article.file} duplicates ${field} "${value}" from ${seen.get(value)}`)
    seen.set(value, article.file)
  }
}

const articles = (await Promise.all(articleDirectories.map(async (directory) => {
  const articleDirectory = path.join(root, 'docs/knowledge-base', directory)
  const articleFiles = (await readdir(articleDirectory)).filter((file) => file.endsWith('.md')).sort()
  return Promise.all(articleFiles.map(async (file) => {
    const relative = path.posix.join(directory, file)
    const source = await readFile(path.join(articleDirectory, file), 'utf8')
    return parseArticle(source, relative)
  }))
}))).flat()

for (const field of ['article_id', 'slug', 'route']) assertUnique(articles, field)

const ids = new Set(articles.map((article) => article.metadata.article_id))
for (const article of articles) {
  const { metadata, file } = article
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.article_id)) fail(`${file} has invalid article_id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug)) fail(`${file} has invalid slug`)
  if (!metadata.route.startsWith('/dashboard') && !metadata.route.startsWith('/admin')) fail(`${file} route must be a dashboard or admin route`)
  if (!Array.isArray(metadata.roles) || !metadata.roles.length || metadata.roles.some((role) => !['owner', 'member', 'admin'].includes(role))) fail(`${file} has invalid roles`)
  if (!Array.isArray(metadata.keywords) || metadata.keywords.length < 2) fail(`${file} must have at least two keywords`)
  if (!Array.isArray(metadata.related_articles)) fail(`${file} related_articles must be an array`)
  if (!['draft', 'published', 'archived'].includes(metadata.status)) fail(`${file} has invalid status`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.updated_at)) fail(`${file} has invalid updated_at`)
  for (const relatedId of metadata.related_articles) {
    if (!ids.has(relatedId)) fail(`${file} references unknown article ${relatedId}`)
    if (relatedId === metadata.article_id) fail(`${file} cannot relate to itself`)
  }
}

const pageRoutes = new Set((await Promise.all(pageDirectories.map(({ directory, prefix }) => collectPageRoutes(directory, prefix)))).flat())
const articleRoutes = new Set(articles.map((article) => article.metadata.route))
const missing = [...pageRoutes].filter((route) => !articleRoutes.has(route)).sort()
const obsolete = [...articleRoutes].filter((route) => !pageRoutes.has(route)).sort()
if (missing.length) fail(`dashboard routes without articles: ${missing.join(', ')}`)
if (obsolete.length) fail(`article routes without dashboard pages: ${obsolete.join(', ')}`)

console.log(`Knowledge base valid: ${articles.length} published product articles cover ${pageRoutes.size} routes.`)

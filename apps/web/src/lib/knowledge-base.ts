export function normalizeDashboardHelpRoute(pathname: string): string {
  const route = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const parts = route.split('/')
  if (parts[1] === 'dashboard' && parts[2] === 'agents' && parts[3]) parts[3] = ':agentId'
  return parts.join('/') || '/dashboard'
}

export function knowledgeBaseSearchText(article: {
  title: string
  summary: string
  category: string
  route: string
  keywords: string[]
  bodyMarkdown: string
}): string {
  return [article.title, article.summary, article.category, article.route, ...article.keywords, article.bodyMarkdown]
    .join(' ')
    .toLocaleLowerCase()
}

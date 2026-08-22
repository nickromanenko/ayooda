import AgentTabs from '@/components/dashboard/AgentTabs'

export default async function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <AgentTabs agentId={agentId} />
      {children}
    </div>
  )
}

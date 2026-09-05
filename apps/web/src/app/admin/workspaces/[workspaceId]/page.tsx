import WorkspaceDetail from './workspace-detail'

export default async function AdminWorkspaceDetailPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return <WorkspaceDetail workspaceId={(await params).workspaceId} />
}

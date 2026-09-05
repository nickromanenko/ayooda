import UserDetail from './user-detail'

export default async function AdminUserDetailPage({ params }: { params: Promise<{ uid: string }> }) {
  return <UserDetail uid={(await params).uid} />
}

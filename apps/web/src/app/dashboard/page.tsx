import { MessageSquare, BookOpen, Bot, Zap } from 'lucide-react'

const stats = [
  { label: 'Total conversations', value: '—', icon: MessageSquare, color: 'text-indigo-600 bg-indigo-50' },
  { label: 'Automated', value: '—', icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
  { label: 'Knowledge docs', value: '—', icon: BookOpen, color: 'text-amber-600 bg-amber-50' },
  { label: 'Agent status', value: 'Inactive', icon: Bot, color: 'text-zinc-600 bg-zinc-100' },
]

export default function DashboardPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Overview</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Your support agent at a glance
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-zinc-200 p-4"
          >
            <div className={`inline-flex p-2 rounded-lg mb-3 ${stat.color}`}>
              <stat.icon size={16} />
            </div>
            <p className="text-2xl font-semibold text-zinc-900">{stat.value}</p>
            <p className="text-sm text-zinc-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Get started */}
      <div className="bg-white rounded-xl border border-zinc-200 p-6">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">Get started</h2>
        <div className="space-y-3">
          <Step
            number={1}
            title="Configure your agent"
            description="Give your agent a name, avatar, and personality."
            href="/dashboard/agent"
            done={false}
          />
          <Step
            number={2}
            title="Add your knowledge base"
            description="Paste your website URL or upload documents."
            href="/dashboard/knowledge"
            done={false}
          />
          <Step
            number={3}
            title="Deploy the widget"
            description="Copy a script tag and paste it into your website."
            href="/dashboard/channels"
            done={false}
          />
        </div>
      </div>
    </div>
  )
}

function Step({
  number,
  title,
  description,
  href,
  done,
}: {
  number: number
  title: string
  description: string
  href: string
  done: boolean
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-4 p-3 rounded-lg hover:bg-zinc-50 transition-colors group"
    >
      <span
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium mt-0.5 ${
          done
            ? 'bg-emerald-500 text-white'
            : 'bg-zinc-100 text-zinc-600 group-hover:bg-indigo-100 group-hover:text-indigo-600'
        }`}
      >
        {done ? '✓' : number}
      </span>
      <div>
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="text-sm text-zinc-500">{description}</p>
      </div>
    </a>
  )
}

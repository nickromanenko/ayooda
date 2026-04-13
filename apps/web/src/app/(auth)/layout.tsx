export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-zinc-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">Ayooda</span>
        </div>
        {children}
      </div>
    </div>
  )
}

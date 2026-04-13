export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white flex flex-col">
      {/* Top bar */}
      <header className="px-8 py-5 border-b border-zinc-100">
        <span className="text-base font-semibold tracking-tight text-zinc-900">Ayooda</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">{children}</div>
      </div>
    </div>
  )
}

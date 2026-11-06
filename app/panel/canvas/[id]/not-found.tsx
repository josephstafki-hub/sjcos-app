export default function CanvasNotFound(){
 return <main className="flex min-h-dvh flex-col items-start justify-center gap-4 bg-paper p-6 text-body text-ink">
  <p>This canvas isn&apos;t available to this account.</p>
  <a href="/panel" className="inline-flex min-h-11 items-center rounded-md border border-rule bg-card px-3 text-ai-2">‹ Chat</a>
 </main>;
}

import { AuditBoard } from "@/components/audit-board"

export default function Home() {
  return (
    <>
      <div className="mx-auto flex w-full max-w-[880px] justify-end px-6 pt-8">
        <a href="/fix" className="text-[13px] text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4">
          Fix with agent
        </a>
      </div>
      <AuditBoard />
    </>
  )
}

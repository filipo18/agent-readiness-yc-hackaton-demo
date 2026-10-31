"use client"

export interface PreviewCard { title: string; price: number; image: string | null; type: string }
export interface PreviewCatalog { ghost: PreviewCard | null; viz: PreviewCard[] }

const cap = "mb-1 text-[11px] uppercase tracking-[0.08em] text-[#8A8984]"
const usd = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "")

function Img({ src, small }: { src: string | null; small?: boolean }) {
  const size = small ? "h-12" : "h-28"
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={`${size} w-full rounded-[4px] bg-[#F4F3EF] object-contain`} /> : <div className={`${size} w-full rounded-[4px] bg-[#F4F3EF]`} />
}

function Card({ p, sizes }: { p: PreviewCard; sizes?: boolean }) {
  return (
    <div className="rounded-[6px] border border-[#E6E5E0] bg-white p-3">
      <Img src={p.image} />
      <p className="mt-2 text-[13px] leading-snug">{p.title}</p>
      <p className="text-[13px] text-[#8A8984]">{usd(p.price)}</p>
      {sizes ? (
        <div className="mt-2 flex gap-1">
          {["8", "9", "10", "11", "12"].map((s) => (
            <span key={s} className={`rounded-[4px] border px-2 py-0.5 text-[12px] ${s === "10" ? "border-[#14130F] bg-[#14130F] text-white" : "border-[#E6E5E0]"}`}>{s}</span>
          ))}
        </div>
      ) : <p className="mt-2 text-[12px] text-[#B5B4AE]">No size picker</p>}
    </div>
  )
}

function Mini({ p, draft }: { p: PreviewCard; draft?: boolean }) {
  return (
    <div className={`rounded-[4px] border border-[#E6E5E0] p-1.5 ${draft ? "opacity-40" : ""}`}>
      <Img src={p.image} small />
      <p className="mt-1 truncate text-[10px]">{p.title}</p>
      {draft ? <span className="text-[9px] uppercase tracking-[0.08em] text-[#8A8984]">Draft</span> : <p className="text-[10px] text-[#8A8984]">{usd(p.price)}</p>}
    </div>
  )
}

function Pair({ before, after }: { before: React.ReactNode; after: React.ReactNode }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3">
      <div><p className={cap}>Before</p>{before}</div>
      <div><p className={cap}>After</p>{after}</div>
    </div>
  )
}

export function ProductPreview({ kind, catalog }: { kind: string; catalog: PreviewCatalog | null }) {
  const g = catalog?.ghost
  if (!g) return <p className="mt-2 text-[12px] text-[#8A8984]">Loading product…</p>
  if (kind === "ghost_size") return <Pair before={<Card p={g} />} after={<Card p={g} sizes />} />
  if (kind === "viz_catalog") {
    const viz = catalog.viz.slice(0, 5)
    return (
      <Pair
        before={<div className="grid grid-cols-3 gap-1.5"><Mini p={g} />{viz.map((p) => <Mini key={p.title} p={p} />)}</div>}
        after={<div className="grid grid-cols-3 gap-1.5"><div className="rounded-[4px] ring-1 ring-[#14130F]"><Mini p={g} /></div>{viz.map((p) => <Mini key={p.title} p={p} draft />)}</div>}
      />
    )
  }
  const code = "rounded-[4px] bg-[#F4F3EF] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
  return (
    <Pair
      before={<pre className={code + " text-[#8A8984]"}>{`{ "@type": "Product",\n  "name": "${g.title}" }\n\n// no size, no offer, no brand`}</pre>}
      after={<pre className={code}>{`{ "@type": "Product",\n  "name": "${g.title}",\n  "brand": "Brooks",\n  "size": ["8","9","10","11","12"],\n  "offers": { "price": "${g.price.toFixed(2)}",\n    "availability": "InStock" } }`}</pre>}
    />
  )
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { usdcToBrl } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; q?: string }>;
}) {
  const sp   = await searchParams;
  const city = sp.city;
  const q    = sp.q;

  const events = await prisma.event.findMany({
    where: {
      status: { in: ["ON_SALE", "PAUSED"] },
      ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
      ...(q    ? { title: { contains: q,    mode: "insensitive" } } : {}),
    },
    include: {
      organizer: { select: { companyName: true } },
      _count:    { select: { tickets: true } },
    },
    orderBy: { eventDate: "asc" },
  });

  const cards = await Promise.all(
    events.map(async (e) => ({
      ...e,
      priceBrl: await usdcToBrl(Number(e.ticketPriceUsdc)),
      sold:     e._count.tickets,
    }))
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold tracking-tight">◆ Shaar</h1>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/" className="underline underline-offset-2">Eventos</Link>
          <Link href="/my-tickets">Meus Ingressos</Link>
          <Link href="/organizer">Minha área</Link>
          <Link href="/admin" className="text-zinc-400">Admin</Link>
        </nav>
      </header>

      <form method="GET" className="flex gap-2 mb-8">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar evento…"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <input
          name="city"
          defaultValue={city}
          placeholder="Cidade"
          className="w-36 rounded-lg border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm text-white">
          Buscar
        </button>
      </form>

      {cards.length === 0 ? (
        <p className="text-zinc-500">Nenhum evento encontrado.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.map((e) => {
            const soldOut = e.maxTickets !== null && e.sold >= e.maxTickets;
            return (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="rounded-xl border hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                {e.coverImageUrl ? (
                  <img src={e.coverImageUrl} alt={e.title} className="h-40 w-full object-cover" />
                ) : (
                  <div className="h-40 w-full bg-zinc-100 flex items-center justify-center text-zinc-400 text-xs">
                    sem imagem
                  </div>
                )}
                <div className="p-4 flex flex-col gap-1 flex-1">
                  <p className="font-semibold leading-snug">{e.title}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(e.eventDate).toLocaleDateString("pt-BR")} · {e.venue}, {e.city}
                  </p>
                  <p className="text-xs text-zinc-400">{e.organizer.companyName}</p>
                  <div className="mt-auto pt-3 flex items-center justify-between">
                    <span className="font-semibold text-sm">
                      R$ {e.priceBrl.toFixed(2).replace(".", ",")}
                    </span>
                    {soldOut ? (
                      <span className="text-xs font-medium text-red-500">ESGOTADO</span>
                    ) : e.maxTickets ? (
                      <span className="text-xs text-zinc-400">{e.sold}/{e.maxTickets}</span>
                    ) : (
                      <span className="text-xs text-zinc-400">{e.sold} vendidos</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

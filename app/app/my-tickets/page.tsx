"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

interface TicketWithEvent {
  tokenId: number;
  ticketNumber: number;
  seat: string | null;
  status: string;
  mintedAt: string | null;
  facePrice: string;
  event: {
    id: string;
    title: string;
    venue: string;
    city: string;
    eventDate: string;
    coverImageUrl: string | null;
  };
}

function RotatingQR({
  tokenId,
  getAccessToken,
}: {
  tokenId: number;
  getAccessToken: () => Promise<string | null>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const prevSrc = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const resp = await fetch(`/api/me/tickets/${tokenId}/qr`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    if (prevSrc.current) URL.revokeObjectURL(prevSrc.current);
    prevSrc.current = url;
    setSrc(url);
  }, [tokenId, getAccessToken]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 28_000);
    return () => {
      clearInterval(id);
      if (prevSrc.current) URL.revokeObjectURL(prevSrc.current);
    };
  }, [refresh]);

  if (!src) {
    return (
      <div className="w-[200px] h-[200px] bg-zinc-100 rounded-lg animate-pulse" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`QR ingresso #${tokenId}`} className="w-[200px] h-[200px] rounded-lg border" />;
}

export default function MyTicketsPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [tickets, setTickets] = useState<TicketWithEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) { setLoading(false); return; }

    (async () => {
      const token = await getAccessToken();
      const r = await fetch("/api/me/tickets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setTickets(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, [ready, authenticated, getAccessToken]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="text-sm text-zinc-400 hover:text-black">← Voltar</Link>
        <h1 className="text-xl font-bold">Meus Ingressos</h1>
        <span />
      </header>

      {!ready || loading ? (
        <p className="text-zinc-400">Carregando…</p>
      ) : !authenticated ? (
        <div className="text-center py-20">
          <p className="text-zinc-500 mb-4">Faça login para ver seus ingressos.</p>
          <button
            onClick={login}
            className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Entrar
          </button>
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-500">Você ainda não tem ingressos.</p>
          <Link href="/" className="mt-4 inline-block text-sm underline text-zinc-600">
            Ver eventos
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tickets.map((t) => (
            <div
              key={t.tokenId}
              className="border rounded-xl overflow-hidden flex flex-col sm:flex-row"
            >
              {/* Cover */}
              {t.event.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.event.coverImageUrl}
                  alt={t.event.title}
                  className="h-32 sm:w-36 sm:h-auto object-cover"
                />
              ) : (
                <div className="h-32 sm:w-36 bg-zinc-100 flex items-center justify-center text-zinc-400 text-xs shrink-0">
                  sem imagem
                </div>
              )}

              {/* Info */}
              <div className="p-4 flex-1 flex flex-col gap-1">
                <p className="font-semibold">{t.event.title}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(t.event.eventDate).toLocaleString("pt-BR")} · {t.event.venue}, {t.event.city}
                </p>
                <p className="text-xs text-zinc-400">
                  Ingresso #{t.ticketNumber}
                  {t.seat ? ` · Assento ${t.seat}` : ""}
                  {" · "}
                  <span
                    className={
                      t.status === "VALID"
                        ? "text-green-600"
                        : t.status === "CHECKED_IN"
                        ? "text-blue-600"
                        : "text-zinc-400"
                    }
                  >
                    {t.status}
                  </span>
                </p>
                <p className="text-xs text-zinc-400">Token #{t.tokenId}</p>

                <button
                  onClick={() =>
                    setSelected((prev) => (prev === t.tokenId ? null : t.tokenId))
                  }
                  className="mt-2 self-start text-xs underline text-zinc-600"
                >
                  {selected === t.tokenId ? "Ocultar QR" : "Mostrar QR"}
                </button>
              </div>

              {/* QR panel */}
              {selected === t.tokenId && (
                <div className="p-4 border-t sm:border-t-0 sm:border-l flex flex-col items-center gap-2 shrink-0">
                  <RotatingQR tokenId={t.tokenId} getAccessToken={getAccessToken} />
                  <p className="text-xs text-zinc-400">Atualiza a cada 30s</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

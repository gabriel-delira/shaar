"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  venue: string;
  city: string;
  coverImageUrl: string | null;
  eventDate: string;
  ticketPriceUsdc: number;
  ticketPriceBrl: number;
  platformFeeBps: number;
  maxTickets: number | null;
  soldCount: number;
  available: number | null;
  status: string;
  organizer: string;
}

interface CheckoutState {
  purchaseId: string;
  pixCode: string;
  qrCodeUrl: string;
  amountBrl: number;
  expiresAt: string;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [event, setEvent]           = useState<EventDetail | null>(null);
  const [loading, setLoading]       = useState(true);
  const [checkout, setCheckout]     = useState<CheckoutState | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [buying, setBuying]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((d) => { setEvent(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  // Poll purchase status after checkout
  useEffect(() => {
    if (!checkout || purchaseStatus === "COMPLETED" || purchaseStatus === "REFUNDED") return;
    const interval = setInterval(async () => {
      const token = await getAccessToken();
      const r = await fetch(`/api/purchases/${checkout.purchaseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setPurchaseStatus(d.status);
    }, 2000);
    return () => clearInterval(interval);
  }, [checkout, purchaseStatus, getAccessToken]);

  const handleBuy = async () => {
    if (!authenticated) { login(); return; }
    setBuying(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const r = await fetch(`/api/events/${id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ method: "PIX" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erro ao criar cobrança");
      setCheckout(d);
      setPurchaseStatus("PENDING");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setBuying(false);
    }
  };

  if (loading) return <div className="p-10 text-zinc-400">Carregando…</div>;
  if (!event)  return <div className="p-10 text-red-500">Evento não encontrado.</div>;

  const soldOut = event.available !== null && event.available <= 0;
  const feePercent = (event.platformFeeBps / 100).toFixed(0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/" className="text-sm text-zinc-400 hover:text-black mb-4 inline-block">← Voltar</Link>

      {event.coverImageUrl && (
        <img src={event.coverImageUrl} alt={event.title}
          className="w-full h-64 object-cover rounded-xl mb-6" />
      )}

      <div className="flex flex-col md:flex-row gap-8">
        {/* Info */}
        <div className="flex-1">
          <h1 className="text-2xl font-bold mb-1">{event.title}</h1>
          <p className="text-sm text-zinc-500 mb-1">
            {new Date(event.eventDate).toLocaleString("pt-BR")} · {event.venue}, {event.city}
          </p>
          <p className="text-xs text-zinc-400 mb-4">Organizado por {event.organizer}</p>
          {event.description && <p className="text-sm text-zinc-600 leading-relaxed">{event.description}</p>}
          {event.maxTickets && (
            <p className="mt-4 text-sm text-zinc-500">
              Disponíveis: {event.available ?? "?"}/{event.maxTickets}
            </p>
          )}
        </div>

        {/* Purchase box */}
        <div className="w-full md:w-72 shrink-0">
          {!checkout ? (
            <div className="border rounded-xl p-5 flex flex-col gap-3">
              <div>
                <p className="text-xl font-bold">
                  R$ {event.ticketPriceBrl.toFixed(2).replace(".", ",")}
                </p>
                <p className="text-xs text-zinc-400">≈ {event.ticketPriceUsdc} USDC</p>
              </div>
              <p className="text-xs text-zinc-400">Taxa de serviço {feePercent}% inclusa</p>
              {soldOut ? (
                <p className="text-center text-red-500 font-medium text-sm">Esgotado</p>
              ) : (
                <button
                  onClick={handleBuy}
                  disabled={buying || !ready}
                  className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white
                    hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  {buying ? "Aguarde…" : authenticated ? "Comprar ingresso" : "Entrar e comprar"}
                </button>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          ) : (
            <div className="border rounded-xl p-5 flex flex-col gap-3">
              {purchaseStatus === "COMPLETED" ? (
                <div className="text-center">
                  <p className="text-2xl">🎉</p>
                  <p className="font-semibold mt-1">Ingresso é seu!</p>
                  <p className="text-xs text-zinc-500 mt-1">NFT mintado com sucesso.</p>
                </div>
              ) : purchaseStatus === "REFUNDED" ? (
                <div className="text-center">
                  <p className="font-semibold text-red-500">Pagamento estornado</p>
                  <p className="text-xs text-zinc-500 mt-1">Erro ao processar. Tente novamente.</p>
                </div>
              ) : (
                <>
                  <p className="font-semibold text-sm">Pague via PIX</p>
                  <p className="text-xs text-zinc-500">
                    R$ {checkout.amountBrl.toFixed(2).replace(".", ",")} · expira às{" "}
                    {new Date(checkout.expiresAt).toLocaleTimeString("pt-BR")}
                  </p>
                  {checkout.qrCodeUrl && (
                    <img src={checkout.qrCodeUrl} alt="QR PIX" className="w-40 mx-auto rounded" />
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(checkout.pixCode)}
                    className="text-xs underline text-zinc-500"
                  >
                    Copiar código PIX
                  </button>
                  <p className="text-xs text-zinc-400 text-center">
                    Status: <span className="font-medium">{purchaseStatus}</span>
                  </p>
                  {process.env.NODE_ENV !== "production" && (
                    <button
                      onClick={async () => {
                        const token = await getAccessToken();
                        await fetch(`/api/dev/simulate-payment/${checkout.purchaseId}`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` },
                        });
                      }}
                      className="text-xs text-blue-500 underline"
                    >
                      [DEV] Simular pagamento
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import Link from "next/link";

interface MarketListing {
  id: string;
  onchainListingId: number;
  tokenId: number;
  sellerAddress: string;
  priceUsdc: number;
  priceBrl: number;
  expiresAt: string | null;
  ticket: {
    tokenId: number;
    ticketNumber: number;
    seat: string | null;
    facePrice: number;
    event: {
      id: string;
      title: string;
      venue: string;
      city: string;
      eventDate: string;
      coverImageUrl: string | null;
    };
  };
}

interface MyTicket {
  tokenId: number;
  ticketNumber: number;
  status: string;
  event: { title: string };
}

interface CheckoutState {
  listingId: string;
  pixCode: string;
  qrCodeUrl: string;
  amountBrl: number;
  purchaseId: string;
}

interface ListFormState {
  tokenId: number | null;
  priceUsdc: string;
  submitting: boolean;
  calldata: { approveCalldata: string; listTicketCalldata: string; nftAddress: string; resaleAddress: string; listingId: string } | null;
}

export default function MarketPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const [listings, setListings]   = useState<MarketListing[]>([]);
  const [myTickets, setMyTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [checkout, setCheckout]   = useState<CheckoutState | null>(null);
  const [listForm, setListForm]   = useState<ListFormState>({ tokenId: null, priceUsdc: "", submitting: false, calldata: null });
  const [txStatus, setTxStatus]   = useState("");

  const fetchListings = useCallback(async () => {
    const r = await fetch("/api/market");
    const data = await r.json();
    setListings(Array.isArray(data) ? data : []);
  }, []);

  const fetchMyTickets = useCallback(async () => {
    if (!authenticated) return;
    const token = await getAccessToken();
    const r = await fetch("/api/me/tickets", { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    setMyTickets(
      (Array.isArray(data) ? data : []).filter(
        (t: MyTicket) => t.status === "VALID"
      )
    );
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready) return;
    fetchListings().finally(() => setLoading(false));
    if (authenticated) fetchMyTickets();
  }, [ready, authenticated, fetchListings, fetchMyTickets]);

  const handleBuy = async (listing: MarketListing) => {
    if (!authenticated) { login(); return; }
    const token = await getAccessToken();
    const r = await fetch(`/api/listings/${listing.id}/checkout`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error ?? "Erro ao iniciar checkout"); return; }
    setCheckout({
      listingId:  listing.id,
      pixCode:    data.pixCode,
      qrCodeUrl:  data.qrCodeUrl,
      amountBrl:  data.amountBrl,
      purchaseId: data.purchaseId,
    });
  };

  const handleListSubmit = async () => {
    if (!listForm.tokenId || !listForm.priceUsdc) return;
    setListForm((f) => ({ ...f, submitting: true }));
    const token = await getAccessToken();
    const r = await fetch("/api/listings", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId: listForm.tokenId, priceUsdc: parseFloat(listForm.priceUsdc) }),
    });
    const data = await r.json();
    if (!r.ok) {
      alert(data.error ?? "Erro ao criar listagem");
      setListForm((f) => ({ ...f, submitting: false }));
      return;
    }
    setListForm((f) => ({ ...f, submitting: false, calldata: { ...data } }));
  };

  const handleSignAndList = async () => {
    if (!listForm.calldata) return;
    const { approveCalldata, listTicketCalldata, nftAddress, resaleAddress, listingId } = listForm.calldata;
    const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
    if (!embeddedWallet) { alert("Carteira Privy não encontrada"); return; }

    setTxStatus("Enviando approve…");
    try {
      await embeddedWallet.sendTransaction({ to: nftAddress as `0x${string}`, data: approveCalldata as `0x${string}` });
      setTxStatus("Approve confirmado. Enviando listTicket…");
      const listTx = await embeddedWallet.sendTransaction({ to: resaleAddress as `0x${string}`, data: listTicketCalldata as `0x${string}` });

      // Confirm to backend so it can extract the onchainListingId
      const token = await getAccessToken();
      await fetch(`/api/listings/${listingId}`, {
        method:  "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ txHash: (listTx as { hash?: string }).hash }),
      });

      setTxStatus("Ingresso listado com sucesso!");
      setListForm({ tokenId: null, priceUsdc: "", submitting: false, calldata: null });
      fetchListings();
      fetchMyTickets();
    } catch (err) {
      setTxStatus(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="text-sm text-zinc-400 hover:text-black">← Voltar</Link>
        <h1 className="text-xl font-bold">Marketplace de Ingressos</h1>
        <span />
      </header>

      {/* Sell panel */}
      {authenticated && myTickets.length > 0 && (
        <div className="border rounded-xl p-5 mb-8 bg-zinc-50">
          <h2 className="font-semibold mb-3">Listar ingresso para venda</h2>
          {!listForm.calldata ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                className="border rounded-lg px-3 py-2 text-sm flex-1"
                value={listForm.tokenId ?? ""}
                onChange={(e) => setListForm((f) => ({ ...f, tokenId: Number(e.target.value) || null }))}
              >
                <option value="">Selecione um ingresso</option>
                {myTickets.map((t) => (
                  <option key={t.tokenId} value={t.tokenId}>
                    #{t.ticketNumber} · {t.event.title} (token #{t.tokenId})
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Preço em USDC"
                className="border rounded-lg px-3 py-2 text-sm w-36"
                value={listForm.priceUsdc}
                onChange={(e) => setListForm((f) => ({ ...f, priceUsdc: e.target.value }))}
                min="0.01"
                step="0.01"
              />
              <button
                onClick={handleListSubmit}
                disabled={listForm.submitting || !listForm.tokenId || !listForm.priceUsdc}
                className="rounded-lg bg-black text-white px-5 py-2 text-sm disabled:opacity-50"
              >
                {listForm.submitting ? "Aguarde…" : "Continuar"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600">
                Pronto! Confirme as duas transações na sua carteira para colocar o ingresso à venda.
              </p>
              <button
                onClick={handleSignAndList}
                className="self-start rounded-lg bg-black text-white px-5 py-2 text-sm"
              >
                Assinar e Listar
              </button>
              {txStatus && <p className="text-xs text-zinc-500">{txStatus}</p>}
            </div>
          )}
        </div>
      )}

      {/* PIX checkout modal */}
      {checkout && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 flex flex-col gap-4">
            <h2 className="font-bold text-lg">Pague via PIX</h2>
            <p className="text-sm text-zinc-500">Valor: R$ {checkout.amountBrl.toFixed(2)}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkout.qrCodeUrl} alt="QR PIX" className="w-48 h-48 mx-auto rounded-lg border" />
            <p className="text-xs break-all bg-zinc-50 rounded-lg p-3 select-all">{checkout.pixCode}</p>
            <p className="text-xs text-zinc-400 text-center">O ingresso será transferido após confirmação do pagamento.</p>
            <button
              onClick={() => { setCheckout(null); fetchListings(); }}
              className="text-sm underline text-zinc-500"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <p className="text-zinc-400">Carregando…</p>
      ) : listings.length === 0 ? (
        <div className="text-center py-20 text-zinc-400">Nenhum ingresso à venda no momento.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {listings.map((l) => (
            <div key={l.id} className="border rounded-xl overflow-hidden flex flex-col sm:flex-row">
              {l.ticket.event.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.ticket.event.coverImageUrl} alt={l.ticket.event.title} className="h-32 sm:w-36 sm:h-auto object-cover" />
              ) : (
                <div className="h-32 sm:w-36 bg-zinc-100 flex items-center justify-center text-zinc-400 text-xs shrink-0">sem imagem</div>
              )}
              <div className="p-4 flex-1 flex flex-col gap-1">
                <p className="font-semibold">{l.ticket.event.title}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(l.ticket.event.eventDate).toLocaleString("pt-BR")} · {l.ticket.event.venue}, {l.ticket.event.city}
                </p>
                <p className="text-xs text-zinc-400">
                  Ingresso #{l.ticket.ticketNumber}{l.ticket.seat ? ` · Assento ${l.ticket.seat}` : ""} · Token #{l.tokenId}
                </p>
                <p className="text-xs text-zinc-400">
                  Face: ${l.ticket.facePrice.toFixed(2)} USDC
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="font-bold">${l.priceUsdc.toFixed(2)} USDC</span>
                  <span className="text-sm text-zinc-500">≈ R$ {l.priceBrl.toFixed(2)}</span>
                  <button
                    onClick={() => handleBuy(l)}
                    className="ml-auto rounded-lg bg-black text-white px-4 py-1.5 text-sm hover:bg-zinc-800"
                  >
                    {authenticated ? "Comprar" : "Login para comprar"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

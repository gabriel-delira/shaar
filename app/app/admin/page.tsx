"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

type Tab = "organizers" | "events";

interface PendingOrganizer {
  id: string;
  companyName: string;
  document: string;
  payoutWallet: string;
  status: string;
  user: { email: string | null };
}

interface PendingEvent {
  id: string;
  title: string;
  city: string;
  eventDate: string;
  ticketPriceUsdc: number;
  maxTickets: number | null;
  status: string;
  organizer: { companyName: string };
}

export default function AdminPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [tab, setTab]           = useState<Tab>("organizers");
  const [organizers, setOrgs]   = useState<PendingOrganizer[]>([]);
  const [events, setEvents]     = useState<PendingEvent[]>([]);
  const [msg, setMsg]           = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function authFetch(url: string, options: RequestInit = {}) {
    const token = await getAccessToken();
    return fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  const loadOrgs   = () => authFetch("/api/admin/organizers?status=PENDING").then((r) => r.json()).then((d) => setOrgs(d.organizers ?? []));
  const loadEvents = () => authFetch("/api/admin/events?status=PENDING_APPROVAL").then((r) => r.json()).then((d) => setEvents(d.events ?? []));

  useEffect(() => {
    if (!ready || !authenticated) return;
    loadOrgs();
    loadEvents();
  }, [ready, authenticated]);

  const action = async (url: string, onSuccess: () => void) => {
    setMsg(null);
    setLoading(true);
    const r = await authFetch(url, { method: "POST" });
    const d = await r.json();
    if (r.ok) { setMsg("OK"); onSuccess(); }
    else setMsg(d.error ?? d.detail ?? "Erro");
    setLoading(false);
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-zinc-500">Login necessário.</p>
        <button onClick={login} className="rounded-lg bg-black px-5 py-2 text-sm text-white">Entrar</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Painel Admin</h1>
        <Link href="/" className="text-sm text-zinc-400">← Catálogo</Link>
      </div>

      <div className="flex gap-2 mb-6">
        {(["organizers","events"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t ? "bg-black text-white" : "border text-zinc-600 hover:bg-zinc-50"
            }`}>
            {t === "organizers" ? `Organizadores (${organizers.length})` : `Eventos (${events.length})`}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm text-zinc-600 border rounded px-3 py-2">{msg}</p>}

      {tab === "organizers" && (
        <div className="flex flex-col gap-3">
          {organizers.length === 0 && <p className="text-zinc-500 text-sm">Nenhum pendente.</p>}
          {organizers.map((o) => (
            <div key={o.id} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="font-medium">{o.companyName}</p>
                <p className="text-xs text-zinc-500">{o.document} · {o.user.email}</p>
                <p className="text-xs text-zinc-400 font-mono truncate">{o.payoutWallet}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button disabled={loading}
                  onClick={() => action(`/api/admin/organizers/${o.id}/approve`, loadOrgs)}
                  className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm disabled:opacity-50">
                  Aprovar
                </button>
                <button disabled={loading}
                  onClick={() => action(`/api/admin/organizers/${o.id}/reject`, loadOrgs)}
                  className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50">
                  Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "events" && (
        <div className="flex flex-col gap-3">
          {events.length === 0 && <p className="text-zinc-500 text-sm">Nenhum pendente.</p>}
          {events.map((e) => (
            <div key={e.id} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <p className="font-medium">{e.title}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(e.eventDate).toLocaleDateString("pt-BR")} · {e.city}
                </p>
                <p className="text-xs text-zinc-400">
                  {e.organizer.companyName} · {e.ticketPriceUsdc} USDC
                  {e.maxTickets ? ` · max ${e.maxTickets}` : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button disabled={loading}
                  onClick={() => action(`/api/admin/events/${e.id}/approve`, loadEvents)}
                  className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm disabled:opacity-50">
                  Aprovar → on-chain
                </button>
                <button disabled={loading}
                  onClick={() => action(`/api/admin/events/${e.id}/reject`, loadEvents)}
                  className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50">
                  Rejeitar
                </button>
                <button disabled={loading}
                  onClick={() => action(`/api/admin/events/${e.id}/pause`, loadEvents)}
                  className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50">
                  {e.status === "PAUSED" ? "Retomar" : "Pausar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

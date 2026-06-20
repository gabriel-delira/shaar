"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

interface OrganizerEvent {
  id: string;
  title: string;
  city: string;
  eventDate: string;
  status: string;
  ticketPriceUsdc: number;
  _count: { tickets: number };
}

interface ApplyForm {
  companyName: string;
  document: string;
  payoutWallet: string;
}

interface NewEventForm {
  title: string;
  description: string;
  venue: string;
  city: string;
  eventDate: string;
  ticketPriceUsdc: string;
  maxTickets: string;
}

export default function OrganizerPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [events, setEvents]         = useState<OrganizerEvent[]>([]);
  const [status, setStatus]         = useState<"loading" | "no-org" | "pending" | "ready">("loading");
  const [applyForm, setApplyForm]   = useState<ApplyForm>({ companyName: "", document: "", payoutWallet: "" });
  const [newEvent, setNewEvent]     = useState<NewEventForm>({
    title: "", description: "", venue: "", city: "",
    eventDate: "", ticketPriceUsdc: "", maxTickets: "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function authFetch(url: string, options: RequestInit = {}) {
    const token = await getAccessToken();
    return fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  useEffect(() => {
    if (!ready || !authenticated) return;
    authFetch("/api/organizer/events").then(async (r) => {
      if (r.status === 403) { setStatus("no-org"); return; }
      const d = await r.json();
      if (d.error === "Organizer not approved yet") { setStatus("pending"); return; }
      setEvents(d.events ?? []);
      setStatus("ready");
    });
  }, [ready, authenticated]);

  const handleApply = async () => {
    setMsg(null);
    const r = await authFetch("/api/organizer/apply", { method: "POST", body: JSON.stringify(applyForm) });
    const d = await r.json();
    if (r.ok) { setMsg("Solicitação enviada! Aguarde a aprovação do admin."); setStatus("pending"); }
    else setMsg(d.error ?? "Erro ao enviar");
  };

  const handleCreateEvent = async () => {
    setMsg(null);
    const r = await authFetch("/api/organizer/events", {
      method: "POST",
      body: JSON.stringify({
        ...newEvent,
        ticketPriceUsdc: parseFloat(newEvent.ticketPriceUsdc),
        maxTickets: newEvent.maxTickets ? parseInt(newEvent.maxTickets) : null,
      }),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg("Evento submetido para aprovação!");
      setEvents((prev) => [d.event, ...prev]);
      setNewEvent({ title:"",description:"",venue:"",city:"",eventDate:"",ticketPriceUsdc:"",maxTickets:"" });
    } else setMsg(d.error ?? "Erro ao criar evento");
  };

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-zinc-500">Faça login para acessar a área do organizador.</p>
        <button onClick={login} className="rounded-lg bg-black px-5 py-2 text-sm text-white">Entrar</button>
      </div>
    );
  }

  if (status === "loading") return <div className="p-10 text-zinc-400">Carregando…</div>;

  if (status === "no-org") {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-xl font-bold mb-6">Seja um organizador</h1>
        <div className="flex flex-col gap-3">
          {(["companyName","document","payoutWallet"] as const).map((f) => (
            <input key={f}
              placeholder={f === "companyName" ? "Nome da empresa" : f === "document" ? "CNPJ" : "Carteira de pagamento (0x…)"}
              value={applyForm[f]}
              onChange={(e) => setApplyForm((p) => ({ ...p, [f]: e.target.value }))}
              className="rounded-lg border px-3 py-2 text-sm"
            />
          ))}
          <button onClick={handleApply} className="rounded-lg bg-black py-2 text-sm text-white">Enviar solicitação</button>
          {msg && <p className="text-sm text-zinc-500">{msg}</p>}
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return <div className="p-10 text-zinc-500">Solicitação em análise. Aguarde a aprovação do administrador.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold">Meus eventos</h1>
        <Link href="/" className="text-sm text-zinc-400">← Catálogo</Link>
      </div>

      {/* New event form */}
      <details className="border rounded-xl p-5 mb-8">
        <summary className="cursor-pointer font-medium text-sm">+ Novo evento</summary>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { f: "title" as const,           ph: "Título do evento" },
            { f: "venue" as const,           ph: "Local / venue" },
            { f: "city" as const,            ph: "Cidade" },
            { f: "eventDate" as const,       ph: "Data (YYYY-MM-DDTHH:MM)", type: "datetime-local" },
            { f: "ticketPriceUsdc" as const, ph: "Preço em USDC (ex: 45.00)" },
            { f: "maxTickets" as const,      ph: "Máximo de ingressos (opcional)" },
          ].map(({ f, ph, type }) => (
            <input key={f} type={type ?? "text"} placeholder={ph}
              value={newEvent[f]}
              onChange={(e) => setNewEvent((p) => ({ ...p, [f]: e.target.value }))}
              className="rounded-lg border px-3 py-2 text-sm"
            />
          ))}
          <textarea placeholder="Descrição (opcional)"
            value={newEvent.description}
            onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
            className="col-span-full rounded-lg border px-3 py-2 text-sm resize-none h-20"
          />
          <button onClick={handleCreateEvent}
            className="col-span-full rounded-lg bg-black py-2 text-sm text-white">
            Submeter para aprovação
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-zinc-500">{msg}</p>}
      </details>

      {/* Events table */}
      {events.length === 0 ? (
        <p className="text-zinc-500 text-sm">Nenhum evento ainda.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-zinc-400">
              <th className="pb-2 font-medium">Evento</th>
              <th className="pb-2 font-medium">Data</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Vendidos</th>
              <th className="pb-2 font-medium">Preço</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-zinc-50">
                <td className="py-2 pr-4 font-medium">{e.title}</td>
                <td className="py-2 pr-4 text-zinc-500">
                  {new Date(e.eventDate).toLocaleDateString("pt-BR")}
                </td>
                <td className="py-2 pr-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    e.status === "ON_SALE"   ? "bg-green-100 text-green-700" :
                    e.status === "PAUSED"    ? "bg-yellow-100 text-yellow-700" :
                    e.status === "REJECTED"  ? "bg-red-100 text-red-700" :
                    "bg-zinc-100 text-zinc-600"
                  }`}>{e.status}</span>
                </td>
                <td className="py-2 pr-4">{e._count.tickets}</td>
                <td className="py-2">{e.ticketPriceUsdc} USDC</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

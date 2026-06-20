"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";

interface CheckinResult {
  ok: boolean;
  tokenId?: number;
  ticketNumber?: number;
  seat?: string | null;
  event?: { title: string; venue: string; city: string; eventDate: string };
  error?: string;
}

export default function CheckinPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [payload, setPayload]   = useState("");
  const [result, setResult]     = useState<CheckinResult | null>(null);
  const [loading, setLoading]   = useState(false);

  // Camera scanning state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError]   = useState("");
  const scanInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const submit = useCallback(async (qrPayload: string) => {
    if (!qrPayload.trim()) return;
    setLoading(true);
    setResult(null);
    const token = await getAccessToken();
    const r = await fetch("/api/checkin", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ qrPayload: qrPayload.trim() }),
    });
    const data = await r.json();
    setResult(data);
    setLoading(false);
    if (data.ok) setPayload("");
  }, [getAccessToken]);

  const startCamera = useCallback(async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      setCameraError("Não foi possível acessar a câmera. Use o campo de texto para colar o payload.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (scanInterval.current) clearInterval(scanInterval.current);
    setCameraActive(false);
  }, []);

  // Try to decode QR from canvas every 500ms using the BarcodeDetector API (where supported)
  useEffect(() => {
    if (!cameraActive) return;
    if (!("BarcodeDetector" in window)) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });

    scanInterval.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      canvasRef.current.width  = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      try {
        const barcodes = await detector.detect(canvasRef.current);
        if (barcodes.length > 0) {
          const raw = barcodes[0].rawValue as string;
          if (raw.startsWith("shaar:")) {
            stopCamera();
            await submit(raw);
          }
        }
      } catch { /* detector not ready yet */ }
    }, 500);

    return () => { if (scanInterval.current) clearInterval(scanInterval.current); };
  }, [cameraActive, stopCamera, submit]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  if (!ready) return <p className="p-8 text-zinc-400">Carregando…</p>;

  if (!authenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <p className="text-zinc-500 mb-4">Faça login para acessar o scanner de check-in.</p>
        <button onClick={login} className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800">
          Entrar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="text-sm text-zinc-400 hover:text-black">← Voltar</Link>
        <h1 className="text-xl font-bold">Check-in</h1>
        <span />
      </header>

      {/* Camera scanner */}
      <div className="mb-6">
        {!cameraActive ? (
          <button
            onClick={startCamera}
            className="w-full border-2 border-dashed border-zinc-300 rounded-xl py-10 text-zinc-500 hover:border-black hover:text-black transition-colors text-sm"
          >
            Abrir câmera para escanear QR
          </button>
        ) : (
          <div className="relative rounded-xl overflow-hidden bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="w-full" playsInline />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-56 border-4 border-white rounded-2xl opacity-70" />
            </div>
            <button
              onClick={stopCamera}
              className="absolute top-3 right-3 bg-black/60 text-white text-xs px-3 py-1.5 rounded-lg"
            >
              Fechar câmera
            </button>
          </div>
        )}
        {cameraError && <p className="text-xs text-red-500 mt-2">{cameraError}</p>}
        {cameraActive && !("BarcodeDetector" in window) && (
          <p className="text-xs text-amber-600 mt-2">
            Câmera ativa, mas detecção automática de QR não suportada neste navegador. Cole o payload abaixo.
          </p>
        )}
      </div>

      {/* Manual input fallback */}
      <div className="flex flex-col gap-3 mb-6">
        <label className="text-sm font-medium text-zinc-700">Ou cole o payload do QR manualmente:</label>
        <textarea
          rows={3}
          className="border rounded-xl p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-black"
          placeholder="shaar:v1:0:12345678:abcd1234abcd1234"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <button
          onClick={() => submit(payload)}
          disabled={loading || !payload.trim()}
          className="rounded-lg bg-black text-white py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Validando…" : "Validar QR"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded-xl p-5 ${result.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          {result.ok ? (
            <>
              <p className="font-bold text-green-700 mb-1">✓ Check-in realizado!</p>
              <p className="text-sm text-green-800">{result.event?.title}</p>
              <p className="text-xs text-green-700 mt-1">
                Ingresso #{result.ticketNumber}{result.seat ? ` · Assento ${result.seat}` : ""} · Token #{result.tokenId}
              </p>
              <p className="text-xs text-green-600">
                {result.event?.venue}, {result.event?.city} · {result.event?.eventDate && new Date(result.event.eventDate).toLocaleString("pt-BR")}
              </p>
            </>
          ) : (
            <p className="font-medium text-red-700">✗ {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

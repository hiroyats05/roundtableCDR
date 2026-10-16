import { useState } from "react";
import {
  estimateMbps,
  FPS_OPTIONS,
  loadQuality,
  RESOLUTIONS,
  saveQuality,
  type ScreenShareContent,
  type ScreenShareQuality,
} from "../livekit/screenShareQuality";

interface ScreenShareModalProps {
  onStart: (quality: ScreenShareQuality) => Promise<void>;
  onClose: () => void;
}

const CONTENT_OPTIONS: { value: ScreenShareContent; label: string; hint: string }[] = [
  { value: "detail", label: "Nitidez", hint: "Texto, código, slides" },
  { value: "motion", label: "Fluidez", hint: "Jogos, vídeos" },
];

export function ScreenShareModal({ onStart, onClose }: ScreenShareModalProps) {
  const [quality, setQuality] = useState<ScreenShareQuality>(loadQuality);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const update = (patch: Partial<ScreenShareQuality>) => setQuality((q) => ({ ...q, ...patch }));

  const handleStart = async () => {
    setError("");
    setStarting(true);
    saveQuality(quality);
    try {
      await onStart(quality);
      onClose();
    } catch (err) {
      // The user cancelling the native picker is not an error worth showing.
      if (err instanceof Error && err.name === "NotAllowedError") {
        setStarting(false);
        return;
      }
      setError(err instanceof Error ? err.message : "Não foi possível iniciar o compartilhamento.");
      setStarting(false);
    }
  };

  return (
    <div className="mic-test-overlay" onClick={onClose}>
      <div className="mic-test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mic-test-header">
          <h3>Compartilhar tela</h3>
          <button className="sidebar-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="share-field">
          <span className="share-field-label">Resolução</span>
          <div className="segmented">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                className={quality.resolution === r.value ? "selected" : ""}
                onClick={() => update({ resolution: r.value })}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="share-field">
          <span className="share-field-label">Taxa de quadros</span>
          <div className="segmented">
            {FPS_OPTIONS.map((fps) => (
              <button
                key={fps}
                className={quality.fps === fps ? "selected" : ""}
                onClick={() => update({ fps })}
              >
                {fps} fps
              </button>
            ))}
          </div>
        </div>

        <div className="share-field">
          <span className="share-field-label">Priorizar</span>
          <div className="segmented">
            {CONTENT_OPTIONS.map((c) => (
              <button
                key={c.value}
                className={quality.content === c.value ? "selected" : ""}
                onClick={() => update({ content: c.value })}
                title={c.hint}
              >
                {c.label}
                <small>{c.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <label className="share-checkbox">
          <input
            type="checkbox"
            checked={quality.audio}
            onChange={(e) => update({ audio: e.target.checked })}
          />
          Compartilhar áudio do sistema/aba
        </label>

        <p className="mic-test-hint">
          Até ~{estimateMbps(quality)} Mbps de upload. Se a conexão não aguentar, a qualidade cai
          automaticamente.
        </p>

        {error && <p className="error">{error}</p>}

        <button className="mic-test-record-button" onClick={() => void handleStart()} disabled={starting}>
          {starting ? "Escolha a tela ou janela..." : "🖥 Iniciar compartilhamento"}
        </button>
      </div>
    </div>
  );
}

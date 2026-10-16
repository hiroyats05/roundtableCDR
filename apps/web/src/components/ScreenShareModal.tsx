import { useCallback, useEffect, useState } from "react";
import {
  estimateMbps,
  FPS_OPTIONS,
  loadQuality,
  RESOLUTIONS,
  saveQuality,
  type ScreenShareContent,
  type ScreenShareQuality,
} from "../livekit/screenShareQuality";
import { isDesktop } from "../services/api";
import { nativeShare, type CaptureSource } from "../native/share";

interface ScreenShareModalProps {
  /** sourceId is set when sharing natively from the desktop app's own picker. */
  onStart: (quality: ScreenShareQuality, sourceId?: string) => Promise<void>;
  onClose: () => void;
}

const CONTENT_OPTIONS: { value: ScreenShareContent; label: string; hint: string }[] = [
  { value: "detail", label: "Nitidez", hint: "Texto, código, slides" },
  { value: "motion", label: "Fluidez", hint: "Jogos, vídeos" },
];

// Tauri command errors arrive as plain strings.
function errorMessage(err: unknown, fallback: string) {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return fallback;
}

function SourcePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (source: CaptureSource) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"window" | "screen">("window");

  const load = useCallback(() => {
    setError("");
    setSources(null);
    nativeShare
      .listSources()
      .then(setSources)
      .catch((err) => setError(errorMessage(err, "Não foi possível listar as telas e janelas.")));
  }, []);

  useEffect(load, [load]);

  const visible = sources?.filter((s) => s.kind === tab) ?? [];

  return (
    <div className="share-field">
      <div className="source-tabs">
        <div className="segmented">
          <button className={tab === "window" ? "selected" : ""} onClick={() => setTab("window")}>
            Janelas
          </button>
          <button className={tab === "screen" ? "selected" : ""} onClick={() => setTab("screen")}>
            Telas
          </button>
        </div>
        <button className="source-refresh" onClick={load} title="Atualizar lista" aria-label="Atualizar lista">
          ⟳
        </button>
      </div>

      {error ? (
        <p className="error">{error}</p>
      ) : !sources ? (
        <p className="mic-test-hint">Carregando janelas...</p>
      ) : visible.length === 0 ? (
        <p className="mic-test-hint">Nada para compartilhar aqui.</p>
      ) : (
        <div className="source-grid">
          {visible.map((source) => (
            <button
              key={source.id}
              className={`source-card ${selectedId === source.id ? "selected" : ""}`}
              onClick={() => onSelect(source)}
              title={source.appName ? `${source.appName} — ${source.title}` : source.title}
            >
              <div className="source-thumb">
                {source.thumbnail ? <img src={source.thumbnail} alt="" /> : <span>🖥</span>}
              </div>
              <span className="source-title">{source.title}</span>
              {source.appName && source.appName !== source.title && (
                <span className="source-app">{source.appName}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScreenShareModal({ onStart, onClose }: ScreenShareModalProps) {
  const [quality, setQuality] = useState<ScreenShareQuality>(loadQuality);
  const [source, setSource] = useState<CaptureSource | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const update = (patch: Partial<ScreenShareQuality>) => setQuality((q) => ({ ...q, ...patch }));

  // In the desktop app audio is captured from the app that owns the window, so
  // it only makes sense for windows.
  const canShareAudio = !isDesktop || source?.kind === "window";
  const audioLabel = isDesktop
    ? source?.kind === "window"
      ? `Compartilhar o áudio de ${source.appName ?? source.title}`
      : "Compartilhar áudio (escolha uma janela)"
    : "Compartilhar áudio do sistema/aba";

  const handleStart = async () => {
    if (isDesktop && !source) return;
    setError("");
    setStarting(true);
    saveQuality(quality);
    try {
      await onStart({ ...quality, audio: quality.audio && canShareAudio }, source?.id);
      onClose();
    } catch (err) {
      // The user cancelling the browser's picker is not an error worth showing.
      if (err instanceof Error && err.name === "NotAllowedError") {
        setStarting(false);
        return;
      }
      setError(errorMessage(err, "Não foi possível iniciar o compartilhamento."));
      setStarting(false);
    }
  };

  return (
    <div className="mic-test-overlay" onClick={onClose}>
      <div className={`mic-test-modal ${isDesktop ? "share-modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="mic-test-header">
          <h3>Compartilhar tela</h3>
          <button className="sidebar-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {isDesktop && <SourcePicker selectedId={source?.id ?? null} onSelect={setSource} />}

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

        <label className={`share-checkbox ${canShareAudio ? "" : "disabled"}`}>
          <input
            type="checkbox"
            checked={quality.audio && canShareAudio}
            disabled={!canShareAudio}
            onChange={(e) => update({ audio: e.target.checked })}
          />
          {audioLabel}
        </label>
        {isDesktop && canShareAudio && quality.audio && (
          <p className="mic-test-hint">Só o som desse app é transmitido; o áudio da chamada fica de fora.</p>
        )}
        {!isDesktop && quality.audio && (
          <p className="mic-test-hint">
            ⚠️ Se alguém ouvir eco, prefira compartilhar só uma aba/janela ou use fone de ouvido.
          </p>
        )}

        <p className="mic-test-hint">
          Até ~{estimateMbps(quality)} Mbps de upload. Se a conexão não aguentar, a qualidade cai
          automaticamente.
        </p>

        {error && <p className="error">{error}</p>}

        <button
          className="mic-test-record-button"
          onClick={() => void handleStart()}
          disabled={starting || (isDesktop && !source)}
        >
          {starting
            ? isDesktop
              ? "Iniciando..."
              : "Escolha a tela ou janela..."
            : isDesktop && !source
              ? "Escolha uma janela ou tela"
              : "🖥 Iniciar compartilhamento"}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type LocalAudioTrack, type RemoteAudioTrack } from "livekit-client";
import { api } from "../services/api";

const RECORD_DURATION_MS = 5000;
const CONNECT_TIMEOUT_MS = 10000;

type TestState = "idle" | "connecting" | "recording" | "playing" | "done" | "error";

interface TransmissionStats {
  rttMs?: number;
  jitterMs?: number;
  lossPercent?: number;
  bitrateKbps?: number;
}

interface VoiceTransmissionTestModalProps {
  onClose: () => void;
}

function verdict(stats: TransmissionStats): { label: string; className: string } {
  const rtt = stats.rttMs ?? 0;
  const loss = stats.lossPercent ?? 0;
  const jitter = stats.jitterMs ?? 0;
  if (rtt > 300 || loss > 5 || jitter > 50) return { label: "Ruim", className: "stat-bad" };
  if (rtt > 150 || loss > 1 || jitter > 30) return { label: "Razoável", className: "stat-ok" };
  return { label: "Boa", className: "stat-good" };
}

function formatStat(value: number | undefined, unit: string, digits = 0) {
  return value === undefined ? "—" : `${value.toFixed(digits)} ${unit}`;
}

/**
 * Sends the mic through LiveKit and listens back with a second connection, so the
 * user hears exactly what other participants receive (codec, noise suppression,
 * network) instead of the raw local mic like MicTestModal.
 */
export function VoiceTransmissionTestModal({ onClose }: VoiceTransmissionTestModalProps) {
  const [state, setState] = useState<TestState>("idle");
  const [error, setError] = useState("");
  const [stats, setStats] = useState<TransmissionStats>({});
  const [remaining, setRemaining] = useState(RECORD_DURATION_MS / 1000);

  const levelBarRef = useRef<HTMLDivElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const runTest = async () => {
    cleanupRef.current?.();
    setError("");
    setStats({});
    setRemaining(RECORD_DURATION_MS / 1000);
    setState("connecting");

    const publisher = new Room();
    const listener = new Room();
    const timers: number[] = [];
    let rafId: number | null = null;
    let audioCtx: AudioContext | null = null;
    let sinkEl: HTMLAudioElement | null = null;

    const cleanup = () => {
      timers.forEach((t) => clearTimeout(t));
      timers.forEach((t) => clearInterval(t));
      if (rafId) cancelAnimationFrame(rafId);
      void audioCtx?.close();
      if (sinkEl) sinkEl.srcObject = null;
      void publisher.disconnect();
      void listener.disconnect();
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    const fail = (message: string) => {
      cleanup();
      setError(message);
      setState("error");
    };

    try {
      const { url, publisherToken, listenerToken } = await api.getVoiceTestTokens();

      const remoteTrack = new Promise<RemoteAudioTrack>((resolve) => {
        listener.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) resolve(track as RemoteAudioTrack);
        });
      });

      await listener.connect(url, listenerToken);
      await publisher.connect(url, publisherToken);
      await publisher.localParticipant.setMicrophoneEnabled(true);

      const localTrack = publisher.localParticipant.getTrackPublication(Track.Source.Microphone)
        ?.track as LocalAudioTrack | undefined;

      const track = await Promise.race([
        remoteTrack,
        new Promise<null>((resolve) => timers.push(window.setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS))),
      ]);
      if (!track) {
        fail("O áudio não voltou do servidor. Verifique se o LiveKit está acessível.");
        return;
      }

      const stream = new MediaStream([track.mediaStreamTrack]);

      // Chrome only pulls remote WebRTC audio into Web Audio / MediaRecorder when
      // the stream is also attached to a media element, so play it muted.
      sinkEl = new Audio();
      sinkEl.muted = true;
      sinkEl.srcObject = stream;
      void sinkEl.play().catch(() => {});

      audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        if (levelBarRef.current) {
          levelBarRef.current.style.width = `${Math.min(100, Math.round((avg / 255) * 160))}%`;
        }
        rafId = requestAnimationFrame(tick);
      };
      tick();

      let lastBytes: { bytes: number; time: number } | null = null;
      const collectStats = async () => {
        const [sender, receiver] = await Promise.all([localTrack?.getSenderStats(), track.getReceiverStats()]);
        const next: TransmissionStats = {};
        if (sender?.roundTripTime !== undefined) next.rttMs = sender.roundTripTime * 1000;
        if (receiver) {
          if (receiver.jitter !== undefined) next.jitterMs = receiver.jitter * 1000;
          const lost = receiver.packetsLost ?? 0;
          const received = receiver.packetsReceived ?? 0;
          if (lost + received > 0) next.lossPercent = (lost / (lost + received)) * 100;
          if (receiver.bytesReceived !== undefined) {
            const now = performance.now();
            if (lastBytes) {
              const seconds = (now - lastBytes.time) / 1000;
              next.bitrateKbps = ((receiver.bytesReceived - lastBytes.bytes) * 8) / 1000 / seconds;
            }
            lastBytes = { bytes: receiver.bytesReceived, time: now };
          }
        }
        setStats((prev) => ({ ...prev, ...next }));
      };
      timers.push(window.setInterval(() => void collectStats(), 1000));

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        void collectStats().finally(cleanup);
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = URL.createObjectURL(blob);
        if (levelBarRef.current) levelBarRef.current.style.width = "0%";
        if (audioElRef.current) {
          audioElRef.current.src = audioUrlRef.current;
          setState("playing");
          void audioElRef.current.play().catch(() => setState("done"));
        }
      };

      setState("recording");
      recorder.start();
      const startedAt = Date.now();
      timers.push(
        window.setInterval(() => {
          setRemaining(Math.max(0, Math.ceil((RECORD_DURATION_MS - (Date.now() - startedAt)) / 1000)));
        }, 250)
      );
      timers.push(
        window.setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, RECORD_DURATION_MS)
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : "Falha no teste de transmissão.");
    }
  };

  const busy = state === "connecting" || state === "recording";
  const hasStats = stats.rttMs !== undefined || stats.jitterMs !== undefined;
  const quality = verdict(stats);

  return (
    <div className="mic-test-overlay" onClick={onClose}>
      <div className="mic-test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mic-test-header">
          <h3>Testar transmissão de áudio</h3>
          <button className="sidebar-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <p className="mic-test-hint">
          Seu microfone vai até o servidor de voz e volta. Você escuta exatamente o que os outros
          ouvem, já com a compressão e a rede.
        </p>

        <div className="mic-level-track">
          <div ref={levelBarRef} className="mic-level-fill" />
        </div>

        {state === "error" && <p className="error">{error}</p>}

        <button onClick={() => void runTest()} disabled={busy} className="mic-test-record-button">
          {state === "connecting"
            ? "Conectando ao servidor..."
            : state === "recording"
              ? `🔴 Fale agora... ${remaining}s`
              : state === "idle"
                ? "📡 Iniciar teste (5s)"
                : "🔁 Testar de novo"}
        </button>

        {state === "playing" && <p className="mic-test-hint transmission-playing">🔊 Tocando o que chegou do servidor...</p>}

        {hasStats && (
          <div className="transmission-stats">
            <div>
              <span>Latência (ida e volta)</span>
              <strong>{formatStat(stats.rttMs, "ms")}</strong>
            </div>
            <div>
              <span>Jitter</span>
              <strong>{formatStat(stats.jitterMs, "ms")}</strong>
            </div>
            <div>
              <span>Perda de pacotes</span>
              <strong>{formatStat(stats.lossPercent, "%", 1)}</strong>
            </div>
            <div>
              <span>Bitrate recebido</span>
              <strong>{formatStat(stats.bitrateKbps, "kbps")}</strong>
            </div>
            {(state === "playing" || state === "done") && (
              <div className="transmission-verdict">
                <span>Conexão</span>
                <strong className={quality.className}>{quality.label}</strong>
              </div>
            )}
          </div>
        )}

        <audio ref={audioElRef} onEnded={() => setState("done")} style={{ display: "none" }} />
      </div>
    </div>
  );
}

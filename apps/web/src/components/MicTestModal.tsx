import { useEffect, useRef, useState } from "react";

const RECORD_DURATION_MS = 3000;

type TestState = "idle" | "recording" | "playing" | "error";

interface MicTestModalProps {
  onClose: () => void;
}

export function MicTestModal({ onClose }: MicTestModalProps) {
  const [state, setState] = useState<TestState>("idle");
  const [error, setError] = useState("");
  const levelBarRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
          const level = Math.min(100, Math.round((avg / 255) * 160));
          if (levelBarRef.current) {
            levelBarRef.current.style.width = `${level}%`;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {
        setState("error");
        setError("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
      });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || state === "recording") return;

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      if (audioElRef.current) {
        audioElRef.current.src = url;
        setState("playing");
        void audioElRef.current.play().catch(() => {});
      }
    };

    setState("recording");
    recorder.start();
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, RECORD_DURATION_MS);
  };

  const handleClose = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    onClose();
  };

  return (
    <div className="mic-test-overlay" onClick={handleClose}>
      <div className="mic-test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mic-test-header">
          <h3>Testar microfone</h3>
          <button className="sidebar-close" onClick={handleClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        {state === "error" ? (
          <p className="error">{error}</p>
        ) : (
          <>
            <p className="mic-test-hint">Fale algo para ver o nível do seu microfone.</p>
            <div className="mic-level-track">
              <div ref={levelBarRef} className="mic-level-fill" />
            </div>

            <button
              onClick={startRecording}
              disabled={state === "recording"}
              className="mic-test-record-button"
            >
              {state === "recording"
                ? "🔴 Gravando..."
                : state === "playing"
                  ? "🔁 Gravar de novo"
                  : "🎙 Gravar teste (3s)"}
            </button>

            {state === "playing" && <p className="mic-test-hint">🔊 Tocando sua gravação...</p>}

            <audio
              ref={audioElRef}
              onEnded={() => setState("idle")}
              style={{ display: "none" }}
            />
          </>
        )}
      </div>
    </div>
  );
}

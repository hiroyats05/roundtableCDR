import type { AudioReception, ListenerReport } from "../livekit/useLiveKit";

export interface MyAudio {
  mic: boolean;
  screen: boolean;
}

const LABELS: Record<AudioReception | "unknown", { icon: string; text: string }> = {
  hearing: { icon: "👂", text: "está ouvindo" },
  deafened: { icon: "🙉", text: "está com o áudio desligado (deafen)" },
  blocked: { icon: "🔈", text: "não ouve: o áudio está bloqueado no app dele" },
  "no-data": { icon: "⚠️", text: "não está recebendo dados de áudio" },
  connecting: { icon: "…", text: "está conectando ao seu áudio" },
  unknown: { icon: "?", text: "não confirmou (app desatualizado ou sem conexão)" },
};

/** Whether a listener is confirmed to be hearing everything I'm currently sending. */
export function isHearingMe(report: ListenerReport | undefined, myAudio: MyAudio): boolean {
  if (!report) return false;
  if (myAudio.mic && report.mic !== "hearing") return false;
  if (myAudio.screen && report.screen !== "hearing") return false;
  return true;
}

interface ReceptionBadgeProps {
  name: string;
  report: ListenerReport | undefined;
  myAudio: MyAudio;
}

export function ReceptionBadge({ name, report, myAudio }: ReceptionBadgeProps) {
  if (!myAudio.mic && !myAudio.screen) return null;

  const parts: { key: string; prefix: string; what: string; status: AudioReception | "unknown" }[] = [];
  if (myAudio.mic) parts.push({ key: "mic", prefix: "", what: "seu microfone", status: report?.mic ?? "unknown" });
  if (myAudio.screen)
    parts.push({ key: "screen", prefix: "🖥", what: "o áudio do seu share", status: report?.screen ?? "unknown" });

  return (
    <span className="reception-badges">
      {parts.map((part) => (
        <span
          key={part.key}
          className={`reception reception-${part.status}`}
          title={`${name} ${LABELS[part.status].text} (${part.what})`}
        >
          {part.prefix}
          {LABELS[part.status].icon}
        </span>
      ))}
    </span>
  );
}

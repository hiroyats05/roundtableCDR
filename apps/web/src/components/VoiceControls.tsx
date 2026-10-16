import { useState } from "react";
import { MicTestModal } from "./MicTestModal";
import { ScreenShareModal } from "./ScreenShareModal";
import { VoiceTransmissionTestModal } from "./VoiceTransmissionTestModal";
import type { ScreenShareQuality } from "../livekit/screenShareQuality";
import type { ListenerReport, VoiceParticipant } from "../livekit/useLiveKit";
import { isHearingMe, type MyAudio } from "./ReceptionBadge";

interface VoiceControlsProps {
  username: string;
  isConnected: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  participants: VoiceParticipant[];
  listenerReports: Map<string, ListenerReport>;
  myAudio: MyAudio;
  canPlayAudio: boolean;
  onStartAudio: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onStartScreenShare: (quality: ScreenShareQuality, sourceId?: string) => Promise<void>;
  onStopScreenShare: () => void;
  onDisconnect: () => void;
  onLogout: () => void;
}

export function VoiceControls({
  username,
  isConnected,
  isMuted,
  isDeafened,
  isScreenSharing,
  participants,
  listenerReports,
  myAudio,
  canPlayAudio,
  onStartAudio,
  onToggleMute,
  onToggleDeafen,
  onStartScreenShare,
  onStopScreenShare,
  onDisconnect,
  onLogout,
}: VoiceControlsProps) {
  const [micTestOpen, setMicTestOpen] = useState(false);
  const [transmissionTestOpen, setTransmissionTestOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const sendingAudio = myAudio.mic || myAudio.screen;
  const hearing = participants.filter((p) => isHearingMe(listenerReports.get(p.identity), myAudio));
  const notHearing = participants.filter((p) => !hearing.includes(p));
  const hearingTitle = [
    hearing.length ? `Ouvindo: ${hearing.map((p) => p.name).join(", ")}` : "",
    notHearing.length ? `Sem confirmação: ${notHearing.map((p) => p.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <footer className="voice-controls">
      <span className="voice-user">{username}</span>

      <button onClick={() => setMicTestOpen(true)}>🎙 Testar microfone</button>

      <button onClick={() => setTransmissionTestOpen(true)}>📡 Testar transmissão</button>

      {micTestOpen && <MicTestModal onClose={() => setMicTestOpen(false)} />}
      {transmissionTestOpen && <VoiceTransmissionTestModal onClose={() => setTransmissionTestOpen(false)} />}
      {shareModalOpen && (
        <ScreenShareModal onStart={onStartScreenShare} onClose={() => setShareModalOpen(false)} />
      )}

      {isConnected && (
        <>
          {!canPlayAudio && (
            <button onClick={onStartAudio} className="active-danger">
              🔈 Ativar áudio
            </button>
          )}
          {sendingAudio && participants.length > 0 && (
            <span
              className={`hearing-summary ${notHearing.length === 0 ? "all" : hearing.length === 0 ? "none" : "some"}`}
              title={hearingTitle}
            >
              👂 {hearing.length}/{participants.length} te ouvindo
            </span>
          )}
          <button onClick={onToggleMute} className={isMuted ? "active-danger" : ""}>
            {isMuted ? "🔇 Unmute" : "🎤 Mute"}
          </button>
          <button onClick={onToggleDeafen} className={isDeafened ? "active-danger" : ""}>
            {isDeafened ? "🔈 Undeafen" : "🔊 Deafen"}
          </button>
          <button
            onClick={isScreenSharing ? onStopScreenShare : () => setShareModalOpen(true)}
            className={isScreenSharing ? "active" : ""}
          >
            {isScreenSharing ? "🖥 Stop Share" : "🖥 Share"}
          </button>
          <button onClick={onDisconnect} className="danger">
            Disconnect
          </button>
        </>
      )}

      <button onClick={onLogout} className="logout-button">
        Sair
      </button>
    </footer>
  );
}

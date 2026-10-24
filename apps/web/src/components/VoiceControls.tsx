import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Ear,
  EarSlash,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Screencast,
  SignOut,
  SpeakerHigh,
  User,
  Waveform,
} from "@phosphor-icons/react";
import { MicTestModal } from "./MicTestModal";
import { ScreenShareModal } from "./ScreenShareModal";
import { VoiceTransmissionTestModal } from "./VoiceTransmissionTestModal";
import type { ScreenShareQuality } from "../livekit/screenShareQuality";
import type { ListenerReport, VoiceParticipant } from "../livekit/useLiveKit";
import { isHearingMe, type MyAudio } from "./ReceptionBadge";

interface VoiceControlsProps {
  username: string;
  voiceChannelName: string | null;
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
  voiceChannelName,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const isConnected = voiceChannelName !== null;
  const sendingAudio = myAudio.mic || myAudio.screen;
  const hearing = participants.filter((p) => isHearingMe(listenerReports.get(p.identity), myAudio));
  const notHearing = participants.filter((p) => !hearing.includes(p));
  const hearingTitle = [
    hearing.length ? `Ouvindo: ${hearing.map((p) => p.name).join(", ")}` : "",
    notHearing.length ? `Sem confirmação: ${notHearing.map((p) => p.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const menuAction = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div className="user-panel-area" ref={menuRef}>
      {/* Portaled: the sidebar is transformed on mobile, which would trap fixed overlays. */}
      {createPortal(
        <>
          {micTestOpen && <MicTestModal onClose={() => setMicTestOpen(false)} />}
          {transmissionTestOpen && <VoiceTransmissionTestModal onClose={() => setTransmissionTestOpen(false)} />}
          {shareModalOpen && (
            <ScreenShareModal onStart={onStartScreenShare} onClose={() => setShareModalOpen(false)} />
          )}
        </>,
        document.body
      )}

      {menuOpen && (
        <div className="user-menu" role="menu">
          <span className="user-menu-name">{username}</span>
          <button role="menuitem" onClick={menuAction(() => setMicTestOpen(true))}>
            <Microphone size={16} /> Testar microfone
          </button>
          <button role="menuitem" onClick={menuAction(() => setTransmissionTestOpen(true))}>
            <Waveform size={16} /> Testar transmissão
          </button>
          <button role="menuitem" className="danger" onClick={menuAction(onLogout)}>
            <SignOut size={16} /> Sair
          </button>
        </div>
      )}

      {isConnected && (
        <div className="voice-status">
          <span className="voice-status-channel" title={`Conectado em #${voiceChannelName}`}>
            #{voiceChannelName}
          </span>
          {sendingAudio && participants.length > 0 && (
            <span
              className={`hearing-summary ${notHearing.length === 0 ? "all" : hearing.length === 0 ? "none" : "some"}`}
              title={hearingTitle}
            >
              <Ear size={12} /> {hearing.length}/{participants.length}
            </span>
          )}
          {!canPlayAudio && (
            <button className="icon-button danger" onClick={onStartAudio} title="Ativar áudio" aria-label="Ativar áudio">
              <SpeakerHigh size={18} />
            </button>
          )}
          <button className="icon-button danger" onClick={onDisconnect} title="Desconectar" aria-label="Desconectar">
            <PhoneDisconnect size={18} />
          </button>
        </div>
      )}

      <div className="user-panel">
        <button
          className="icon-button user-panel-avatar"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`Menu de ${username}`}
          aria-expanded={menuOpen}
          title={username}
        >
          <User size={24} />
        </button>
        <span className="user-panel-name">{username}</span>

        <div className="user-panel-actions">
          <button
            className={`icon-button ${isMuted ? "off" : ""}`}
            onClick={onToggleMute}
            disabled={!isConnected}
            aria-label={isMuted ? "Ativar microfone" : "Mutar microfone"}
            title={isMuted ? "Ativar microfone" : "Mutar microfone"}
          >
            {isMuted ? <MicrophoneSlash size={24} /> : <Microphone size={24} />}
          </button>
          <button
            className={`icon-button ${isDeafened ? "off" : ""}`}
            onClick={onToggleDeafen}
            disabled={!isConnected}
            aria-label={isDeafened ? "Ativar áudio" : "Desativar áudio"}
            title={isDeafened ? "Ativar áudio" : "Desativar áudio"}
          >
            {isDeafened ? <EarSlash size={24} /> : <Ear size={24} />}
          </button>
          <button
            className={`icon-button ${isScreenSharing ? "on" : ""}`}
            onClick={isScreenSharing ? onStopScreenShare : () => setShareModalOpen(true)}
            disabled={!isConnected}
            aria-label={isScreenSharing ? "Parar transmissão" : "Transmitir tela"}
            title={isScreenSharing ? "Parar transmissão" : "Transmitir tela"}
          >
            <Screencast size={24} weight={isScreenSharing ? "fill" : "regular"} />
          </button>
        </div>
      </div>
    </div>
  );
}

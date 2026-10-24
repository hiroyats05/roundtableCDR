import { useState, type ReactNode } from "react";
import {
  ChatCircle,
  Microphone,
  MicrophoneSlash,
  Plus,
  Prohibit,
  Screencast,
  SidebarSimple,
  Trash,
  UserSound,
  X,
} from "@phosphor-icons/react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Channel, ChannelType } from "@saladereunioes/shared";
import type { VoiceParticipant } from "../livekit/useLiveKit";
import { Avatar } from "./Avatar";
import { ReceptionBadge, type MyAudio } from "./ReceptionBadge";

interface ChannelListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  connectedVoiceChannelId: string | null;
  voiceParticipants: Map<string, VoiceParticipant[]>;
  currentUserId: string;
  myAudio: MyAudio;
  isAdmin: boolean;
  isOpen: boolean;
  /** Pinned to the bottom of the sidebar (the user panel). */
  footer: ReactNode;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
  onClose: () => void;
  /** Collapses the column on desktop. */
  onHide: () => void;
  onCreateChannel: (name: string, type: ChannelType) => void;
  onDeleteChannel: (channelId: string) => void;
  onKickParticipant: (channelId: string, userId: string) => void;
  onMuteParticipant: (channelId: string, userId: string) => void;
}

function CreateChannelForm({
  type,
  onCreate,
  onDone,
}: {
  type: ChannelType;
  onCreate: (name: string, type: ChannelType) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, type);
    setName("");
    onDone();
  };

  return (
    <form
      className="create-channel-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        autoFocus
        type="text"
        placeholder="nome do canal"
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        onBlur={onDone}
      />
    </form>
  );
}

export function ChannelList({
  channels,
  selectedChannelId,
  connectedVoiceChannelId,
  voiceParticipants,
  currentUserId,
  myAudio,
  isAdmin,
  isOpen,
  footer,
  onSelectTextChannel,
  onJoinVoiceChannel,
  onClose,
  onHide,
  onCreateChannel,
  onDeleteChannel,
  onKickParticipant,
  onMuteParticipant,
}: ChannelListProps) {
  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");

  const handleDeleteChannel = (e: React.MouseEvent, channelId: string, name: string) => {
    e.stopPropagation();
    setPendingDelete({ id: channelId, name });
  };

  return (
    <aside className={`channel-list ${isOpen ? "open" : ""}`}>
      <div className="channel-list-header">
        <span>Roundtable Server</span>
        <button className="icon-button column-hide-button" onClick={onHide} aria-label="Esconder canais" title="Esconder canais">
          <SidebarSimple size={18} />
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Fechar">
          <X size={18} />
        </button>
      </div>

      <div className="channel-sections">
        <div className="channel-section">
          <div className="channel-section-header">
            <ChatCircle size={24} className="channel-section-icon" />
            <h3>TEXT</h3>
            {isAdmin && (
              <button className="add-channel-button" onClick={() => setCreating("TEXT")} aria-label="Criar canal de texto">
                <Plus size={10} weight="bold" />
              </button>
            )}
          </div>
          {isAdmin && creating === "TEXT" && (
            <CreateChannelForm type="TEXT" onCreate={onCreateChannel} onDone={() => setCreating(null)} />
          )}
          {textChannels.map((channel) => (
            <div key={channel.id} className="channel-item-row">
              <button
                className={`channel-item ${selectedChannelId === channel.id ? "active" : ""}`}
                onClick={() => onSelectTextChannel(channel.id)}
              >
                #{channel.name}
              </button>
              {isAdmin && (
                <button
                  className="channel-delete-button"
                  onClick={(e) => handleDeleteChannel(e, channel.id, channel.name)}
                  aria-label={`Apagar ${channel.name}`}
                >
                  <Trash size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="channel-section">
          <div className="channel-section-header">
            <UserSound size={24} className="channel-section-icon" />
            <h3>VOICE</h3>
            {isAdmin && (
              <button className="add-channel-button" onClick={() => setCreating("VOICE")} aria-label="Criar canal de voz">
                <Plus size={10} weight="bold" />
              </button>
            )}
          </div>
          {isAdmin && creating === "VOICE" && (
            <CreateChannelForm type="VOICE" onCreate={onCreateChannel} onDone={() => setCreating(null)} />
          )}
          {voiceChannels.map((channel) => {
            const participants = voiceParticipants.get(channel.id) ?? [];
            const isConnected = connectedVoiceChannelId === channel.id;

            return (
              <div key={channel.id} className="voice-channel">
                <div className="channel-item-row">
                  <button
                    className={`channel-item voice ${isConnected ? "active" : ""}`}
                    onClick={() => onJoinVoiceChannel(channel.id)}
                  >
                    #{channel.name}
                  </button>
                  {isAdmin && (
                    <button
                      className="channel-delete-button"
                      onClick={(e) => handleDeleteChannel(e, channel.id, channel.name)}
                      aria-label={`Apagar ${channel.name}`}
                    >
                      <Trash size={12} />
                    </button>
                  )}
                </div>
                {participants.length > 0 && (
                  <ul className="voice-participants">
                    {participants.map((p) => (
                      <li key={p.identity}>
                        <Avatar size="sm" speaking={p.isSpeaking && !p.isMuted} />
                        <span className="voice-participant-name">{p.name}</span>
                        {p.isMuted ? <MicrophoneSlash size={12} /> : <Microphone size={12} />}
                        {p.isScreenSharing && <Screencast size={12} />}
                        {isConnected && p.identity !== currentUserId && (
                          <ReceptionBadge name={p.name} report={p.reception} myAudio={myAudio} />
                        )}
                        {isAdmin && p.identity !== currentUserId && (
                          <span className="participant-actions">
                            <button
                              onClick={() => onMuteParticipant(channel.id, p.identity)}
                              aria-label={`Mutar ${p.name}`}
                              title={`Mutar ${p.name}`}
                            >
                              <MicrophoneSlash size={12} />
                            </button>
                            <button
                              onClick={() => onKickParticipant(channel.id, p.identity)}
                              aria-label={`Kickar ${p.name}`}
                              title={`Kickar ${p.name}`}
                            >
                              <Prohibit size={12} />
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {footer}

      {pendingDelete && (
        <ConfirmDialog
          message={`Apagar o canal #${pendingDelete.name}?`}
          onConfirm={() => {
            onDeleteChannel(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

import { useState } from "react";
import type { Channel, ChannelType, User, UserRole } from "@saladereunioes/shared";
import type { VoiceParticipant } from "../livekit/useLiveKit";

interface ChannelListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  connectedVoiceChannelId: string | null;
  voiceParticipants: Map<string, VoiceParticipant[]>;
  onlineUsers: Set<string>;
  users: Map<string, User>;
  currentUserId: string;
  isAdmin: boolean;
  isOpen: boolean;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
  onClose: () => void;
  onCreateChannel: (name: string, type: ChannelType) => void;
  onDeleteChannel: (channelId: string) => void;
  onKickParticipant: (channelId: string, userId: string) => void;
  onMuteParticipant: (channelId: string, userId: string) => void;
  onUpdateUserRole: (userId: string, role: UserRole) => void;
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
  onlineUsers,
  users,
  currentUserId,
  isAdmin,
  isOpen,
  onSelectTextChannel,
  onJoinVoiceChannel,
  onClose,
  onCreateChannel,
  onDeleteChannel,
  onKickParticipant,
  onMuteParticipant,
  onUpdateUserRole,
}: ChannelListProps) {
  const [creating, setCreating] = useState<ChannelType | null>(null);

  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");

  const handleDeleteChannel = (e: React.MouseEvent, channelId: string, name: string) => {
    e.stopPropagation();
    if (window.confirm(`Apagar o canal #${name}?`)) {
      onDeleteChannel(channelId);
    }
  };

  return (
    <aside className={`channel-list ${isOpen ? "open" : ""}`}>
      <div className="channel-list-header">
        <span>Sala de Reuniões</span>
        <button className="sidebar-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>

      <div className="channel-section">
        <div className="channel-section-header">
          <h3>TEXT</h3>
          {isAdmin && (
            <button className="add-channel-button" onClick={() => setCreating("TEXT")} aria-label="Criar canal de texto">
              +
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
              # {channel.name}
            </button>
            {isAdmin && (
              <button
                className="channel-delete-button"
                onClick={(e) => handleDeleteChannel(e, channel.id, channel.name)}
                aria-label={`Apagar ${channel.name}`}
              >
                🗑
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="channel-section">
        <div className="channel-section-header">
          <h3>VOICE</h3>
          {isAdmin && (
            <button className="add-channel-button" onClick={() => setCreating("VOICE")} aria-label="Criar canal de voz">
              +
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
                  🔊 {channel.name}
                </button>
                {isAdmin && (
                  <button
                    className="channel-delete-button"
                    onClick={(e) => handleDeleteChannel(e, channel.id, channel.name)}
                    aria-label={`Apagar ${channel.name}`}
                  >
                    🗑
                  </button>
                )}
              </div>
              {participants.length > 0 && (
                <ul className="voice-participants">
                  {participants.map((p) => (
                    <li key={p.identity}>
                      <span>
                        {p.isMuted ? "🔇" : "🎤"} {p.name}
                        {p.isScreenSharing && " 🖥"}
                      </span>
                      {isAdmin && p.identity !== currentUserId && (
                        <span className="participant-actions">
                          <button
                            onClick={() => onMuteParticipant(channel.id, p.identity)}
                            aria-label={`Mutar ${p.name}`}
                          >
                            🔇
                          </button>
                          <button
                            onClick={() => onKickParticipant(channel.id, p.identity)}
                            aria-label={`Kickar ${p.name}`}
                          >
                            ⛔
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

      <div className="online-section">
        <h3>Online — {onlineUsers.size}</h3>
        <ul className="online-users">
          {Array.from(onlineUsers).map((userId) => {
            const u = users.get(userId);
            const isSelf = userId === currentUserId;
            return (
              <li key={userId}>
                <span className="online-dot" />
                <span className="online-name">
                  {u?.role === "ADMIN" && "👑 "}
                  {u?.username ?? userId}
                  {isSelf && " (você)"}
                </span>
                {isAdmin && !isSelf && u && (
                  <button
                    className="role-toggle-button"
                    onClick={() => onUpdateUserRole(userId, u.role === "ADMIN" ? "MEMBER" : "ADMIN")}
                  >
                    {u.role === "ADMIN" ? "Rebaixar" : "Promover"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

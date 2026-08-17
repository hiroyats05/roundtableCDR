import type { Channel } from "@saladereunioes/shared";
import type { VoiceParticipant } from "../livekit/useLiveKit";

interface ChannelListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  connectedVoiceChannelId: string | null;
  voiceParticipants: Map<string, VoiceParticipant[]>;
  onlineUsers: Set<string>;
  userMap: Map<string, string>;
  currentUserId: string;
  onSelectTextChannel: (channelId: string) => void;
  onJoinVoiceChannel: (channelId: string) => void;
}

export function ChannelList({
  channels,
  selectedChannelId,
  connectedVoiceChannelId,
  voiceParticipants,
  onlineUsers,
  userMap,
  currentUserId,
  onSelectTextChannel,
  onJoinVoiceChannel,
}: ChannelListProps) {
  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");

  return (
    <aside className="channel-list">
      <div className="channel-section">
        <h3>TEXT</h3>
        {textChannels.map((channel) => (
          <button
            key={channel.id}
            className={`channel-item ${selectedChannelId === channel.id ? "active" : ""}`}
            onClick={() => onSelectTextChannel(channel.id)}
          >
            # {channel.name}
          </button>
        ))}
      </div>

      <div className="channel-section">
        <h3>VOICE</h3>
        {voiceChannels.map((channel) => {
          const participants = voiceParticipants.get(channel.id) ?? [];
          const isConnected = connectedVoiceChannelId === channel.id;

          return (
            <div key={channel.id} className="voice-channel">
              <button
                className={`channel-item voice ${isConnected ? "active" : ""}`}
                onClick={() => onJoinVoiceChannel(channel.id)}
              >
                🔊 {channel.name}
              </button>
              {participants.length > 0 && (
                <ul className="voice-participants">
                  {participants.map((p) => (
                    <li key={p.identity}>
                      {p.isMuted ? "🔇" : "🎤"} {p.name}
                      {p.isScreenSharing && " 🖥"}
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
          {Array.from(onlineUsers).map((userId) => (
            <li key={userId}>
              <span className="online-dot" />
              {userMap.get(userId) ?? userId}
              {userId === currentUserId && " (você)"}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, Message, ServerEvent } from "@saladereunioes/shared";
import { api } from "./services/api";
import { useWebSocket } from "./websocket/useWebSocket";
import { useLiveKit } from "./livekit/useLiveKit";
import { AuthForm } from "./components/AuthForm";
import { ChannelList } from "./components/ChannelList";
import { ChatPanel } from "./components/ChatPanel";
import { ScreenShareView } from "./components/ScreenShareView";
import { VoiceControls } from "./components/VoiceControls";

export function App() {
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [knownUsers, setKnownUsers] = useState<Map<string, string>>(new Map());

  const joinedChannelRef = useRef<string | null>(null);

  const livekit = useLiveKit();

  const handleWsEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message:created") {
        if (event.message.channelId === selectedChannelId) {
          setMessages((prev) => [...prev, event.message]);
        }
      } else if (event.type === "presence:online") {
        setOnlineUsers((prev) => new Set(prev).add(event.userId));
      } else if (event.type === "presence:offline") {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(event.userId);
          return next;
        });
      }
    },
    [selectedChannelId]
  );

  const { send: wsSend } = useWebSocket(handleWsEvent, !!user);

  useEffect(() => {
    api
      .me()
      .then(({ user: u }) => {
        setUser(u);
        setKnownUsers(new Map([[u.id, u.username]]));
        setOnlineUsers(new Set([u.id]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;

    api.getChannels().then((data) => {
      const typed = data as Channel[];
      setChannels(typed);
      const firstText = typed.find((c) => c.type === "TEXT");
      if (firstText) {
        setSelectedChannelId(firstText.id);
      }
    });
  }, [user]);

  useEffect(() => {
    if (!selectedChannelId) return;

    if (joinedChannelRef.current) {
      wsSend({ type: "channel:leave", channelId: joinedChannelRef.current });
    }

    wsSend({ type: "channel:join", channelId: selectedChannelId });
    joinedChannelRef.current = selectedChannelId;

    api.getMessages(selectedChannelId).then(setMessages);
  }, [selectedChannelId, wsSend]);

  const userMap = useMemo(() => {
    const map = new Map(knownUsers);
    if (user) map.set(user.id, user.username);
    for (const msg of messages) {
      if (!map.has(msg.authorId)) {
        map.set(msg.authorId, msg.authorId.slice(0, 8));
      }
    }
    return map;
  }, [knownUsers, user, messages]);

  const voiceParticipantsMap = useMemo(() => {
    const map = new Map<string, typeof livekit.participants>();
    if (livekit.connectedChannelId) {
      map.set(livekit.connectedChannelId, livekit.participants);
    }
    return map;
  }, [livekit.connectedChannelId, livekit.participants]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  const handleAuth = (u: { id: string; username: string }) => {
    setUser(u);
    setKnownUsers(new Map([[u.id, u.username]]));
    setOnlineUsers(new Set([u.id]));
  };

  const handleLogout = async () => {
    await livekit.leave();
    await api.logout();
    setUser(null);
    setChannels([]);
    setSelectedChannelId(null);
    setMessages([]);
  };

  const handleJoinVoice = async (channelId: string) => {
    if (livekit.connectedChannelId === channelId) return;
    await livekit.join(channelId);
  };

  const handleToggleScreenShare = () => {
    if (livekit.isScreenSharing) {
      void livekit.stopScreenShare();
    } else {
      void livekit.startScreenShare();
    }
  };

  if (loading) {
    return <div className="loading">Carregando...</div>;
  }

  if (!user) {
    return <AuthForm onAuth={handleAuth} />;
  }

  const showScreenShare = livekit.remoteScreenShare ?? (livekit.isScreenSharing && livekit.screenShareTrack
    ? { participantName: user.username, track: livekit.screenShareTrack }
    : null);

  return (
    <div className="app">
      <ChannelList
        channels={channels}
        selectedChannelId={selectedChannelId}
        connectedVoiceChannelId={livekit.connectedChannelId}
        voiceParticipants={voiceParticipantsMap}
        onlineUsers={onlineUsers}
        userMap={userMap}
        currentUserId={user.id}
        onSelectTextChannel={setSelectedChannelId}
        onJoinVoiceChannel={handleJoinVoice}
      />

      <main className="main-content">
        {showScreenShare ? (
          <ScreenShareView
            participantName={showScreenShare.participantName}
            track={showScreenShare.track}
          />
        ) : selectedChannel ? (
          <ChatPanel
            channelName={selectedChannel.name}
            messages={messages}
            userMap={userMap}
            currentUserId={user.id}
            onSend={(content) => {
              if (selectedChannelId) {
                wsSend({ type: "message:send", channelId: selectedChannelId, content });
              }
            }}
          />
        ) : (
          <div className="empty-state">Selecione um canal</div>
        )}
      </main>

      <VoiceControls
        username={user.username}
        isConnected={!!livekit.connectedChannelId}
        isMuted={livekit.isMuted}
        isDeafened={livekit.isDeafened}
        isScreenSharing={livekit.isScreenSharing}
        onToggleMute={() => void livekit.toggleMute()}
        onToggleDeafen={() => void livekit.toggleDeafen()}
        onToggleScreenShare={handleToggleScreenShare}
        onDisconnect={() => void livekit.leave()}
        onLogout={() => void handleLogout()}
      />
    </div>
  );
}

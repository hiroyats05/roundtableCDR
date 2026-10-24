import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Channel, ChannelType, Message, ServerEvent, User, UserRole } from "@saladereunioes/shared";
import { api } from "./services/api";
import { useWebSocket } from "./websocket/useWebSocket";
import { useLiveKit } from "./livekit/useLiveKit";
import { AuthForm } from "./components/AuthForm";
import { ChannelList } from "./components/ChannelList";
import { List, Users, X } from "@phosphor-icons/react";
import { ChatPanel } from "./components/ChatPanel";
import { MemberList } from "./components/MemberList";
import { ScreenShareStage } from "./components/ScreenShareView";
import { VoiceControls } from "./components/VoiceControls";

// Matches the breakpoint where the side columns become drawers (styles.css).
const MOBILE_QUERY = "(max-width: 900px)";

function readHidden(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeHidden(key: string, hidden: boolean) {
  try {
    localStorage.setItem(key, hidden ? "1" : "0");
  } catch {
    // storage unavailable
  }
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<Map<string, User>>(new Map());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [channelsHidden, setChannelsHidden] = useState(() => readHidden("channelsHidden"));
  const [membersHidden, setMembersHidden] = useState(() => readHidden("membersHidden"));

  useEffect(() => writeHidden("channelsHidden", channelsHidden), [channelsHidden]);
  useEffect(() => writeHidden("membersHidden", membersHidden), [membersHidden]);

  const usersRef = useRef(users);
  usersRef.current = users;

  const refreshUsers = useCallback(() => {
    api
      .getUsers()
      .then((data) => setUsers(new Map(data.map((u) => [u.id, u]))))
      .catch(() => {});
  }, []);

  const joinedChannelRef = useRef<string | null>(null);

  const livekit = useLiveKit();

  const handleWsEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message:created") {
        if (event.message.channelId === selectedChannelId) {
          setMessages((prev) => [...prev, event.message]);
        }
      } else if (event.type === "message:deleted") {
        if (event.channelId === selectedChannelId) {
          setMessages((prev) => prev.filter((m) => m.id !== event.messageId));
        }
      } else if (event.type === "channel:created") {
        setChannels((prev) => (prev.some((c) => c.id === event.channel.id) ? prev : [...prev, event.channel]));
      } else if (event.type === "channel:deleted") {
        setChannels((prev) => prev.filter((c) => c.id !== event.channelId));
        setSelectedChannelId((prev) => (prev === event.channelId ? null : prev));
        if (livekit.connectedChannelId === event.channelId) {
          void livekit.leave();
        }
      } else if (event.type === "user:updated") {
        setUsers((prev) => new Map(prev).set(event.user.id, event.user));
        setUser((prev) => (prev && prev.id === event.user.id ? event.user : prev));
      } else if (event.type === "presence:online") {
        setOnlineUsers((prev) => new Set(prev).add(event.userId));
        // Someone who registered after we loaded the user list.
        if (!usersRef.current.has(event.userId)) refreshUsers();
      } else if (event.type === "presence:offline") {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(event.userId);
          return next;
        });
      }
    },
    [selectedChannelId, livekit, refreshUsers]
  );

  const { send: wsSend } = useWebSocket(handleWsEvent, !!user);

  useEffect(() => {
    api
      .me()
      .then(({ user: u }) => {
        setUser(u);
        setOnlineUsers(new Set([u.id]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;

    api.getChannels().then((data) => {
      setChannels(data);
      const firstText = data.find((c) => c.type === "TEXT");
      if (firstText) {
        setSelectedChannelId(firstText.id);
      }
    });

    refreshUsers();
  }, [user, refreshUsers]);

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
    const map = new Map<string, string>();
    for (const u of users.values()) {
      map.set(u.id, u.username);
    }
    for (const msg of messages) {
      if (!map.has(msg.authorId)) {
        map.set(msg.authorId, msg.authorId.slice(0, 8));
      }
    }
    return map;
  }, [users, messages]);

  const voiceParticipantsMap = useMemo(() => {
    const map = new Map<string, typeof livekit.participants>();
    if (livekit.connectedChannelId) {
      map.set(
        livekit.connectedChannelId,
        livekit.participants.map((p) => ({ ...p, reception: livekit.listenerReports.get(p.identity) }))
      );
    }
    return map;
  }, [livekit.connectedChannelId, livekit.participants, livekit.listenerReports]);

  const myAudio = { mic: !livekit.isMuted, screen: livekit.isSharingAudio };

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const voiceChannel = channels.find((c) => c.id === livekit.connectedChannelId);
  const isAdmin = user?.role === "ADMIN";

  const handleAuth = (u: User) => {
    setUser(u);
    setOnlineUsers(new Set([u.id]));
  };

  const handleLogout = async () => {
    await livekit.leave();
    await api.logout();
    setUser(null);
    setChannels([]);
    setSelectedChannelId(null);
    setMessages([]);
    setUsers(new Map());
  };

  const handleJoinVoice = async (channelId: string) => {
    if (livekit.connectedChannelId === channelId) return;
    await livekit.join(channelId);
  };

  const handleSelectTextChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
    setSidebarOpen(false);
  };

  const handleCreateChannel = async (name: string, type: ChannelType) => {
    await api.createChannel(name, type);
  };

  const handleDeleteChannel = async (channelId: string) => {
    await api.deleteChannel(channelId);
  };

  const handleDeleteMessage = async (messageId: string) => {
    await api.deleteMessage(messageId);
  };

  const handleKickParticipant = async (channelId: string, userId: string) => {
    await api.kickParticipant(channelId, userId);
  };

  const handleMuteParticipant = async (channelId: string, userId: string) => {
    await api.muteParticipant(channelId, userId);
  };

  const handleUpdateUserRole = async (userId: string, role: UserRole) => {
    await api.updateUserRole(userId, role);
  };

  if (loading) {
    return <div className="loading">Carregando...</div>;
  }

  if (!user) {
    return <AuthForm onAuth={handleAuth} />;
  }

  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

  const toggleChannels = () => {
    if (isMobile()) setSidebarOpen((v) => !v);
    else setChannelsHidden(false);
  };

  const toggleMembers = () => {
    if (isMobile()) setMembersOpen((v) => !v);
    else setMembersHidden(false);
  };

  const appClassName = ["app", channelsHidden && "channels-hidden", membersHidden && "members-hidden"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appClassName}>
      <ChannelList
        channels={channels}
        selectedChannelId={selectedChannelId}
        connectedVoiceChannelId={livekit.connectedChannelId}
        voiceParticipants={voiceParticipantsMap}
        currentUserId={user.id}
        myAudio={myAudio}
        isAdmin={isAdmin}
        isOpen={sidebarOpen}
        onSelectTextChannel={handleSelectTextChannel}
        onJoinVoiceChannel={handleJoinVoice}
        onClose={() => setSidebarOpen(false)}
        onHide={() => setChannelsHidden(true)}
        onCreateChannel={handleCreateChannel}
        onDeleteChannel={handleDeleteChannel}
        onKickParticipant={handleKickParticipant}
        onMuteParticipant={handleMuteParticipant}
        footer={
          <VoiceControls
            username={user.username}
            voiceChannelName={livekit.connectedChannelId ? (voiceChannel?.name ?? "voz") : null}
            isMuted={livekit.isMuted}
            isDeafened={livekit.isDeafened}
            isScreenSharing={livekit.isScreenSharing}
            participants={livekit.participants.filter((p) => p.identity !== user.id)}
            listenerReports={livekit.listenerReports}
            myAudio={myAudio}
            canPlayAudio={livekit.canPlayAudio}
            onStartAudio={() => void livekit.startAudio()}
            onToggleMute={() => void livekit.toggleMute()}
            onToggleDeafen={() => void livekit.toggleDeafen()}
            onStartScreenShare={livekit.startScreenShare}
            onStopScreenShare={() => void livekit.stopScreenShare()}
            onDisconnect={() => void livekit.leave()}
            onLogout={() => void handleLogout()}
          />
        }
      />

      {(sidebarOpen || membersOpen) && (
        <div
          className="sidebar-backdrop"
          onClick={() => {
            setSidebarOpen(false);
            setMembersOpen(false);
          }}
        />
      )}

      <main className="main-content">
        <div className="mobile-topbar">
          <button className="icon-button sidebar-toggle" onClick={toggleChannels} aria-label="Mostrar canais">
            <List size={22} />
          </button>
          <span className="mobile-topbar-title">
            {selectedChannel ? `#${selectedChannel.name}` : "roundtableCDR"}
          </span>
          <button className="icon-button members-toggle" onClick={toggleMembers} aria-label="Mostrar membros">
            <Users size={22} />
          </button>
        </div>

        {livekit.screenShares.length > 0 && (
          <ScreenShareStage
            shares={livekit.screenShares}
            volumes={livekit.shareVolumes}
            onVolumeChange={livekit.setShareVolume}
          />
        )}

        {selectedChannel ? (
          <ChatPanel
            messages={messages}
            userMap={userMap}
            currentUserId={user.id}
            isAdmin={isAdmin}
            onSend={(content) => {
              if (selectedChannelId) {
                wsSend({ type: "message:send", channelId: selectedChannelId, content });
              }
            }}
            onDeleteMessage={handleDeleteMessage}
          />
        ) : (
          <div className="empty-state">Selecione um canal</div>
        )}
      </main>

      <MemberList
        onlineUsers={onlineUsers}
        users={users}
        currentUserId={user.id}
        isAdmin={isAdmin}
        isOpen={membersOpen}
        onClose={() => setMembersOpen(false)}
        onHide={() => setMembersHidden(true)}
        onUpdateUserRole={handleUpdateUserRole}
      />

      {livekit.shareEndedReason && (
        <div className="share-ended-banner" role="status">
          <span>O compartilhamento parou: {livekit.shareEndedReason}</span>
          <button className="icon-button" onClick={livekit.clearShareEndedReason} aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

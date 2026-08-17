interface VoiceControlsProps {
  username: string;
  isConnected: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onDisconnect: () => void;
  onLogout: () => void;
}

export function VoiceControls({
  username,
  isConnected,
  isMuted,
  isDeafened,
  isScreenSharing,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onDisconnect,
  onLogout,
}: VoiceControlsProps) {
  return (
    <footer className="voice-controls">
      <span className="voice-user">{username}</span>

      {isConnected && (
        <>
          <button onClick={onToggleMute} className={isMuted ? "active-danger" : ""}>
            {isMuted ? "🔇 Unmute" : "🎤 Mute"}
          </button>
          <button onClick={onToggleDeafen} className={isDeafened ? "active-danger" : ""}>
            {isDeafened ? "🔈 Undeafen" : "🔊 Deafen"}
          </button>
          <button onClick={onToggleScreenShare} className={isScreenSharing ? "active" : ""}>
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

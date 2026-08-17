import { useEffect, useRef, useState } from "react";

interface ScreenShareViewProps {
  participantName: string;
  track: MediaStreamTrack;
}

export function ScreenShareView({ participantName, track }: ScreenShareViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const stream = new MediaStream([track]);
    video.srcObject = stream;
    void video.play().catch(() => {});

    return () => {
      video.srcObject = null;
    };
  }, [track]);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  };

  return (
    <div ref={containerRef} className={`screen-share-view ${isFullscreen ? "fullscreen" : ""}`}>
      <div className="screen-share-header">
        <span>🖥 {participantName} está compartilhando a tela</span>
        <button className="fullscreen-toggle" onClick={toggleFullscreen}>
          {isFullscreen ? "🗗 Sair da tela cheia" : "⛶ Tela cheia"}
        </button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="screen-share-video"
        onDoubleClick={toggleFullscreen}
      />
    </div>
  );
}

import { useEffect, useRef } from "react";

interface ScreenShareViewProps {
  participantName: string;
  track: MediaStreamTrack;
}

export function ScreenShareView({ participantName, track }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

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

  return (
    <div className="screen-share-view">
      <div className="screen-share-header">
        <span>🖥 {participantName} está compartilhando a tela</span>
      </div>
      <video ref={videoRef} autoPlay playsInline muted className="screen-share-video" />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  PlayCircle,
  SpeakerSimpleHigh,
  SpeakerSimpleLow,
  SpeakerSimpleX,
} from "@phosphor-icons/react";
import type { ScreenShare } from "../livekit/useLiveKit";

interface ScreenShareStageProps {
  shares: ScreenShare[];
  volumes: Map<string, number>;
  onVolumeChange: (identity: string, volume: number) => void;
}

/** One transmission fills the stage; several are laid out as a mosaic. */
export function ScreenShareStage({ shares, volumes, onVolumeChange }: ScreenShareStageProps) {
  const columns = Math.ceil(Math.sqrt(shares.length));
  const rows = Math.ceil(shares.length / columns);

  return (
    <section
      className={`screen-share-stage ${shares.length > 1 ? "mosaic" : ""}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {shares.map((share) => (
        <ScreenShareTile
          key={share.identity}
          share={share}
          volume={volumes.get(share.identity) ?? 1}
          onVolumeChange={(v) => onVolumeChange(share.identity, v)}
        />
      ))}
    </section>
  );
}

interface ScreenShareTileProps {
  share: ScreenShare;
  volume: number;
  onVolumeChange: (volume: number) => void;
}

function ScreenShareTile({ share, volume, onVolumeChange }: ScreenShareTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = new MediaStream([share.track]);
    void video.play().catch(() => setIsPaused(true));

    return () => {
      video.srcObject = null;
    };
  }, [share.track]);

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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  return (
    <div ref={containerRef} className={`screen-share-tile ${isFullscreen ? "fullscreen" : ""}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="screen-share-video"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setIsPaused(false)}
        onPause={() => setIsPaused(true)}
      />

      <span className="screen-share-title">
        {share.isLocal ? "Your transmission" : `${share.name}'s transmission`}
      </span>

      {isPaused && (
        <button className="screen-share-play" onClick={togglePlay} aria-label="Assistir">
          <PlayCircle size={24} />
        </button>
      )}

      <div className="screen-share-controls">
        {share.hasAudio && <VolumeControl volume={volume} onChange={onVolumeChange} />}
        <button
          className="icon-button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
        >
          {isFullscreen ? <ArrowsInSimple size={24} /> : <ArrowsOutSimple size={24} />}
        </button>
      </div>
    </div>
  );
}

const VOLUME_STEP = 0.1;

function VolumeControl({ volume, onChange }: { volume: number; onChange: (volume: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lastAudibleRef = useRef(volume || 1);

  const set = (v: number) => {
    const clamped = Math.min(1, Math.max(0, Math.round(v * 100) / 100));
    if (clamped > 0) lastAudibleRef.current = clamped;
    onChange(clamped);
  };

  const setFromPointer = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    set((rect.bottom - clientY) / rect.height);
  };

  const Icon = volume === 0 ? SpeakerSimpleX : volume < 0.5 ? SpeakerSimpleLow : SpeakerSimpleHigh;

  return (
    <div className="volume-control">
      <div
        ref={trackRef}
        className="volume-track"
        role="slider"
        tabIndex={0}
        aria-label="Volume da transmissão"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") set(volume + VOLUME_STEP);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(volume - VOLUME_STEP);
          else return;
          e.preventDefault();
        }}
      >
        <span className="volume-knob" style={{ bottom: `calc(2px + ${volume} * (100% - 10px))` }} />
      </div>
      <button
        className="icon-button"
        onClick={() => set(volume === 0 ? lastAudibleRef.current : 0)}
        aria-label={volume === 0 ? "Ativar som da transmissão" : "Silenciar transmissão"}
      >
        <Icon size={24} />
      </button>
    </div>
  );
}

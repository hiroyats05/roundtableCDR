import type { AudioCaptureOptions, ScreenShareCaptureOptions, TrackPublishOptions } from "livekit-client";

export type ScreenShareResolution = "720p" | "1080p" | "1440p" | "source";
export type ScreenShareFps = 15 | 30 | 60;
export type ScreenShareContent = "detail" | "motion";

export interface ScreenShareQuality {
  resolution: ScreenShareResolution;
  fps: ScreenShareFps;
  content: ScreenShareContent;
  audio: boolean;
}

export const RESOLUTIONS: { value: ScreenShareResolution; label: string; size?: { width: number; height: number } }[] = [
  { value: "720p", label: "720p", size: { width: 1280, height: 720 } },
  { value: "1080p", label: "1080p", size: { width: 1920, height: 1080 } },
  { value: "1440p", label: "1440p", size: { width: 2560, height: 1440 } },
  { value: "source", label: "Original" },
];

export const FPS_OPTIONS: ScreenShareFps[] = [15, 30, 60];

// Target bitrate (Mbps) at 30fps; scaled by the fps multiplier below.
const BASE_MBPS: Record<ScreenShareResolution, number> = {
  "720p": 1.5,
  "1080p": 3,
  "1440p": 5,
  source: 6,
};

const FPS_MULTIPLIER: Record<ScreenShareFps, number> = { 15: 0.6, 30: 1, 60: 1.6 };

export const DEFAULT_QUALITY: ScreenShareQuality = {
  resolution: "1080p",
  fps: 30,
  content: "detail",
  audio: false,
};

const STORAGE_KEY = "screenShareQuality";

export function estimateMbps(quality: ScreenShareQuality): number {
  return Math.round(BASE_MBPS[quality.resolution] * FPS_MULTIPLIER[quality.fps] * 10) / 10;
}

export function loadQuality(): ScreenShareQuality {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ScreenShareQuality> | null;
    return { ...DEFAULT_QUALITY, ...saved };
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function saveQuality(quality: ScreenShareQuality) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality));
  } catch {
    // storage unavailable
  }
}

export function toLiveKitOptions(quality: ScreenShareQuality): {
  capture: ScreenShareCaptureOptions;
  publish: TrackPublishOptions;
} {
  const size = RESOLUTIONS.find((r) => r.value === quality.resolution)?.size;
  const maxBitrate = estimateMbps(quality) * 1_000_000;

  return {
    capture: {
      // System audio also contains the call itself (everyone else's voices), which
      // makes them hear themselves back as echo. restrictOwnAudio asks Chromium to
      // leave this app's own playback out of the capture; other engines ignore it.
      audio: quality.audio ? ({ restrictOwnAudio: true } as AudioCaptureOptions) : false,
      systemAudio: quality.audio ? "include" : "exclude",
      contentHint: quality.content,
      // LiveKit treats 0x0 as uncapped: "source" captures at the screen's native
      // resolution, with fps capped by the encoding below.
      resolution: { ...(size ?? { width: 0, height: 0 }), frameRate: quality.fps },
    },
    publish: {
      screenShareEncoding: { maxBitrate, maxFramerate: quality.fps },
      // Text/code: keep it sharp and drop frames when bandwidth is tight.
      // Games/video: keep it smooth and drop resolution instead.
      degradationPreference: quality.content === "detail" ? "maintain-resolution" : "maintain-framerate",
      // A single high-quality layer; simulcast layers would cap viewers at lower quality.
      simulcast: false,
    },
  };
}

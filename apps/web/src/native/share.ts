// Bridge to the desktop app's native screen share (apps/desktop/src-tauri/src/share).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface CaptureSource {
  id: string;
  kind: "screen" | "window";
  title: string;
  appName?: string | null;
  thumbnail?: string | null;
}

export interface NativeShareArgs {
  url: string;
  token: string;
  sourceId: string;
  /** 0 = native size */
  maxWidth: number;
  maxHeight: number;
  fps: number;
  maxBitrate: number;
  content: "detail" | "motion";
  audio: boolean;
}

export const nativeShare = {
  listSources: () => invoke<CaptureSource[]>("list_capture_sources"),
  start: (args: NativeShareArgs) => invoke<void>("start_native_share", { args }),
  stop: () => invoke<void>("stop_native_share"),
  onEnded: (callback: (reason: string) => void): Promise<UnlistenFn> =>
    listen<string>("native-share-ended", (event) => callback(event.payload)),
};

/** LiveKit identity of the companion participant that carries a user's native share. */
export const SCREEN_IDENTITY_SUFFIX = ":screen";

export function screenIdentity(userIdentity: string) {
  return `${userIdentity}${SCREEN_IDENTITY_SUFFIX}`;
}

export function isScreenIdentity(identity: string) {
  return identity.endsWith(SCREEN_IDENTITY_SUFFIX);
}

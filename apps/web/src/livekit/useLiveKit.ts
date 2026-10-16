import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type LocalParticipant,
  type RemoteTrack,
  type RemoteAudioTrack,
} from "livekit-client";
import { api, isDesktop } from "../services/api";
import { isScreenIdentity, nativeShare, screenIdentity } from "../native/share";
import { estimateMbps, RESOLUTIONS, toLiveKitOptions, type ScreenShareQuality } from "./screenShareQuality";

// livekit-client never plays remote audio by itself: each audio track must be
// attached to an <audio> element.
function attachAudio(track: RemoteTrack) {
  if (track.kind !== Track.Kind.Audio) return;
  const el = track.attach();
  el.style.display = "none";
  el.dataset.voiceAudio = track.sid ?? "";
  document.body.appendChild(el);
}

function detachAudio(track: RemoteTrack) {
  if (track.kind !== Track.Kind.Audio) return;
  track.detach().forEach((el) => el.remove());
  // When a participant leaves, LiveKit stops the track (detaching its elements)
  // before emitting TrackUnsubscribed, so also remove ours by sid.
  if (track.sid) {
    document.querySelectorAll(`audio[data-voice-audio="${track.sid}"]`).forEach((el) => el.remove());
  }
}

// How a listener is receiving one of my audio tracks, as reported by their client.
export type AudioReception = "hearing" | "deafened" | "blocked" | "no-data" | "connecting";

export interface ListenerReport {
  mic?: AudioReception;
  screen?: AudioReception;
  receivedAt: number;
}

interface ListenReportMessage {
  // publisher identity -> how I'm receiving each of their audio tracks
  tracks: Record<string, { mic?: AudioReception; screen?: AudioReception }>;
}

const LISTEN_REPORT_TOPIC = "listen-report";
const LISTEN_REPORT_INTERVAL_MS = 2000;
const LISTEN_REPORT_STALE_MS = 6000;

export interface VoiceParticipant {
  identity: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  /** For remote participants: how they report receiving my audio. */
  reception?: ListenerReport;
}

export function useLiveKit() {
  const roomRef = useRef<Room | null>(null);
  const [connectedChannelId, setConnectedChannelId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareTrack, setScreenShareTrack] = useState<MediaStreamTrack | null>(null);
  const [remoteScreenShare, setRemoteScreenShare] = useState<{
    participantName: string;
    track: MediaStreamTrack;
  } | null>(null);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [isSharingAudio, setIsSharingAudio] = useState(false);
  // identity -> what that listener reports about my audio
  const [listenerReports, setListenerReports] = useState<Map<string, ListenerReport>>(new Map());

  const isDeafenedRef = useRef(false);
  // Desktop app: the share is published natively by Rust as "<me>:screen".
  const nativeShareRef = useRef(false);
  const connectedChannelIdRef = useRef<string | null>(null);
  const reportTimerRef = useRef<number | null>(null);
  const lastBytesRef = useRef<Map<string, number>>(new Map());

  const updateParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipants([]);
      return;
    }

    const all: VoiceParticipant[] = [];

    // Native shares come from a companion "<identity>:screen" participant; fold
    // it into its owner instead of listing it as a person.
    const mapParticipant = (p: LocalParticipant | RemoteParticipant): VoiceParticipant => ({
      identity: p.identity,
      name: p.name || p.identity,
      isMuted: !p.isMicrophoneEnabled,
      isSpeaking: p.isSpeaking,
      isScreenSharing:
        p.isScreenShareEnabled || !!room.remoteParticipants.get(screenIdentity(p.identity))?.isScreenShareEnabled,
    });

    all.push(mapParticipant(room.localParticipant));

    room.remoteParticipants.forEach((p) => {
      if (!isScreenIdentity(p.identity)) all.push(mapParticipant(p));
    });

    setParticipants(all);
  }, []);

  const updateScreenShare = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setRemoteScreenShare(null);
      return;
    }

    for (const participant of room.remoteParticipants.values()) {
      const pub = participant.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track?.mediaStreamTrack) {
        setRemoteScreenShare({
          participantName: participant.name || participant.identity,
          track: pub.track.mediaStreamTrack,
        });
        return;
      }
    }

    setRemoteScreenShare(null);
  }, []);

  const resetState = useCallback(() => {
    roomRef.current = null;
    setConnectedChannelId(null);
    connectedChannelIdRef.current = null;
    setParticipants([]);
    setIsMuted(false);
    setIsDeafened(false);
    setIsScreenSharing(false);
    setScreenShareTrack(null);
    setRemoteScreenShare(null);
    setCanPlayAudio(true);
    setIsSharingAudio(false);
    setListenerReports(new Map());
    isDeafenedRef.current = false;
    lastBytesRef.current.clear();
    if (reportTimerRef.current) {
      clearInterval(reportTimerRef.current);
      reportTimerRef.current = null;
    }
  }, []);

  // Tell everyone else whether their audio is actually reaching me, so they can
  // see who is hearing them.
  const sendListenReport = useCallback(async (room: Room) => {
    const message: ListenReportMessage = { tracks: {} };

    for (const participant of room.remoteParticipants.values()) {
      // I'm not a listener of my own native share.
      if (participant.identity === screenIdentity(room.localParticipant.identity)) continue;
      const entry: ListenReportMessage["tracks"][string] = {};

      for (const [key, source] of [
        ["mic", Track.Source.Microphone],
        ["screen", Track.Source.ScreenShareAudio],
      ] as const) {
        const pub = participant.getTrackPublication(source);
        if (!pub || pub.isMuted) continue;

        if (isDeafenedRef.current) {
          entry[key] = "deafened";
        } else if (!room.canPlaybackAudio) {
          entry[key] = "blocked";
        } else if (!pub.track) {
          entry[key] = "connecting";
        } else {
          const stats = await (pub.track as RemoteAudioTrack).getReceiverStats();
          const bytes = stats?.bytesReceived ?? 0;
          const previous = lastBytesRef.current.get(pub.trackSid);
          lastBytesRef.current.set(pub.trackSid, bytes);
          entry[key] = previous === undefined ? "connecting" : bytes > previous ? "hearing" : "no-data";
        }
      }

      message.tracks[participant.identity] = entry;
    }

    if (room.state !== "connected") return;
    await room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(message)), {
        reliable: true,
        topic: LISTEN_REPORT_TOPIC,
      })
      .catch(() => {});

    // Forget listeners that stopped reporting (left, or an older client).
    setListenerReports((prev) => {
      const now = Date.now();
      const next = new Map([...prev].filter(([, r]) => now - r.receivedAt < LISTEN_REPORT_STALE_MS));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const setupRoomListeners = useCallback(
    (room: Room) => {
      room.on(RoomEvent.Disconnected, () => {
        document.querySelectorAll("audio[data-voice-audio]").forEach((el) => el.remove());
        if (nativeShareRef.current) {
          nativeShareRef.current = false;
          void nativeShare.stop();
        }
        // Only reset if this room is still the active one — avoids clobbering
        // state when disconnecting an old room while switching channels.
        if (roomRef.current === room) {
          resetState();
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setCanPlayAudio(room.canPlaybackAudio));
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== LISTEN_REPORT_TOPIC || !participant) return;
        try {
          const message = JSON.parse(new TextDecoder().decode(payload)) as ListenReportMessage;
          const me = room.localParticipant.identity;
          const aboutMe = { ...message.tracks[me] };
          const aboutMyShare = message.tracks[screenIdentity(me)];
          if (aboutMyShare?.screen) aboutMe.screen = aboutMyShare.screen;
          setListenerReports((prev) =>
            new Map(prev).set(participant.identity, { ...aboutMe, receivedAt: Date.now() })
          );
        } catch {
          // ignore malformed reports
        }
      });
      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        updateParticipants();
        setListenerReports((prev) => {
          const next = new Map(prev);
          next.delete(participant.identity);
          return next;
        });
      });
      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        updateParticipants();
        if (participant.isLocal && publication.kind === Track.Kind.Audio) {
          setIsMuted(true);
        }
      });
      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        updateParticipants();
        if (participant.isLocal && publication.kind === Track.Kind.Audio) {
          setIsMuted(false);
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, updateParticipants);
      room.on(RoomEvent.LocalTrackPublished, () => {
        updateParticipants();
        if (nativeShareRef.current) return;
        const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track?.mediaStreamTrack) {
          setIsScreenSharing(true);
          setScreenShareTrack(pub.track.mediaStreamTrack);
        }
        setIsSharingAudio(!!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio));
      });
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        updateParticipants();
        if (nativeShareRef.current) return;
        setIsSharingAudio(!!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio));
        setIsScreenSharing(false);
        setScreenShareTrack(null);
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        // My own native share: keep the video as a preview of what others see,
        // but never play its audio back to me (I already hear the app locally).
        if (participant.identity === screenIdentity(room.localParticipant.identity) && track.kind === Track.Kind.Audio) {
          publication.setSubscribed(false);
          return;
        }
        attachAudio(track);
        updateParticipants();
        if (publication.source === Track.Source.ScreenShare && publication.track?.mediaStreamTrack) {
          setRemoteScreenShare({
            participantName: participant.name || participant.identity,
            track: publication.track.mediaStreamTrack,
          });
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        detachAudio(track);
        updateParticipants();
        if (publication.source === Track.Source.ScreenShare) {
          updateScreenShare();
        }
      });
    },
    [updateParticipants, updateScreenShare, resetState]
  );

  const join = useCallback(
    async (channelId: string) => {
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      const { token, url } = await api.getVoiceToken(channelId);
      const room = new Room();
      roomRef.current = room;
      setupRoomListeners(room);

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      setConnectedChannelId(channelId);
      connectedChannelIdRef.current = channelId;
      setIsMuted(false);
      setIsDeafened(false);
      setCanPlayAudio(room.canPlaybackAudio);
      updateParticipants();

      reportTimerRef.current = window.setInterval(() => {
        if (roomRef.current === room) void sendListenReport(room);
      }, LISTEN_REPORT_INTERVAL_MS);
    },
    [setupRoomListeners, updateParticipants, sendListenReport]
  );

  const stopNativeShare = useCallback(async () => {
    if (!nativeShareRef.current) return;
    nativeShareRef.current = false;
    await nativeShare.stop().catch(() => {});
    setIsScreenSharing(false);
    setIsSharingAudio(false);
    updateParticipants();
  }, [updateParticipants]);

  const leave = useCallback(async () => {
    await stopNativeShare();
    if (roomRef.current) {
      await roomRef.current.disconnect();
    }
    resetState();
  }, [resetState, stopNativeShare]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const newMuted = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsMuted(newMuted);
    updateParticipants();
  }, [isMuted, updateParticipants]);

  const toggleDeafen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const newDeafened = !isDeafened;
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.kind === Track.Kind.Audio) {
          pub.setEnabled(!newDeafened);
        }
      });
    });
    setIsDeafened(newDeafened);
    isDeafenedRef.current = newDeafened;
  }, [isDeafened]);

  // Browsers may block audio autoplay until the user interacts with the page.
  const startAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
    setCanPlayAudio(roomRef.current?.canPlaybackAudio ?? true);
  }, []);

  const startScreenShare = useCallback(async (quality: ScreenShareQuality, sourceId?: string) => {
    const room = roomRef.current;
    if (!room) return;

    if (isDesktop && sourceId) {
      const channelId = connectedChannelIdRef.current;
      if (!channelId) return;
      const { token, url } = await api.getScreenShareToken(channelId);
      const size = RESOLUTIONS.find((r) => r.value === quality.resolution)?.size;
      const audio = quality.audio && sourceId.startsWith("window:");
      await nativeShare.start({
        url,
        token,
        sourceId,
        maxWidth: size?.width ?? 0,
        maxHeight: size?.height ?? 0,
        fps: quality.fps,
        maxBitrate: Math.round(estimateMbps(quality) * 1_000_000),
        content: quality.content,
        audio,
      });
      nativeShareRef.current = true;
      setIsScreenSharing(true);
      setIsSharingAudio(audio);
      updateParticipants();
      return;
    }

    const { capture, publish } = toLiveKitOptions(quality);
    await room.localParticipant.setScreenShareEnabled(true, capture, publish);
    setIsScreenSharing(true);
    updateParticipants();
  }, [updateParticipants]);

  const stopScreenShare = useCallback(async () => {
    if (nativeShareRef.current) {
      await stopNativeShare();
      return;
    }
    const room = roomRef.current;
    if (!room) return;

    await room.localParticipant.setScreenShareEnabled(false);
    setIsScreenSharing(false);
    setScreenShareTrack(null);
    updateParticipants();
  }, [updateParticipants, stopNativeShare]);

  // The native capture can end on its own (window closed, permission revoked).
  const [shareEndedReason, setShareEndedReason] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    const unlisten = nativeShare.onEnded((reason) => {
      if (!nativeShareRef.current) return;
      setShareEndedReason(reason);
      void stopNativeShare();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [stopNativeShare]);

  useEffect(() => {
    return () => {
      if (nativeShareRef.current) void nativeShare.stop();
      void roomRef.current?.disconnect();
    };
  }, []);

  return {
    connectedChannelId,
    participants,
    isMuted,
    isDeafened,
    isScreenSharing,
    screenShareTrack,
    remoteScreenShare,
    canPlayAudio,
    isSharingAudio,
    listenerReports,
    startAudio,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
    shareEndedReason,
    clearShareEndedReason: () => setShareEndedReason(null),
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type LocalParticipant,
} from "livekit-client";
import { api } from "../services/api";

export interface VoiceParticipant {
  identity: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
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

  const updateParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipants([]);
      return;
    }

    const all: VoiceParticipant[] = [];

    const mapParticipant = (p: LocalParticipant | RemoteParticipant): VoiceParticipant => ({
      identity: p.identity,
      name: p.name || p.identity,
      isMuted: !p.isMicrophoneEnabled,
      isSpeaking: p.isSpeaking,
      isScreenSharing: p.isScreenShareEnabled,
    });

    all.push(mapParticipant(room.localParticipant));

    room.remoteParticipants.forEach((p) => {
      all.push(mapParticipant(p));
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

  const setupRoomListeners = useCallback(
    (room: Room) => {
      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.on(RoomEvent.TrackMuted, updateParticipants);
      room.on(RoomEvent.TrackUnmuted, updateParticipants);
      room.on(RoomEvent.ActiveSpeakersChanged, updateParticipants);
      room.on(RoomEvent.LocalTrackPublished, () => {
        updateParticipants();
        const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track?.mediaStreamTrack) {
          setIsScreenSharing(true);
          setScreenShareTrack(pub.track.mediaStreamTrack);
        }
      });
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        updateParticipants();
        setIsScreenSharing(false);
        setScreenShareTrack(null);
      });
      room.on(RoomEvent.TrackSubscribed, (_track, publication, participant) => {
        updateParticipants();
        if (publication.source === Track.Source.ScreenShare && publication.track?.mediaStreamTrack) {
          setRemoteScreenShare({
            participantName: participant.name || participant.identity,
            track: publication.track.mediaStreamTrack,
          });
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
        updateParticipants();
        if (publication.source === Track.Source.ScreenShare) {
          updateScreenShare();
        }
      });
    },
    [updateParticipants, updateScreenShare]
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
      setIsMuted(false);
      setIsDeafened(false);
      updateParticipants();
    },
    [setupRoomListeners, updateParticipants]
  );

  const leave = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
    setConnectedChannelId(null);
    setParticipants([]);
    setIsMuted(false);
    setIsDeafened(false);
    setIsScreenSharing(false);
    setScreenShareTrack(null);
    setRemoteScreenShare(null);
  }, []);

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
  }, [isDeafened]);

  const startScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    await room.localParticipant.setScreenShareEnabled(true);
    setIsScreenSharing(true);
    updateParticipants();
  }, [updateParticipants]);

  const stopScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    await room.localParticipant.setScreenShareEnabled(false);
    setIsScreenSharing(false);
    setScreenShareTrack(null);
    updateParticipants();
  }, [updateParticipants]);

  useEffect(() => {
    return () => {
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
    join,
    leave,
    toggleMute,
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
  };
}

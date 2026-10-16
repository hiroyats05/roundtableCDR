import { useEffect, useRef, useCallback, useState } from "react";
import type { ClientEvent, ServerEvent } from "@saladereunioes/shared";
import { getApiUrl, getAuthToken } from "../services/api";

function getWsUrl() {
  const url = new URL(getApiUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  const token = getAuthToken();
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export function useWebSocket(
  onEvent: (event: ServerEvent) => void,
  enabled: boolean
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const send = useCallback((event: ClientEvent) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as ServerEvent;
        onEventRef.current(event);
      } catch {
        // ignore invalid messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [enabled]);

  return { send };
}

export function useOnlineUsers(enabled: boolean) {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  const handleEvent = useCallback((event: ServerEvent) => {
    if (event.type === "presence:online") {
      setOnlineUsers((prev) => new Set(prev).add(event.userId));
    } else if (event.type === "presence:offline") {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(event.userId);
        return next;
      });
    }
  }, []);

  const { send } = useWebSocket(handleEvent, enabled);

  return { onlineUsers, send };
}

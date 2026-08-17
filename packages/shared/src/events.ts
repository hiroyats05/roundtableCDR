import type { Message } from "./types.js";

export type ClientEvent =
  | {
      type: "channel:join";
      channelId: string;
    }
  | {
      type: "channel:leave";
      channelId: string;
    }
  | {
      type: "message:send";
      channelId: string;
      content: string;
    };

export type ServerEvent =
  | {
      type: "message:created";
      message: Message;
    }
  | {
      type: "presence:online";
      userId: string;
    }
  | {
      type: "presence:offline";
      userId: string;
    };

/**
 * ACP over a process's stdio. The SDK owns the JSON-RPC framing and the
 * protocol types; this module only adapts Node streams and the two client
 * handlers (permission requests, session updates) the caller provides.
 *
 * The streams are the ones `Computer.attach` hands back, so the process is
 * always inside the bot's box and this package never talks to a container
 * runtime itself.
 */
import type { Readable, Writable } from "node:stream";

import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

export type ClientHandlers = {
  requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
  sessionUpdate: (params: SessionNotification) => Promise<void>;
};

export function connectAcp(
  toAgent: Writable,
  fromAgent: Readable,
  handlers: ClientHandlers,
): ClientSideConnection {
  const stream = ndJsonStream(toWebWritable(toAgent), toWebReadable(fromAgent));
  return new ClientSideConnection(() => handlers, stream);
}

function toWebWritable(stream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
  });
}

function toWebReadable(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
  });
}

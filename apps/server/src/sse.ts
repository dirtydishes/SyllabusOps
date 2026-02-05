import type { LogEvent } from "./logger";

export type SseEvent =
  | { type: "log"; payload: LogEvent }
  | { type: "hello"; payload: { now: string } };

export class SseHub {
  private readonly encoder = new TextEncoder();
  private readonly controllers = new Set<
    ReadableStreamDefaultController<Uint8Array>
  >();

  connect(): ReadableStream<Uint8Array> {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;
        this.controllers.add(controller);
        this.sendTo(controller, {
          type: "hello",
          payload: { now: new Date().toISOString() },
        });
      },
      cancel: () => {
        if (controllerRef) this.controllers.delete(controllerRef);
      },
    });
  }

  close(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.controllers.delete(controller);
  }

  broadcast(evt: SseEvent) {
    for (const controller of this.controllers) this.sendTo(controller, evt);
  }

  private sendTo(
    controller: ReadableStreamDefaultController<Uint8Array>,
    evt: SseEvent
  ) {
    const lines = [
      `event: ${evt.type}`,
      `data: ${JSON.stringify(evt.payload)}`,
      "",
      "",
    ].join("\n");
    controller.enqueue(this.encoder.encode(lines));
  }
}

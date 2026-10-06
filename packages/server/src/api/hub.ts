import type { ServerMessage } from '@joseki-dojo/shared'
import type { WebSocket } from 'ws'

/** Remembers which session each socket watches; session messages go only to its watchers. */
export class Hub {
  private readonly watching = new Map<WebSocket, string>()

  watch(socket: WebSocket, sessionId: string): void {
    this.watching.set(socket, sessionId)
  }

  drop(socket: WebSocket): void {
    this.watching.delete(socket)
  }

  publish(sessionId: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const [socket, id] of this.watching) {
      if (id === sessionId && socket.readyState === socket.OPEN) socket.send(data)
    }
  }
}

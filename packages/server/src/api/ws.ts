import type { ServerMessage } from '@joseki-dojo/shared'
import type { WebSocket } from 'ws'
import type { AppServices } from '../app'
import { EngineError } from '../engine/engine'
import { toErrorMessage } from '../errors'
import { parseClientMessage } from './messages'

type SocketDeps = Pick<AppServices, 'sessions' | 'hub' | 'health'>

export function handleSocket(socket: WebSocket, deps: SocketDeps): void {
  const send = (msg: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  const handle = async (text: string): Promise<void> => {
    const msg = parseClientMessage(text)
    switch (msg.type) {
      case 'startSession': {
        requireReady(deps)
        const view = deps.sessions.start(msg.settings)
        deps.hub.watch(socket, view.id)
        send({ type: 'sessionState', session: view })
        return
      }
      case 'replayFrom': {
        requireReady(deps)
        const view = deps.sessions.replayFrom(msg.sessionId, msg.turn)
        deps.hub.watch(socket, view.id)
        send({ type: 'sessionState', session: view })
        return
      }
      case 'resync': {
        deps.hub.watch(socket, msg.sessionId) // before the await: updates published meanwhile must not be missed
        if (deps.health.get().state === 'failed') await deps.health.recover()
        send({ type: 'sessionState', session: deps.sessions.resync(msg.sessionId) })
        return
      }
      case 'playMove':
        deps.sessions.playUserMove(msg.sessionId, msg.vertex)
        return
      case 'tenuki':
        await deps.sessions.tenuki(msg.sessionId)
        return
      case 'finish':
        deps.sessions.finish(msg.sessionId)
        return
      case 'continuePlaying':
        deps.sessions.continuePlaying(msg.sessionId)
        return
    }
  }

  socket.on('message', (data) => {
    handle(String(data)).catch((err: unknown) => send(toErrorMessage(err)))
  })
  socket.on('close', () => deps.hub.drop(socket))
}

function requireReady(deps: SocketDeps): void {
  const h = deps.health.get()
  if (h.state !== 'ready') throw new EngineError(`KataGo не готов: ${h.reason ?? h.state}`, 'engine_failed')
}

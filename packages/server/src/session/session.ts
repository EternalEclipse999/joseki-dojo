import { inZone, nextColor, Position, type Actor, type Color, type Corner, type Move, type MoveVertex, type PlayedMove, type SessionView } from '@joseki-dojo/shared'
import { movesBefore, type SessionRecord } from '../store/records'
import { josekiStartedIn } from './end-detection'

export type SessionErrorCode = 'bad_request' | 'outside_zone' | 'not_your_turn' | 'session_not_found' | 'session_finished'

export class SessionError extends Error {
  constructor(message: string, readonly code: SessionErrorCode) {
    super(message)
    this.name = 'SessionError'
  }
}

/** In-memory state of one training session; mutates the SessionRecord it wraps. */
export class Session {
  botThinking = false
  private pos: Position
  private started: boolean
  private endProposed = false
  private movesSinceDecline: number | null = null

  constructor(readonly record: SessionRecord) {
    const corner = record.settings.corner
    let pos = Position.fromMoves(record.initialMoves)
    let started = josekiStartedIn(pos, corner)
    for (const m of record.moves) {
      pos = pos.play(m)
      started ||= josekiStartedIn(pos, corner)
    }
    this.pos = pos
    this.started = started
  }

  get id(): string {
    return this.record.id
  }

  get corner(): Corner {
    return this.record.settings.corner
  }

  get userColor(): Color {
    return this.record.settings.userColor
  }

  get position(): Position {
    return this.pos
  }

  /** Index of the current position (= number of session moves). */
  get turn(): number {
    return this.record.moves.length
  }

  get allMoves(): Move[] {
    return movesBefore(this.record, this.turn)
  }

  get toMove(): Color {
    return nextColor(this.allMoves)
  }

  get isUserTurn(): boolean {
    return this.toMove === this.userColor
  }

  get isPlaying(): boolean {
    return this.record.status === 'playing'
  }

  get josekiStarted(): boolean {
    return this.started
  }

  /** Plays `vertex` for the side to move. Throws IllegalMoveError or SessionError and leaves state unchanged. */
  apply(vertex: MoveVertex, actor: Actor): PlayedMove {
    if (!this.isPlaying) throw new SessionError('Тренировка уже закончена', 'session_finished')
    const color = this.toMove
    const next = this.pos.play({ color, vertex })
    const played: PlayedMove = { color, vertex, actor, inZone: inZone(this.corner, vertex) }
    this.record.moves.push(played)
    this.pos = next
    this.started ||= josekiStartedIn(next, this.corner)
    if (this.endProposed) {
      // Playing on instead of answering the proposal counts as «Играть дальше».
      this.endProposed = false
      this.movesSinceDecline = 0
    }
    if (this.movesSinceDecline !== null) this.movesSinceDecline++
    return played
  }

  canProposeEnd(): boolean {
    return (
      this.isPlaying &&
      this.started &&
      !this.endProposed &&
      (this.movesSinceDecline === null || this.movesSinceDecline >= 2)
    )
  }

  proposeEnd(): void {
    this.endProposed = true
  }

  declineEnd(): void {
    if (!this.endProposed) return
    this.endProposed = false
    this.movesSinceDecline = 0
  }

  finish(at: string): void {
    this.record.status = 'finished'
    this.record.finishedAt = at
    this.endProposed = false
  }

  view(): SessionView {
    return {
      id: this.id,
      settings: this.record.settings,
      initialMoves: [...this.record.initialMoves],
      moves: [...this.record.moves],
      toMove: this.toMove,
      status: this.record.status,
      josekiStarted: this.started,
      endProposed: this.endProposed,
      botThinking: this.botThinking,
      parentSessionId: this.record.parentSessionId,
    }
  }
}

import { gtpToVertex, moveToGtp, type Actor, type Color, type Corner, type PlayedMove, type ReviewSummary, type SessionStatus } from '@joseki-dojo/shared'
import type { Db } from './db'
import type { AnalysisKind, MissedPunishmentRow, SessionRecord, StoredAnalysis } from './records'

interface SessionRow {
  id: string
  created_at: string
  finished_at: string | null
  user_color: string
  bot_rank: string
  corner: string
  status: string
  parent_session_id: string | null
  initial_moves_json: string
  summary_json: string | null
}

interface MoveRow {
  color: string
  move: string
  actor: string
  in_zone: number
}

interface MissedRow {
  turn: number
  bot_move: string
  bot_loss: number
  user_move: string
  user_loss: number
  best_move: string
  best_pv_json: string
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  insertSession(r: SessionRecord): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, created_at, finished_at, mode, environment, user_color, bot_rank, corner, status, parent_session_id, initial_moves_json, summary_json)
           VALUES (@id, @createdAt, @finishedAt, @mode, @environment, @userColor, @botRank, @corner, @status, @parentSessionId, @initialMoves, @summary)`,
        )
        .run({
          id: r.id,
          createdAt: r.createdAt,
          finishedAt: r.finishedAt,
          mode: r.settings.mode,
          environment: r.settings.environment,
          userColor: r.settings.userColor,
          botRank: r.settings.botRank,
          corner: r.settings.corner,
          status: r.status,
          parentSessionId: r.parentSessionId,
          initialMoves: JSON.stringify(r.initialMoves),
          summary: r.summary ? JSON.stringify(r.summary) : null,
        })
      r.moves.forEach((m, turn) => this.insertMove(r.id, turn, m))
    })()
  }

  insertMove(sessionId: string, turn: number, m: PlayedMove): void {
    this.db
      .prepare('INSERT INTO moves (session_id, turn, color, move, actor, in_zone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, turn, m.color, moveToGtp(m.vertex), m.actor, m.inZone ? 1 : 0)
  }

  setStatus(id: string, status: SessionStatus, finishedAt: string | null): void {
    this.db.prepare('UPDATE sessions SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, id)
  }

  saveSummary(id: string, summary: ReviewSummary): void {
    this.db.prepare('UPDATE sessions SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), id)
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    if (!row) return null
    const moveRows = this.db
      .prepare('SELECT color, move, actor, in_zone FROM moves WHERE session_id = ? ORDER BY turn')
      .all(id) as MoveRow[]
    return {
      id: row.id,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      settings: {
        mode: 'free',
        environment: 'empty',
        userColor: row.user_color as Color,
        botRank: row.bot_rank,
        corner: row.corner as Corner,
      },
      status: row.status as SessionStatus,
      parentSessionId: row.parent_session_id,
      initialMoves: JSON.parse(row.initial_moves_json),
      moves: moveRows.map((m) => ({
        color: m.color as Color,
        vertex: gtpToVertex(m.move),
        actor: m.actor as Actor,
        inZone: m.in_zone === 1,
      })),
      summary: row.summary_json ? (JSON.parse(row.summary_json) as ReviewSummary) : null,
    }
  }

  saveAnalysis(sessionId: string, turn: number, kind: AnalysisKind, visits: number, analysis: StoredAnalysis): void {
    this.db
      .prepare(
        `INSERT INTO analyses (session_id, turn, kind, visits, payload_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_id, turn, kind) DO UPDATE SET visits = excluded.visits, payload_json = excluded.payload_json`,
      )
      .run(sessionId, turn, kind, visits, JSON.stringify(analysis))
  }

  getAnalysis(sessionId: string, turn: number, kind: AnalysisKind): { visits: number; analysis: StoredAnalysis } | null {
    const row = this.db
      .prepare('SELECT visits, payload_json FROM analyses WHERE session_id = ? AND turn = ? AND kind = ?')
      .get(sessionId, turn, kind) as { visits: number; payload_json: string } | undefined
    return row ? { visits: row.visits, analysis: JSON.parse(row.payload_json) as StoredAnalysis } : null
  }

  replaceMissedPunishments(sessionId: string, rows: MissedPunishmentRow[], createdAt: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM missed_punishments WHERE session_id = ?').run(sessionId)
      const insert = this.db.prepare(
        `INSERT INTO missed_punishments (session_id, turn, bot_move, bot_loss, user_move, user_loss, best_move, best_pv_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const r of rows) {
        insert.run(
          sessionId,
          r.turn,
          moveToGtp(r.botMove),
          r.botLoss,
          moveToGtp(r.userMove),
          r.userLoss,
          moveToGtp(r.bestMove),
          JSON.stringify(r.bestPv.map(moveToGtp)),
          createdAt,
        )
      }
    })()
  }

  listMissedPunishments(sessionId: string): MissedPunishmentRow[] {
    const rows = this.db
      .prepare('SELECT turn, bot_move, bot_loss, user_move, user_loss, best_move, best_pv_json FROM missed_punishments WHERE session_id = ? ORDER BY turn')
      .all(sessionId) as MissedRow[]
    return rows.map((r) => ({
      turn: r.turn,
      botMove: gtpToVertex(r.bot_move),
      botLoss: r.bot_loss,
      userMove: gtpToVertex(r.user_move),
      userLoss: r.user_loss,
      bestMove: gtpToVertex(r.best_move),
      bestPv: (JSON.parse(r.best_pv_json) as string[]).map(gtpToVertex),
    }))
  }
}

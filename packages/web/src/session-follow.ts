/**
 * Which session's messages reach the screen. The user leaves a session by going back to the start screen or by starting
 * another one; its late messages (the bot's move that ends after «Закончить», the review analysis) must not bring it back.
 */
export class SessionFollow {
  private readonly left = new Set<string>()
  /** The session on screen while a start or a replay is on its way; null when nothing is being replaced. */
  private replacing: string | null = null

  /** The user starts or replays a session while `current` is on screen. */
  starting(current: string | null): void {
    this.replacing = current
  }

  /** The user goes back to the start screen from `current`. */
  leave(current: string | null): void {
    if (current !== null) this.left.add(current)
    this.replacing = null
  }

  /**
   * Whether a `sessionState` of `id` goes on screen. The first state of a new session retires the one it replaces; until
   * then the old one keeps updating, so a start that fails leaves it as it was.
   */
  acceptState(id: string): boolean {
    if (this.left.has(id)) return false
    if (this.replacing !== null && id !== this.replacing) {
      this.left.add(this.replacing)
      this.replacing = null
    }
    return true
  }

  /** Whether a message about session `id` (analysis progress, review, variation) still concerns the screen. */
  concerns(id: string): boolean {
    return !this.left.has(id)
  }
}

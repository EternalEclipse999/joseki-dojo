export class JdbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JdbError'
  }
}

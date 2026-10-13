import { JdbError } from './errors'

/** Unsigned LEB128. */
export function writeVarint(out: number[], value: number): void {
  let v = value
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
}

export function readVarint(bytes: Uint8Array, pos: number): [value: number, next: number] {
  let value = 0
  let scale = 1
  let p = pos
  for (let i = 0; i < 5; i++) {
    if (p >= bytes.length) throw new JdbError('Файл базы обрывается')
    const b = bytes[p++]
    value += (b & 0x7f) * scale
    if (b < 0x80) return [value, p]
    scale *= 0x80
  }
  throw new JdbError('Повреждённое число в файле базы')
}

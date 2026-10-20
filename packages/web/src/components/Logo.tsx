/** Two stones, black over white: the brand in the header and in the «О программе» window. */
export function Logo() {
  return (
    <svg class="logo" viewBox="0 0 22 22" aria-hidden="true">
      <circle class="w" cx="14" cy="11" r="6.6" />
      <circle cx="8.2" cy="11" r="7.3" fill="var(--bg)" />
      <circle class="b" cx="8.2" cy="11" r="6.6" />
    </svg>
  )
}

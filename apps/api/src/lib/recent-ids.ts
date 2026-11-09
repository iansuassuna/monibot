/** Bounded memory of recently seen ids, oldest forgotten first. */
export class RecentIds {
  readonly #ids = new Set<string>()

  constructor(readonly capacity: number) {}

  /** Records `id`; true when it was not among the remembered ids. */
  markSeen(id: string): boolean {
    if (this.#ids.has(id)) return false
    this.#ids.add(id)
    if (this.#ids.size > this.capacity) {
      const [oldest] = this.#ids
      if (oldest !== undefined) this.#ids.delete(oldest)
    }
    return true
  }
}

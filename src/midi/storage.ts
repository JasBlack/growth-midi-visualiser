// localStorage that never throws. Storage can be missing or refuse writes
// (blocked site data, private windows, a full quota); the app then keeps
// working for the session and says so, instead of an exception stopping a
// click handler half-way.

export function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/** false when the value could not be stored. */
export function writeStored(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

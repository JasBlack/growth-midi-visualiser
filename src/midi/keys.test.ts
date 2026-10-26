import { describe, expect, it } from 'vitest'
import { controlOwnsKey, ignoredKey, type TargetKind } from './keys'

const NAV = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
const owns = (kind: TargetKind, byKeyboard: boolean) => (key: string) => controlOwnsKey(kind, key, byKeyboard)

describe('controlOwnsKey', () => {
  it('text entry keeps every key except Escape and F2, however it got focus', () => {
    for (const by of [true, false]) {
      expect(['a', ' ', 'Enter', 'Backspace', ...NAV].every(owns('text', by))).toBe(true)
      expect(['Escape', 'F2'].some(owns('text', by))).toBe(false)
    }
  })

  it('a slider keeps only its arrows / Home / End / PageUp / PageDown, even when clicked', () => {
    for (const by of [true, false]) {
      expect(NAV.every(owns('range', by))).toBe(true)
      expect(['a', ' ', 'Enter', 'Escape'].some(owns('range', by))).toBe(false)
    }
  })

  // v0.19: focus left on a clicked button or a touched slider swallowed every shortcut and the piano
  it('a control the mouse clicked leaves letters, space and Enter to the shortcuts and piano', () => {
    for (const kind of ['select', 'toggle', 'activator', 'file'] as const) expect(['a', 'z', ' ', 'Enter', ...NAV].some(owns(kind, false))).toBe(false)
    expect(['a', 'z', '1'].some(owns('range', false))).toBe(false)
  })

  it('tabbed to with the keyboard, a control keeps the keys it natively uses', () => {
    expect([' ', 'Enter', ...NAV].every(owns('select', true))).toBe(true)
    expect(owns('toggle', true)(' ')).toBe(true)
    expect(owns('toggle', true)('Enter')).toBe(false)
    for (const kind of ['activator', 'file'] as const) {
      expect([' ', 'Enter'].every(owns(kind, true))).toBe(true)
      expect(['a', 'ArrowUp'].some(owns(kind, true))).toBe(false)
    }
    expect(['a', ' ', 'Enter', 'ArrowUp'].some(owns('none', true))).toBe(false)
  })
})

describe('ignoredKey', () => {
  const ev = (key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'isComposing'>> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, isComposing: false, ...mods }) as KeyboardEvent

  it('handled events, IME composition and browser / OS chords are ignored; plain keys are not', () => {
    expect(ignoredKey(ev('a'))).toBe(false)
    expect(ignoredKey(ev('a', { defaultPrevented: true }))).toBe(true)
    expect(ignoredKey(ev('a', { isComposing: true }))).toBe(true)
    expect(ignoredKey(ev('Process'))).toBe(true)
    expect(ignoredKey(ev('s', { ctrlKey: true }))).toBe(true)
    expect(ignoredKey(ev('k', { metaKey: true }))).toBe(true)
    expect(ignoredKey(ev('a', { altKey: true }))).toBe(true)
  })

  it('AltGr (Ctrl+Alt) or Option typing a palette bracket still reaches the shortcuts', () => {
    expect(ignoredKey(ev('[', { altKey: true }))).toBe(false)
    expect(ignoredKey(ev(']', { altKey: true, ctrlKey: true }))).toBe(false)
    expect(ignoredKey(ev('[', { altKey: true, metaKey: true }))).toBe(true)
    expect(ignoredKey(ev('[', { ctrlKey: true }))).toBe(true)
  })
})

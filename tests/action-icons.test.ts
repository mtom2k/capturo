import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pages = ['index', 'gif', 'gif-record', 'gif-preview', 'scroll-record', 'color', 'pin'] as const
const html = Object.fromEntries(pages.map((page) => [page,
  readFileSync(new URL(`../src/renderer/${page}.html`, import.meta.url), 'utf8')
])) as Record<(typeof pages)[number], string>

function action(page: (typeof pages)[number], id: string): string {
  const tag = html[page].match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0]
  expect(tag, `${page} #${id}`).toBeDefined()
  return tag!
}

describe('shared action buttons', () => {
  it('uses the same glyph and color for equivalent actions in every mode', () => {
    for (const page of ['index', 'gif-preview', 'color', 'pin'] as const) {
      expect(action(page, 'copy')).toContain('data-action-icon="copy" data-action-tone="copy"')
    }
    for (const page of ['index', 'gif-preview'] as const) {
      expect(action(page, 'save')).toContain('data-action-icon="save" data-action-tone="save"')
    }
    for (const [page, id] of [
      ['index', 'cancel'], ['gif', 'cancel'], ['gif-record', 'cancel'],
      ['gif-preview', 'discard'], ['scroll-record', 'cancel'], ['pin', 'close']
    ] as const) {
      expect(action(page, id)).toContain('data-action-icon="cancel" data-action-tone="cancel"')
    }
    expect(action('index', 'open-detached')).toContain('data-action-icon="edit" data-action-tone="transition"')
    expect(action('pin', 'edit')).toContain('data-action-icon="edit" data-action-tone="transition"')
  })

  it('names and explains every icon-only action', () => {
    for (const page of pages) {
      const buttons = html[page].match(/<button\b[^>]*class="[^"]*app-action[^"]*"[^>]*><\/button>/g) ?? []
      expect(buttons.length, page).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(button, page).toMatch(/data-action-icon="[^"]+"/)
        expect(button, page).toMatch(/aria-label="[^"]+"/)
        expect(button, page).toMatch(/title="[^"]+"/)
      }
    }
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizeScreenAccessStatus,
  presentScreenAccess,
  type ScreenAccessActionKind,
  type ScreenAccessStatus
} from '../src/shared/permissions'

function present(status: ScreenAccessStatus, previouslyGranted = false) {
  return presentScreenAccess({ supported: true, status, previouslyGranted })
}

function actionKinds(status: ScreenAccessStatus, previouslyGranted = false): ScreenAccessActionKind[] {
  return present(status, previouslyGranted).actions.map((action) => action.kind)
}

describe('screen access status normalization', () => {
  it('keeps the statuses Electron documents', () => {
    expect(normalizeScreenAccessStatus('granted')).toBe('granted')
    expect(normalizeScreenAccessStatus('denied')).toBe('denied')
    expect(normalizeScreenAccessStatus('restricted')).toBe('restricted')
    expect(normalizeScreenAccessStatus('not-determined')).toBe('not-determined')
  })

  it('maps anything unrecognized to unknown rather than guessing', () => {
    expect(normalizeScreenAccessStatus('something-new')).toBe('unknown')
    expect(normalizeScreenAccessStatus(undefined)).toBe('unknown')
    expect(normalizeScreenAccessStatus(null)).toBe('unknown')
    expect(normalizeScreenAccessStatus(1)).toBe('unknown')
  })
})

describe('screen access presentation', () => {
  it('offers no action on a platform without the permission gate', () => {
    const presentation = presentScreenAccess({ supported: false, status: 'granted', previouslyGranted: false })
    expect(presentation.actions).toEqual([])
    expect(presentation.tone).toBe('ok')
  })

  it('asks nothing of the user once the permission is granted', () => {
    expect(present('granted').tone).toBe('ok')
    expect(present('granted').summary).toBe('Granted')
    // Nothing to fix: no request, no relaunch. Managing it is not a remediation step.
    expect(actionKinds('granted')).toEqual(['open-settings'])
  })

  it('always offers a way into System Settings on a platform that gates capture', () => {
    // A permission is not a one-way door. Granted included, the user must be able to reach the
    // pane to review or revoke it; hiding the route once the answer was yes left the Settings
    // row reporting a status with no way to act on it.
    for (const status of ['granted', 'not-determined', 'denied', 'restricted', 'unknown'] as const) {
      for (const previouslyGranted of [false, true]) {
        expect(actionKinds(status, previouslyGranted)).toContain('open-settings')
      }
    }
  })

  it('names that action for what it does rather than where it goes', () => {
    const manage = present('granted').actions.find((action) => action.kind === 'open-settings')
    expect(manage?.label).toBe('Manage Permissions')
  })

  it('still offers the request on denied, because macOS reports a never-asked app that way', () => {
    // getMediaAccessStatus('screen') is a boolean preflight: a first run and a real refusal are
    // the same value. Dropping the request action would mean the system prompt is never raised on
    // a first run, and System Settings would not list Capturo yet either.
    expect(actionKinds('denied')).toContain('request')
    expect(actionKinds('not-determined')).toContain('request')
  })

  it('never tells the user they refused a permission macOS may never have asked about', () => {
    expect(present('denied').detail).not.toMatch(/refus|declin|you denied/i)
  })

  it('always pairs turning the permission on with reopening Capturo', () => {
    // macOS hands a new grant only to a newly launched app, so an instruction that stops at
    // "turn it on" leaves the user with a permission that appears granted and does nothing.
    for (const status of ['denied', 'not-determined'] as const) {
      expect(actionKinds(status)).toContain('relaunch')
      expect(present(status).detail).toMatch(/reopen Capturo/i)
    }
  })

  it('names the stale-grant case instead of repeating generic advice', () => {
    // The confusing state: System Settings still shows Capturo switched on while the app is
    // denied. Telling that user to "turn it on" sends them to a pane that already looks correct.
    const stale = present('denied', true)
    expect(stale.summary).toBe('Needs re-granting')
    expect(stale.detail).toMatch(/switch it off and on again/i)
    expect(stale.actions[0].kind).toBe('open-settings')
    expect(stale.actions.map((a) => a.kind)).toContain('relaunch')
  })

  it('does not tell a first-time user to switch anything off', () => {
    expect(present('denied', false).detail).not.toMatch(/off and on/i)
    expect(present('denied', false).summary).toBe('Not granted')
  })

  it('offers no request or relaunch for a policy restriction that no prompt can move', () => {
    expect(actionKinds('restricted')).toEqual(['open-settings'])
    expect(present('restricted').summary).toBe('Restricted')
  })

  it('routes an unreadable status to System Settings', () => {
    expect(actionKinds('unknown')).toContain('open-settings')
  })

  it('labels every offered action', () => {
    for (const status of ['not-determined', 'denied', 'restricted', 'unknown'] as const) {
      for (const previouslyGranted of [false, true]) {
        for (const action of present(status, previouslyGranted).actions) {
          expect(action.label.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('gives every actionable state a one-word summary', () => {
    for (const status of ['granted', 'not-determined', 'denied', 'restricted', 'unknown'] as const) {
      expect(present(status).summary.length).toBeGreaterThan(0)
    }
  })
})

describe('screen access settings row', () => {
  const html = readFileSync(new URL('../src/renderer/settings.html', import.meta.url), 'utf8')
  const renderer = readFileSync(new URL('../src/renderer/settings.ts', import.meta.url), 'utf8')

  it('labels the settings button the way the presentation names it', () => {
    expect(html).toContain('id="screen-access-open"')
    expect(html).toMatch(/id="screen-access-open"[^>]*>Manage Permissions</)
  })

  it('still explains where the button goes', () => {
    expect(html).toMatch(/id="screen-access-open"[^>]*title="Open System Settings at Privacy [^"]*Screen Recording"/)
  })

  it('opens the pane through the main process rather than a renderer-side URL', () => {
    expect(renderer).toContain('window.capturoPermissions.openScreenSettings()')
    expect(renderer).not.toContain('x-apple.systempreferences')
  })

  // Managing the permission is offered even when nothing is wrong, so the row must not treat the
  // presence of a button as evidence that the user has something to fix.
  it('draws the callout from tone, not from the number of actions', () => {
    expect(renderer).toContain("screenAccessRow.classList.toggle('needs-action', presentation.tone !== 'ok')")
    expect(renderer).not.toContain("'needs-action', presentation.actions.length > 0")
  })
})

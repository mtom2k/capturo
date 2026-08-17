// macOS gates screen capture behind a TCC permission the user grants in System Settings, and
// without it every Capturo capture returns nothing. Windows has no equivalent gate, so the whole
// feature reports itself unsupported there and the Settings row stays hidden rather than showing
// a control that means nothing on that platform.
//
// Three macOS behaviours shape everything here:
//
//   1. There is no readable "not asked yet" state. getMediaAccessStatus('screen') is a boolean
//      preflight, so a first run and a genuine refusal both report 'denied'. No message may
//      accuse the user of refusing, and 'denied' must keep offering the request path.
//   2. A new grant does not reach a running process. macOS applies it to a newly launched app,
//      so "turn it on" is never the whole instruction; reopening Capturo is the other half.
//   3. A grant can go stale while System Settings still shows Capturo switched on. TCC binds a
//      grant to the app's designated requirement, which for an unsigned build is its own code
//      hash, so a rebuilt Capturo is a different app to TCC. The user sees an enabled toggle and
//      a denied app at the same time. `previouslyGranted` exists to name that state instead of
//      repeating generic "turn it on" advice at someone who already has. See D-028.
//
// The logic here is pure so it can be tested without Electron; the main process owns the actual
// systemPreferences query in src/main/index.ts. See D-027.

// The statuses Electron documents. macOS only produces 'granted' and 'denied' for screen capture;
// the others are kept because the API is shared with camera/microphone and may widen.
export type ScreenAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export type ScreenAccessState = {
  // False on platforms that do not gate screen capture behind a system permission.
  supported: boolean
  status: ScreenAccessStatus
  // True once Capturo has observed a granted status on this machine, persisted across launches.
  previouslyGranted: boolean
}

// 'request' attempts a capture, which raises the system prompt only if macOS has never asked.
// 'open-settings' opens the Screen Recording pane. 'relaunch' restarts Capturo, which is the only
// way a grant made while Capturo was running takes effect.
export type ScreenAccessActionKind = 'request' | 'open-settings' | 'relaunch'

export type ScreenAccessAction = {
  kind: ScreenAccessActionKind
  label: string
}

export type ScreenAccessPresentation = {
  // One word for the state, so it reads at a glance without parsing the explanation.
  summary: string
  detail: string
  tone: 'ok' | 'pending' | 'error'
  // In display order. Empty when there is nothing for the user to do.
  actions: ScreenAccessAction[]
}

export type CapturoPermissionsApi = {
  getScreenAccess: () => Promise<ScreenAccessState>
  requestScreenAccess: () => Promise<ScreenAccessState>
  openScreenSettings: () => Promise<boolean>
  relaunch: () => Promise<void>
}

const REQUEST: ScreenAccessAction = { kind: 'request', label: 'Request access' }
const OPEN_SETTINGS: ScreenAccessAction = { kind: 'open-settings', label: 'Open System Settings' }
const RELAUNCH: ScreenAccessAction = { kind: 'relaunch', label: 'Reopen Capturo' }

const KNOWN_STATUSES: ScreenAccessStatus[] = ['not-determined', 'granted', 'denied', 'restricted']

// Electron types this loosely and macOS can add values, so anything unrecognized becomes
// 'unknown' and is treated as "send the user to System Settings" rather than silently as denied.
export function normalizeScreenAccessStatus(value: unknown): ScreenAccessStatus {
  return KNOWN_STATUSES.includes(value as ScreenAccessStatus) ? (value as ScreenAccessStatus) : 'unknown'
}

export function presentScreenAccess(state: ScreenAccessState): ScreenAccessPresentation {
  if (!state.supported) {
    return {
      summary: 'Not required',
      detail: 'This system does not require screen capture permission.',
      tone: 'ok',
      actions: []
    }
  }

  if (state.status === 'granted') {
    return { summary: 'Granted', detail: 'Capturo can capture this screen.', tone: 'ok', actions: [] }
  }

  if (state.status === 'restricted') {
    return {
      summary: 'Restricted',
      detail: 'Screen Recording is restricted on this device, usually by a device policy. Capturo cannot request it.',
      tone: 'error',
      actions: [OPEN_SETTINGS]
    }
  }

  if (state.status === 'unknown') {
    return {
      summary: 'Unknown',
      detail: 'macOS did not report a Screen Recording status. Check it in System Settings, then reopen Capturo.',
      tone: 'error',
      actions: [OPEN_SETTINGS, RELAUNCH]
    }
  }

  // 'denied' and 'not-determined'. The instruction is always two steps, because turning the
  // permission on does not reach this already-running process.
  if (state.previouslyGranted) {
    return {
      summary: 'Needs re-granting',
      detail:
        'Capturo had Screen Recording access and no longer does. If System Settings still shows Capturo switched on, ' +
        'switch it off and on again, then reopen Capturo.',
      tone: 'error',
      actions: [OPEN_SETTINGS, RELAUNCH, REQUEST]
    }
  }

  return {
    summary: 'Not granted',
    detail:
      'Capturo cannot capture your screen yet. Step 1: allow Screen Recording. ' +
      'Step 2: reopen Capturo, because macOS only applies it to a newly launched app.',
    tone: 'error',
    actions: [REQUEST, OPEN_SETTINGS, RELAUNCH]
  }
}

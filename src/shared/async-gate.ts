// Keep asynchronous live-tool launches single-flight. A capture can spend time waiting for
// permission or a native screenshot before it has a session to close, so a session check alone
// cannot prevent two simultaneous triggers from creating independent overlays.
export class AsyncGate {
  private active: Promise<void> | null = null

  run(task: () => Promise<void>): Promise<void> {
    if (this.active) return this.active
    const started = Promise.resolve().then(task)
    const active = started.finally(() => {
      if (this.active === active) this.active = null
    })
    this.active = active
    return active
  }
}

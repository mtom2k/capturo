// Build, then launch Electron . with CAPTURO_CAPTURE_ON_START=1, --remote-debugging-port=9235
// and --inspect=9236. Uses the real main/preload/editor and generated image content.
// Exercises clipboard image copy; preserves/restores common text/HTML/RTF/image clipboard formats.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
const clients = []
const targets = async () => (await (await fetch('http://127.0.0.1:9235/json/list')).json())
const connect = async (url) => {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let id = 0
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    pending.get(message.id)?.(message)
  }
  const client = { ws, send: (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout: ${method}`)) }, 15_000)
    pending.set(key, (message) => {
      clearTimeout(timer); pending.delete(key)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    })
    ws.send(JSON.stringify({ id: key, method, params }))
  }) }
  clients.push(client)
  return client
}
const evaluate = async (client, expression) => {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const waitFor = async (fn) => {
  for (let n = 0; n < 100; n++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('Timed out waiting for window state')
}
const main = await connect((await (await fetch('http://127.0.0.1:9236/json/list')).json())[0].webSocketDebuggerUrl)
const readMain = (expression) => evaluate(main, expression)
const windows = () => readMain("process.mainModule.require('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL(),visible:w.isVisible(),top:w.isAlwaysOnTop(),bounds:w.getBounds(),opacity:w.getOpacity()}))")
const findOverlay = async () => {
  const connected = new Map()
  return waitFor(async () => {
    for (const target of (await targets()).filter(t => t.url.endsWith('/index.html'))) {
      const client = connected.get(target.id) ?? await connect(target.webSocketDebuggerUrl)
      connected.set(target.id, client)
      const role = await evaluate(client, 'window.capturo?.requestInitialization().then(p=>p?.role)')
      if (role === 'editor') return { target, client }
    }
  })
}
if (!(await targets()).some(t => t.url.endsWith('/index.html'))) {
  await readMain("process.mainModule.require('electron').app.emit('second-instance',{},[],process.cwd())")
}
const { target: capture, client: overlay } = await findOverlay()
mkdirSync('tmp-pin-smoke', { recursive: true })
try {
  await waitFor(() => evaluate(overlay, 'Boolean(window.capturoPin && window.capturo)'))
  assert.equal(await evaluate(overlay, 'window.capturoPin.initialize()'), null, 'Editor cannot read pin payloads')
  assert.equal(await evaluate(overlay, 'window.capturoPin.copy()'), false)
  const generated = `(() => {const c=document.createElement('canvas');c.width=960;c.height=480;
    const x=c.getContext('2d');x.fillStyle='#eef5ff';x.fillRect(0,0,960,480);
    x.fillStyle='#183650';x.font='bold 44px sans-serif';x.fillText('Pinned reference',60,100);
    x.font='28px sans-serif';x.fillText('Original resolution: 960 × 480',60,165);
    x.fillStyle='#187ae0';x.fillRect(60,220,380,160);x.fillStyle='#ffba49';x.beginPath();x.arc(660,300,90,0,7);x.fill();
    return c.toDataURL('image/png')})()`
  const url = await evaluate(overlay, generated)
  const session = await evaluate(overlay, 'window.capturo.requestInitialization().then(p=>p.sessionId)')
  // Invalid session must not create a window.
  const before = (await windows()).length
  assert.equal((await evaluate(overlay, `window.capturo.pinImage('invalid',${JSON.stringify(url)})`)).opened, false)
  assert.equal((await windows()).length, before)
  // Open the generated capture in the actual Full Tab editor, then use its toolbar Pin action.
  const detached = await evaluate(overlay, `window.capturo.openDetachedEditor(${JSON.stringify(session)},${JSON.stringify(url)},false)`)
  assert.equal(detached.opened, true, JSON.stringify(detached))
  const editorTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('/index.html') && t.id !== capture.id))
  const editor = await connect(editorTarget.webSocketDebuggerUrl)
  await waitFor(() => evaluate(editor, 'document.body?.classList.contains("detached-editor") && document.querySelector("#editor-ui")?.hidden === false'))
  const editorId = (await windows()).find(w => w.url.endsWith('/index.html')).id
  await evaluate(editor, "document.querySelector('#pin').click()")
  const pinTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('/pin.html')))
  const pin = await connect(pinTarget.webSocketDebuggerUrl)
  await waitFor(async () => (await windows()).some(w => w.url.endsWith('/pin.html') && w.visible))
  let pins = (await windows()).filter(w => w.url.endsWith('/pin.html'))
  assert.equal(pins.length, 1)
  assert.equal(pins[0].top, true)
  assert.ok((await windows()).some(w => w.id === editorId), 'Full Tab remains open')
  assert.deepEqual(await evaluate(pin, '({width:document.querySelector("img").naturalWidth,height:document.querySelector("img").naturalHeight})'), { width: 960, height: 480 })
  const pinId = pins[0].id
  await evaluate(pin, "document.querySelector('#opacity').value='45';document.querySelector('#opacity').dispatchEvent(new Event('input',{bubbles:true}))")
  await waitFor(async () => Math.abs((await windows()).find(w => w.id === pinId).opacity - 0.45) < 0.01)
  await readMain(`process.mainModule.require('electron').BrowserWindow.fromId(${pinId}).setSize(350,220)`)
  assert.equal(await evaluate(pin, 'document.querySelector("header").scrollWidth <= innerWidth'), true)
  await readMain(`process.mainModule.require('electron').BrowserWindow.fromId(${pinId}).setSize(900,540)`)
  assert.equal(await evaluate(pin, 'document.querySelector("header").getBoundingClientRect().top'), 0)
  await evaluate(pin, "document.querySelector('#opacity').value='100';document.querySelector('#opacity').dispatchEvent(new Event('input',{bubbles:true}))")
  // Clipboard operations retain source pixels and do not close a pin.
  await readMain("globalThis.pinClipboardBackup = (()=>{const c=process.mainModule.require('electron').clipboard;return {text:c.readText(),html:c.readHTML(),rtf:c.readRTF(),image:c.readImage()}})()")
  assert.equal(await evaluate(pin, 'window.capturoPin.copy()'), true)
  assert.deepEqual(await readMain("process.mainModule.require('electron').clipboard.readImage().getSize()"), { width: 960, height: 480 })
  await readMain("process.mainModule.require('electron').clipboard.write(pinClipboardBackup);delete globalThis.pinClipboardBackup")
  await evaluate(pin, "document.querySelector('#edit').click()")
  await waitFor(() => evaluate(pin, "document.querySelector('#status').textContent.includes('already open')"))
  assert.equal((await windows()).filter(w => w.url.endsWith('/index.html')).length, 1, 'Edit does not replace an open Full Tab')
  const shot = await pin.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('tmp-pin-smoke/pin.png', Buffer.from(shot.data, 'base64'))
  await evaluate(editor, "document.querySelector('#pin').click()")
  await waitFor(async () => (await windows()).filter(w => w.url.endsWith('/pin.html') && w.visible).length === 2)
  // Start another real capture using the development single-instance path while pins remain open.
  await readMain("process.mainModule.require('electron').app.emit('second-instance',{},[],process.cwd())")
  const { target: nextCapture, client: nextOverlay } = await findOverlay()
  await waitFor(() => evaluate(nextOverlay, 'Boolean(window.capturo)'))
  const nextSession = await evaluate(nextOverlay, 'window.capturo.requestInitialization().then(p=>p.sessionId)')
  assert.equal((await evaluate(nextOverlay, `window.capturo.pinImage(${JSON.stringify(nextSession)},${JSON.stringify(url)})`)).opened, true)
  await waitFor(async () => !(await targets()).some(t => t.id === nextCapture.id))
  assert.equal((await windows()).filter(w => w.url.endsWith('/pin.html')).length, 3)
  await pin.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' })
  await waitFor(async () => !(await windows()).some(w => w.id === pinId))
  assert.equal((await windows()).filter(w => w.url.endsWith('/pin.html')).length, 2)
  await readMain(`process.mainModule.require('electron').BrowserWindow.fromId(${editorId}).close()`)
  await waitFor(async () => !(await windows()).some(w => w.id === editorId))
  const editablePinTarget = (await targets()).find(t => t.url.endsWith('/pin.html'))
  const editablePin = await connect(editablePinTarget.webSocketDebuggerUrl)
  await evaluate(editablePin, "document.querySelector('#edit').click()")
  const reopenedTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('/index.html')))
  const reopened = await connect(reopenedTarget.webSocketDebuggerUrl)
  await waitFor(() => evaluate(reopened, 'document.body?.classList.contains("detached-editor") && document.querySelector("#editor-ui")?.hidden === false'))
  assert.deepEqual(await evaluate(reopened, 'window.capturo.requestInitialization().then(p=>({role:p.role,width:p.imageWidth,height:p.imageHeight,forcePng:p.forcePng}))'),
    { role: 'detached', width: 960, height: 480, forcePng: true })
  assert.equal((await windows()).filter(w => w.url.endsWith('/pin.html')).length, 2, 'Editing leaves the original pin visible')
  console.log('PASS: real Pin toolbar, decoded reveal, always-on-top, opacity, resize, original-resolution clipboard, independent pins, Edit to Full Tab, overlay teardown, and Escape close.')
} finally {
  await readMain("if(globalThis.pinClipboardBackup){process.mainModule.require('electron').clipboard.write(pinClipboardBackup);delete globalThis.pinClipboardBackup}")
  if (process.env.CAPTURO_PIN_SMOKE_KEEP_OPEN !== '1') {
    await readMain("setTimeout(()=>process.mainModule.require('electron').app.quit(),100);true")
  }
  clients.forEach(client => client.ws.close())
}

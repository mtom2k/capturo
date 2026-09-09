// Run against annotation-app.cjs launched with --remote-debugging-port=9235 --inspect=9236.
// Exercises the real editor bundle, then validates the scene observed by its main-process IPC.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const connect = async (port) => {
  const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data)
    const callback = pending.get(response.id)
    if (callback) { pending.delete(response.id); callback(response) }
  }
  return {
    close: () => socket.close(),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)) }, 5000)
      pending.set(requestId, (response) => {
        clearTimeout(timer)
        response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result)
      })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
  }
}
const renderer = await connect(9235)
const main = await connect(9236)
const evaluate = async (client, expression) => {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const read = (expression) => evaluate(renderer, expression)
const scene = () => evaluate(main, 'annotationSmokeScene')
const settle = () => read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
const click = async (x, y, count = 1) => {
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count })
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count })
  await settle()
}
const element = async (selector) => read(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
const clickElement = async (selector) => { const p = await element(selector); await click(p.x, p.y) }
const drag = async (from, to) => {
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', clickCount: 1 })
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 })
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', clickCount: 1 })
  await settle()
}
const key = async (key, modifiers = 0) => {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers })
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers })
  await settle()
}
const box = () => read('document.querySelector("#text-editor").getBoundingClientRect().toJSON()')
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.1, `${a} != ${b}`)
const tool = (name) => clickElement(`[data-tool="${name}"]`)
const slider = (id, value) => read(`(() => {const s=document.getElementById(${JSON.stringify(id)});s.value=${value};s.dispatchEvent(new Event('input',{bubbles:true}));})()`)
try {
  // Shells can hide a launched Electron window; animation-frame waits need a visible surface.
  await evaluate(main, "process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w => { w.show(); w.focus() })")
  await renderer.send('Page.reload')
  for (let n = 0; n < 60; n++) {
    if (await read('document.body?.classList.contains("detached-editor") && document.querySelector("#editor-ui")?.hidden === false')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await tool('text')
  await click(200, 190)
  await renderer.send('Input.insertText', { text: 'Text should wrap automatically when the box gets narrower and keep the same font size when its top edge is dragged.' })
  await settle()
  const initial = await box()
  assert.ok(initial.height > 50)
  const grip = await element('[data-text-resize="north"]')
  await drag(grip, { x: grip.x, y: grip.y - 40 })
  const raised = await box()
  near(raised.bottom, initial.bottom)
  near(raised.width, initial.width)
  near(raised.top, initial.top - 40)
  await key('Enter', 2)
  const committed = (await scene()).annotations[0]
  assert.ok(committed.box)
  assert.ok(!committed.text.includes('\n'))
  await tool('select')
  await click(220, raised.top + 15)
  const right = { x: raised.right, y: raised.top + raised.height / 2 }
  await drag(right, { x: right.x + 100, y: right.y })
  const widened = (await scene()).annotations[0]
  near(widened.style.fontSize, committed.style.fontSize)
  near(widened.box.height, committed.box.height)
  near(widened.origin.x, committed.origin.x)
  assert.ok(widened.box.width > committed.box.width)
  await click(230, raised.top + 15, 2)
  near((await box()).width, raised.width + 100)
  assert.equal(await read('document.querySelector("#text-editor").value'), committed.text)
  await key('Escape')
  assert.equal((await scene()).annotations[0].text, committed.text)
  assert.equal(await read('document.querySelector("#text-editor").hidden'), true)

  // Selecting or drawing shapes at extreme widths must not alter new step geometry.
  await tool('rectangle')
  await slider('line-width', 1)
  await drag({ x: 100, y: 430 }, { x: 200, y: 500 })
  await tool('step')
  await click(320, 460)
  await tool('ellipse')
  await slider('line-width', 24)
  await drag({ x: 450, y: 430 }, { x: 550, y: 500 })
  await tool('step')
  await click(650, 460)
  const steps = (await scene()).annotations.filter(a => a.type === 'step')
  assert.equal(steps.length, 2)
  near(steps[0].style.fontSize, steps[1].style.fontSize)
  near(steps[0].style.lineWidth, steps[1].style.lineWidth)
  await tool('select')
  await click(320, 460)
  await tool('rectangle')
  assert.equal(await read('document.querySelector("#line-width").value'), '24')
  await tool('text')
  assert.equal(await read('document.querySelector("#font-size").value'), '18')
  await tool('select')
  // At high zoom the source bitmap's pixels must not become the annotation raster grid.
  for (let i = 0; i < 16; i++) {
    await renderer.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 450, deltaX: 0, deltaY: -100, modifiers: 2 })
    await settle()
  }
  const edge = await read(`(() => {
    const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),d=c.width/r.width;
    const pixels=c.getContext('2d').getImageData(0,Math.round((450-r.y)*d),c.width,1).data;
    let longest=0,run=0,solid=0;
    for(let i=0;i<pixels.length;i+=4){
      if(pixels[i+1]>75&&pixels[i+1]<248){run++;longest=Math.max(longest,run)}else run=0;
      if(pixels[i+1]<=75&&pixels[i]>200)solid++;
    }
    return {longest,solid,dpr:devicePixelRatio,backingRatio:d};
  })()`)
  assert.ok(edge.solid > 3, `Zoomed rectangle edge missing: ${JSON.stringify(edge)}`)
  assert.ok(edge.longest <= 2, `Annotation edge is bitmap-scaled: ${JSON.stringify(edge)}`)
  near(edge.backingRatio, edge.dpr)
  for (const [width, height] of [[720, 520], [1500, 950], [820, 900], [1100, 744]]) {
    await evaluate(main, `process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].setContentSize(${width},${height})`)
    await settle()
    const layout = await read(`(() => {
      const r=id=>document.getElementById(id).getBoundingClientRect().toJSON();
      return {dock:r('editor-dock'),toolbar:r('toolbar'),canvas:r('capture-canvas'),width:innerWidth};
    })()`)
    near(layout.dock.top, 0)
    assert.ok(layout.toolbar.top >= 0 && layout.toolbar.bottom <= layout.dock.bottom)
    assert.ok(layout.toolbar.left >= 0 && layout.toolbar.right <= layout.width)
    assert.ok(layout.canvas.top >= layout.dock.bottom)
    await tool('text')
    assert.equal(await read(`(() => {
      const a=document.querySelector('#options-bar').getBoundingClientRect(),b=document.querySelector('#editor-dock').getBoundingClientRect();
      return a.top>=0&&a.bottom<=b.bottom&&a.right<=innerWidth;
    })()`), true)
    await tool('select')
  }
  await clickElement('#zoom-reset')
  // At 1:1, source-aligned viewport pixels (including overlapping privacy effects) must match
  // export exactly. The backing store changes for display density; output dimensions do not.
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1048, height: 770, deviceScaleFactor: 1, mobile: false })
  await settle()
  const ellipse = (await scene()).annotations.find(a => a.type === 'ellipse').rect
  await tool('blur')
  await drag({ x: ellipse.x + 24, y: ellipse.y + 126 },
    { x: ellipse.x + ellipse.width / 2 + 24, y: ellipse.y + ellipse.height + 126 })
  await tool('pixelate')
  await drag({ x: ellipse.x + ellipse.width / 3 + 24, y: ellipse.y + 126 },
    { x: ellipse.x + ellipse.width + 24, y: ellipse.y + ellipse.height + 126 })
  await tool('select')
  const screenshot = await renderer.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('tmp-annotation-smoke/editor.png', Buffer.from(screenshot.data, 'base64'))
  await clickElement('#save')
  const exportData = `data:image/png;base64,${readFileSync('tmp-annotation-smoke/save.png').toString('base64')}`
  const pixels = await read(`(async () => {
    const image=new Image();image.src=${JSON.stringify(exportData)};await image.decode();
    const ref=document.createElement('canvas');ref.width=image.width;ref.height=image.height;
    ref.getContext('2d').drawImage(image,0,0);
    const a=ref.getContext('2d').getImageData(8,8,984,604).data;
    const b=document.querySelector('canvas').getContext('2d').getImageData(32,32,984,604).data;
    let mismatch=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])mismatch++;
    return {width:image.width,height:image.height,mismatch};
  })()`)
  assert.deepEqual(pixels, { width: 1000, height: 620, mismatch: 0 })
  await renderer.send('Emulation.clearDeviceMetricsOverride')
  console.log('PASS: text/step regressions; sharp zoomed edges; DPR backing; fixed dock at four sizes; preview/export pixels identical with overlapping Blur/Pixelate.', edge)
} finally {
  renderer.close()
  main.close()
}

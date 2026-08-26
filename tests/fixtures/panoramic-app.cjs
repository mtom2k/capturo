const { app, BrowserWindow } = require('electron')
const path = require('node:path')

let fixtureWindow = null

app.whenReady().then(async () => {
  fixtureWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'Capturo Panoramic Fixture',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  await fixtureWindow.loadFile(path.join(__dirname, 'panoramic-fixture.html'))
  fixtureWindow.show()
})

app.on('window-all-closed', () => app.quit())

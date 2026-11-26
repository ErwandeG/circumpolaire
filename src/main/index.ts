import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

// Ancien nom de l'appli (« Circumpolaire ») : on garde son dossier de données pour conserver
// les réglages, le dernier lieu et le cache des zones déjà chargées.
app.setPath('userData', join(app.getPath('appData'), 'circumpolaire'))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Star Trail Planner',
    autoHideMenuBar: true,
    // Une fois empaquetée, l'appli prend l'icône de l'exécutable ; en développement, celle du dépôt.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Les liens externes (attributions de la carte) s'ouvrent dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

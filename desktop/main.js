// Nour de Commerce — application de bureau Windows (Electron).
// Ouvre le logiciel en ligne dans une fenêtre dédiée et ajoute ce qu'un navigateur fait mal :
//  - connexion automatique des lecteurs code-barres série / RS232 / USB-COM (Web Serial, sans fenêtre de choix)
//  - impression directe des tickets (optionnelle)
//  - écran clair en cas de coupure Internet
// Les lecteurs Honeywell en mode USB clavier (HID) fonctionnent directement, sans rien installer.
const { app, BrowserWindow, Menu, shell, session, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_URL = 'https://nour-de-commerce-erp.foot-arena-pro.workers.dev';
// Identifiants USB (vendorId) : Honeywell / Hand Held Products / Metrologic
const SCANNER_VENDORS = ['0c2e', '0536', '0d5c', '3118', '1334'];

const configPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try {
    return { url: DEFAULT_URL, silentPrint: false, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { url: DEFAULT_URL, silentPrint: false };
  }
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
let config;
let mainWindow = null;

const appOrigin = () => new URL(config.url).origin;
const isAppUrl = (u) => {
  try {
    return new URL(u).origin === appOrigin();
  } catch {
    return false;
  }
};

function setupSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['serial', 'media', 'clipboard-sanitized-write', 'fullscreen', 'notifications']);
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && isAppUrl(origin));
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission) && isAppUrl(wc.getURL())));
  ses.setDevicePermissionHandler((d) => d.deviceType === 'serial' && isAppUrl(d.origin));
  // Choix automatique du port série : lecteur Honeywell en priorité, sinon le premier port disponible
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    const vid = (p) => String(p.vendorId ?? '').toLowerCase().replace(/^0x/, '');
    const scanner = portList.find((p) => SCANNER_VENDORS.includes(vid(p)) || SCANNER_VENDORS.includes(vid(p).padStart(4, '0')));
    const port = scanner ?? portList[0];
    callback(port ? port.portId : '');
  });
}

function buildMenu() {
  const go = (p) => mainWindow?.loadURL(new URL(p, config.url).toString());
  const template = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Accueil', accelerator: 'Alt+Home', click: () => go('/') },
        { label: 'Point de vente', accelerator: 'F2', click: () => go('/pos') },
        { type: 'separator' },
        { label: 'Recharger', accelerator: 'F5', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Plein écran', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Agrandir le texte', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Réduire le texte', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Taille normale', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ],
    },
    {
      label: 'Scanner et impression',
      submenu: [
        { label: 'Tester le lecteur code-barres', click: () => go('/scanner') },
        { type: 'separator' },
        {
          label: 'Impression directe des tickets (sans fenêtre)',
          type: 'checkbox',
          checked: !!config.silentPrint,
          click: (item) => {
            config.silentPrint = item.checked;
            saveConfig();
          },
        },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Guide du scanner Honeywell', click: () => shell.openExternal('https://github.com/Hmoham404/Nour-DE-Commerce/blob/main/docs/SCANNER-HONEYWELL.md') },
        { label: 'Ouvrir le fichier de configuration', click: () => (saveConfig(), shell.openPath(configPath())) },
        { label: 'Outils de diagnostic', accelerator: 'Ctrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        {
          label: 'À propos',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Nour de Commerce',
              message: `Nour de Commerce — version ${app.getVersion()}`,
              detail: `Serveur : ${config.url}\nDeveloped by GM LAC`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function attachHandlers(win) {
  // Fenêtres ouvertes par l'application (impression, documents) : même application ; liens externes : navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1000, height: 800, autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.on('did-create-window', (child) => attachHandlers(child));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Nour de Commerce',
    backgroundColor: '#0B2149',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  attachHandlers(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  // Coupure Internet ou serveur injoignable → page hors ligne avec nouvel essai automatique
  mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation annulée
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { target: url || config.url } });
  });
  mainWindow.loadURL(config.url);
}

ipcMain.handle('ndc:print', (e) => {
  const wc = e.sender;
  return new Promise((resolve) => wc.print({ silent: !!config.silentPrint, printBackground: true }, (ok, reason) => resolve({ ok, reason })));
});
ipcMain.handle('ndc:info', () => ({ version: app.getVersion(), silentPrint: !!config.silentPrint, url: config.url }));
ipcMain.handle('ndc:retry', () => mainWindow?.loadURL(config.url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    config = loadConfig();
    app.setAppUserModelId('tn.nourdecommerce.erp');
    setupSession();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require("electron-updater");
const BackupManager = require('./backup-manager');
const cron = require('node-cron');

let mainWindow;
let backupManager;
let isQuitting = false;
let isUpdating = false; // Nuova flag per controllare se siamo in fase di aggiornamento

// Avvia il server Express
require(path.join(__dirname, 'src', 'server.js'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
  });

  // Carica la home dell'app Express
  mainWindow.loadURL('http://localhost:3000/');
  
  // Mette in fullscreen l'applicazione all'avvio
  mainWindow.maximize();

  // Gestisci la chiusura della finestra con backup
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      performBackupAndQuit();
    }
  });
}

// Funzione per eseguire backup prima di chiudere con messaggio semplice
async function performBackupAndQuit() {
  console.log('🔄 Esecuzione backup prima di chiudere l\'app...');
  
  // Mostra messaggio informativo con opzione di skip
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: '💾 Salvataggio Sicurezza Dati',
    message: 'Backup automatico in corso',
    detail: 'Questa opzione è stata aggiunta per evitare perdita di dati.\n\n' +
            'Il backup verrà effettuato ogni volta che l\'app verrà chiusa, ' +
            'per evitare perdita insolita di dati.\n\n' +
            'L\'operazione richiederà pochi secondi...',
    buttons: ['✓ Procedi con il backup', '✗ Salta il backup'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
  });

  // Se l'utente sceglie "Salta il backup"
  if (result === 1) {
    console.log('⚠️ Backup saltato dall\'utente');
    isQuitting = true;
    app.quit();
    return;
  }

  try {
    // Mostra finestra di progresso (senza pulsanti)
    dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: '🔄 Backup in corso...',
      message: 'Salvataggio dati in corso',
      detail: 'Attendere prego, sto salvando i dati...\n' +
              'Non chiudere l\'applicazione.\n\n' +
              'Tempo stimato: 5-10 secondi',
      buttons: [], // Nessun pulsante, solo messaggio
      noLink: true,
      icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
    });

    // Esegue backup
    await backupManager.createBackup();
    
    // Pulizia backup vecchi
    backupManager.cleanOldBackups(20);
    
    console.log('✅ Backup completato con successo');
    
    // Mostra breve messaggio di conferma (opzionale, si chiude automaticamente)
    setTimeout(() => {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: '✅ Backup completato',
        message: 'Backup completato con successo',
        detail: 'I tuoi dati sono stati salvati in sicurezza.\n' +
                'Puoi ora chiudere l\'applicazione.',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
        icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
      });
    }, 300);
    
  } catch (error) {
    console.error('❌ Errore backup alla chiusura:', error);
    
    // Mostra errore con opzione di chiudere comunque
    const errorResult = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: '⚠️ Attenzione',
      message: 'Backup non completato',
      detail: 'Il backup non è stato completato a causa di un errore.\n\n' +
              'Dettagli: ' + error.message.substring(0, 150) + '\n\n' +
              'Puoi comunque chiudere l\'applicazione.',
      buttons: ['Chiudi comunque', 'Riprova'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
    });
    
    // Se l'utente sceglie "Riprova", riprova il backup
    if (errorResult === 1) {
      console.log('🔄 Riprovo backup dopo errore...');
      try {
        await backupManager.createBackup();
        backupManager.cleanOldBackups(20);
        console.log('✅ Backup riuscito al secondo tentativo');
      } catch (retryError) {
        console.error('❌ Errore anche al secondo tentativo:', retryError);
      }
    }
  }
  
  isQuitting = true;
  app.quit();
}

// NUOVA FUNZIONE: Backup automatico silenzioso per aggiornamenti
async function performSilentBackup() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🔒 Backup automatico silenzioso in corso...');
      
      // Esegue backup senza mostrare dialog
      await backupManager.createBackup();
      
      // Pulizia backup vecchi
      backupManager.cleanOldBackups(20);
      
      console.log('✅ Backup silenzioso completato con successo');
      resolve(true);
    } catch (error) {
      console.error('❌ Errore backup silenzioso:', error);
      // Anche in caso di errore, continuiamo comunque con l'aggiornamento
      // ma registriamo l'errore
      resolve(false);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  // Inizializza il sistema di backup
  const dbConfig = {
    host: 'mysql-jemaka.alwaysdata.net',
    user: 'jemaka',
    password: 'Saba270704!',
    database: 'jemaka_salmax'
  };

  backupManager = new BackupManager(dbConfig);

  // Backup ogni 3 ore (se l'app è aperta) - SILENZIOSO
  cron.schedule('0 */3 * * *', async () => {
    console.log('⏰ Backup programmato ogni 3 ore');
    try {
      await backupManager.createBackup();
      backupManager.cleanOldBackups(20);
    } catch (err) {
      console.error('❌ Errore backup periodico:', err);
    }
  });

  // Backup giornaliero a mezzanotte (se l'app è aperta) - SILENZIOSO
  cron.schedule('0 0 * * *', async () => {
    console.log('🌙 Backup notturno programmato');
    try {
      await backupManager.createBackup();
      backupManager.cleanOldBackups(20);
    } catch (err) {
      console.error('❌ Errore backup notturno:', err);
    }
  });

  // Backup iniziale dopo 10 secondi dall'avvio - SILENZIOSO
  setTimeout(async () => {
    console.log('🚀 Esecuzione backup iniziale...');
    try {
      await backupManager.createBackup();
      const stats = backupManager.getBackupStats();
      console.log('📊 Statistiche backup:', stats);
    } catch (err) {
      console.error('❌ Errore backup iniziale:', err);
    }
  }, 10000); // 10 secondi dopo l'avvio

  // Controlla aggiornamenti dopo che la finestra è creata
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Gestisce chiusura finestre con backup
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuitting) {
    performBackupAndQuit();
  } else if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Backup anche quando l'app viene chiusa dal sistema
app.on('before-quit', (event) => {
  if (!isQuitting && !isUpdating) {
    event.preventDefault();
    performBackupAndQuit();
  }
});

// Handler per errori non gestiti (evita crash visibili)
process.on('uncaughtException', (error) => {
  console.error('⚠️ Errore non gestito:', error);
  // L'app continua a funzionare
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Promise rejection non gestita:', reason);
  // L'app continua a funzionare
});

// ===== GESTIONE AGGIORNAMENTI =====
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'ChrisFireXx',
  repo: 'Gestionale',
  private: true,
  token: process.env.GH_TOKEN || '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'
});

// Configurazione updater
autoUpdater.autoDownload = false; // Non scaricare automaticamente

// Quando trova un aggiornamento disponibile
autoUpdater.on('update-available', (info) => {
  console.log('Aggiornamento disponibile:', info.version);
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '🎉 Nuovo Aggiornamento Disponibile',
    message: `Una nuova versione è pronta per te!`,
    detail: `Versione corrente: ${app.getVersion()}\nNuova versione: ${info.version}\n\nVuoi scaricare l'aggiornamento ora?`,
    buttons: ['✓ Sì, scarica ora', '⏰ Più tardi'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
    icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
  }).then((result) => {
    // Solo se l'utente clicca "Sì, scarica ora" (indice 0)
    if (result.response === 0) {
      console.log('Inizio download aggiornamento...');
      
      // Mostra notifica di download in corso
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '⬇️ Download in corso',
        message: 'Sto scaricando l\'aggiornamento...',
        detail: 'Puoi continuare a lavorare, ti avviserò quando sarà pronto.',
        buttons: ['OK'],
        noLink: true,
        icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
      });
      
      autoUpdater.downloadUpdate();
    } else {
      console.log('Download aggiornamento rimandato dall\'utente');
    }
  });
});

// Quando NON ci sono aggiornamenti
autoUpdater.on('update-not-available', () => {
  console.log('✅ App già aggiornata all\'ultima versione');
});

// Progresso del download
autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  const downloaded = (progressObj.transferred / 1024 / 1024).toFixed(2);
  const total = (progressObj.total / 1024 / 1024).toFixed(2);
  const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(2);
  
  console.log(`📥 Download: ${percent}% (${downloaded}MB / ${total}MB) - ${speed} MB/s`);
});

// Quando l'aggiornamento è stato scaricato
autoUpdater.on('update-downloaded', async (info) => {
  console.log('✅ Aggiornamento scaricato completamente');
  
  // IMPOSTA LA FLAG DI AGGIORNAMENTO
  isUpdating = true;
  
  // Mostra dialog che informa dell'aggiornamento imminente
  const updateDialogResult = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '✅ Aggiornamento Pronto',
    message: 'L\'aggiornamento è stato scaricato con successo!',
    detail: `Versione ${info.version} pronta per l'installazione.\n\nL'applicazione verrà aggiornata automaticamente.\n\nI tuoi dati verranno salvati in sicurezza prima dell'aggiornamento.`,
    buttons: ['🔄 Procedi con l\'aggiornamento', '⏰ Rimanda'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
    icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
  });

  // Solo se l'utente clicca "Procedi con l'aggiornamento" (indice 0)
  if (updateDialogResult.response === 0) {
    console.log('Avvio backup automatico prima dell\'aggiornamento...');
    
    // ✅ Mostra dialog "Backup automatico in corso"
    const backupWindow = new BrowserWindow({
      width: 400,
      height: 200,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      center: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
    });

    // ✅ HTML per il dialog di backup automatico
    backupWindow.loadURL(`data:text/html;charset=utf-8,
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: transparent;
          }
          .container {
            background: white;
            padding: 30px 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            text-align: center;
            min-width: 320px;
          }
          .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #27ae60;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          h2 {
            color: #2c3e50;
            margin: 0 0 10px 0;
            font-size: 1.3rem;
          }
          p {
            color: #7f8c8d;
            margin: 0;
            font-size: 0.95rem;
          }
          .subtext {
            margin-top: 8px;
            font-size: 0.85rem;
            color: #95a5a6;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h2>💾 Backup automatico in corso</h2>
          <p>Sto salvando i tuoi dati in sicurezza...</p>
          <p class="subtext">Non chiudere l'applicazione</p>
        </div>
      </body>
      </html>
    `);

    // ✅ Esegui backup automatico in background
    setTimeout(async () => {
      try {
        // Esegui il backup silenzioso
        const backupSuccess = await performSilentBackup();
        
        if (backupSuccess) {
          console.log('✅ Backup completato, procedo con l\'aggiornamento');
        } else {
          console.log('⚠️ Backup non riuscito, procedo comunque con l\'aggiornamento');
        }
        
        // Chiudi la finestra di backup
        if (backupWindow && !backupWindow.isDestroyed()) {
          backupWindow.close();
        }
        
        // ✅ Mostra dialog "Installazione in corso"
        const loadingWindow = new BrowserWindow({
          width: 400,
          height: 200,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          center: true,
          resizable: false,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          },
          icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
        });

        // ✅ HTML per il dialog di installazione
        loadingWindow.loadURL(`data:text/html;charset=utf-8,
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body {
                margin: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: transparent;
              }
              .container {
                background: white;
                padding: 30px 40px;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                text-align: center;
                min-width: 320px;
              }
              .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              h2 {
                color: #2c3e50;
                margin: 0 0 10px 0;
                font-size: 1.3rem;
              }
              p {
                color: #7f8c8d;
                margin: 0;
                font-size: 0.95rem;
              }
              .subtext {
                margin-top: 8px;
                font-size: 0.85rem;
                color: #95a5a6;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="spinner"></div>
              <h2>🔄 Installazione in corso...</h2>
              <p>Sto riavviando l'applicazione</p>
              <p class="subtext">Attendere prego</p>
            </div>
          </body>
          </html>
        `);

        // ✅ Chiudi la finestra principale
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }

        // ✅ Attendi 2 secondi per mostrare il messaggio, poi installa
        setTimeout(() => {
          autoUpdater.quitAndInstall(true, true);
        }, 2000);
        
      } catch (error) {
        console.error('❌ Errore durante il processo di aggiornamento:', error);
        
        // Chiudi eventuali finestre rimaste aperte
        if (backupWindow && !backupWindow.isDestroyed()) {
          backupWindow.close();
        }
        
        // Mostra errore all'utente
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '❌ Errore Aggiornamento',
          message: 'Si è verificato un errore durante l\'aggiornamento',
          detail: 'L\'aggiornamento non è stato completato.\n\nPuoi continuare a usare l\'applicazione normalmente.',
          buttons: ['OK'],
          noLink: true,
          icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
        });
        
        // Resetta la flag
        isUpdating = false;
      }
    }, 1000); // Breve attesa per mostrare il messaggio di backup
    
  } else {
    console.log('Aggiornamento rimandato dall\'utente');
    // Resetta la flag
    isUpdating = false;
  }
});

// Gestione errori
autoUpdater.on('error', (err) => {
  console.error('❌ Errore aggiornamento:', err);
  
  // Resetta la flag di aggiornamento
  isUpdating = false;
  
  // ✅ Verifica se è un errore di connessione
  const isNetworkError = 
    err.message.includes('net::') || 
    err.message.includes('ENOTFOUND') || 
    err.message.includes('ETIMEDOUT') ||
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('getaddrinfo') ||
    err.message.includes('network');

  if (isNetworkError) {
    // ⚠️ Errore di connessione - chiude l'app
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '⚠️ Nessuna Connessione Internet',
      message: 'Attenzione: Connessione Internet non disponibile',
      detail: 'Per utilizzare l\'applicazione è necessaria una connessione Internet attiva.\n\nCollegati alla rete e riprova.',
      buttons: ['OK'],
      noLink: true,
      defaultId: 0,
      icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
    }).then(() => {
      // ✅ Chiude l'applicazione dopo aver cliccato OK
      console.log('Chiusura app per mancanza di connessione');
      isQuitting = true;
      app.quit();
    });
  } else {
    // ℹ️ Altro tipo di errore - l'app continua a funzionare
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '⚠️ Errore Aggiornamento',
      message: 'Si è verificato un problema durante l\'aggiornamento',
      detail: `Dettagli errore:\n${err.message}\n\nPuoi continuare a usare l'applicazione normalmente.`,
      buttons: ['OK'],
      noLink: true,
      icon: path.join(__dirname, 'src', 'public', 'img', 'logo2.ico')
    });
  }
});
const express = require('express');
const path = require('path');
const engine = require('ejs-mate');
const session = require('express-session');
const cookieParser = require('cookie-parser'); // ⭐ AGGIUNTO
const db = require('./db');

const clientiRoutes = require('./routes/clienti');
const prodottiRoutes = require('./routes/prodotti');
const bolleRoutes = require('./routes/bolle');
const dipendentiRoutes = require('./routes/dipendenti');
const storicoRoutes = require('./routes/storico-bolle');
const loginRoutes = require('./routes/login');
const merceRoutes = require('./routes/merce');
const settingsRoutes = require('./routes/settings');
const profileRoutes = require('./routes/profile');
const assistenzaRoutes = require('./routes/assistenza'); // ⭐ AGGIUNTO
const notificheRoutes = require('./routes/notifiche'); // ⭐ AGGIUNTO
const adminRoutes = require('./routes/admin'); // ⭐ AGGIUNTO
const productionRoutes = require('./routes/production');

const app = express();

// Imposta ejs-mate come motore di rendering
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, './views'));

// ⭐ Cookie parser PRIMA delle sessioni
app.use(cookieParser());

// Middleware per sessioni
app.use(session({
  secret: 'salmax-secret-key-CAMBIAMI-in-produzione',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 8 * 60 * 60 * 1000, // 8 ore
    httpOnly: true
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, './public')));

// ⚠️ IMPORTANTE: Le route di login DEVONO essere PRIMA del middleware di autenticazione
app.use('/', loginRoutes);

// ⭐ Route admin (senza middleware autenticazione normale)
app.use('/admin', adminRoutes);

// Middleware di autenticazione per le altre route
app.use((req, res, next) => {
  const publicRoutes = ['/login', '/logout'];

  if (publicRoutes.includes(req.path)) {
    return next();
  }

  // ⭐ CONTROLLO COOKIE "RICORDAMI" SE NON C'È SESSIONE
  if (!req.session.userId || !req.session.societaId) {
    const rememberedUser = req.cookies.rememberedUser;
    
    if (rememberedUser) {
      try {
        // Decodifica i dati dal cookie
        const userData = JSON.parse(Buffer.from(rememberedUser, 'base64').toString());
        
        // Ricrea la sessione automaticamente
        req.session.userId = userData.userId;
        req.session.societaId = userData.societaId;
        req.session.username = userData.username;
        req.session.ragioneSociale = userData.ragioneSociale;
        
        console.log('✅ Login automatico da cookie "ricordami":', userData.username);
        return next();
      } catch (err) {
        console.error('Errore lettura cookie ricordami:', err);
        // Se il cookie è corrotto, eliminalo
        res.clearCookie('rememberedUser');
      }
    }
    
    return res.redirect('/login');
  }

  next();
});

// ✅ Passa dati comuni a tutte le view
app.use((req, res, next) => {
  res.locals.nomeUtente = req.session?.ragioneSociale || req.session?.username || 'Utente';
  res.locals.userId = req.session?.userId || null;
  res.locals.societaId = req.session?.societaId || null;
  next();
});

// Route protette (richiedono autenticazione)
app.use('/clienti', clientiRoutes);
app.use('/prodotti', prodottiRoutes);
app.use('/bolle', bolleRoutes);
app.use('/dipendenti', dipendentiRoutes);
app.use('/storico-bolle', storicoRoutes);
app.use('/merce', merceRoutes);
app.use('/settings', settingsRoutes);
app.use('/profile', profileRoutes);
app.use('/assistenza', assistenzaRoutes); // ⭐ AGGIUNTO
app.use('/notifiche', notificheRoutes); // ⭐ AGGIUNTO
app.use('/conteggio-produzione', productionRoutes); // ⭐ CORRETTO

// 🏠 Homepage / Dashboard
app.get('/', (req, res) => {
  const societaId = req.session.societaId;
  const oggi = new Date();
  const yyyy = oggi.getFullYear();
  const mm = String(oggi.getMonth() + 1).padStart(2, '0');
  const dd = String(oggi.getDate()).padStart(2, '0');
  const dataOggi = `${yyyy}-${mm}-${dd}`;
  
  // Ottieni anche mese corrente per la produzione (YYYY-MM)
  const meseCorrente = `${yyyy}-${mm}`;

  // ✅ Query con filtro societa_id
  const queryBolle = `SELECT COUNT(*) AS totale FROM bolle WHERE DATE(data_creazione) = ? AND societa_id = ?`;
  const queryClienti = `SELECT COUNT(*) AS totale FROM clienti WHERE societa_id = ?`;
  const queryProdotti = `SELECT COUNT(*) AS totale FROM prodotti WHERE societa_id = ?`;
  const queryDipendenti = `SELECT COUNT(*) AS totale FROM dipendenti WHERE societa_id = ?`;
  const queryMerce = `SELECT COUNT(*) AS totale FROM merce WHERE societa_id = ?`;
  
  // ✅ QUERY CORRETTA per conteggio produzione mensile
  // Ottieni tutti i record di produzione per il mese corrente
  const queryProduzioneMensile = `SELECT id, quantita FROM produzione WHERE societa_id = ? AND mese = ?`;

  db.query(queryBolle, [dataOggi, societaId], (err, bolleResult) => {
    if (err) {
      console.error('Errore DB bolle:', err);
      return res.status(500).send("Errore nel DB bolle");
    }

    db.query(queryClienti, [societaId], (err, clientiResult) => {
      if (err) {
        console.error('Errore DB clienti:', err);
        return res.status(500).send("Errore nel DB clienti");
      }

      db.query(queryProdotti, [societaId], (err, prodottiResult) => {
        if (err) {
          console.error('Errore DB prodotti:', err);
          return res.status(500).send("Errore nel DB prodotti");
        }

        db.query(queryDipendenti, [societaId], (err, dipendentiResult) => {
          if (err) {
            console.error('Errore DB dipendenti:', err);
            return res.status(500).send("Errore nel DB dipendenti");
          }

          db.query(queryMerce, [societaId], (err, merceResult) => {
            if (err) {
              console.error('Errore DB merce:', err);
              return res.status(500).send("Errore nel DB merce");
            }

            // 🔴 QUERY CORRETTA: Calcola la somma delle quantità
            db.query(queryProduzioneMensile, [societaId, meseCorrente], (err, produzioneResult) => {
              if (err) {
                console.error('Errore DB produzione:', err);
                // Se c'è errore, imposta produzione a 0
                produzioneResult = [];
              }

              // Calcola il totale sommando tutti i valori negli array JSON
              let totaleProduzioneMensile = 0;
              if (produzioneResult && produzioneResult.length > 0) {
                produzioneResult.forEach(row => {
                  try {
                    if (row.quantita) {
                      const quantitaArray = JSON.parse(row.quantita);
                      if (Array.isArray(quantitaArray)) {
                        quantitaArray.forEach(val => {
                          totaleProduzioneMensile += Number(val) || 0;
                        });
                      }
                    }
                  } catch (parseErr) {
                    console.error('Errore parsing JSON quantita:', parseErr);
                  }
                });
              }

              res.render('index', {
                totaleBolleOggi: bolleResult[0].totale,
                totaleClienti: clientiResult[0].totale,
                totaleProdotti: prodottiResult[0].totale,
                totaleDipendenti: dipendentiResult[0].totale,
                totaleMerce: merceResult[0].totale,
                totaleProduzioneMensile: totaleProduzioneMensile,
                meseProduzione: meseCorrente, // Passa anche il mese per riferimento
                nomeUtente: req.session.ragioneSociale || req.session.username || 'Utente'
              });
            });
          });
        });
      });
    });
  });
});

// 📄 Route /index (alternativa a /)
app.get('/index', (req, res) => {
  res.redirect('/');
});

// 🎯 ROUTE DIRETTA PER CONTEGGIO-PRODUZIONE (come backup)
app.get('/conteggio-produzione-direct', (req, res) => {
  // Ottieni mese corrente (YYYY-MM)
  const oggi = new Date();
  const yyyy = oggi.getFullYear();
  const mm = String(oggi.getMonth() + 1).padStart(2, '0');
  const meseCorrente = `${yyyy}-${mm}`;
  
  console.log('📌 Rendering conteggio-produzione.ejs con mese:', meseCorrente);
  
  res.render('conteggio-produzione', {
    nomeUtente: req.session.ragioneSociale || req.session.username || 'Utente',
    meseCorrente: meseCorrente,
    userId: req.session.userId,
    societaId: req.session.societaId
  });
});

// ❌ Annulla bolla
app.post('/bolle/annulla', async (req, res) => {
  const { bolla_id } = req.body;
  const societaId = req.session.societaId;

  if (!bolla_id) {
    return res.status(400).json({ success: false, message: 'Bolla non specificata' });
  }

  try {
    // ✅ Verifica che la bolla appartenga alla società
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({ success: false, message: 'Non hai i permessi per annullare questa bolla' });
    }

    // 1. Elimina tutte le righe associate
    await db.promise().query(
      'DELETE FROM righe_bolla WHERE bolla_id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    // 2. Elimina la bolla stessa
    await db.promise().query(
      'DELETE FROM bolle WHERE id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    // 3. Pulisci la sessione
    if (req.session) {
      req.session.bollaAperta = null;
      req.session.clienteSelezionato = null;
    }

    res.json({ success: true, message: 'Bolla annullata con successo' });
  } catch (err) {
    console.error('Errore annullamento bolla:', err);
    res.status(500).json({ success: false, message: 'Errore durante l\'annullamento della bolla' });
  }
});

// 🚫 Gestione 404
app.use((req, res) => {
  console.log('🔴 404 - Pagina non trovata:', req.originalUrl);
  console.log('🔴 Metodo:', req.method);
  res.status(404).send('Pagina non trovata');
});

// 🚀 Avvio server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Salmax avviato su http://localhost:${PORT}`);
  console.log(`📝 Accedi a: http://localhost:${PORT}/login`);
  console.log(`🔧 Conteggio produzione: http://localhost:${PORT}/conteggio-produzione`);
  console.log(`🔧 Test diretto: http://localhost:${PORT}/conteggio-produzione-direct`);
});

module.exports = app;
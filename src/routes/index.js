const express = require('express');
const router = express.Router();
const db = require('../db'); // il modulo per la connessione MySQL

router.get('/', (req, res) => {
  const oggi = new Date();
  const anno = oggi.getFullYear();
  const mese = String(oggi.getMonth() + 1).padStart(2, '0'); // mese da 1 a 12
  const giorno = String(oggi.getDate()).padStart(2, '0');

  const dataOggi = `${anno}-${mese}-${giorno}`; // formato YYYY-MM-DD

  // Query per bolle di oggi, clienti totali e prodotti totali
  const queryBolle = 'SELECT COUNT(*) AS totaleBolleOggi FROM bolle WHERE numero != NULL AND DATE(data_creazione) = ? AND societa_id=?';
  const queryClienti = 'SELECT COUNT(*) AS totaleClienti FROM clienti WHERE societa_id=?';
  const queryProdotti = 'SELECT COUNT(*) AS totaleProdotti FROM prodotti Where societa_id=?';

  // Eseguiamo le query in parallelo con Promise
  Promise.all([
    new Promise((resolve, reject) => {
      db.query(queryBolle, [dataOggi], (err, results) => {
        if (err) return reject(err);
        resolve(results[0].totaleBolleOggi);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(queryClienti, (err, results) => {
        if (err) return reject(err);
        resolve(results[0].totaleClienti);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(queryProdotti, (err, results) => {
        if (err) return reject(err);
        resolve(results[0].totaleProdotti);
      });
    }),
  ])
    .then(([totaleBolleOggi, totaleClienti, totaleProdotti]) => {
      // Passa i dati alla view
      res.render('index', {
        totaleBolleOggi,
        totaleClienti,
        totaleProdotti,
        totaleMerce,
        nomeUtente: req.session.ragioneSociale // o prendi da sessione o database
      });
    })
    .catch((err) => {
      console.error('Errore nel caricamento dati:', err);
      res.status(500).send('Errore interno del server');
    });
});

module.exports = router;

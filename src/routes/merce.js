const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
    const societaId = req.session.societaId;
    
    db.query('SELECT * FROM merce WHERE societa_id = ?', [societaId], (err, results) => {
        if (err) {
            console.error('Errore nel caricamento merce:', err);
            return res.status(500).send("Errore nel caricamento merce.");
        }
        res.render('merce', { 
            merce: results,
            merceInModifica: null,
            errore: null
        });
    });
});

router.post('/add', (req, res) => {
    const { nome, quantita } = req.body;
    const societaId = req.session.societaId;
    
    db.query('INSERT INTO merce (nome, quantita, societa_id) VALUES (?, ?, ?)',
        [nome, quantita, societaId], (err) => {
            if (err) {
                console.error('Errore inserimento merce:', err);
                return res.status(500).send('Errore durante l\'inserimento');
            }
            res.redirect('/merce');
        });
});

router.post('/modifica', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;
    
    db.query('SELECT * FROM merce WHERE id = ? AND societa_id = ?', [id, societaId], (err, result) => {
        if (err) {
            console.error("Errore recupero merce:", err);
            return res.status(500).send("Errore durante il recupero della merce.");
        }
        
        if (result.length === 0) {
            return res.status(403).send("Non autorizzato");
        }
        
        db.query('SELECT * FROM merce WHERE societa_id = ?', [societaId], (err, results) => {
            if (err) {
                console.error('Errore caricamento merce:', err);
                return res.status(500).send('Errore del server');
            }
            res.render('merce', { 
                merce: results, 
                merceInModifica: result[0], 
                errore: null 
            });
        });
    });
});

router.post('/update', (req, res) => {
    const { id, nome, quantita } = req.body;
    const societaId = req.session.societaId;
    
    db.query('UPDATE merce SET nome = ?, quantita = ? WHERE id = ? AND societa_id = ?', 
        [nome, quantita, id, societaId], (err, result) => {
            if (err) {
                console.error("Errore aggiornamento merce:", err);
                return res.status(500).send("Errore durante l'aggiornamento della merce.");
            }
            
            if (result.affectedRows === 0) {
                return res.status(403).send('Non autorizzato');
            }
            
            res.redirect('/merce');
        });
});

router.post('/remove', (req, res) => {
    const { id } = req.body;
    const societaId = req.session.societaId;
    
    db.query('DELETE FROM merce WHERE id = ? AND societa_id = ?',
        [id, societaId], (err, result) => {
            if (err) {
                console.error('Errore eliminazione merce:', err);
                return res.status(500).send('Errore durante l\'eliminazione');
            }
            
            if (result.affectedRows === 0) {
                return res.status(403).send('Non autorizzato');
            }
            
            res.redirect('/merce');
        });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const db = require('../db');

// 🔁 GET /prodotti → mostra tutti i prodotti della società
router.get('/', (req, res) => {
    const societaId = req.session.societaId;
    
    db.query('SELECT * FROM prodotti WHERE societa_id = ?', [societaId], (err, results) => {
        if (err) {
            console.error('Errore nel caricamento prodotti:', err);
            return res.status(500).send("Errore nel caricamento prodotti.");
        }
        res.render('prodotti', { prodotti: results });
    });
});

// ➕ POST /prodotti/add → aggiungi nuovo prodotto
router.post('/add', (req, res) => {
    const { codice } = req.body;
    const societaId = req.session.societaId;
    
    db.query(
        'INSERT INTO prodotti (codice, societa_id) VALUES (?, ?)',
        [codice, societaId],
        (err) => {
            if (err) {
                console.error("Errore aggiunta prodotto:", err);
                return res.status(500).send("Errore durante l'inserimento del prodotto.");
            }
            res.redirect('/prodotti');
        }
    );
});

// ❌ POST /prodotti/remove → elimina prodotto per ID
router.post('/remove', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;
    
    db.query('DELETE FROM prodotti WHERE id = ? AND societa_id = ?', [id, societaId], (err, result) => {
        if (err) {
            console.error("Errore eliminazione prodotto:", err);
            return res.status(500).send("Errore durante l'eliminazione del prodotto.");
        }
        
        if (result.affectedRows === 0) {
            return res.status(403).send('Non autorizzato');
        }
        
        res.redirect('/prodotti');
    });
});

// 🔍 GET /prodotti/codice/:codice → ricerca prodotto per codice (solo della propria società)
router.get('/codice/:codice', (req, res) => {
    const codice = req.params.codice.trim();
    const societaId = req.session.societaId;

    db.query(
        'SELECT * FROM prodotti WHERE TRIM(LOWER(codice)) = TRIM(LOWER(?)) AND societa_id = ?',
        [codice, societaId],
        (err, results) => {
            if (err) {
                console.error('Errore nella query codice:', err);
                return res.status(500).json({ error: 'Errore interno' });
            }

            if (results.length > 0) {
                res.json({ prodotto: results[0] });
            } else {
                res.status(404).json({ prodotto: null });
            }
        }
    );
});

module.exports = router;
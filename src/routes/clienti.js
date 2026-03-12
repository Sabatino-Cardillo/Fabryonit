const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
    const societaId = req.session.societaId;
    db.query('SELECT * FROM clienti WHERE societa_id=?', [societaId], (err, results) => {
        if (err) throw err;
        res.render('clienti', { clienti: results, clienteInModifica: null, errore: null });
    });
});

router.post('/add', (req, res) => {
    const { 
        nome, 
        cognome, 
        ragionesociale, 
        indirizzo, 
        citta, 
        cap, 
        provincia, 
        indirizzo_spedizione, 
        citta_spedizione, 
        cap_spedizione, 
        provincia_spedizione, 
        piva 
    } = req.body;
    const societaId = req.session.societaId;

    // Controlla se esiste già un cliente con la stessa ragione sociale
    db.query('SELECT * FROM clienti WHERE ragionesociale = ? AND societa_id=?', [ragionesociale, societaId], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            // Cliente già esistente
            db.query('SELECT * FROM clienti WHERE societa_id=?', [societaId], (err, allResults) => {
                if (err) throw err;
                res.render('clienti', { 
                    clienti: allResults, 
                    clienteInModifica: null, 
                    errore: 'Attenzione: Un cliente con questa ragione sociale è già presente nel database!' 
                });
            });
        } else {
            db.query(
                'INSERT INTO clienti (nome, cognome, ragionesociale, indirizzo, citta, provincia, cap, indirizzo_spedizione, citta_spedizione, provincia_spedizione, cap_spedizione, piva, societa_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
                [
                    nome || '', 
                    cognome || '', 
                    ragionesociale, 
                    indirizzo || '', 
                    citta || '', 
                    provincia || '', 
                    cap || '', 
                    indirizzo_spedizione || indirizzo || '', 
                    citta_spedizione || citta || '', 
                    provincia_spedizione || provincia || '', 
                    cap_spedizione || cap || '', 
                    piva || '', 
                    societaId
                ], 
                (err) => {
                    if (err) throw err;
                    res.redirect('/clienti');
                }
            );
        }
    });
});

router.post('/modifica', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;

    db.query('SELECT * FROM clienti WHERE id = ? AND societa_id=?', [id, societaId], (err, result) => {
        if (err) {
            console.error("Errore recupero cliente:", err);
            return res.status(500).send("Errore durante il recupero del cliente.");
        }
        
        db.query('SELECT * FROM clienti WHERE societa_id=?', [societaId], (err, results) => {
            if (err) throw err;
            res.render('clienti', { clienti: results, clienteInModifica: result[0], errore: null });
        });
    });
});

router.post('/update', (req, res) => {
    const { 
        id, 
        nome, 
        cognome, 
        ragionesociale, 
        indirizzo, 
        citta, 
        cap, 
        provincia, 
        indirizzo_spedizione, 
        citta_spedizione, 
        cap_spedizione, 
        provincia_spedizione, 
        piva 
    } = req.body;
    const societaId = req.session.societaId;

    db.query('SELECT * FROM clienti WHERE ragionesociale = ? AND id != ? AND societa_id=?', [ragionesociale, id, societaId], (err, results) => {
        if (err) throw err;
        
        if (results.length > 0) {
            // Esiste un altro cliente con la stessa ragione sociale
            db.query('SELECT * FROM clienti WHERE id = ? AND societa_id=?', [id, societaId], (err, clienteResult) => {
                if (err) throw err;
                
                db.query('SELECT * FROM clienti WHERE societa_id=?', [societaId], (err, allResults) => {
                    if (err) throw err;
                    res.render('clienti', { 
                        clienti: allResults, 
                        clienteInModifica: clienteResult[0], 
                        errore: 'Attenzione: Un altro cliente con questa ragione sociale è già presente nel database!' 
                    });
                });
            });
        } else {
            db.query(
                'UPDATE clienti SET nome = ?, cognome = ?, ragionesociale = ?, indirizzo = ?, citta = ?, provincia = ?, cap = ?, indirizzo_spedizione = ?, citta_spedizione = ?, provincia_spedizione = ?, cap_spedizione = ?, piva = ? WHERE id = ? AND societa_id = ?', 
                [
                    nome || '', 
                    cognome || '', 
                    ragionesociale, 
                    indirizzo || '', 
                    citta || '', 
                    provincia || '', 
                    cap || '', 
                    indirizzo_spedizione || '', 
                    citta_spedizione || '', 
                    provincia_spedizione || '', 
                    cap_spedizione || '', 
                    piva || '', 
                    id, 
                    societaId
                ], 
                (err) => {
                    if (err) {
                        console.error("Errore aggiornamento cliente:", err);
                        return res.status(500).send("Errore durante l'aggiornamento del cliente.");
                    }
                    res.redirect('/clienti');
                }
            );
        }
    });
});

router.post('/remove', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;

    db.query('DELETE FROM clienti WHERE id = ? AND societa_id = ?', [id, societaId], (err) => {
        if (err) {
            console.error("Errore eliminazione cliente:", err);
            return res.status(500).send("Errore durante l'eliminazione del cliente.");
        }
        res.redirect('/clienti');
    });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /assistenza → Lista ticket del cliente
router.get('/', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [tickets] = await db.promise().query(
            `SELECT * FROM tickets 
             WHERE societa_id = ? 
             ORDER BY data_aggiornamento DESC`,
            [societaId]
        );

        res.render('assistenza', { 
            tickets,
            success: null,
            error: null
        });
    } catch (err) {
        console.error('Errore caricamento ticket:', err);
        res.status(500).send('Errore del server');
    }
});

// GET /assistenza/nuovo → Form nuovo ticket
router.get('/nuovo', (req, res) => {
    res.render('assistenza-nuovo', { error: null });
});

// POST /assistenza/nuovo → Crea nuovo ticket
router.post('/nuovo', async (req, res) => {
    const societaId = req.session.societaId;
    const { oggetto, descrizione, categoria, priorita } = req.body;

    try {
        // Crea il ticket
        const [result] = await db.promise().query(
            `INSERT INTO tickets (societa_id, oggetto, descrizione, categoria, priorita, stato) 
             VALUES (?, ?, ?, ?, ?, 'aperto')`,
            [societaId, oggetto, descrizione, categoria, priorita]
        );

        // Aggiungi il primo messaggio
        await db.promise().query(
            `INSERT INTO ticket_messaggi (ticket_id, mittente_tipo, messaggio) 
             VALUES (?, 'cliente', ?)`,
            [result.insertId, descrizione]
        );

        res.redirect('/assistenza');
    } catch (err) {
        console.error('Errore creazione ticket:', err);
        res.render('assistenza-nuovo', { 
            error: 'Errore durante la creazione del ticket' 
        });
    }
});

// GET /assistenza/:id → Dettaglio ticket con messaggi
router.get('/:id', async (req, res) => {
    const societaId = req.session.societaId;
    const ticketId = req.params.id;

    try {
        // Verifica che il ticket appartenga alla società
        const [tickets] = await db.promise().query(
            'SELECT * FROM tickets WHERE id = ? AND societa_id = ?',
            [ticketId, societaId]
        );

        if (tickets.length === 0) {
            return res.status(404).send('Ticket non trovato');
        }

        const ticket = tickets[0];

        // Carica tutti i messaggi
        const [messaggi] = await db.promise().query(
            `SELECT * FROM ticket_messaggi 
             WHERE ticket_id = ? 
             ORDER BY data_invio ASC`,
            [ticketId]
        );

        // Segna le notifiche come lette
        await db.promise().query(
            `UPDATE notifiche 
             SET letta = TRUE 
             WHERE ticket_id = ? AND societa_id = ? AND letta = FALSE`,
            [ticketId, societaId]
        );

        res.render('assistenza-dettaglio', { 
            ticket, 
            messaggi,
            success: null,
            error: null
        });
    } catch (err) {
        console.error('Errore caricamento dettaglio:', err);
        res.status(500).send('Errore del server');
    }
});

// POST /assistenza/:id/messaggio → Aggiungi messaggio
router.post('/:id/messaggio', async (req, res) => {
    const societaId = req.session.societaId;
    const ticketId = req.params.id;
    const { messaggio } = req.body;

    try {
        // Verifica proprietà ticket
        const [tickets] = await db.promise().query(
            'SELECT id FROM tickets WHERE id = ? AND societa_id = ?',
            [ticketId, societaId]
        );

        if (tickets.length === 0) {
            return res.status(403).send('Non autorizzato');
        }

        // Aggiungi messaggio
        await db.promise().query(
            `INSERT INTO ticket_messaggi (ticket_id, mittente_tipo, messaggio) 
             VALUES (?, 'cliente', ?)`,
            [ticketId, messaggio]
        );

        // Aggiorna data ultimo aggiornamento
        await db.promise().query(
            'UPDATE tickets SET data_aggiornamento = NOW() WHERE id = ?',
            [ticketId]
        );

        res.redirect(`/assistenza/${ticketId}`);
    } catch (err) {
        console.error('Errore invio messaggio:', err);
        res.status(500).send('Errore durante l\'invio del messaggio');
    }
});

module.exports = router;
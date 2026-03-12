const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /notifiche/count → Conta notifiche non lette (per badge)
router.get('/count', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [result] = await db.promise().query(
            'SELECT COUNT(*) as count FROM notifiche WHERE societa_id = ? AND letta = FALSE',
            [societaId]
        );

        res.json({ count: result[0].count });
    } catch (err) {
        console.error('Errore conteggio notifiche:', err);
        res.status(500).json({ error: 'Errore del server' });
    }
});

// GET /notifiche → Lista tutte le notifiche
router.get('/', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [notifiche] = await db.promise().query(
            `SELECT n.*, t.oggetto as ticket_oggetto 
             FROM notifiche n
             JOIN tickets t ON n.ticket_id = t.id
             WHERE n.societa_id = ? 
             ORDER BY n.data_creazione DESC
             LIMIT 50`,
            [societaId]
        );

        res.render('notifiche', { notifiche });
    } catch (err) {
        console.error('Errore caricamento notifiche:', err);
        res.status(500).send('Errore del server');
    }
});

// POST /notifiche/:id/leggi → Segna notifica come letta
router.post('/:id/leggi', async (req, res) => {
    const societaId = req.session.societaId;
    const notificaId = req.params.id;

    try {
        await db.promise().query(
            'UPDATE notifiche SET letta = TRUE WHERE id = ? AND societa_id = ?',
            [notificaId, societaId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Errore aggiornamento notifica:', err);
        res.status(500).json({ error: 'Errore del server' });
    }
});

// POST /notifiche/leggi-tutte → Segna tutte come lette
router.post('/leggi-tutte', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        await db.promise().query(
            'UPDATE notifiche SET letta = TRUE WHERE societa_id = ? AND letta = FALSE',
            [societaId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Errore aggiornamento notifiche:', err);
        res.status(500).json({ error: 'Errore del server' });
    }
});

module.exports = router;
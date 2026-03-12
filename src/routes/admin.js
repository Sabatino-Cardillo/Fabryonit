const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// Middleware per verificare se è admin
function requireAdmin(req, res, next) {
    if (!req.session.isAdmin) {
        return res.redirect('/admin/login');
    }
    next();
}

// GET /admin/login → Redirect al login unificato
router.get('/login', (req, res) => {
    res.redirect('/login');
});

// GET /admin/logout → Logout admin
router.get('/logout', (req, res) => {
    req.session.isAdmin = false;
    req.session.adminId = null;
    req.session.adminName = null;
    res.redirect('/admin/login');
});

// 🆕 GET /admin/gestione → Pagina gestione società e admin
router.get('/gestione', requireAdmin, async (req, res) => {
    try {
        const [societa] = await db.promise().query(
            'SELECT id, ragione_sociale, username, email, telefono, comune FROM societa ORDER BY ragione_sociale'
        );
        
        const [admins] = await db.promise().query(
            'SELECT id, username, nome, email FROM admin ORDER BY nome'
        );
        
        res.render('admin-gestione', {
            societa,
            admins,
            adminName: req.session.adminName,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        console.error('Errore caricamento gestione:', err);
        res.status(500).send('Errore del server');
    }
});

// 🆕 POST /admin/societa/nuova → Crea nuova società
router.post('/societa/nuova', requireAdmin, async (req, res) => {
    const {
        ragione_sociale, indirizzo, comune, provincia, cap,
        partita_iva, email, telefono, username, password, numero_bolla_inizio
    } = req.body;

    try {
        // Verifica che username non esista già
        const [existing] = await db.promise().query(
            'SELECT id FROM societa WHERE username = ?',
            [username]
        );

        if (existing.length > 0) {
            return res.redirect('/admin/gestione?error=Username già esistente');
        }

        // 🔒 Cripta la password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Inserisci la nuova società
        await db.promise().query(
            `INSERT INTO societa 
            (ragione_sociale, indirizzo, comune, provincia, cap, partita_iva, 
             email, telefono, username, password, numero_bolla_inizio) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ragione_sociale, indirizzo, comune, provincia, cap, partita_iva,
             email, telefono, username, hashedPassword, numero_bolla_inizio || 0]
        );

        console.log('✅ Nuova società creata:', ragione_sociale);
        res.redirect('/admin/gestione?success=Società creata con successo');
    } catch (err) {
        console.error('Errore creazione società:', err);
        res.redirect('/admin/gestione?error=Errore durante la creazione della società');
    }
});

// 🆕 POST /admin/societa/:id/elimina → Elimina società
router.post('/societa/:id/elimina', requireAdmin, async (req, res) => {
    const societaId = req.params.id;

    try {
        // Le foreign key CASCADE elimineranno automaticamente tutti i dati correlati
        await db.promise().query('DELETE FROM societa WHERE id = ?', [societaId]);

        console.log('✅ Società eliminata:', societaId);
        res.redirect('/admin/gestione?success=Società eliminata con successo');
    } catch (err) {
        console.error('Errore eliminazione società:', err);
        res.redirect('/admin/gestione?error=Errore durante l\'eliminazione');
    }
});

// 🆕 POST /admin/societa/:id/reset-password → Reset password società
router.post('/societa/:id/reset-password', requireAdmin, async (req, res) => {
    const societaId = req.params.id;
    const { nuova_password } = req.body;

    try {
        // 🔒 Cripta la nuova password
        const hashedPassword = await bcrypt.hash(nuova_password, 10);

        await db.promise().query(
            'UPDATE societa SET password = ? WHERE id = ?',
            [hashedPassword, societaId]
        );

        console.log('✅ Password società resettata:', societaId);
        res.redirect('/admin/gestione?success=Password resettata con successo');
    } catch (err) {
        console.error('Errore reset password:', err);
        res.redirect('/admin/gestione?error=Errore durante il reset della password');
    }
});

// 🆕 POST /admin/admin/nuovo → Crea nuovo admin
router.post('/admin/nuovo', requireAdmin, async (req, res) => {
    const { username, password, email, nome } = req.body;

    try {
        // Verifica che username non esista già
        const [existing] = await db.promise().query(
            'SELECT id FROM admin WHERE username = ?',
            [username]
        );

        if (existing.length > 0) {
            return res.redirect('/admin/gestione?error=Username admin già esistente');
        }

        // 🔒 Cripta la password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Inserisci il nuovo admin
        await db.promise().query(
            'INSERT INTO admin (username, password, email, nome) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, email, nome]
        );

        console.log('✅ Nuovo admin creato:', username);
        res.redirect('/admin/gestione?success=Admin creato con successo');
    } catch (err) {
        console.error('Errore creazione admin:', err);
        res.redirect('/admin/gestione?error=Errore durante la creazione dell\'admin');
    }
});

// 🆕 POST /admin/admin/:id/elimina → Elimina admin
router.post('/admin/:id/elimina', requireAdmin, async (req, res) => {
    const adminId = req.params.id;

    // Previeni l'eliminazione dell'admin corrente
    if (parseInt(adminId) === req.session.adminId) {
        return res.redirect('/admin/gestione?error=Non puoi eliminare il tuo account');
    }

    try {
        await db.promise().query('DELETE FROM admin WHERE id = ?', [adminId]);

        console.log('✅ Admin eliminato:', adminId);
        res.redirect('/admin/gestione?success=Admin eliminato con successo');
    } catch (err) {
        console.error('Errore eliminazione admin:', err);
        res.redirect('/admin/gestione?error=Errore durante l\'eliminazione');
    }
});

// GET /admin/tickets → Dashboard admin con tutti i ticket
router.get('/tickets', requireAdmin, async (req, res) => {
    const filtroStato = req.query.stato || 'tutti';

    try {
        let query = `
            SELECT t.*, s.ragione_sociale, s.username,
            (SELECT COUNT(*) FROM ticket_messaggi WHERE ticket_id = t.id) as num_messaggi
            FROM tickets t
            JOIN societa s ON t.societa_id = s.id
        `;

        const params = [];

        if (filtroStato !== 'tutti') {
            query += ' WHERE t.stato = ?';
            params.push(filtroStato);
        }

        query += ' ORDER BY t.data_aggiornamento DESC';

        const [tickets] = await db.promise().query(query, params);

        // Conta ticket per stato
        const [statistiche] = await db.promise().query(`
            SELECT 
                COUNT(*) as totale,
                SUM(CASE WHEN stato = 'aperto' THEN 1 ELSE 0 END) as aperti,
                SUM(CASE WHEN stato = 'in_lavorazione' THEN 1 ELSE 0 END) as in_lavorazione,
                SUM(CASE WHEN stato = 'risolto' THEN 1 ELSE 0 END) as risolti,
                SUM(CASE WHEN stato = 'chiuso' THEN 1 ELSE 0 END) as chiusi
            FROM tickets
        `);

        res.render('admin-tickets', { 
            tickets,
            stats: statistiche[0],
            filtroStato,
            adminName: req.session.adminName
        });
    } catch (err) {
        console.error('Errore caricamento tickets:', err);
        res.status(500).send('Errore del server');
    }
});

// GET /admin/tickets/:id → Dettaglio ticket
router.get('/tickets/:id', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;

    try {
        const [tickets] = await db.promise().query(
            `SELECT t.*, s.ragione_sociale, s.username, s.email, s.telefono
             FROM tickets t
             JOIN societa s ON t.societa_id = s.id
             WHERE t.id = ?`,
            [ticketId]
        );

        if (tickets.length === 0) {
            return res.status(404).send('Ticket non trovato');
        }

        const ticket = tickets[0];

        const [messaggi] = await db.promise().query(
            `SELECT * FROM ticket_messaggi 
             WHERE ticket_id = ? 
             ORDER BY data_invio ASC`,
            [ticketId]
        );

        res.render('admin-ticket-dettaglio', { 
            ticket, 
            messaggi,
            adminName: req.session.adminName,
            success: null,
            error: null
        });
    } catch (err) {
        console.error('Errore caricamento dettaglio:', err);
        res.status(500).send('Errore del server');
    }
});

// POST /admin/tickets/:id/risposta → Rispondi al ticket
router.post('/tickets/:id/risposta', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;
    const { messaggio } = req.body;

    try {
        // Aggiungi risposta
        await db.promise().query(
            `INSERT INTO ticket_messaggi (ticket_id, mittente_tipo, messaggio) 
             VALUES (?, 'admin', ?)`,
            [ticketId, messaggio]
        );

        // Aggiorna data
        await db.promise().query(
            'UPDATE tickets SET data_aggiornamento = NOW() WHERE id = ?',
            [ticketId]
        );

        // Crea notifica per il cliente
        const [ticket] = await db.promise().query(
            'SELECT societa_id, oggetto FROM tickets WHERE id = ?',
            [ticketId]
        );

        await db.promise().query(
            `INSERT INTO notifiche (societa_id, ticket_id, tipo, messaggio) 
             VALUES (?, ?, 'nuova_risposta', ?)`,
            [ticket[0].societa_id, ticketId, `Nuova risposta al ticket: ${ticket[0].oggetto}`]
        );

        res.redirect(`/admin/tickets/${ticketId}`);
    } catch (err) {
        console.error('Errore invio risposta:', err);
        res.status(500).send('Errore durante l\'invio della risposta');
    }
});

// POST /admin/tickets/:id/stato → Cambia stato ticket
router.post('/tickets/:id/stato', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;
    const { stato } = req.body;

    try {
        await db.promise().query(
            'UPDATE tickets SET stato = ?, data_aggiornamento = NOW() WHERE id = ?',
            [stato, ticketId]
        );

        // Crea notifica
        const [ticket] = await db.promise().query(
            'SELECT societa_id, oggetto FROM tickets WHERE id = ?',
            [ticketId]
        );

        const messaggiStato = {
            'aperto': 'riaperto',
            'in_lavorazione': 'preso in carico',
            'risolto': 'risolto',
            'chiuso': 'chiuso'
        };

        await db.promise().query(
            `INSERT INTO notifiche (societa_id, ticket_id, tipo, messaggio) 
             VALUES (?, ?, 'cambio_stato', ?)`,
            [
                ticket[0].societa_id, 
                ticketId, 
                `Il ticket "${ticket[0].oggetto}" è stato ${messaggiStato[stato]}`
            ]
        );

        res.redirect(`/admin/tickets/${ticketId}`);
    } catch (err) {
        console.error('Errore cambio stato:', err);
        res.status(500).send('Errore durante il cambio stato');
    }
});

// POST /admin/tickets/:id/elimina → Elimina ticket
router.post('/tickets/:id/elimina', requireAdmin, async (req, res) => {
    const ticketId = req.params.id;

    try {
        // Le foreign key CASCADE elimineranno automaticamente messaggi e notifiche
        await db.promise().query('DELETE FROM tickets WHERE id = ?', [ticketId]);

        res.redirect('/admin/tickets');
    } catch (err) {
        console.error('Errore eliminazione ticket:', err);
        res.status(500).send('Errore durante l\'eliminazione');
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt'); // 🔐 Importa bcrypt

// GET /profile → Mostra pagina profilo
router.get('/', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [societa] = await db.promise().query(
            'SELECT * FROM societa WHERE id = ?',
            [societaId]
        );

        if (societa.length === 0) {
            return res.status(404).send('Società non trovata');
        }

        res.render('profile', { 
            societa: societa[0],
            success: null,
            error: null
        });
    } catch (err) {
        console.error('Errore caricamento profilo:', err);
        res.status(500).send('Errore del server');
    }
});

// POST /profile/update → Aggiorna dati profilo
router.post('/update', async (req, res) => {
    const societaId = req.session.societaId;
    const {
        ragione_sociale,
        indirizzo,
        comune,
        provincia,
        cap,
        partita_iva,
        email,
        telefono,
        username
    } = req.body;

    try {
        // ✅ Verifica se username è già usato da un'altra società
        const [esistente] = await db.promise().query(
            'SELECT id FROM societa WHERE username = ? AND id != ?',
            [username, societaId]
        );

        if (esistente.length > 0) {
            const [societa] = await db.promise().query(
                'SELECT * FROM societa WHERE id = ?',
                [societaId]
            );

            return res.render('profile', {
                societa: societa[0],
                success: null,
                error: 'Username già in uso da un\'altra società'
            });
        }

        // ✅ Aggiorna i dati
        await db.promise().query(
            `UPDATE societa SET 
             ragione_sociale = ?,
             indirizzo = ?,
             comune = ?,
             provincia = ?,
             cap = ?,
             partita_iva = ?,
             email = ?,
             telefono = ?,
             username = ?
             WHERE id = ?`,
            [ragione_sociale, indirizzo, comune, provincia, cap, partita_iva, email, telefono, username, societaId]
        );

        // ✅ Aggiorna sessione
        req.session.username = username;
        req.session.ragioneSociale = ragione_sociale;

        // ✅ Aggiorna cookie "ricordami" se esiste
        const rememberedUser = req.cookies.rememberedUser;
        if (rememberedUser) {
            const userData = {
                userId: societaId,
                societaId: societaId,
                username: username,
                ragioneSociale: ragione_sociale
            };

            const encodedData = Buffer.from(JSON.stringify(userData)).toString('base64');

            res.cookie('rememberedUser', encodedData, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                secure: false,
                sameSite: 'strict'
            });
        }

        const [societa] = await db.promise().query(
            'SELECT * FROM societa WHERE id = ?',
            [societaId]
        );

        res.render('profile', {
            societa: societa[0],
            success: 'Profilo aggiornato con successo!',
            error: null
        });

    } catch (err) {
        console.error('Errore aggiornamento profilo:', err);

        const [societa] = await db.promise().query(
            'SELECT * FROM societa WHERE id = ?',
            [societaId]
        );

        res.render('profile', {
            societa: societa[0],
            success: null,
            error: 'Errore durante l\'aggiornamento del profilo'
        });
    }
});

// POST /profile/change-password → Cambia password con bcrypt
router.post('/change-password', async (req, res) => {
    const societaId = req.session.societaId;
    const { old_password, new_password, confirm_password } = req.body;

    try {
        // ✅ Recupera la password hashata dal database
        const [societa] = await db.promise().query(
            'SELECT password FROM societa WHERE id = ?',
            [societaId]
        );

        // 🔒 Verifica password attuale con bcrypt
        const passwordMatch = await bcrypt.compare(old_password, societa[0].password);

        if (!passwordMatch) {
            const [societaData] = await db.promise().query(
                'SELECT * FROM societa WHERE id = ?',
                [societaId]
            );

            return res.render('profile', {
                societa: societaData[0],
                success: null,
                error: 'Password attuale errata'
            });
        }

        // ✅ Verifica che le nuove password coincidano
        if (new_password !== confirm_password) {
            const [societaData] = await db.promise().query(
                'SELECT * FROM societa WHERE id = ?',
                [societaId]
            );

            return res.render('profile', {
                societa: societaData[0],
                success: null,
                error: 'Le nuove password non coincidono'
            });
        }

        // ✅ Verifica lunghezza minima
        if (new_password.length < 6) {
            const [societaData] = await db.promise().query(
                'SELECT * FROM societa WHERE id = ?',
                [societaId]
            );

            return res.render('profile', {
                societa: societaData[0],
                success: null,
                error: 'La password deve essere di almeno 6 caratteri'
            });
        }

        // 🔒 Hash della nuova password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // ✅ Aggiorna password hashata nel database
        await db.promise().query(
            'UPDATE societa SET password = ? WHERE id = ?',
            [hashedPassword, societaId]
        );

        console.log('✅ Password cambiata per società ID:', societaId);

        const [societaData] = await db.promise().query(
            'SELECT * FROM societa WHERE id = ?',
            [societaId]
        );

        res.render('profile', {
            societa: societaData[0],
            success: 'Password cambiata con successo!',
            error: null
        });

    } catch (err) {
        console.error('Errore cambio password:', err);

        const [societa] = await db.promise().query(
            'SELECT * FROM societa WHERE id = ?',
            [societaId]
        );

        res.render('profile', {
            societa: societa[0],
            success: null,
            error: 'Errore durante il cambio password'
        });
    }
});

module.exports = router;
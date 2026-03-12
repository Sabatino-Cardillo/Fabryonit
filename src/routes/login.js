const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

// GET /login → Mostra la pagina di login
router.get('/login', (req, res) => {
    // ✅ Se c'è già una sessione attiva, redirect appropriato
    if (req.session.isAdmin) {
        return res.redirect('/admin/gestione'); // ⭐ MODIFICATO: ora va a gestione
    }
    if (req.session.societaId) {
        return res.redirect('/');
    }

    // ✅ Controlla se c'è un cookie "ricordami"
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
            return res.redirect('/');
        } catch (err) {
            console.error('Errore lettura cookie ricordami:', err);
            // Se il cookie è corrotto, eliminalo
            res.clearCookie('rememberedUser');
        }
    }

    res.render('login', { error: null });
});

// POST /login → Gestisce il login (Admin o Società)
router.post('/login', async (req, res) => {
    const { username, password, remember } = req.body;

    try {
        // ✅ PRIMA: Controlla se è un ADMIN
        const [admins] = await db.promise().query(
            'SELECT * FROM admin WHERE username = ?',
            [username]
        );

        if (admins.length > 0) {
            const admin = admins[0];
            
            // 🔒 Verifica password con bcrypt
            const passwordMatch = await bcrypt.compare(password, admin.password);
            
            if (passwordMatch) {
                // ✅ È un ADMIN - Login Admin
                req.session.isAdmin = true;
                req.session.adminId = admin.id;
                req.session.adminName = admin.nome;

                console.log('✅ Login ADMIN effettuato:', admin.username);
                return res.redirect('/admin/gestione'); // ⭐ MODIFICATO: va a gestione invece di tickets
            } else {
                // ❌ Password admin errata
                return res.render('login', { 
                    error: 'Username o password non corretti' 
                });
            }
        }

        // ✅ ALTRIMENTI: Controlla se è una SOCIETÀ
        const [societa] = await db.promise().query(
            'SELECT * FROM societa WHERE username = ?',
            [username]
        );

        if (societa.length === 0) {
            // ❌ Username non trovato
            return res.render('login', { 
                error: 'Username o password non corretti' 
            });
        }

        const societaData = societa[0];
        
        // 🔒 Verifica password con bcrypt
        const passwordMatch = await bcrypt.compare(password, societaData.password);
        
        if (!passwordMatch) {
            // ❌ Password società errata
            return res.render('login', { 
                error: 'Username o password non corretti' 
            });
        }

        // ✅ Salva i dati in sessione (SOCIETÀ)
        req.session.userId = societaData.id;
        req.session.societaId = societaData.id;
        req.session.username = societaData.username;
        req.session.ragioneSociale = societaData.ragione_sociale;

        // ✅ Se "Ricordami" è attivo, crea un cookie persistente (SOLO per società)
        if (remember === 'on') {
            const userData = {
                userId: societaData.id,
                societaId: societaData.id,
                username: societaData.username,
                ragioneSociale: societaData.ragione_sociale
            };

            const encodedData = Buffer.from(JSON.stringify(userData)).toString('base64');

            res.cookie('rememberedUser', encodedData, {
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 giorni
                httpOnly: true,
                secure: false,
                sameSite: 'strict'
            });

            console.log('✅ Cookie "ricordami" creato per:', societaData.username);
        } else {
            res.clearCookie('rememberedUser');
        }

        console.log('✅ Login SOCIETÀ effettuato:', societaData.username);
        res.redirect('/');

    } catch (err) {
        console.error('Errore durante il login:', err);
        res.render('login', { 
            error: 'Errore del server durante il login' 
        });
    }
});

// GET /logout → Logout manuale
router.get('/logout', (req, res) => {
    const wasAdmin = req.session.isAdmin;

    // ✅ Elimina il cookie "ricordami"
    res.clearCookie('rememberedUser');
    
    // ✅ Distruggi la sessione
    req.session.destroy((err) => {
        if (err) {
            console.error('Errore durante il logout:', err);
            return res.status(500).send('Errore durante il logout');
        }
        
        console.log('✅ Logout effettuato');
        
        // ✅ Se era admin, redirect al login admin
        if (wasAdmin) {
            return res.redirect('/admin/login');
        }
        
        res.redirect('/login');
    });
});

// POST /logout → Logout da AJAX (opzionale)
router.post('/logout', (req, res) => {
    res.clearCookie('rememberedUser');
    
    req.session.destroy((err) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true });
    });
});

module.exports = router;
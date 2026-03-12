const express = require('express');
const router = express.Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// GET /settings → mostra la pagina
router.get('/', (req, res) => {
    const lingua = req.session.lingua || 'it';
    res.render('settings', { lingua });
});

// POST /settings/lingua → cambia lingua
router.post('/lingua', (req, res) => {
    const { lingua } = req.body;
    req.session.lingua = lingua;
    res.json({ success: true, message: 'Lingua aggiornata' });
});

// ==========================================
// ESPORTAZIONE EXCEL
// ==========================================

// Esporta clienti in Excel
router.get('/export/clienti', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [clienti] = await db.promise().query(
            'SELECT * FROM clienti WHERE societa_id = ?',
            [societaId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Clienti');

        // Intestazioni colonne
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Nome', key: 'nome', width: 30 },
            { header: 'Cognome', key: 'cognome', width: 30 },
            { header: 'Indirizzo', key: 'indirizzo', width: 40 },
            { header: 'Città', key: 'citta', width: 20 },
            { header: 'Provincia', key: 'provincia', width: 10 },
            { header: 'CAP', key: 'cap', width: 10 },
            { header: 'Indirizzo Spedizione', key: 'indirizzo_spedizione', width: 40 },
            { header: 'Città Spedizione', key: 'citta_spedizione', width: 20 },
            { header: 'Provincia Spedizione', key: 'provincia_spedizione', width: 10 },
            { header: 'CAP Spedizione', key: 'cap_spedizione', width: 10 }
        ];

        // Stile intestazioni
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF3498DB' }
        };

        // Aggiungi dati
        clienti.forEach(cliente => {
            worksheet.addRow(cliente);
        });

        // Aggiungi bordi
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // Invia il file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=clienti.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Errore esportazione clienti:', err);
        res.status(500).send('Errore durante l\'esportazione');
    }
});

// Esporta prodotti in Excel
router.get('/export/prodotti', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [prodotti] = await db.promise().query(
            'SELECT * FROM prodotti WHERE societa_id = ?',
            [societaId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Prodotti');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Codice', key: 'codice', width: 20 }
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF27AE60' }
        };

        prodotti.forEach(prodotto => {
            worksheet.addRow(prodotto);
        });

        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=prodotti.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Errore esportazione prodotti:', err);
        res.status(500).send('Errore durante l\'esportazione');
    }
});

// Esporta dipendenti in Excel
router.get('/export/dipendenti', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [dipendenti] = await db.promise().query(
            'SELECT * FROM dipendenti WHERE societa_id = ?',
            [societaId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Dipendenti');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Nome', key: 'nome', width: 20 },
            { header: 'Cognome', key: 'cognome', width: 20 },
            { header: 'Codice Fiscale', key: 'cf', width: 20 },
            { header: 'Data Nascita', key: 'data', width: 15 },
            { header: 'Residenza', key: 'residenza', width: 40 },
            { header: 'Comune', key: 'comune', width: 20 },
            { header: 'CAP', key: 'cap', width: 10 },
            { header: 'Provincia', key: 'provincia', width: 10 },
            { header: 'Ruolo', key: 'ruolo', width: 20 },
            { header: 'IBAN', key: 'iban', width: 30 }
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE67E22' }
        };

        dipendenti.forEach(dip => {
            worksheet.addRow(dip);
        });

        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=dipendenti.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Errore esportazione dipendenti:', err);
        res.status(500).send('Errore durante l\'esportazione');
    }
});

// Esporta bolle in Excel
router.get('/export/bolle', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [bolle] = await db.promise().query(
            `SELECT b.*, c.nome as cliente_nome, c.cognome as cliente_cognome
             FROM bolle b
             LEFT JOIN clienti c ON b.cliente_id = c.id
             WHERE b.societa_id = ?
             ORDER BY b.data_creazione DESC`,
            [societaId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bolle');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Numero', key: 'numero', width: 15 },
            { header: 'Cliente', key: 'cliente', width: 30 },
            { header: 'Data Creazione', key: 'data_creazione', width: 20 },
            { header: 'Data Chiusura', key: 'data_chiusura', width: 20 },
            { header: 'Stato', key: 'stato', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF9B59B6' }
        };

        bolle.forEach(bolla => {
            worksheet.addRow({
                id: bolla.id,
                numero: bolla.numero,
                cliente: `${bolla.cliente_nome || ''} ${bolla.cliente_cognome || ''}`.trim(),
                data_creazione: bolla.data_creazione,
                data_chiusura: bolla.data_chiusura,
                stato: bolla.stato
            });
        });

        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=bolle.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Errore esportazione bolle:', err);
        res.status(500).send('Errore durante l\'esportazione');
    }
});

// Esporta merce in Excel
router.get('/export/merce', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [merce] = await db.promise().query(
            'SELECT * FROM merce WHERE societa_id = ?',
            [societaId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Merce');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Nome', key: 'nome', width: 40 },
            { header: 'Quantità', key: 'quantita', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1ABC9C' }
        };

        merce.forEach(item => {
            worksheet.addRow(item);
        });

        worksheet.eachRow(row => {
            row.eachCell(cell => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=merce.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Errore esportazione merce:', err);
        res.status(500).send('Errore durante l\'esportazione');
    }
});

// ==========================================
// BACKUP DATABASE
// ==========================================

// Backup completo database (solo dati della propria società)
router.get('/backup/database', async (req, res) => {
    const societaId = req.session.societaId;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `backup_societa_${societaId}_${timestamp}.sql`;
    const filepath = path.join(__dirname, 'backups', filename);

    try {
        // Crea cartella backups se non esiste
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // Ottieni credenziali database da variabili d'ambiente o config
        const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'mysql-jemaka.alwaysdata.net',
            password: process.env.DB_PASSWORD || 'Saba270704!',
            database: process.env.DB_NAME || 'jemaka_salmax'
        };

        // Comando mysqldump con filtro per societa_id
        const tables = ['clienti', 'dipendenti', 'prodotti', 'bolle', 'righe_bolla', 'merce', 'bolla_prodotti'];
        let sqlContent = `-- Backup Database Società ID: ${societaId}\n`;
        sqlContent += `-- Data: ${new Date().toLocaleString('it-IT')}\n\n`;

        // Esporta solo i dati della società corrente
        for (const table of tables) {
            const [rows] = await db.promise().query(
                `SELECT * FROM ${table} WHERE societa_id = ?`,
                [societaId]
            );

            if (rows.length > 0) {
                sqlContent += `-- Tabella: ${table}\n`;
                
                // Ottieni struttura tabella
                const [structure] = await db.promise().query(`SHOW CREATE TABLE ${table}`);
                sqlContent += `DROP TABLE IF EXISTS \`${table}\`;\n`;
                sqlContent += structure[0]['Create Table'] + ';\n\n';

                // Inserisci dati
                sqlContent += `INSERT INTO \`${table}\` VALUES\n`;
                
                rows.forEach((row, index) => {
                    const values = Object.values(row).map(val => {
                        if (val === null) return 'NULL';
                        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                        if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        return val;
                    });
                    
                    sqlContent += `(${values.join(', ')})`;
                    sqlContent += index < rows.length - 1 ? ',\n' : ';\n\n';
                });
            }
        }

        // Salva file
        fs.writeFileSync(filepath, sqlContent);

        // Invia il file
        res.download(filepath, filename, (err) => {
            // Elimina il file dopo il download
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
        });

    } catch (err) {
        console.error('Errore backup database:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ripristina backup
router.post('/backup/restore', async (req, res) => {
    // TODO: Implementare upload e ripristino backup SQL
    res.status(501).json({ 
        success: false, 
        message: 'Funzionalità in sviluppo' 
    });
});

// ==========================================
// SICUREZZA
// ==========================================

// Cambia password
router.post('/security/change-password', async (req, res) => {
    const { old_password, new_password } = req.body;
    const societaId = req.session.societaId;

    try {
        // Verifica password attuale
        const [societa] = await db.promise().query(
            'SELECT password FROM societa WHERE id = ?',
            [societaId]
        );

        if (societa[0].password !== old_password) {
            return res.json({ success: false, message: 'Password attuale errata' });
        }

        // Aggiorna password
        await db.promise().query(
            'UPDATE societa SET password = ? WHERE id = ?',
            [new_password, societaId]
        );

        res.json({ success: true, message: 'Password aggiornata con successo' });

    } catch (err) {
        console.error('Errore cambio password:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Disconnetti tutti i dispositivi
router.post('/security/logout-all', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        res.json({ success: true, message: 'Disconnesso da tutti i dispositivi' });
    });
});

// ==========================================
// IMPOSTAZIONI BOLLE
// ==========================================

// Ottieni impostazioni bolla
router.get('/impostazioni/bolle', async (req, res) => {
    const societaId = req.session.societaId;

    try {
        const [societa] = await db.promise().query(
            'SELECT numero_bolla_inizio FROM societa WHERE id = ?',
            [societaId]
        );

        if (societa.length === 0) {
            return res.status(404).json({ success: false, error: 'Società non trovata' });
        }

        res.json({
            success: true,
            numeroBollaInizio: societa[0].numero_bolla_inizio || 0
        });
    } catch (err) {
        console.error('Errore ottenimento impostazioni bolla:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Salva impostazioni bolla
router.post('/impostazioni/bolle', async (req, res) => {
    const societaId = req.session.societaId;
    const { numeroBollaInizio } = req.body;

    // Validazione
    if (numeroBollaInizio === undefined || numeroBollaInizio === null) {
        return res.status(400).json({ success: false, error: 'Numero di partenza mancante' });
    }

    const numero = parseInt(numeroBollaInizio);
    if (isNaN(numero) || numero < 0) {
        return res.status(400).json({ success: false, error: 'Numero di partenza non valido' });
    }

    try {
        // Controlla se ci sono bolle chiuse con numeri superiori al nuovo valore
        const [bolle] = await db.promise().query(
            'SELECT MIN(numero) as minNumero FROM bolle WHERE stato = "chiusa" AND societa_id = ?',
            [societaId]
        );

        const minNumeroEsistente = bolle[0].minNumero;
        
        if (minNumeroEsistente !== null && numero > minNumeroEsistente) {
            return res.status(400).json({
                success: false,
                error: `Impossibile impostare il numero a ${numero}. Esistono già bolle con numeri più bassi (a partire da ${minNumeroEsistente}).`
            });
        }

        // Aggiorna il numero di partenza
        await db.promise().query(
            'UPDATE societa SET numero_bolla_inizio = ? WHERE id = ?',
            [numero, societaId]
        );

        res.json({
            success: true,
            message: 'Numero di partenza bolle aggiornato con successo'
        });
    } catch (err) {
        console.error('Errore salvataggio impostazioni bolla:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
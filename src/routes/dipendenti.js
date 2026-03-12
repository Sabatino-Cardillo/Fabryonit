const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Funzione per generare calendario mensile con layout migliore
function generaCalendarioMese(mese, anno) {
    const data = new Date(anno, mese, 1);
    const giorniMese = new Date(anno, mese + 1, 0).getDate();
    const primoGiornoSettimana = data.getDay();
    
    const calendario = [];
    let settimana = [];
    
    // Aggiungi celle vuote per i giorni prima del primo del mese
    for (let i = 0; i < primoGiornoSettimana; i++) {
        settimana.push(null);
    }
    
    // Aggiungi i giorni del mese
    for (let giorno = 1; giorno <= giorniMese; giorno++) {
        settimana.push(giorno);
        
        if (settimana.length === 7 || giorno === giorniMese) {
            calendario.push(settimana);
            settimana = [];
        }
    }
    
    return calendario;
}

// Funzione per calcolare ore lavorate
function calcolaOreLavorate(entrate, uscite) {
    if (entrate.length === 0 || uscite.length === 0) return null;
    
    const entrata = new Date(`2000-01-01T${entrate[0]}`);
    const uscita = new Date(`2000-01-01T${uscite[0]}`);
    const diffOre = (uscita - entrata) / (1000 * 60 * 60);
    
    return diffOre;
}

// Funzione per controllare se ci sono uscite anticipate (prima delle 17:00)
function haUscitaAnticipata(uscite) {
    if (uscite.length === 0) return false;
    
    const oraUscita = uscite[0].split(':');
    const ore = parseInt(oraUscita[0]);
    const minuti = parseInt(oraUscita[1]);
    
    // Considera anticipata se prima delle 17:00
    return ore < 17;
}

router.get('/', (req, res) => {
    const societaId = req.session.societaId;

    // ✅ Filtra per societa_id e calcola le presenze del mese corrente
    const meseCorrente = new Date().toISOString().slice(0, 7); // YYYY-MM
    
    db.query(
        `SELECT d.*, 
                DATE_FORMAT(d.data, "%Y-%m-%d") as data_formattata,
                COUNT(DISTINCT DATE(p.data)) as presenze_mese_corrente
         FROM dipendenti d 
         LEFT JOIN presenze p ON d.id = p.dipendente_id 
            AND p.societa_id = ? 
            AND DATE_FORMAT(p.data, "%Y-%m") = ?
            AND p.tipo = 'entrata'
         WHERE d.societa_id = ?
         GROUP BY d.id
         ORDER BY d.cognome, d.nome`,
        [societaId, meseCorrente, societaId],
        (err, results) => {
            if (err) {
                console.error('Errore caricamento dipendenti:', err);
                return res.status(500).send('Errore del server');
            }
            res.render('dipendenti', { 
                dipendenti: results, 
                dipendenteInModifica: null, 
                errore: null,
                meseCorrente: meseCorrente
            });
        }
    );
});

router.post('/add', (req, res) => {
    const { nome, cognome, cf, data, residenza, comune, cap, provincia, ruolo, iban } = req.body;
    const societaId = req.session.societaId;
    
    // ✅ Controlla se esiste già un dipendente con lo stesso CF NELLA STESSA SOCIETÀ
    db.query(
        'SELECT * FROM dipendenti WHERE cf = ? AND societa_id = ?', 
        [cf, societaId], 
        (err, results) => {
            if (err) {
                console.error('Errore verifica CF:', err);
                return res.status(500).send('Errore del server');
            }
            
            if (results.length > 0) {
                // Dipendente già esistente nella società
                const meseCorrente = new Date().toISOString().slice(0, 7);
                
                db.query(
                    `SELECT d.*, 
                            DATE_FORMAT(d.data, "%Y-%m-%d") as data_formattata,
                            COUNT(DISTINCT DATE(p.data)) as presenze_mese_corrente
                     FROM dipendenti d 
                     LEFT JOIN presenze p ON d.id = p.dipendente_id 
                        AND p.societa_id = ? 
                        AND DATE_FORMAT(p.data, "%Y-%m") = ?
                        AND p.tipo = 'entrata'
                     WHERE d.societa_id = ?
                     GROUP BY d.id
                     ORDER BY d.cognome, d.nome`,
                    [societaId, meseCorrente, societaId],
                    (err, allResults) => {
                        if (err) {
                            console.error('Errore caricamento dipendenti:', err);
                            return res.status(500).send('Errore del server');
                        }
                        res.render('dipendenti', { 
                            dipendenti: allResults, 
                            dipendenteInModifica: null, 
                            errore: 'Attenzione: Un dipendente con questo codice fiscale è già presente!',
                            meseCorrente: meseCorrente
                        });
                    }
                );
            } else {
                // ✅ Inserisci il nuovo dipendente CON societa_id
                db.query(
                    `INSERT INTO dipendenti 
                     (nome, cognome, cf, data, residenza, comune, cap, provincia, ruolo, iban, societa_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                    [nome, cognome, cf, data, residenza, comune, cap, provincia, ruolo, iban, societaId], 
                    (err) => {
                        if (err) {
                            console.error('Errore inserimento dipendente:', err);
                            return res.status(500).send('Errore durante l\'inserimento');
                        }
                        res.redirect('/dipendenti');
                    }
                );
            }
        }
    );
});

router.post('/modifica', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;

    // ✅ Verifica che il dipendente appartenga alla società
    db.query(
        'SELECT *, DATE_FORMAT(data, "%Y-%m-%d") as data_formattata FROM dipendenti WHERE id = ? AND societa_id = ?', 
        [id, societaId], 
        (err, result) => {
            if (err) {
                console.error("Errore recupero dipendente:", err);
                return res.status(500).send("Errore durante il recupero del dipendente.");
            }

            if (result.length === 0) {
                return res.status(403).send("Non autorizzato");
            }
            
            // ✅ Carica tutti i dipendenti della società
            const meseCorrente = new Date().toISOString().slice(0, 7);
            db.query(
                `SELECT d.*, 
                        DATE_FORMAT(d.data, "%Y-%m-%d") as data_formattata,
                        COUNT(DISTINCT DATE(p.data)) as presenze_mese_corrente
                 FROM dipendenti d 
                 LEFT JOIN presenze p ON d.id = p.dipendente_id 
                    AND p.societa_id = ? 
                    AND DATE_FORMAT(p.data, "%Y-%m") = ?
                    AND p.tipo = 'entrata'
                 WHERE d.societa_id = ?
                 GROUP BY d.id
                 ORDER BY d.cognome, d.nome`,
                [societaId, meseCorrente, societaId],
                (err, results) => {
                    if (err) {
                        console.error('Errore caricamento dipendenti:', err);
                        return res.status(500).send('Errore del server');
                    }
                    res.render('dipendenti', { 
                        dipendenti: results, 
                        dipendenteInModifica: result[0], 
                        errore: null,
                        meseCorrente: meseCorrente
                    });
                }
            );
        }
    );
});

router.post('/update', (req, res) => {
    const { id, nome, cognome, cf, data, residenza, comune, cap, provincia, ruolo, iban } = req.body;
    const societaId = req.session.societaId;
    
    // ✅ Verifica che il dipendente appartenga alla società
    db.query(
        'SELECT id FROM dipendenti WHERE id = ? AND societa_id = ?',
        [id, societaId],
        (err, dipCheck) => {
            if (err) {
                console.error('Errore verifica dipendente:', err);
                return res.status(500).send('Errore del server');
            }

            if (dipCheck.length === 0) {
                return res.status(403).send('Non autorizzato');
            }

            // ✅ Controlla se esiste un altro dipendente con lo stesso CF NELLA STESSA SOCIETÀ
            db.query(
                'SELECT * FROM dipendenti WHERE cf = ? AND id != ? AND societa_id = ?', 
                [cf, id, societaId], 
                (err, results) => {
                    if (err) {
                        console.error('Errore verifica CF:', err);
                        return res.status(500).send('Errore del server');
                    }
                    
                    if (results.length > 0) {
                        // Esiste un altro dipendente con lo stesso CF
                        const meseCorrente = new Date().toISOString().slice(0, 7);
                        db.query(
                            'SELECT *, DATE_FORMAT(data, "%Y-%m-%d") as data_formattata FROM dipendenti WHERE id = ? AND societa_id = ?', 
                            [id, societaId], 
                            (err, dipendenteResult) => {
                                if (err) {
                                    console.error('Errore caricamento dipendente:', err);
                                    return res.status(500).send('Errore del server');
                                }
                                
                                db.query(
                                    `SELECT d.*, 
                                            DATE_FORMAT(d.data, "%Y-%m-%d") as data_formattata,
                                            COUNT(DISTINCT DATE(p.data)) as presenze_mese_corrente
                                     FROM dipendenti d 
                                     LEFT JOIN presenze p ON d.id = p.dipendente_id 
                                        AND p.societa_id = ? 
                                        AND DATE_FORMAT(p.data, "%Y-%m") = ?
                                        AND p.tipo = 'entrata'
                                     WHERE d.societa_id = ?
                                     GROUP BY d.id
                                     ORDER BY d.cognome, d.nome`,
                                    [societaId, meseCorrente, societaId],
                                    (err, allResults) => {
                                        if (err) {
                                            console.error('Errore caricamento dipendenti:', err);
                                            return res.status(500).send('Errore del server');
                                        }
                                        res.render('dipendenti', { 
                                            dipendenti: allResults, 
                                            dipendenteInModifica: dipendenteResult[0], 
                                            errore: 'Attenzione: Un altro dipendente con questo codice fiscale è già presente!',
                                            meseCorrente: meseCorrente
                                        });
                                    }
                                );
                            }
                        );
                    } else {
                        // ✅ Aggiorna il dipendente CON filtro societa_id
                        db.query(
                            `UPDATE dipendenti 
                             SET nome = ?, cognome = ?, cf = ?, data = ?, residenza = ?, 
                            comune = ?, cap = ?, provincia = ?, ruolo = ?, iban = ? 
                             WHERE id = ? AND societa_id = ?`, 
                            [nome, cognome, cf, data, residenza, comune, cap, provincia, ruolo, iban, id, societaId], 
                            (err, result) => {
                                if (err) {
                                    console.error("Errore aggiornamento dipendente:", err);
                                    return res.status(500).send("Errore durante l'aggiornamento del dipendente.");
                                }

                                if (result.affectedRows === 0) {
                                    return res.status(403).send('Non autorizzato');
                                }

                                res.redirect('/dipendenti');
                            }
                        );
                    }
                }
            );
        }
    );
});

router.post('/remove', (req, res) => {
    const id = req.body.id;
    const societaId = req.session.societaId;

    // ✅ Elimina SOLO se appartiene alla società
    db.query(
        'DELETE FROM dipendenti WHERE id = ? AND societa_id = ?', 
        [id, societaId], 
        (err, result) => {
            if (err) {
                console.error("Errore eliminazione dipendente:", err);
                return res.status(500).send("Errore durante l'eliminazione del dipendente.");
            }

            if (result.affectedRows === 0) {
                return res.status(403).send('Non autorizzato');
            }

            res.redirect('/dipendenti');
        }
    );
});

// ✅ Rotte per la gestione presenze

// Registra entrata/uscita
router.post('/presenza', (req, res) => {
    const { dipendente_id, data, tipo, ora } = req.body;
    const societaId = req.session.societaId;
    
    // Validazione dati
    if (!dipendente_id || !data || !tipo || !ora) {
        return res.status(400).send('Dati mancanti');
    }
    
    // Verifica che il dipendente appartenga alla società
    db.query(
        'SELECT id FROM dipendenti WHERE id = ? AND societa_id = ?',
        [dipendente_id, societaId],
        (err, result) => {
            if (err) {
                console.error('Errore verifica dipendente:', err);
                return res.status(500).send('Errore del server');
            }
            
            if (result.length === 0) {
                return res.status(403).send('Non autorizzato');
            }
            
            // Inserisci la presenza
            db.query(
                `INSERT INTO presenze (dipendente_id, societa_id, data, tipo, ora) 
                 VALUES (?, ?, ?, ?, ?)`,
                [dipendente_id, societaId, data, tipo, ora],
                (err) => {
                    if (err) {
                        console.error('Errore registrazione presenza:', err);
                        return res.status(500).send('Errore del server');
                    }
                    res.redirect('/dipendenti/presenze?data=' + data);
                }
            );
        }
    );
});

// Elimina una presenza specifica
router.post('/presenze/elimina', (req, res) => {
    const { presenza_id, data_presenza } = req.body;
    const societaId = req.session.societaId;
    
    if (!presenza_id) {
        return res.status(400).send('ID presenza mancante');
    }
    
    // Verifica che la presenza appartenga alla società
    db.query(
        'SELECT data FROM presenze WHERE id = ? AND societa_id = ?',
        [presenza_id, societaId],
        (err, result) => {
            if (err) {
                console.error('Errore verifica presenza:', err);
                return res.status(500).send('Errore del server');
            }
            
            if (result.length === 0) {
                return res.status(403).send('Non autorizzato');
            }
            
            const dataPresenza = result[0].data;
            
            // Elimina la presenza
            db.query(
                'DELETE FROM presenze WHERE id = ? AND societa_id = ?',
                [presenza_id, societaId],
                (err) => {
                    if (err) {
                        console.error('Errore eliminazione presenza:', err);
                        return res.status(500).send('Errore del server');
                    }
                    
                    // Usa la data passata dal form, altrimenti quella dal database
                    const dataPerRedirect = data_presenza || dataPresenza;
                    res.redirect('/dipendenti/presenze?data=' + dataPerRedirect);
                }
            );
        }
    );
});

// Pagina per gestione presenze
router.get('/presenze', (req, res) => {
    const societaId = req.session.societaId;
    const dataParam = req.query.data || new Date().toISOString().slice(0, 10);
    const meseCorrente = new Date().toISOString().slice(0, 7);
    
    // Ottieni tutti i dipendenti della società
    db.query(
        'SELECT id, nome, cognome FROM dipendenti WHERE societa_id = ? ORDER BY cognome, nome',
        [societaId],
        (err, dipendenti) => {
            if (err) {
                console.error('Errore caricamento dipendenti:', err);
                return res.status(500).send('Errore del server');
            }
            
            // Ottieni le presenze per la data specificata
            db.query(
                `SELECT p.*, d.nome, d.cognome 
                 FROM presenze p 
                 JOIN dipendenti d ON p.dipendente_id = d.id 
                 WHERE p.societa_id = ? AND p.data = ? 
                 ORDER BY p.ora`,
                [societaId, dataParam],
                (err, presenze) => {
                    if (err) {
                        console.error('Errore caricamento presenze:', err);
                        return res.status(500).send('Errore del server');
                    }
                    
                    res.render('presenze', {
                        dipendenti,
                        presenze,
                        dataSelezionata: dataParam,
                        meseCorrente: meseCorrente,
                        oggi: new Date().toISOString().slice(0, 10),
                        req: req
                    });
                }
            );
        }
    );
});

// Report presenze mensili
router.get('/presenze/report', (req, res) => {
    const societaId = req.session.societaId;
    const mese = req.query.mese || new Date().toISOString().slice(0, 7);
    
    db.query(
        `SELECT d.id, d.nome, d.cognome, 
                COUNT(DISTINCT DATE(p.data)) as giorni_presenza,
                GROUP_CONCAT(DISTINCT DATE_FORMAT(p.data, '%d/%m/%Y') ORDER BY p.data) as date_presenze
         FROM dipendenti d 
         LEFT JOIN presenze p ON d.id = p.dipendente_id 
            AND p.societa_id = ? 
            AND DATE_FORMAT(p.data, "%Y-%m") = ?
            AND p.tipo = 'entrata'
         WHERE d.societa_id = ?
         GROUP BY d.id
         ORDER BY d.cognome, d.nome`,
        [societaId, mese, societaId],
        (err, results) => {
            if (err) {
                console.error('Errore generazione report:', err);
                return res.status(500).send('Errore del server');
            }
            
            res.render('report_presenze', {
                report: results,
                meseSelezionato: mese,
                oggi: new Date().toISOString().slice(0, 7)
            });
        }
    );
});

// Genera PDF delle presenze di TUTTI i dipendenti per il mese corrente
// Genera PDF delle presenze di TUTTI i dipendenti per il mese corrente
router.get('/presenze/pdf', (req, res) => {
    const societaId = req.session.societaId;
    const mese = req.query.mese || new Date().toISOString().slice(0, 7);
    const [anno, meseNum] = mese.split('-').map(Number);
    
    // Ottieni i dati della società
    db.query(
        'SELECT ragione_sociale, indirizzo FROM societa WHERE id = ?',
        [societaId],
        (err, societaResult) => {
            if (err || societaResult.length === 0) {
                return res.status(500).send('Errore caricamento dati società');
            }
            
            // Ottieni tutti i dipendenti con le loro presenze
            db.query(
                `SELECT d.id, d.nome, d.cognome, 
                        DATE_FORMAT(p.data, '%Y-%m-%d') as data_presenza,
                        p.tipo,
                        TIME(p.ora) as ora_presenza
                 FROM dipendenti d 
                 LEFT JOIN presenze p ON d.id = p.dipendente_id 
                    AND p.societa_id = ? 
                    AND DATE_FORMAT(p.data, "%Y-%m") = ?
                 WHERE d.societa_id = ?
                 ORDER BY d.cognome, d.nome, p.data, p.ora`,
                [societaId, mese, societaId],
                (err, presenzeResult) => {
                    if (err) {
                        console.error('Errore recupero presenze:', err);
                        return res.status(500).send('Errore generazione report');
                    }
                    
                    // Organizza i dati per dipendente
                    const dipendentiMap = {};
                    presenzeResult.forEach(row => {
                        if (!dipendentiMap[row.id]) {
                            dipendentiMap[row.id] = {
                                nome: row.nome,
                                cognome: row.cognome,
                                presenze: {}
                            };
                        }
                        
                        if (row.data_presenza) {
                            const data = row.data_presenza;
                            if (!dipendentiMap[row.id].presenze[data]) {
                                dipendentiMap[row.id].presenze[data] = { entrate: [], uscite: [] };
                            }
                            
                            if (row.tipo === 'entrata') {
                                dipendentiMap[row.id].presenze[data].entrate.push(row.ora_presenza);
                            } else {
                                dipendentiMap[row.id].presenze[data].uscite.push(row.ora_presenza);
                            }
                        }
                    });
                    
                    // Converti mappa in array
                    const dipendentiArray = Object.keys(dipendentiMap).map(id => ({
                        id: id,
                        nome: dipendentiMap[id].nome,
                        cognome: dipendentiMap[id].cognome,
                        presenze: dipendentiMap[id].presenze
                    }));
                    
                    // Crea il PDF
                    const doc = new PDFDocument({ 
                        margin: 40, 
                        size: 'A4'
                    });
                    
                    const fileName = `presenze_complete_${mese}_${Date.now()}.pdf`;
                    const filePath = path.join(__dirname, '../temp', fileName);
                    
                    // Assicurati che la cartella temp esista
                    if (!fs.existsSync(path.join(__dirname, '../temp'))) {
                        fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
                    }
                    
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                    
                    const stream = fs.createWriteStream(filePath);
                    doc.pipe(stream);
                    doc.pipe(res);
                    
                    // Variabile per tenere traccia del numero di pagine
                    let pageCount = 0;
                    
                    // Funzione per aggiungere intestazione
                    const addHeader = () => {
                        doc.fontSize(20).font('Helvetica-Bold').text('REPORT PRESENZE COMPLETO', { align: 'center' });
                        doc.moveDown(0.5);
                        
                        doc.fontSize(12).font('Helvetica');
                        doc.text(`Società: ${societaResult[0].ragione_sociale}`);
                        doc.text(`Indirizzo: ${societaResult[0].indirizzo}`);
                        doc.text(`Mese: ${mese}`);
                        doc.moveDown(0.5);
                        
                        doc.fontSize(10).text(`Generato il: ${new Date().toLocaleDateString('it-IT')}`, { align: 'right' });
                        doc.moveDown(1);
                        
                        // Linea separatrice
                        doc.moveTo(40, doc.y)
                           .lineTo(550, doc.y)
                           .lineWidth(1)
                           .strokeColor('#3498db')
                           .stroke();
                        doc.moveDown(1);
                    };
                    
                    // Funzione per aggiungere numero pagina
                    const addPageNumber = () => {
                        doc.fontSize(8).fillColor('#666');
                        doc.text(
                            `Pagina ${pageCount}`,
                            40,
                            800,
                            { align: 'center', width: 520 }
                        );
                    };
                    
                    // PER OGNI DIPENDENTE
                    dipendentiArray.forEach((dipendente, index) => {
                        // Se non c'è spazio per un nuovo dipendente (circa 500px di contenuto stimato)
                        if (index > 0 && doc.y > 300) {
                            // Aggiungi numero pagina e inizia nuova pagina
                            doc.addPage();
                            pageCount++;
                            
                            // Aggiungi intestazione alla nuova pagina
                            addHeader();
                        } else if (index === 0) {
                            // Prima pagina, aggiungi intestazione
                            pageCount = 1;
                            addHeader();
                        }
                        
                        // Informazioni dipendente
                        doc.fontSize(16).font('Helvetica-Bold')
                           .text(`Dipendente: ${dipendente.cognome} ${dipendente.nome}`, { underline: true });
                        doc.moveDown(1);
                        
                        // CALENDARIO
                        const calendario = generaCalendarioMese(meseNum - 1, anno);
                        const nomiGiorni = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
                        const nomeMese = new Date(anno, meseNum - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
                        
                        // Titolo calendario
                        doc.fontSize(14).font('Helvetica-Bold')
                           .text(`CALENDARIO ${nomeMese.toUpperCase()}`, { align: 'center' });
                        doc.moveDown(0.5);
                        
                        const cellSize = 25;
                        const tableTop = doc.y;
                        const tableLeft = 50;
                        
                        // Intestazioni giorni
                        doc.font('Helvetica-Bold').fontSize(10);
                        for (let i = 0; i < 7; i++) {
                            const x = tableLeft + (cellSize * i);
                            doc.text(nomiGiorni[i], x, tableTop, { width: cellSize, align: 'center' });
                        }
                        
                        doc.moveDown(1);
                        
                        // Celle del calendario
                        calendario.forEach((settimana, settimanaIndex) => {
                            const y = doc.y;
                            
                            settimana.forEach((giorno, giornoIndex) => {
                                const x = tableLeft + (cellSize * giornoIndex);
                                
                                if (giorno !== null) {
                                    const dataStr = `${anno}-${String(meseNum).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
                                    const giornoPresenze = dipendente.presenze[dataStr];
                                    
                                    // Determina il colore della cella
                                    let cellColor = '#e74c3c'; // Rosso per assenza
                                    let textColor = 'white';
                                    let simbolo = 'A';
                                    
                                    if (giornoPresenze && giornoPresenze.entrate && giornoPresenze.entrate.length > 0) {
                                        if (giornoPresenze.uscite && giornoPresenze.uscite.length > 0) {
                                            if (haUscitaAnticipata(giornoPresenze.uscite)) {
                                                cellColor = '#f39c12'; // Giallo per uscita anticipata
                                                textColor = 'black';
                                                simbolo = 'U';
                                            } else {
                                                cellColor = '#27ae60'; // Verde per presenza normale
                                                textColor = 'white';
                                                simbolo = 'P';
                                            }
                                        } else {
                                            cellColor = '#27ae60'; // Verde per presenza normale
                                            textColor = 'white';
                                            simbolo = 'P';
                                        }
                                    }
                                    
                                    // Disegna cella con colore
                                    doc.rect(x, y, cellSize, cellSize)
                                       .fill(cellColor)
                                       .stroke();
                                    
                                    // Numero giorno
                                    doc.font('Helvetica').fontSize(8).fillColor(textColor);
                                    doc.text(giorno.toString(), x + 2, y + 2);
                                    
                                    // Simbolo al centro
                                    doc.font('Helvetica-Bold').fontSize(10);
                                    doc.text(simbolo, x + cellSize/2 - 5, y + cellSize/2 - 5, { width: 10, align: 'center' });
                                    doc.fillColor('black');
                                } else {
                                    // Cella vuota per giorni fuori mese
                                    doc.rect(x, y, cellSize, cellSize)
                                       .fill('#ecf0f1')
                                       .stroke();
                                }
                            });
                            
                            doc.moveDown(cellSize / 18);
                        });
                        
                        doc.moveDown(1);
                        
                        // LEGENDA
                        const legendaY = doc.y;
                        
                        doc.font('Helvetica-Bold').fontSize(12)
                           .text('LEGENDA:', 50, legendaY, { underline: true });
                        
                        doc.font('Helvetica').fontSize(10);
                        
                        doc.fillColor('#27ae60').text('Verde ', 50, legendaY + 20, { continued: true });
                        doc.fillColor('black').text(' = Presenza regolare');
                        
                        doc.fillColor('#f39c12').text('Arancione ', 50, legendaY + 35, { continued: true });
                        doc.fillColor('black').text(' = Uscita anticipata (< 17:00)');
                        
                        doc.fillColor('#e74c3c').text('Rosso ', 50, legendaY + 50, { continued: true });
                        doc.fillColor('black').text(' = Assenza');
                        
                        doc.fillColor('#ecf0f1').text('Grigio ', 50, legendaY + 65, { continued: true });
                        doc.fillColor('black').text(' = Giorno fuori mese');
                        
                        doc.fillColor('black');
                        doc.text('P = Presenza registrata', 250, legendaY + 20);
                        doc.text('U = Uscita anticipata', 250, legendaY + 35);
                        doc.text('A = Assenza', 250, legendaY + 50);
                        
                        // Posiziona il cursore dopo la legenda
                        doc.y = legendaY + 85;
                        
                        // Statistiche per questo dipendente
                        const giorniPresenze = Object.keys(dipendente.presenze).length;
                        const giorniMese = new Date(anno, meseNum, 0).getDate();
                        const percentuale = ((giorniPresenze / giorniMese) * 100).toFixed(1);
                        
                        // Conta giorni con uscita anticipata
                        let giorniUscitaAnticipata = 0;
                        Object.keys(dipendente.presenze).forEach(data => {
                            const giorno = dipendente.presenze[data];
                            if (giorno.entrate && giorno.entrate.length > 0 && 
                                giorno.uscite && giorno.uscite.length > 0 && 
                                haUscitaAnticipata(giorno.uscite)) {
                                giorniUscitaAnticipata++;
                            }
                        });
                        
                        doc.font('Helvetica-Bold').fontSize(12)
                           .text('STATISTICHE:', { underline: true });
                        doc.moveDown(0.3);
                        
                        doc.font('Helvetica').fontSize(10);
                        doc.text(`Giorni con presenza: ${giorniPresenze}`, 50);
                        doc.text(`Giorni del mese: ${giorniMese}`, 50);
                        doc.text(`Percentuale presenza: ${percentuale}%`, 50);
                        doc.text(`Giorni con uscita anticipata: ${giorniUscitaAnticipata}`, 50);
                        
                        // Se ci sono dati dettagliati, mostrali
                        if (Object.keys(dipendente.presenze).length > 0 && doc.y < 700) {
                            doc.moveDown(1);
                            doc.font('Helvetica-Bold').fontSize(12)
                               .text('DETTAGLIO PRESENZE:', { underline: true });
                            doc.moveDown(0.3);
                            
                            const detailTop = doc.y;
                            let currentY = detailTop;
                            
                            // Controlla se abbiamo spazio per l'intestazione della tabella
                            if (currentY > 700) {
                                addPageNumber();
                                doc.addPage();
                                pageCount++;
                                addHeader();
                                doc.fontSize(16).font('Helvetica-Bold')
                                   .text(`Dipendente: ${dipendente.cognome} ${dipendente.nome} (continua)`, { underline: true });
                                doc.moveDown(1);
                                currentY = doc.y;
                            }
                            
                            // Intestazione tabella dettagli
                            doc.font('Helvetica-Bold').fontSize(9);
                            doc.text('Data', 50, currentY);
                            doc.text('Entrata', 120, currentY);
                            doc.text('Uscita', 190, currentY);
                            doc.text('Ore', 260, currentY);
                            doc.text('Note', 330, currentY);
                            
                            currentY += 15;
                            
                            // Riga dei dati
                            doc.font('Helvetica').fontSize(8);
                            Object.keys(dipendente.presenze).sort().forEach(data => {
                                const giorno = dipendente.presenze[data];
                                const dataFormattata = new Date(data).toLocaleDateString('it-IT');
                                
                                // Controlla se abbiamo spazio per questa riga
                                if (currentY > 750) {
                                    
                                    // Intestazione nuova pagina
                                    addHeader();
                                    doc.fontSize(16).font('Helvetica-Bold')
                                       .text(`Dipendente: ${dipendente.cognome} ${dipendente.nome} (continua)`, { underline: true });
                                    doc.moveDown(1);
                                    
                                    currentY = 120;
                                    
                                    // Ripeti intestazione tabella
                                    doc.font('Helvetica-Bold').fontSize(9);
                                    doc.text('Data', 50, currentY);
                                    doc.text('Entrata', 120, currentY);
                                    doc.text('Uscita', 190, currentY);
                                    doc.text('Ore', 260, currentY);
                                    doc.text('Note', 330, currentY);
                                    currentY += 15;
                                }
                                
                                doc.font('Helvetica').fontSize(8);
                                
                                // Entrate
                                const entrateStr = giorno.entrate && giorno.entrate.length > 0 
                                    ? giorno.entrate.map(e => e.slice(0,5)).join(', ')
                                    : '--';
                                
                                // Uscite
                                const usciteStr = giorno.uscite && giorno.uscite.length > 0 
                                    ? giorno.uscite.map(u => u.slice(0,5)).join(', ')
                                    : '--';
                                
                                // Calcola ore lavorate
                                let oreLavorate = '--';
                                if (giorno.entrate && giorno.entrate.length > 0 && giorno.uscite && giorno.uscite.length > 0) {
                                    const ore = calcolaOreLavorate(giorno.entrate, giorno.uscite);
                                    if (ore !== null) {
                                        oreLavorate = ore.toFixed(1) + 'h';
                                    }
                                }
                                
                                // Note
                                let note = '';
                                if (giorno.uscite && giorno.uscite.length > 0 && haUscitaAnticipata(giorno.uscite)) {
                                    note = 'Uscita anticipata';
                                }
                                
                                doc.text(dataFormattata, 50, currentY);
                                doc.text(entrateStr, 120, currentY);
                                doc.text(usciteStr, 190, currentY);
                                doc.text(oreLavorate, 260, currentY);
                                doc.text(note, 330, currentY);
                                
                                currentY += 12;
                            });
                            
                            // Aggiorna la posizione Y corrente
                            doc.y = currentY;
                        }
                        
                        // Linea separatrice tra dipendenti (solo se non è l'ultimo dipendente e c'è spazio)
                        if (index < dipendentiArray.length - 1 && doc.y < 750) {
                            doc.moveDown(1);
                            doc.moveTo(40, doc.y)
                               .lineTo(550, doc.y)
                               .lineWidth(0.5)
                               .strokeColor('#95a5a6')
                               .stroke();
                            doc.moveDown(1);
                        }
                    });
                    
                    
                    doc.end();
                    
                    // Cancella il file temporaneo dopo 5 minuti
                    setTimeout(() => {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    }, 300000);
                }
            );
        }
    );
});

// Genera PDF delle presenze individuali per un dipendente
// Genera PDF delle presenze individuali per un dipendente
router.get('/presenze/pdf/:dipendenteId', (req, res) => {
    const societaId = req.session.societaId;
    const dipendenteId = req.params.dipendenteId;
    const mese = req.query.mese || new Date().toISOString().slice(0, 7);
    const [anno, meseNum] = mese.split('-').map(Number);
    
    // Ottieni i dati della società
    db.query(
        'SELECT ragione_sociale, indirizzo FROM societa WHERE id = ?',
        [societaId],
        (err, societaResult) => {
            if (err || societaResult.length === 0) {
                return res.status(500).send('Errore caricamento dati società');
            }
            
            // Ottieni i dati del dipendente
            db.query(
                'SELECT nome, cognome FROM dipendenti WHERE id = ? AND societa_id = ?',
                [dipendenteId, societaId],
                (err, dipendenteResult) => {
                    if (err || dipendenteResult.length === 0) {
                        return res.status(404).send('Dipendente non trovato');
                    }
                    
                    const dipendente = dipendenteResult[0];
                    
                    // Ottieni le presenze del dipendente per il mese specificato
                    db.query(
                        `SELECT DATE_FORMAT(p.data, '%Y-%m-%d') as data_presenza, 
                                p.tipo, 
                                TIME(p.ora) as ora_presenza
                         FROM presenze p
                         WHERE p.dipendente_id = ? 
                         AND p.societa_id = ?
                         AND DATE_FORMAT(p.data, "%Y-%m") = ?
                         ORDER BY p.data, p.ora`,
                        [dipendenteId, societaId, mese],
                        (err, presenzeResult) => {
                            if (err) {
                                console.error('Errore recupero presenze:', err);
                                return res.status(500).send('Errore generazione report');
                            }
                            
                            // Organizza le presenze per data
                            const presenzePerData = {};
                            const presenzeEntrate = new Set();
                            
                            presenzeResult.forEach(presenza => {
                                const data = presenza.data_presenza;
                                
                                if (presenza.tipo === 'entrata') {
                                    presenzeEntrate.add(data);
                                }
                                if (!presenzePerData[data]) {
                                    presenzePerData[data] = { entrate: [], uscite: [] };
                                }
                                if (presenza.tipo === 'entrata') {
                                    presenzePerData[data].entrate.push(presenza.ora_presenza);
                                } else {
                                    presenzePerData[data].uscite.push(presenza.ora_presenza);
                                }
                            });
                            
                            // Calcola statistiche
                            const giorniConPresenza = presenzeEntrate.size;
                            const giorniMese = new Date(anno, meseNum, 0).getDate();
                            let oreTotali = 0;
                            let giorniUscitaAnticipata = 0;
                            let giorniRegolari = 0;
                            
                            // Calcola ore totali e statistiche
                            Object.keys(presenzePerData).forEach(data => {
                                const giorno = presenzePerData[data];
                                if (giorno.entrate && giorno.entrate.length > 0) {
                                    if (giorno.uscite && giorno.uscite.length > 0) {
                                        const ore = calcolaOreLavorate(giorno.entrate, giorno.uscite);
                                        if (ore !== null) {
                                            oreTotali += ore;
                                        }
                                        
                                        if (haUscitaAnticipata(giorno.uscite)) {
                                            giorniUscitaAnticipata++;
                                        } else {
                                            giorniRegolari++;
                                        }
                                    } else {
                                        const entrata = giorno.entrate[0];
                                        const oreUscitaDefault = calcolaOreLavorate([entrata], ['17:00']);
                                        if (oreUscitaDefault !== null) {
                                            oreTotali += oreUscitaDefault;
                                        }
                                        giorniRegolari++;
                                    }
                                }
                            });
                            
                            // Crea il PDF
                            const doc = new PDFDocument({ 
                                margin: 40, 
                                size: 'A4'
                            });
                            
                            const timestamp = new Date();
                            const dateStr = timestamp.toISOString().slice(0,10).replace(/-/g, '');
                            const timeStr = timestamp.toTimeString().slice(0,8).replace(/:/g, '');
                            const fileName = `presenze_${dipendente.cognome}_${dipendente.nome}_${mese}_${dateStr}_${timeStr}.pdf`;
                            const filePath = path.join(__dirname, '../temp', fileName);
                            
                            if (!fs.existsSync(path.join(__dirname, '../temp'))) {
                                fs.mkdirSync(path.join(__dirname, '../temp'), { recursive: true });
                            }
                            
                            res.setHeader('Content-Type', 'application/pdf');
                            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                            
                            const stream = fs.createWriteStream(filePath);
                            doc.pipe(stream);
                            doc.pipe(res);
                            
                            let pageNumber = 1;
                            
                            // Funzione per aggiungere numero pagina
                            const addPageNumber = (isLastPage = false) => {
                                doc.fontSize(8).fillColor('#95a5a6');
                                const pageText = `Pagina ${pageNumber}`;
                                
                                if (isLastPage) {
                                    doc.text(`${societaResult[0].ragione_sociale} - Documento generato automaticamente`, 40, 815, { align: 'center', width: 520 });
                                }
                                doc.text(pageText, 40, 800, { align: 'center', width: 520 });
                            };
                            
                            // INTESTAZIONE PRIMA PAGINA
                            doc.fontSize(24).font('Helvetica-Bold').fillColor('#2c3e50')
                               .text('REPORT PRESENZE INDIVIDUALI', { align: 'center' });
                            doc.moveDown(0.5);
                            
                            doc.moveTo(100, doc.y)
                               .lineTo(500, doc.y)
                               .lineWidth(2)
                               .strokeColor('#3498db')
                               .stroke();
                            doc.moveDown(1);
                            
                            doc.fontSize(12).font('Helvetica');
                            const infoTop = doc.y;
                            
                            doc.fillColor('#7f8c8d').text('Società:', 50, infoTop);
                            doc.fillColor('#2c3e50').text(societaResult[0].ragione_sociale, 110, infoTop);
                            
                            doc.fillColor('#7f8c8d').text('Dipendente: ', 50, infoTop + 20);
                            doc.fillColor('#2c3e50').text(`${dipendente.cognome} ${dipendente.nome}`, 110, infoTop + 20);
                            
                            doc.fillColor('#7f8c8d').text('Periodo:', 50, infoTop + 40);
                            doc.fillColor('#2c3e50').text(mese, 110, infoTop + 40);
                            
                            doc.fillColor('#7f8c8d').text('Generato il:', 350, infoTop);
                            doc.fillColor('#2c3e50').text(new Date().toLocaleDateString('it-IT'), 420, infoTop);
                            
                            doc.fillColor('#7f8c8d').text('Ora:', 350, infoTop + 20);
                            doc.fillColor('#2c3e50').text(new Date().toLocaleTimeString('it-IT'), 420, infoTop + 20);
                            
                            doc.moveDown(4);
                            
                            // STATISTICHE RIEPILOGATIVE
                            doc.fontSize(18).font('Helvetica-Bold').fillColor('#2c3e50')
                               .text('RIEPILOGO STATISTICHE', { align: 'center' });
                            doc.moveDown(1);
                            
                            const statsTop = doc.y;
                            const statBoxWidth = 250;
                            const statBoxHeight = 60;
                            const statMargin = 20;
                            
                            const stats = [
                                {
                                    label: 'Giorni con presenza',
                                    value: giorniConPresenza,
                                    subLabel: `su ${giorniMese} giorni`,
                                    color: '#27ae60',
                                    icon: '✓'
                                },
                                {
                                    label: 'Percentuale presenza',
                                    value: ((giorniConPresenza / giorniMese) * 100).toFixed(1) + '%',
                                    subLabel: 'del mese',
                                    color: '#3498db',
                                    icon: '%'
                                },
                                {
                                    label: 'Ore totali lavorate',
                                    value: oreTotali.toFixed(1) + 'h',
                                    subLabel: 'ore registrate',
                                    color: '#9b59b6',
                                    icon: '⏱'
                                },
                                {
                                    label: 'Uscite anticipate',
                                    value: giorniUscitaAnticipata,
                                    subLabel: 'giorni',
                                    color: '#f39c12',
                                    icon: '⚠'
                                }
                            ];
                            
                            stats.forEach((stat, index) => {
                                const row = Math.floor(index / 2);
                                const col = index % 2;
                                const x = 50 + (col * (statBoxWidth + statMargin));
                                const y = statsTop + (row * (statBoxHeight + 15));
                                
                                doc.roundedRect(x, y, statBoxWidth, statBoxHeight, 5)
                                   .fill('#f8f9fa')
                                   .stroke('#ddd');
                                
                                doc.font('Helvetica-Bold').fontSize(24).fillColor(stat.color);
                                doc.text(stat.icon, x + 15, y + 15);
                                
                                doc.font('Helvetica-Bold').fontSize(22).fillColor('#2c3e50');
                                doc.text(stat.value, x + 50, y + 10);
                                
                                doc.font('Helvetica').fontSize(11).fillColor('#666');
                                doc.text(stat.label, x + 50, y + 35);
                                
                                doc.font('Helvetica').fontSize(9).fillColor('#95a5a6');
                                doc.text(stat.subLabel, x + 50, y + 48);
                            });
                            
                            doc.moveDown((Math.ceil(stats.length / 2) * (statBoxHeight + 15)) / 18 + 2);
                            
                            // CALENDARIO
                            const calendario = generaCalendarioMese(meseNum - 1, anno);
                            const nomiGiorni = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
                            const nomeMese = new Date(anno, meseNum - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
                            
                            doc.fontSize(18).font('Helvetica-Bold').fillColor('#2c3e50')
                               .text(`CALENDARIO ${nomeMese.toUpperCase()}`, { align: 'center' });
                            doc.moveDown(0.5);
                            
                            const cellSize = 25;
                            const tableTop = doc.y;
                            const tableLeft = 50;
                            
                            doc.font('Helvetica-Bold').fontSize(10).fillColor('#2c3e50');
                            for (let i = 0; i < 7; i++) {
                                const x = tableLeft + (cellSize * i);
                                doc.text(nomiGiorni[i], x, tableTop, { width: cellSize, align: 'center' });
                            }
                            
                            doc.moveDown(1);
                            
                            calendario.forEach((settimana, settimanaIndex) => {
                                const y = doc.y;
                                
                                settimana.forEach((giorno, giornoIndex) => {
                                    const x = tableLeft + (cellSize * giornoIndex);
                                    
                                    if (giorno !== null) {
                                        const dataStr = `${anno}-${String(meseNum).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
                                        const giornoPresenze = presenzePerData[dataStr];
                                        
                                        let cellColor = '#e74c3c';
                                        let textColor = 'white';
                                        let simbolo = giorno.toString();
                                        
                                        if (giornoPresenze && giornoPresenze.entrate && giornoPresenze.entrate.length > 0) {
                                            if (giornoPresenze.uscite && giornoPresenze.uscite.length > 0) {
                                                if (haUscitaAnticipata(giornoPresenze.uscite)) {
                                                    cellColor = '#f39c12';
                                                    textColor = 'black';
                                                } else {
                                                    cellColor = '#27ae60';
                                                    textColor = 'white';
                                                }
                                            } else {
                                                cellColor = '#27ae60';
                                                textColor = 'white';
                                            }
                                        }
                                        
                                        doc.roundedRect(x, y, cellSize, cellSize, 3)
                                           .fill(cellColor)
                                           .stroke('#ddd');
                                        
                                        doc.font('Helvetica').fontSize(9).fillColor(textColor);
                                        doc.text(simbolo, x + cellSize/2 - 3, y + cellSize/2 - 5, { width: cellSize, align: 'center' });
                                        doc.fillColor('black');
                                    } else {
                                        doc.roundedRect(x, y, cellSize, cellSize, 3)
                                           .fill('#fafafa')
                                           .stroke('#eee');
                                    }
                                });
                                
                                doc.moveDown(cellSize / 18);
                            });
                            
                            doc.moveDown(1.5);
                            
                            // LEGENDA
                            doc.font('Helvetica-Bold').fontSize(12).fillColor('#2c3e50')
                               .text('LEGENDA', { align: 'center' });
                            doc.moveDown(0.5);
                            
                            const legendaY = doc.y;
                            
                            doc.rect(100, legendaY, 15, 15)
                               .fill('#27ae60')
                               .stroke('#ddd');
                            doc.font('Helvetica').fontSize(9).fillColor('#2c3e50');
                            doc.text('= Presenza regolare', 120, legendaY + 3);
                            
                            doc.rect(100, legendaY + 20, 15, 15)
                               .fill('#f39c12')
                               .stroke('#ddd');
                            doc.text('= Uscita anticipata (<17:00)', 120, legendaY + 23);
                            
                            doc.rect(300, legendaY, 15, 15)
                               .fill('#e74c3c')
                               .stroke('#ddd');
                            doc.text('= Assenza / Nessuna entrata', 320, legendaY + 3);
                            
                            doc.rect(300, legendaY + 20, 15, 15)
                               .fill('#fafafa')
                               .stroke('#ddd');
                            doc.text('= Giorno fuori mese', 320, legendaY + 23);
                            
                            doc.moveDown(4);
                            
                            // Aggiungi numero pagina alla prima pagina
                            addPageNumber();
                            
                            // DETTAGLIO PRESENZE (se ci sono dati)
                            if (presenzeResult.length > 0) {
                                // CONTROLLA SE C'È SPAZIO SULLA PAGINA CORRENTE
                                // Se siamo troppo in basso (meno di 200px disponibili), aggiungi nuova pagina
                                if (doc.y > 600) {
                                    doc.addPage();
                                    pageNumber++;
                                    
                                    // Aggiungi intestazione minima alla nuova pagina
                                    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2c3e50')
                                       .text('DETTAGLIO PRESENZE', { align: 'center' });
                                    doc.moveDown(0.5);
                                    
                                    doc.fontSize(12).font('Helvetica');
                                    doc.text(`Dipendente: ${dipendente.cognome} ${dipendente.nome}`);
                                    doc.text(`Mese: ${mese}`);
                                } else {
                                    doc.moveDown(2);
                                    doc.fontSize(20).font('Helvetica-Bold').fillColor('#2c3e50')
                                       .text('DETTAGLIO PRESENZE', { align: 'center' });
                                    doc.moveDown(0.5);
                                    
                                    doc.fontSize(12).font('Helvetica');
                                    doc.text(`Dipendente: ${dipendente.cognome} ${dipendente.nome}`);
                                    doc.text(`Mese: ${mese}`);
                                }
                                
                                doc.moveDown(1);
                                
                                const detailTop = doc.y;
                                let currentY = detailTop;
                                
                                // Intestazione tabella
                                doc.font('Helvetica-Bold').fontSize(10).fillColor('white');
                                doc.rect(40, currentY, 520, 20)
                                   .fill('#3498db')
                                   .stroke();
                                
                                doc.text('Data', 45, currentY + 6);
                                doc.text('Entrata', 120, currentY + 6);
                                doc.text('Uscita', 200, currentY + 6);
                                doc.text('Ore', 280, currentY + 6);
                                doc.text('Stato', 350, currentY + 6);
                                
                                currentY += 25;
                                doc.fillColor('black');
                                
                                // Raggruppa entrate/uscite per data
                                const presenzePerGiorno = {};
                                presenzeResult.forEach(p => {
                                    const data = p.data_presenza;
                                    if (!presenzePerGiorno[data]) {
                                        presenzePerGiorno[data] = { entrate: [], uscite: [] };
                                    }
                                    if (p.tipo === 'entrata') {
                                        presenzePerGiorno[data].entrate.push(p.ora_presenza);
                                    } else {
                                        presenzePerGiorno[data].uscite.push(p.ora_presenza);
                                    }
                                });
                                
                                doc.font('Helvetica').fontSize(9);
                                
                                doc.moveTo(40, currentY - 2)
                                   .lineTo(560, currentY - 2)
                                   .lineWidth(0.5)
                                   .strokeColor('#ddd')
                                   .stroke();
                                
                                Object.keys(presenzePerGiorno).sort().forEach(data => {
                                    const giorno = presenzePerGiorno[data];
                                    const dataFormattata = new Date(data).toLocaleDateString('it-IT');
                                    
                                    // CONTROLLA SE C'È SPAZIO PER QUESTA RIGA
                                    if (currentY > 750) {
                                        doc.addPage();
                                        pageNumber++;
                                        
                                        currentY = 50;
                                        
                                        doc.fontSize(16).font('Helvetica-Bold')
                                           .text('DETTAGLIO PRESENZE (continua)', { align: 'center' });
                                        doc.moveDown(1);
                                        
                                        doc.font('Helvetica-Bold').fontSize(10).fillColor('white');
                                        doc.rect(40, currentY, 520, 20)
                                           .fill('#3498db')
                                           .stroke();
                                        doc.text('Data', 45, currentY + 6);
                                        doc.text('Entrata', 120, currentY + 6);
                                        doc.text('Uscita', 200, currentY + 6);
                                        doc.text('Ore', 280, currentY + 6);
                                        doc.text('Stato', 350, currentY + 6);
                                        currentY += 25;
                                        doc.fillColor('black').font('Helvetica').fontSize(9);
                                        
                                        doc.moveTo(40, currentY - 2)
                                           .lineTo(560, currentY - 2)
                                           .lineWidth(0.5)
                                           .strokeColor('#ddd')
                                           .stroke();
                                    }
                                    
                                    doc.moveTo(40, currentY - 2)
                                       .lineTo(560, currentY - 2)
                                       .lineWidth(0.5)
                                       .strokeColor('#eee')
                                       .stroke();
                                    
                                    const entrateStr = giorno.entrate.length > 0 
                                        ? giorno.entrate.map(e => e.slice(0,5)).join(', ')
                                        : '--';
                                    
                                    let usciteStr = '17:00';
                                    if (giorno.uscite && giorno.uscite.length > 0) {
                                        usciteStr = giorno.uscite.map(u => u.slice(0,5)).join(', ');
                                    }
                                    
                                    let oreLavorate = '--';
                                    if (giorno.entrate.length > 0) {
                                        const uscitePerCalcolo = giorno.uscite.length > 0 ? giorno.uscite : ['17:00'];
                                        const ore = calcolaOreLavorate(giorno.entrate, uscitePerCalcolo);
                                        if (ore !== null) {
                                            oreLavorate = ore.toFixed(1) + 'h';
                                        }
                                    }
                                    
                                    let stato = 'Regolare';
                                    let statoColor = '#27ae60';
                                    
                                    if (giorno.entrate.length === 0) {
                                        stato = 'Assente';
                                        statoColor = '#e74c3c';
                                    } else if (giorno.uscite && giorno.uscite.length > 0 && haUscitaAnticipata(giorno.uscite)) {
                                        stato = 'Uscita anticipata';
                                        statoColor = '#f39c12';
                                    }
                                    
                                    doc.text(dataFormattata, 45, currentY);
                                    doc.text(entrateStr, 120, currentY);
                                    doc.text(usciteStr, 200, currentY);
                                    doc.text(oreLavorate, 280, currentY);
                                    
                                    doc.font('Helvetica-Bold').fillColor(statoColor);
                                    doc.text(stato, 350, currentY);
                                    doc.fillColor('black').font('Helvetica');
                                    
                                    currentY += 18;
                                });
                                
                                doc.moveTo(40, currentY - 2)
                                   .lineTo(560, currentY - 2)
                                   .lineWidth(0.5)
                                   .strokeColor('#ddd')
                                   .stroke();
                                
                                // RIEPILOGO FINALE
                                doc.moveDown(3);
                                doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                                   .text('RIEPILOGO FINALE', { align: 'center' });
                                doc.moveDown(0.5);
                                
                                const recapTop = doc.y;
                                doc.rect(80, recapTop, 440, 100)
                                   .fill('#f8f9fa')
                                   .stroke('#3498db');
                                
                                doc.font('Helvetica').fontSize(10);
                                
                                doc.fillColor('#7f8c8d').text('Giorni di presenza:', 100, recapTop + 15);
                                doc.fillColor('#2c3e50').font('Helvetica-Bold').text(giorniConPresenza.toString(), 300, recapTop + 15);
                                
                                doc.fillColor('#7f8c8d').font('Helvetica').text('Percentuale presenza:', 100, recapTop + 30);
                                doc.fillColor('#2c3e50').font('Helvetica-Bold').text(((giorniConPresenza / giorniMese) * 100).toFixed(1) + '%', 300, recapTop + 30);
                                
                                doc.fillColor('#7f8c8d').text('Ore totali lavorate:', 100, recapTop + 45);
                                doc.fillColor('#2c3e50').font('Helvetica-Bold').text(oreTotali.toFixed(1) + ' ore', 300, recapTop + 45);
                                
                                doc.fillColor('#7f8c8d').text('Uscite anticipate:', 100, recapTop + 60);
                                doc.fillColor('#2c3e50').font('Helvetica-Bold').text(giorniUscitaAnticipata.toString(), 300, recapTop + 60);
                                
                                doc.fillColor('#7f8c8d').text('Giorni regolari:', 100, recapTop + 75);
                                doc.fillColor('#2c3e50').font('Helvetica-Bold').text(giorniRegolari.toString(), 300, recapTop + 75);
                                
                                if (giorniConPresenza > 0) {
                                    doc.fillColor('#7f8c8d').text('Media ore/giorno:', 100, recapTop + 90);
                                    doc.fillColor('#2c3e50').font('Helvetica-Bold').text((oreTotali / giorniConPresenza).toFixed(1) + ' ore', 300, recapTop + 90);
                                }
                                
                                // FIRMA E TIMBRO
                                doc.moveDown(4);
                                doc.font('Helvetica').fontSize(10).fillColor('#7f8c8d');
                                doc.text('________________________________', 150, doc.y, { width: 300, align: 'center' });
                                doc.text('Firma del responsabile', 150, doc.y + 15, { width: 300, align: 'center' });
                            } else {
                                // Nessuna presenza registrata
                                doc.moveDown(4);
                                doc.fontSize(20).font('Helvetica-Bold').fillColor('#2c3e50')
                                   .text('NESSUNA PRESENZA REGISTRATA', { align: 'center' });
                                doc.moveDown(2);
                                
                                doc.fontSize(14).font('Helvetica').fillColor('#7f8c8d')
                                   .text(`Per il mese ${mese}, non sono state registrate presenze per il dipendente:`, { align: 'center' });
                                doc.moveDown(1);
                                
                                doc.fontSize(18).font('Helvetica-Bold').fillColor('#3498db')
                                   .text(`${dipendente.cognome} ${dipendente.nome}`, { align: 'center' });
                                doc.moveDown(2);
                                
                                doc.fontSize(12).font('Helvetica').fillColor('#95a5a6')
                                   .text('Verifica di aver registrato correttamente le presenze per questo mese.', { align: 'center' });
                            }
                            
                            // Aggiungi numero pagina all'ultima pagina
                            
                            doc.end();
                            
                            // Cancella il file temporaneo
                            setTimeout(() => {
                                if (fs.existsSync(filePath)) {
                                    try {
                                        fs.unlinkSync(filePath);
                                    } catch (err) {
                                        console.error('Errore cancellazione file temporaneo:', err);
                                    }
                                }
                            }, 300000);
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;
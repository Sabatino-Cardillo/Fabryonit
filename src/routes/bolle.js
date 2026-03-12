const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');

// Route principale GET '/'
router.get('/', async (req, res) => {
  const societaId = req.session.societaId;

  try {
    const [clienti] = await db.promise().query(
      'SELECT * FROM clienti WHERE societa_id = ?', 
      [societaId]
    );

    const [prodotti] = await db.promise().query(
      'SELECT * FROM prodotti WHERE societa_id = ?', 
      [societaId]
    );

    const [societa] = await db.promise().query(
      'SELECT * FROM societa WHERE id = ?', 
      [societaId]
    );

    let righe = [];
    let bollaCorrente = null;

    if (req.session.bollaId) {
      const [bolleData] = await db.promise().query(
        'SELECT *, COALESCE(data_creazione_personalizzata, data_creazione) as data_documento FROM bolle WHERE id = ? AND societa_id = ?',
        [req.session.bollaId, societaId]
      );
      
      if (bolleData.length > 0) {
        bollaCorrente = bolleData[0];
      }

      const [rows] = await db.promise().query(
        `SELECT rb.*, p.codice 
         FROM righe_bolla rb 
         JOIN prodotti p ON rb.prodotto_id = p.id 
         WHERE rb.bolla_id = ? AND rb.societa_id = ?`,
        [req.session.bollaId, societaId]
      );
      righe = rows;
    }

    res.render('bolle', {
      clienti,
      prodotti,
      righe,
      societa: societa[0] || {},
      bollaCorrente: bollaCorrente,
      clienteCorrente: req.session.clienteId ? clienti.find(c => c.id == req.session.clienteId) : null,
      clienteSelezionato: req.session.clienteId || null,
      bollaAperta: !!req.session.bollaId,
      bollaId: req.session.bollaId || null
    });
  } catch (err) {
    console.error('Errore route bolle:', err);
    res.status(500).send(err.message);
  }
});

// Seleziona o cambia cliente
router.post('/cliente', async (req, res) => {
  const cliente_id = req.body.cliente_id;
  const data_personalizzata = req.body.data_personalizzata;
  const societaId = req.session.societaId;

  if (!cliente_id) return res.status(400).send('Seleziona un cliente');

  try {
    const [cliente] = await db.promise().query(
      'SELECT * FROM clienti WHERE id = ? AND societa_id = ?',
      [cliente_id, societaId]
    );

    if (cliente.length === 0) {
      return res.status(403).send('Cliente non trovato o non autorizzato');
    }

    const [bolle] = await db.promise().query(
      `SELECT * FROM bolle 
       WHERE cliente_id = ? AND stato = "aperta" AND societa_id = ? 
       LIMIT 1`,
      [cliente_id, societaId]
    );

    let bollaId;

    if (bolle.length > 0) {
      bollaId = bolle[0].id;
    } else {
      const [result] = await db.promise().query(
        'INSERT INTO bolle (cliente_id, stato, societa_id, data_creazione_personalizzata) VALUES (?, "aperta", ?, ?)',
        [cliente_id, societaId, data_personalizzata || null]
      );
      bollaId = result.insertId;
    }

    req.session.bollaId = bollaId;
    req.session.clienteId = cliente_id;

    res.redirect('/bolle');
  } catch (err) {
    console.error('Errore selezione cliente:', err);
    res.status(500).send('Errore del server: ' + err.message);
  }
});

// Aggiungi una riga alla bolla aperta
router.post('/aggiungi', async (req, res) => {
  const { prodotto_id, quantita, bolla_id, descrizione, prezzo } = req.body;
  const bollaId = req.session.bollaId || bolla_id;
  const societaId = req.session.societaId;

  if (!bollaId) return res.status(400).send('Nessuna bolla aperta');

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bollaId, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).send('Non autorizzato');
    }

    const [prodotto] = await db.promise().query(
      'SELECT id FROM prodotti WHERE id = ? AND societa_id = ?',
      [prodotto_id, societaId]
    );

    if (prodotto.length === 0) {
      return res.status(403).send('Prodotto non trovato');
    }

    await db.promise().query(
      `INSERT INTO righe_bolla 
       (bolla_id, prodotto_id, quantita, descrizione, prezzo, societa_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [bollaId, prodotto_id, quantita, descrizione, prezzo, societaId]
    );

    res.redirect('/bolle');
  } catch (err) {
    console.error('Errore aggiunta riga:', err);
    res.status(500).send(err.message);
  }
});

// Annulla bolla
router.post('/annulla', async (req, res) => {
  const { bolla_id } = req.body;
  const bollaId = bolla_id || req.session.bollaId;
  const societaId = req.session.societaId;

  if (!bollaId) {
    return res.status(400).json({ 
      success: false, 
      message: 'Nessuna bolla da annullare' 
    });
  }

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bollaId, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Non autorizzato'
      });
    }

    await db.promise().query(
      'DELETE FROM righe_bolla WHERE bolla_id = ? AND societa_id = ?', 
      [bollaId, societaId]
    );
    
    await db.promise().query(
      'DELETE FROM bolle WHERE id = ? AND societa_id = ?', 
      [bollaId, societaId]
    );
    
    delete req.session.bollaId;
    delete req.session.clienteId;

    res.json({ 
      success: true, 
      message: 'Bolla annullata con successo' 
    });

  } catch (err) {
    console.error('Errore annullamento bolla:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Errore durante l\'annullamento: ' + err.message 
    });
  }
});

// Elimina una riga dalla bolla aperta
router.post('/elimina/:id', async (req, res) => {
  const rigaId = req.params.id;
  const societaId = req.session.societaId;

  if (!req.session.bollaId) return res.status(400).send('Nessuna bolla aperta');

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [req.session.bollaId, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).send('Non autorizzato');
    }

    await db.promise().query(
      'DELETE FROM righe_bolla WHERE id = ? AND bolla_id = ? AND societa_id = ?', 
      [rigaId, req.session.bollaId, societaId]
    );

    res.redirect('/bolle');
  } catch (err) {
    console.error('Errore eliminazione riga:', err);
    res.status(500).send(err.message);
  }
});

// Modifica riga della bolla
router.post('/modifica/:id', async (req, res) => {
  const rigaId = req.params.id;
  const { descrizione, quantita, prezzo, bolla_id } = req.body;
  const societaId = req.session.societaId;

  if (!bolla_id) return res.status(400).json({ success: false, message: 'ID bolla mancante' });

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({ success: false, message: 'Non autorizzato' });
    }

    await db.promise().query(
      `UPDATE righe_bolla 
       SET descrizione = ?, quantita = ?, prezzo = ? 
       WHERE id = ? AND bolla_id = ? AND societa_id = ?`,
      [descrizione, quantita, prezzo, rigaId, bolla_id, societaId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Errore modifica riga:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Salva bolla senza chiuderla
router.post('/salva', async (req, res) => {
  const bollaId = req.session.bollaId || req.body.bolla_id;
  const societaId = req.session.societaId;

  if (!bollaId) return res.status(400).json({ success: false, error: 'Nessuna bolla aperta' });

  try {
    const [result] = await db.promise().query(
      'UPDATE bolle SET updated_at = NOW() WHERE id = ? AND societa_id = ?', 
      [bollaId, societaId]
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({ success: false, error: 'Non autorizzato' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Errore salvataggio:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Salva opzioni aggiuntive della bolla
router.post('/salva-opzioni', async (req, res) => {
  const { 
    bolla_id, 
    trasporto_cura, 
    porto, 
    note, 
    colli_custom, 
    paia_custom, 
    causale, 
    aspetto_beni 
  } = req.body;
  
  const societaId = req.session.societaId;

  if (!bolla_id) {
    return res.status(400).json({ success: false, error: 'ID bolla mancante' });
  }

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({ success: false, error: 'Non autorizzato' });
    }

    await db.promise().query(
      `UPDATE bolle 
       SET trasporto_cura = ?, porto = ?, note = ?, 
           colli_custom = ?, paia_custom = ?, 
           causale = ?, aspetto_beni = ?, 
           updated_at = NOW()
       WHERE id = ? AND societa_id = ?`,
      [
        trasporto_cura || 'Destinatario', 
        porto || 'Assegnato', 
        note, 
        colli_custom, 
        paia_custom,
        causale,
        aspetto_beni,
        bolla_id, 
        societaId
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Errore salvataggio opzioni:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Aggiorna data personalizzata della bolla
router.post('/aggiorna-data', async (req, res) => {
  const { bolla_id, data_personalizzata } = req.body;
  const societaId = req.session.societaId;

  if (!bolla_id) {
    return res.status(400).json({ success: false, error: 'ID bolla mancante' });
  }

  try {
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bolla_id, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({ success: false, error: 'Non autorizzato' });
    }

    await db.promise().query(
      `UPDATE bolle 
       SET data_creazione_personalizzata = ?, updated_at = NOW()
       WHERE id = ? AND societa_id = ?`,
      [data_personalizzata || null, bolla_id, societaId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Errore aggiornamento data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stampa la bolla e chiudila
// Stampa la bolla e chiudila
router.post('/stampa', async (req, res) => {
  const societaId = req.session.societaId;

  if (!req.session.bollaId) {
    return res.status(400).json({ success: false, error: 'Nessuna bolla aperta' });
  }

  try {
    const [bolle] = await db.promise().query(
      'SELECT *, COALESCE(data_creazione_personalizzata, data_creazione) as data_documento FROM bolle WHERE id = ? AND societa_id = ?', 
      [req.session.bollaId, societaId]
    );

    if (bolle.length === 0) {
      return res.status(404).json({ success: false, error: 'Bolla non trovata' });
    }

    const bolla = bolle[0];
    let numeroBolla;

    // SE LA BOLLA HA GIA' UN NUMERO, LO MANTIENI SEMPRE
    if (bolla.numero) {
      // La bolla ha già un numero assegnato → mantienilo
      numeroBolla = bolla.numero;
    } else {
      // Bolla nuova senza numero → calcola nuovo numero incrementale
      
      // Ottieni il numero di partenza configurato dalla società
      const [societaRows] = await db.promise().query(
        'SELECT numero_bolla_inizio FROM societa WHERE id = ?',
        [societaId]
      );

      if (societaRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Società non trovata' });
      }

      const societa = societaRows[0];
      const numeroInizio = societa.numero_bolla_inizio || 0;

      // Calcola il prossimo numero di bolla
      const [lastNumRows] = await db.promise().query(
        'SELECT MAX(numero) as maxNumero FROM bolle WHERE societa_id = ?',
        [societaId]
      );

      const ultimoNumero = lastNumRows[0].maxNumero || numeroInizio - 1;
      numeroBolla = Math.max(ultimoNumero + 1, numeroInizio);
    }

const [righe] = await db.promise().query(
  `SELECT rb.*, p.codice 
   FROM righe_bolla rb 
   JOIN prodotti p ON rb.prodotto_id = p.id 
   WHERE rb.bolla_id = ? AND rb.societa_id = ?
   ORDER BY 
     REGEXP_REPLACE(p.codice, '[0-9]+', '') ASC,  -- Parte alfabetica (A-Z)
     CAST(REGEXP_SUBSTR(p.codice, '[0-9]+') AS UNSIGNED) ASC  -- Parte numerica (0-9 crescente)
  `,
  [req.session.bollaId, societaId]
);

    if (!righe.length) {
      return res.status(400).json({ success: false, error: 'La bolla non contiene righe da stampare.' });
    }

    // Ottieni i dati della società per l'intestazione
    const [societaRows] = await db.promise().query(
      'SELECT ragione_sociale, indirizzo, cap, comune, provincia, partita_iva, email, telefono FROM societa WHERE id = ?',
      [societaId]
    );

    if (societaRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Società non trovata' });
    }

    const societa = societaRows[0];

    const [clienteRows] = await db.promise().query(
      'SELECT * FROM clienti WHERE id = ? AND societa_id = ?', 
      [bolla.cliente_id, societaId]
    );

    if (clienteRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente non trovato' });
    }

    const cliente = clienteRows[0];

    // CREAZIONE DOCUMENTO PDF
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfData = Buffer.concat(chunks);

      // Aggiorna SEMPRE la bolla con stato "chiusa" e numero (nuovo o esistente)
      await db.promise().query(
        'UPDATE bolle SET stato="chiusa", numero=?, data_chiusura=NOW() WHERE id=? AND societa_id=?',
        [numeroBolla, req.session.bollaId, societaId]
      );

      delete req.session.bollaId;
      delete req.session.clienteId;

      res.json({
        success: true,
        pdf: pdfData.toString('base64'),
        filename: `bolla_${numeroBolla}_${cliente.nome}_${cliente.cognome || ''}.pdf`
      });
    });

    // FUNZIONI HELPER
    function checkPageSpace(yPosition, requiredSpace) {
      const pageHeight = doc.page.height;
      const marginBottom = 50;
      return (pageHeight - yPosition - marginBottom) >= requiredSpace;
    }

    function addNewPage() {
      doc.addPage();
      return 40;
    }

    let y = 40;

    // INTESTAZIONE AZIENDA
    doc.font('Helvetica-Bold').fontSize(14).text(`${societa.ragione_sociale || ''}`, 50, y);
    y += 20;
    doc.font('Helvetica').fontSize(10)
      .text(`${societa.indirizzo || ''}`, 50, y)
      .text(`${societa.cap || ''} ${societa.comune || ''} ${societa.provincia || ''}`, 50, y + 15)
      .text(`P.IVA ${societa.partita_iva || ''}`, 50, y + 30)
      .text(`${societa.email || ''}`, 50, y + 45)
      .text(`Tel: ${societa.telefono || ''}`, 200, y + 45);

    y += 60;

    // CLIENTE
    doc.rect(50, y, 250, 80).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('CLIENTE', 55, y + 5);
    doc.font('Helvetica').fontSize(10)
      .text(`${cliente.ragionesociale || cliente.nome || ''}`, 55, y + 20)
      .text(`Indirizzo: ${cliente.indirizzo || ''}`, 55, y + 35)
      .text(`Città: ${cliente.citta || ''} ${cliente.cap || ''}`, 55, y + 50)
      .text(`P.IVA: ${cliente.piva || ''}`, 55, y + 65);

    // DESTINAZIONE
    doc.rect(310, y, 250, 80).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('DESTINAZIONE', 315, y + 5);
    doc.font('Helvetica').fontSize(10)
      .text(`Indirizzo: ${cliente.indirizzo_spedizione || cliente.indirizzo || ''}`, 315, y + 35)
      .text(`Città: ${cliente.citta_spedizione || cliente.citta || ''} ${cliente.cap_spedizione || cliente.cap || ''}`, 315, y + 50);

    y += 90;

    // DOCUMENTO
    doc.rect(50, y, 510, 30).stroke();
    doc.font('Helvetica-Bold').fontSize(12)
      .text('DOCUMENTO DI TRASPORTO', 55, y + 10)
      .text(`Numero: ${numeroBolla}`, 300, y + 10)
      .text(`Data: ${new Date(bolla.data_documento).toLocaleDateString('it-IT')}`, 420, y + 10);

    y += 40;

    // TABELLA PRODOTTI - COLONNE CON PIÙ SPAZIO DAI BORDI
    // Posizioni delle linee verticali
    const linePositions = {
      afterCodice: 110,       // Linea dopo CODICE
      afterDescrizione: 260,  // Linea dopo DESCRIZIONE
      afterQuantita: 330,     // Linea dopo QUANTITÀ
      afterUnita: 380,        // Linea dopo UNITÀ
      afterPrezzo: 450        // Linea dopo PREZZO
    };

    // Posizioni del testo (centrato tra le linee)
    const textPositions = {
      codice: 55,            // Inizio a 55, finisce a 110 (55px di spazio)
      descrizione: 115,      // Inizia a 115, finisce a 260 (145px di spazio)
      quantita: 265,         // Inizia a 265, finisce a 330 (65px di spazio)
      unita: 335,            // Inizia a 335, finisce a 380 (45px di spazio)
      prezzo: 385,           // Inizia a 385, finisce a 450 (65px di spazio)
      totale: 455            // Inizia a 455, finisce a 560 (105px di spazio)
    };

    // Larghezze per il testo (spazio disponibile meno margini)
    const textWidths = {
      codice: linePositions.afterCodice - textPositions.codice - 10,      // 45px
      descrizione: linePositions.afterDescrizione - textPositions.descrizione - 10, // 135px
      quantita: linePositions.afterQuantita - textPositions.quantita - 10, // 55px
      unita: linePositions.afterUnita - textPositions.unita - 10,         // 35px
      prezzo: linePositions.afterPrezzo - textPositions.prezzo - 10,      // 55px
      totale: 560 - textPositions.totale - 10                            // 95px
    };

    const rowMinHeight = 20; // Aumentato per dare più spazio verticale
    const textTopMargin = 3; // Margine superiore per il testo

    // LINEA ORIZZONTALE SUPERIORE DELLA TABELLA
    doc.moveTo(50, y).lineTo(560, y).stroke();

    // INTESTAZIONE TABELLA - CENTRATA NELLE COLONNE CON MARGINE SUPERIORE
    doc.font('Helvetica-Bold').fontSize(9)
      .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
      .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
      .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
      .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
      .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
      .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

    // LINEA ORIZZONTALE SOTTO L'INTESTAZIONE
    y += 25;
    doc.moveTo(50, y).lineTo(560, y).stroke();
    
    // LINEE VERTICALI DI SEPARAZIONE CON PIÙ SPAZIO
    doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();      // Dopo CODICE
    doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke(); // Dopo DESCRIZIONE
    doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();  // Dopo QUANTITÀ
    doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();        // Dopo UNITÀ
    doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();      // Dopo PREZZO

    // IMPORTANTE: Ripristina font normale per le righe
    doc.font('Helvetica');

    // RIGHE DELLA TABELLA
    let totaleGenerale = 0;
    let inizioRigheY = y;

    const altezzaTotaleSezioneFinale = 200; // Aumentato per includere il totale generale
    let ultimaRigaInNuovaPagina = false;
    let righeRimanenti = [];

    for (let i = 0; i < righe.length; i++) {
      const r = righe[i];
      const prezzo = parseFloat(r.prezzo) || 0;
      const quantita = parseFloat(r.quantita) || 0;
      const totaleRiga = prezzo * quantita;
      totaleGenerale += totaleRiga;

      const descrizione = r.descrizione || '';
      const descHeight = doc.heightOfString(descrizione, { 
        width: textWidths.descrizione,
        fontSize: 9
      });
      const rowHeight = Math.max(rowMinHeight, descHeight + 10); // Aumentato il padding verticale

      const isLast = i === righe.length - 1;
      
      let spazioNecessario = rowHeight;
      if (isLast) {
        spazioNecessario += altezzaTotaleSezioneFinale;
      }

      // Se non c'è spazio su questa pagina
      if (!checkPageSpace(y, spazioNecessario)) {
        // Disegna linee verticali per la sezione corrente
        if (y > inizioRigheY) {
          doc.moveTo(linePositions.afterCodice, inizioRigheY).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, inizioRigheY).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, inizioRigheY).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, inizioRigheY).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, inizioRigheY).lineTo(linePositions.afterPrezzo, y).stroke();
        }
        
        if (isLast) {
          righeRimanenti.push({ r, rowHeight, totaleRiga });
          ultimaRigaInNuovaPagina = true;
          
          y = addNewPage();
          inizioRigheY = y;
          
          // LINEA ORIZZONTALE SUPERIORE DELLA TABELLA (nuova pagina)
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          // Ripristina intestazione tabella
          doc.font('Helvetica-Bold').fontSize(9)
            .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
            .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
            .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
            .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
            .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
            .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

          y += 25;
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          // LINEE VERTICALI
          doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();
          
          doc.font('Helvetica').fontSize(9);
          
          const lastRiga = righeRimanenti[0];
          // CODICE con margine superiore
          doc.text(lastRiga.r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
            width: textWidths.codice, 
            fontSize: 9 
          });
          // DESCRIZIONE con margine superiore
          doc.text(lastRiga.r.descrizione || '', textPositions.descrizione + 5, y + textTopMargin, { 
            width: textWidths.descrizione,
            fontSize: 9 
          });
          // QUANTITÀ con margine superiore
          doc.text(lastRiga.r.quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
            width: textWidths.quantita,
            align: 'left',
            fontSize: 9 
          });
          // UNITÀ con margine superiore
          doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
            width: textWidths.unita,
            align: 'left',
            fontSize: 9 
          });
          // PREZZO con margine superiore
          doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
            width: textWidths.prezzo,
            align: 'left',
            fontSize: 9 
          });
          // TOTALE con margine superiore
          doc.text(`€ ${lastRiga.totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
            width: textWidths.totale,
            align: 'left',
            fontSize: 9 
          });

          doc.moveTo(50, y + lastRiga.rowHeight).lineTo(560, y + lastRiga.rowHeight).stroke();
          y += lastRiga.rowHeight;
        } else {
          y = addNewPage();
          inizioRigheY = y;
          
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          doc.font('Helvetica-Bold').fontSize(9)
            .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
            .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
            .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
            .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
            .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
            .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

          y += 25;
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();
          
          doc.font('Helvetica').fontSize(9);
          
          // CODICE con margine superiore
          doc.text(r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
            width: textWidths.codice, 
            fontSize: 9 
          });
          // DESCRIZIONE con margine superiore
          doc.text(descrizione, textPositions.descrizione + 5, y + textTopMargin, { 
            width: textWidths.descrizione,
            fontSize: 9 
          });
          // QUANTITÀ con margine superiore
          doc.text(quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
            width: textWidths.quantita,
            align: 'left',
            fontSize: 9 
          });
          // UNITÀ con margine superiore
          doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
            width: textWidths.unita,
            align: 'left',
            fontSize: 9 
          });
          // PREZZO con margine superiore
          doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
            width: textWidths.prezzo,
            align: 'left',
            fontSize: 9 
          });
          // TOTALE con margine superiore
          doc.text(`€ ${totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
            width: textWidths.totale,
            align: 'left',
            fontSize: 9 
          });

          doc.moveTo(50, y + rowHeight).lineTo(560, y + rowHeight).stroke();
          y += rowHeight;
        }
      } else {
        doc.font('Helvetica').fontSize(9);
        
        // CODICE con margine superiore di 3px dalla linea orizzontale
        doc.text(r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
          width: textWidths.codice, 
          fontSize: 9 
        });
        // DESCRIZIONE con margine superiore di 3px dalla linea orizzontale
        doc.text(descrizione, textPositions.descrizione + 5, y + textTopMargin, { 
          width: textWidths.descrizione,
          fontSize: 9 
        });
        // QUANTITÀ con margine superiore di 3px dalla linea orizzontale
        doc.text(quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
          width: textWidths.quantita,
          align: 'left',
          fontSize: 9 
        });
        // UNITÀ con margine superiore di 3px dalla linea orizzontale
        doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
          width: textWidths.unita,
          align: 'left',
          fontSize: 9 
        });
        // PREZZO con margine superiore di 3px dalla linea orizzontale
        doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
          width: textWidths.prezzo,
          align: 'left',
          fontSize: 9 
        });
        // TOTALE con margine superiore di 3px dalla linea orizzontale
        doc.text(`€ ${totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
          width: textWidths.totale,
          align: 'left',
          fontSize: 9 
        });

        doc.moveTo(50, y + rowHeight).lineTo(560, y + rowHeight).stroke();
        y += rowHeight;
      }
    }

    // Disegna linee verticali finali
    if (y > inizioRigheY) {
      doc.moveTo(linePositions.afterCodice, inizioRigheY).lineTo(linePositions.afterCodice, y).stroke();
      doc.moveTo(linePositions.afterDescrizione, inizioRigheY).lineTo(linePositions.afterDescrizione, y).stroke();
      doc.moveTo(linePositions.afterQuantita, inizioRigheY).lineTo(linePositions.afterQuantita, y).stroke();
      doc.moveTo(linePositions.afterUnita, inizioRigheY).lineTo(linePositions.afterUnita, y).stroke();
      doc.moveTo(linePositions.afterPrezzo, inizioRigheY).lineTo(linePositions.afterPrezzo, y).stroke();
    }

    // CALCOLO IN BASE ALLE NOTE
    const noteText = (bolla.note || '').toLowerCase();
    const sommaPaia = righe.reduce((sum, r) => sum + (parseInt(r.quantita) || 0), 0);
    
    y += 10; // ← AUMENTA QUESTO VALORE PER PIÙ SPAZIO

    // SEZIONE FINALE - MODIFICATA PER INCLUDERE CAUSALE E ASPETTO BENI
    // Verifica se c'è spazio per la sezione finale
    const altezzaSezioneFinaleCompleta = 180;
    if (!checkPageSpace(y, altezzaSezioneFinaleCompleta)) {
      y = addNewPage();
    }

    // IMPORTANTE: Ripristina font normale per la sezione finale
    doc.font('Helvetica');

    // PRIMA RIGA: Trasporto, Porto, Colli/Paia
    const boxHeight = 18;
    
    // Trasporto a cura - etichetta in normale
    doc.fontSize(7).text('Trasporto a cura', 50, y);
    doc.rect(50, y + 6, 150, boxHeight).stroke();
    doc.fontSize(8).text(bolla.trasporto_cura || 'Destinatario', 55, y + 10);

    // Porto - etichetta in normale
    doc.fontSize(7).text('Porto', 210, y);
    doc.rect(210, y + 6, 100, boxHeight).stroke();
    doc.fontSize(8).text(bolla.porto || 'Assegnato', 215, y + 10);

    // Calcola il valore in base alle note
let colliValore = '';
let paiaValore = '';
if (noteText.includes('imballaggio')) {
    // Se c'è "imballaggio" → mostra "Colli" e "Paia" AFFIANCATI
    // COLLI (sinistra)
    doc.fontSize(7).text("Colli", 320, y);
    doc.rect(320, y + 6, 40, boxHeight).stroke(); // Rettangolo più stretto
    doc.fontSize(8).text(bolla.colli_custom || righe.length.toString(), 325, y + 10, { 
        width: 30, 
        align: 'center' 
    });
    
    // PAIA (destra)
    doc.fontSize(7).text("Paia", 365, y); // 320 + 40 + 5(spazio)
    doc.rect(365, y + 6, 40, boxHeight).stroke(); // Rettangolo più stretto
    doc.fontSize(8).text(bolla.paia_custom || sommaPaia.toString(), 370, y + 10, { 
        width: 30, 
        align: 'center' 
    });
} else {
    // Se NON c'è "imballaggio" → mostra solo "Paia" CENTRATO nello spazio
    // PAIA (centrato nello spazio di 85px)
    doc.fontSize(7).text("Paia", 320, y);
    doc.rect(320, y + 6, 85, boxHeight).stroke(); // Rettangolo combinato (40+5+40)
    doc.fontSize(8).text(bolla.paia_custom || sommaPaia.toString(), 325, y + 10, { 
        width: 75, 
        align: 'center' 
    });
}
    // Colli o Paia - etichetta in normale


    y += 35;

    // SECONDA RIGA: Causale e Aspetto beni (quadrati piccoli affiancati)
    
    // Causale - quadrato piccolo - etichetta in normale
    const smallBoxWidth = 180;
    const smallBoxHeight = 25;
    
    doc.fontSize(7).text('Causale', 50, y);
    doc.rect(50, y + 6, smallBoxWidth, smallBoxHeight).stroke();
    if (bolla.causale && bolla.causale.trim()) {
      doc.fontSize(8).text(bolla.causale, 55, y + 12, {
        width: smallBoxWidth - 10,
        ellipsis: true
      });
    }

    // Aspetto beni - quadrato piccolo - etichetta in normale
    doc.fontSize(7).text('Aspetto beni', 240, y);
    doc.rect(240, y + 6, smallBoxWidth, smallBoxHeight).stroke();
    if (bolla.aspetto_beni && bolla.aspetto_beni.trim()) {
      doc.fontSize(8).text(bolla.aspetto_beni, 245, y + 12, {
        width: smallBoxWidth - 10,
        ellipsis: true
      });
    }

    y += 35;

    // TERZA RIGA: Note (rettangolo più grande) - etichetta in normale
    doc.fontSize(7).text('Note', 50, y);
    doc.rect(50, y + 6, 510, 25).stroke();
    
    if (bolla.note && bolla.note.trim()) {
      doc.fontSize(8).text(bolla.note.trim(), 55, y + 10, {
        width: 500,
        height: 20,
        ellipsis: true
      });
    }

    y += 35;

    // QUARTA RIGA: Firme - etichette in normale
    doc.fontSize(7).text('Firma destinatario', 50, y);
    doc.rect(50, y + 6, 250, 25).stroke();

    doc.fontSize(7).text('Firma conducente', 310, y);
    doc.rect(310, y + 6, 250, 25).stroke();

    // TOTALE GENERALE PICCOLO DOPO LA SEZIONE FINALE
    y += 50; // Spazio dopo le firme
    doc.font('Helvetica').fontSize(8) // Font normale e dimensioni piccole
      .text('Totale Generale Bolla:', 420, y)
      .text(`€ ${totaleGenerale.toFixed(2)}`, 500, y, { align: 'right' });

    doc.end();

  } catch (err) {
    console.error('Errore generale in /stampa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cerca bolla esistente
router.get('/cerca', async (req, res) => {
  const societaId = req.session.societaId;

  try {
    const { numero } = req.query;

    const [bolle] = await db.promise().query(
      `SELECT b.*, c.nome, c.cognome 
       FROM bolle b 
       JOIN clienti c ON b.cliente_id = c.id 
       WHERE b.numero = ? AND b.stato = "chiusa" AND b.societa_id = ?`,
      [numero, societaId]
    );
    
    if (bolle.length === 0) {
      return res.status(404).json({ success: false, error: 'Bolla non trovata' });
    }

    const bolla = bolle[0];

    const [righe] = await db.promise().query(
      `SELECT rb.*, p.codice 
       FROM righe_bolla rb 
       JOIN prodotti p ON rb.prodotto_id = p.id 
       WHERE rb.bolla_id = ? AND rb.societa_id = ?`,
      [bolla.id, societaId]
    );

    res.json({ success: true, bolla, righe });
  } catch (err) {
    console.error('Errore ricerca bolla:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Riapri bolla esistente
router.post('/riapri/:id', async (req, res) => {
  const societaId = req.session.societaId;

  try {
    const [bolla] = await db.promise().query(
      'SELECT cliente_id FROM bolle WHERE id = ? AND societa_id = ?',
      [req.params.id, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).json({ success: false, error: 'Non autorizzato' });
    }

    await db.promise().query(
      'UPDATE bolle SET stato = "aperta" WHERE id = ? AND societa_id = ?', 
      [req.params.id, societaId]
    );

    req.session.bollaId = parseInt(req.params.id);
    req.session.clienteId = bolla[0].cliente_id;

    res.redirect('/bolle');
  } catch (err) {
    console.error('Errore riapertura:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ristampa bolla esistente
router.get('/ristampa/:id', async (req, res) => {
  const societaId = req.session.societaId;

  try {
    const [bolle] = await db.promise().query(
      'SELECT *, COALESCE(data_creazione_personalizzata, data_creazione) as data_documento FROM bolle WHERE id = ? AND societa_id = ?', 
      [req.params.id, societaId]
    );

    if (bolle.length === 0) {
      return res.status(404).json({ success: false, error: 'Bolla non trovata' });
    }

    const bolla = bolle[0];
    const numeroBolla = bolla.numero;
    
    const [clienteRows] = await db.promise().query(
      'SELECT * FROM clienti WHERE id = ? AND societa_id = ?', 
      [bolla.cliente_id, societaId]
    );

    if (clienteRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente non trovato' });
    }

    const cliente = clienteRows[0];

    const [societaRows] = await db.promise().query(
      'SELECT ragione_sociale, indirizzo, cap, comune, provincia, partita_iva, email, telefono FROM societa WHERE id = ?',
      [societaId]
    );

    if (societaRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Società non trovata' });
    }

    const societa = societaRows[0];
    
const [righe] = await db.promise().query(
  `SELECT rb.*, p.codice 
   FROM righe_bolla rb 
   JOIN prodotti p ON rb.prodotto_id = p.id 
   WHERE rb.bolla_id = ? AND rb.societa_id = ?
   ORDER BY 
     REGEXP_REPLACE(p.codice, '[0-9]+', '') ASC,  -- Parte alfabetica (A-Z)
     CAST(REGEXP_SUBSTR(p.codice, '[0-9]+') AS UNSIGNED) ASC  -- Parte numerica (0-9 crescente)
  `,
  [bolla.id, societaId]
);

    if (!righe.length) {
      return res.status(400).json({ success: false, error: 'La bolla non contiene righe' });
    }

    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfData = Buffer.concat(chunks);

      res.json({
        success: true,
        pdf: pdfData.toString('base64'),
        filename: `bolla_${numeroBolla}_${cliente.nome}_${cliente.cognome || ''}.pdf`
      });
    });

    // FUNZIONI HELPER
    function checkPageSpace(yPosition, requiredSpace) {
      const pageHeight = doc.page.height;
      const marginBottom = 50;
      return (pageHeight - yPosition - marginBottom) >= requiredSpace;
    }

    function addNewPage() {
      doc.addPage();
      return 40;
    }

    let y = 40;

    // INTESTAZIONE AZIENDA
    doc.font('Helvetica-Bold').fontSize(14).text(`${societa.ragione_sociale || ''}`, 50, y);
    y += 20;
    doc.font('Helvetica').fontSize(10)
      .text(`${societa.indirizzo || ''}`, 50, y)
      .text(`${societa.cap || ''} ${societa.comune || ''} ${societa.provincia || ''}`, 50, y + 15)
      .text(`P.IVA ${societa.partita_iva || ''}`, 50, y + 30)
      .text(`${societa.email || ''}`, 50, y + 45)
      .text(`Tel: ${societa.telefono || ''}`, 200, y + 45);

    y += 60;

    // CLIENTE
    doc.rect(50, y, 250, 80).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('CLIENTE', 55, y + 5);
    doc.font('Helvetica').fontSize(10)
      .text(`${cliente.ragionesociale || cliente.nome || ''}`, 55, y + 20)
      .text(`Indirizzo: ${cliente.indirizzo || ''}`, 55, y + 35)
      .text(`Città: ${cliente.citta || ''} ${cliente.cap || ''}`, 55, y + 50)
      .text(`P.IVA: ${cliente.piva || ''}`, 55, y + 65);

    // DESTINAZIONE
    doc.rect(310, y, 250, 80).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('DESTINAZIONE', 315, y + 5);
    doc.font('Helvetica').fontSize(10)
      .text(`Indirizzo: ${cliente.indirizzo_spedizione || cliente.indirizzo || ''}`, 315, y + 35)
      .text(`Città: ${cliente.citta_spedizione || cliente.citta || ''} ${cliente.cap_spedizione || cliente.cap || ''}`, 315, y + 50);

    y += 90;

    // DOCUMENTO
    doc.rect(50, y, 510, 30).stroke();
    doc.font('Helvetica-Bold').fontSize(12)
      .text('DOCUMENTO DI TRASPORTO', 55, y + 10)
      .text(`Numero: ${numeroBolla}`, 300, y + 10)
      .text(`Data: ${new Date(bolla.data_documento).toLocaleDateString('it-IT')}`, 420, y + 10);

    y += 40;

    // TABELLA PRODOTTI - COLONNE CON PIÙ SPAZIO DAI BORDI
    // Posizioni delle linee verticali
    const linePositions = {
      afterCodice: 110,       // Linea dopo CODICE
      afterDescrizione: 260,  // Linea dopo DESCRIZIONE
      afterQuantita: 330,     // Linea dopo QUANTITÀ
      afterUnita: 380,        // Linea dopo UNITÀ
      afterPrezzo: 450        // Linea dopo PREZZO
    };

    // Posizioni del testo (centrato tra le linee)
    const textPositions = {
      codice: 55,            // Inizio a 55, finisce a 110 (55px di spazio)
      descrizione: 115,      // Inizia a 115, finisce a 260 (145px di spazio)
      quantita: 265,         // Inizia a 265, finisce a 330 (65px di spazio)
      unita: 335,            // Inizia a 335, finisce a 380 (45px di spazio)
      prezzo: 385,           // Inizia a 385, finisce a 450 (65px di spazio)
      totale: 455            // Inizia a 455, finisce a 560 (105px di spazio)
    };

    // Larghezze per il testo (spazio disponibile meno margini)
    const textWidths = {
      codice: linePositions.afterCodice - textPositions.codice - 10,      // 45px
      descrizione: linePositions.afterDescrizione - textPositions.descrizione - 10, // 135px
      quantita: linePositions.afterQuantita - textPositions.quantita - 10, // 55px
      unita: linePositions.afterUnita - textPositions.unita - 10,         // 35px
      prezzo: linePositions.afterPrezzo - textPositions.prezzo - 10,      // 55px
      totale: 560 - textPositions.totale - 10                            // 95px
    };

    const rowMinHeight = 20; // Aumentato per dare più spazio verticale
    const textTopMargin = 3; // Margine superiore per il testo

    // LINEA ORIZZONTALE SUPERIORE DELLA TABELLA
    doc.moveTo(50, y).lineTo(560, y).stroke();

    // INTESTAZIONE TABELLA - CENTRATA NELLE COLONNE CON MARGINE SUPERIORE
    doc.font('Helvetica-Bold').fontSize(9)
      .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
      .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
      .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
      .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
      .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
      .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

    // LINEA ORIZZONTALE SOTTO L'INTESTAZIONE
    y += 25;
    doc.moveTo(50, y).lineTo(560, y).stroke();
    
    // LINEE VERTICALI DI SEPARAZIONE CON PIÙ SPAZIO
    doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();      // Dopo CODICE
    doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke(); // Dopo DESCRIZIONE
    doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();  // Dopo QUANTITÀ
    doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();        // Dopo UNITÀ
    doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();      // Dopo PREZZO

    // IMPORTANTE: Ripristina font normale per le righe
    doc.font('Helvetica');

    // RIGHE DELLA TABELLA
    let totaleGenerale = 0;
    let inizioRigheY = y;

    const altezzaTotaleSezioneFinale = 200; // Aumentato per includere il totale generale
    let ultimaRigaInNuovaPagina = false;
    let righeRimanenti = [];

    for (let i = 0; i < righe.length; i++) {
      const r = righe[i];
      const prezzo = parseFloat(r.prezzo) || 0;
      const quantita = parseFloat(r.quantita) || 0;
      const totaleRiga = prezzo * quantita;
      totaleGenerale += totaleRiga;

      const descrizione = r.descrizione || '';
      const descHeight = doc.heightOfString(descrizione, { 
        width: textWidths.descrizione,
        fontSize: 9
      });
      const rowHeight = Math.max(rowMinHeight, descHeight + 10); // Aumentato il padding verticale

      const isLast = i === righe.length - 1;
      
      let spazioNecessario = rowHeight;
      if (isLast) {
        spazioNecessario += altezzaTotaleSezioneFinale;
      }

      // Se non c'è spazio su questa pagina
      if (!checkPageSpace(y, spazioNecessario)) {
        // Disegna linee verticali per la sezione corrente
        if (y > inizioRigheY) {
          doc.moveTo(linePositions.afterCodice, inizioRigheY).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, inizioRigheY).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, inizioRigheY).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, inizioRigheY).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, inizioRigheY).lineTo(linePositions.afterPrezzo, y).stroke();
        }
        
        if (isLast) {
          righeRimanenti.push({ r, rowHeight, totaleRiga });
          ultimaRigaInNuovaPagina = true;
          
          y = addNewPage();
          inizioRigheY = y;
          
          // LINEA ORIZZONTALE SUPERIORE DELLA TABELLA (nuova pagina)
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          // Ripristina intestazione tabella
          doc.font('Helvetica-Bold').fontSize(9)
            .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
            .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
            .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
            .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
            .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
            .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

          y += 25;
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          // LINEE VERTICALI
          doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();
          
          doc.font('Helvetica').fontSize(9);
          
          const lastRiga = righeRimanenti[0];
          // CODICE con margine superiore
          doc.text(lastRiga.r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
            width: textWidths.codice, 
            fontSize: 9 
          });
          // DESCRIZIONE con margine superiore
          doc.text(lastRiga.r.descrizione || '', textPositions.descrizione + 5, y + textTopMargin, { 
            width: textWidths.descrizione,
            fontSize: 9 
          });
          // QUANTITÀ con margine superiore
          doc.text(lastRiga.r.quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
            width: textWidths.quantita,
            align: 'left',
            fontSize: 9 
          });
          // UNITÀ con margine superiore
          doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
            width: textWidths.unita,
            align: 'left',
            fontSize: 9 
          });
          // PREZZO con margine superiore
          doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
            width: textWidths.prezzo,
            align: 'left',
            fontSize: 9 
          });
          // TOTALE con margine superiore
          doc.text(`€ ${lastRiga.totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
            width: textWidths.totale,
            align: 'left',
            fontSize: 9 
          });

          doc.moveTo(50, y + lastRiga.rowHeight).lineTo(560, y + lastRiga.rowHeight).stroke();
          y += lastRiga.rowHeight;
        } else {
          y = addNewPage();
          inizioRigheY = y;
          
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          doc.font('Helvetica-Bold').fontSize(9)
            .text('CODICE', textPositions.codice + 5, y + 8, { width: textWidths.codice, align: 'left' })
            .text('DESCRIZIONE', textPositions.descrizione + 5, y + 8, { width: textWidths.descrizione, align: 'left' })
            .text('Q.TÀ', textPositions.quantita + 5, y + 8, { width: textWidths.quantita, align: 'left' })
            .text('UNITÀ', textPositions.unita + 5, y + 8, { width: textWidths.unita, align: 'left' })
            .text('PREZZO', textPositions.prezzo + 5, y + 8, { width: textWidths.prezzo, align: 'left' })
            .text('TOTALE', textPositions.totale + 5, y + 8, { width: textWidths.totale, align: 'left' });

          y += 25;
          doc.moveTo(50, y).lineTo(560, y).stroke();
          
          doc.moveTo(linePositions.afterCodice, y - 25).lineTo(linePositions.afterCodice, y).stroke();
          doc.moveTo(linePositions.afterDescrizione, y - 25).lineTo(linePositions.afterDescrizione, y).stroke();
          doc.moveTo(linePositions.afterQuantita, y - 25).lineTo(linePositions.afterQuantita, y).stroke();
          doc.moveTo(linePositions.afterUnita, y - 25).lineTo(linePositions.afterUnita, y).stroke();
          doc.moveTo(linePositions.afterPrezzo, y - 25).lineTo(linePositions.afterPrezzo, y).stroke();
          
          doc.font('Helvetica').fontSize(9);
          
          // CODICE con margine superiore
          doc.text(r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
            width: textWidths.codice, 
            fontSize: 9 
          });
          // DESCRIZIONE con margine superiore
          doc.text(descrizione, textPositions.descrizione + 5, y + textTopMargin, { 
            width: textWidths.descrizione,
            fontSize: 9 
          });
          // QUANTITÀ con margine superiore
          doc.text(quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
            width: textWidths.quantita,
            align: 'left',
            fontSize: 9 
          });
          // UNITÀ con margine superiore
          doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
            width: textWidths.unita,
            align: 'left',
            fontSize: 9 
          });
          // PREZZO con margine superiore
          doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
            width: textWidths.prezzo,
            align: 'left',
            fontSize: 9 
          });
          // TOTALE con margine superiore
          doc.text(`€ ${totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
            width: textWidths.totale,
            align: 'left',
            fontSize: 9 
          });

          doc.moveTo(50, y + rowHeight).lineTo(560, y + rowHeight).stroke();
          y += rowHeight;
        }
      } else {
        doc.font('Helvetica').fontSize(9);
        
        // CODICE con margine superiore di 3px dalla linea orizzontale
        doc.text(r.codice.toString(), textPositions.codice + 5, y + textTopMargin, { 
          width: textWidths.codice, 
          fontSize: 9 
        });
        // DESCRIZIONE con margine superiore di 3px dalla linea orizzontale
        doc.text(descrizione, textPositions.descrizione + 5, y + textTopMargin, { 
          width: textWidths.descrizione,
          fontSize: 9 
        });
        // QUANTITÀ con margine superiore di 3px dalla linea orizzontale
        doc.text(quantita.toString(), textPositions.quantita + 5, y + textTopMargin, { 
          width: textWidths.quantita,
          align: 'left',
          fontSize: 9 
        });
        // UNITÀ con margine superiore di 3px dalla linea orizzontale
        doc.text('PAIA', textPositions.unita + 5, y + textTopMargin, { 
          width: textWidths.unita,
          align: 'left',
          fontSize: 9 
        });
        // PREZZO con margine superiore di 3px dalla linea orizzontale
        doc.text(`€ ${prezzo.toFixed(2)}`, textPositions.prezzo + 5, y + textTopMargin, { 
          width: textWidths.prezzo,
          align: 'left',
          fontSize: 9 
        });
        // TOTALE con margine superiore di 3px dalla linea orizzontale
        doc.text(`€ ${totaleRiga.toFixed(2)}`, textPositions.totale + 5, y + textTopMargin, { 
          width: textWidths.totale,
          align: 'left',
          fontSize: 9 
        });

        doc.moveTo(50, y + rowHeight).lineTo(560, y + rowHeight).stroke();
        y += rowHeight;
      }
    }

    // Disegna linee verticali finali
    if (y > inizioRigheY) {
      doc.moveTo(linePositions.afterCodice, inizioRigheY).lineTo(linePositions.afterCodice, y).stroke();
      doc.moveTo(linePositions.afterDescrizione, inizioRigheY).lineTo(linePositions.afterDescrizione, y).stroke();
      doc.moveTo(linePositions.afterQuantita, inizioRigheY).lineTo(linePositions.afterQuantita, y).stroke();
      doc.moveTo(linePositions.afterUnita, inizioRigheY).lineTo(linePositions.afterUnita, y).stroke();
      doc.moveTo(linePositions.afterPrezzo, inizioRigheY).lineTo(linePositions.afterPrezzo, y).stroke();
    }

    // CALCOLO IN BASE ALLE NOTE
    const noteText = (bolla.note || '').toLowerCase();
    const sommaPaia = righe.reduce((sum, r) => sum + (parseInt(r.quantita) || 0), 0);
    
    // AGGIUNGI SPAZIO TRA LA TABELLA E LA SEZIONE FINALE
    y += 10; // ← STESSO SPAZIO DELLA FUNZIONE STAMPA

    // SEZIONE FINALE - MODIFICATA PER INCLUDERE CAUSALE E ASPETTO BENI
    // Verifica se c'è spazio per la sezione finale
    const altezzaSezioneFinaleCompleta = 180;
    if (!checkPageSpace(y, altezzaSezioneFinaleCompleta)) {
      y = addNewPage();
    }

    // IMPORTANTE: Ripristina font normale per la sezione finale
    doc.font('Helvetica');

    // PRIMA RIGA: Trasporto, Porto, Colli/Paia
    const boxHeight = 18;
    
    // Trasporto a cura - etichetta in normale
    doc.fontSize(7).text('Trasporto a cura', 50, y);
    doc.rect(50, y + 6, 150, boxHeight).stroke();
    doc.fontSize(8).text(bolla.trasporto_cura || 'Destinatario', 55, y + 10);

    // Porto - etichetta in normale
    doc.fontSize(7).text('Porto', 210, y);
    doc.rect(210, y + 6, 100, boxHeight).stroke();
    doc.fontSize(8).text(bolla.porto || 'Assegnato', 215, y + 10);

    // Calcola il valore in base alle note
let colliValore = '';
let paiaValore = '';
if (noteText.includes('imballaggio')) {
    // Se c'è "imballaggio" → mostra "Colli" e "Paia" AFFIANCATI
    // COLLI (sinistra)
    doc.fontSize(7).text("Colli", 320, y);
    doc.rect(320, y + 6, 40, boxHeight).stroke(); // Rettangolo più stretto
    doc.fontSize(8).text(bolla.colli_custom || righe.length.toString(), 325, y + 10, { 
        width: 30, 
        align: 'center' 
    });
    
    // PAIA (destra)
    doc.fontSize(7).text("Paia", 365, y); // 320 + 40 + 5(spazio)
    doc.rect(365, y + 6, 40, boxHeight).stroke(); // Rettangolo più stretto
    doc.fontSize(8).text(bolla.paia_custom || sommaPaia.toString(), 370, y + 10, { 
        width: 30, 
        align: 'center' 
    });
} else {
    // Se NON c'è "imballaggio" → mostra solo "Paia" CENTRATO nello spazio
    // PAIA (centrato nello spazio di 85px)
    doc.fontSize(7).text("Paia", 320, y);
    doc.rect(320, y + 6, 85, boxHeight).stroke(); // Rettangolo combinato (40+5+40)
    doc.fontSize(8).text(bolla.paia_custom || sommaPaia.toString(), 325, y + 10, { 
        width: 75, 
        align: 'center' 
    });
}
    y += 35;

    // SECONDA RIGA: Causale e Aspetto beni (quadrati piccoli affiancati)
    
    // Causale - quadrato piccolo - etichetta in normale
    const smallBoxWidth = 180;
    const smallBoxHeight = 25;
    
    doc.fontSize(7).text('Causale', 50, y);
    doc.rect(50, y + 6, smallBoxWidth, smallBoxHeight).stroke();
    if (bolla.causale && bolla.causale.trim()) {
      doc.fontSize(8).text(bolla.causale, 55, y + 12, {
        width: smallBoxWidth - 10,
        ellipsis: true
      });
    }

    // Aspetto beni - quadrato piccolo - etichetta in normale
    doc.fontSize(7).text('Aspetto beni', 240, y);
    doc.rect(240, y + 6, smallBoxWidth, smallBoxHeight).stroke();
    if (bolla.aspetto_beni && bolla.aspetto_beni.trim()) {
      doc.fontSize(8).text(bolla.aspetto_beni, 245, y + 12, {
        width: smallBoxWidth - 10,
        ellipsis: true
      });
    }

    y += 35;

    // TERZA RIGA: Note (rettangolo più grande) - etichetta in normale
    doc.fontSize(7).text('Note', 50, y);
    doc.rect(50, y + 6, 510, 25).stroke();
    
    if (bolla.note && bolla.note.trim()) {
      doc.fontSize(8).text(bolla.note.trim(), 55, y + 10, {
        width: 500,
        height: 20,
        ellipsis: true
      });
    }

    y += 35;

    // QUARTA RIGA: Firme - etichette in normale
    doc.fontSize(7).text('Firma destinatario', 50, y);
    doc.rect(50, y + 6, 250, 25).stroke();

    doc.fontSize(7).text('Firma conducente', 310, y);
    doc.rect(310, y + 6, 250, 25).stroke();

    // TOTALE GENERALE PICCOLO DOPO LA SEZIONE FINALE - STESSO STILE DI /STAMPA
    y += 50; // Spazio dopo le firme
    doc.font('Helvetica').fontSize(8) // Font normale e dimensioni piccole
      .text('Totale Generale Bolla:', 420, y)
      .text(`€ ${totaleGenerale.toFixed(2)}`, 500, y, { align: 'right' });

    doc.end();

  } catch (err) {
    console.error('Errore ristampa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
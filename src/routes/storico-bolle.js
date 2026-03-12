const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');

// GET /storico-bolle → mostra tutte le bolle DELLA SOCIETÀ
router.get('/', (req, res) => {
  const societaId = req.session.societaId;

  const query = `SELECT bolle.*, clienti.ragionesociale as cliente_nome 
                 FROM bolle 
                 LEFT JOIN clienti ON bolle.cliente_id = clienti.id 
                 WHERE bolle.societa_id = ?
                 ORDER BY bolle.data_creazione DESC`;

  db.query(query, [societaId], (err, results) => {
    if (err) {
      console.error('Errore nel caricamento delle bolle:', err);
      return res.status(500).send("Errore nel caricamento bolle.");
    }
    res.render('storico-bolle', { bolle: results });
  });
});

// POST /storico-bolle/remove → elimina bolla (solo della propria società)
router.post('/remove', async (req, res) => {
  const bollaId = req.body.id;
  const societaId = req.session.societaId;
  
  try {
    // ✅ Verifica che la bolla appartenga alla società
    const [bolla] = await db.promise().query(
      'SELECT id FROM bolle WHERE id = ? AND societa_id = ?',
      [bollaId, societaId]
    );

    if (bolla.length === 0) {
      return res.status(403).send('Non autorizzato');
    }

    // ✅ Elimina righe e bolla con filtro societa_id
    await db.promise().query(
      'DELETE FROM righe_bolla WHERE bolla_id = ? AND societa_id = ?', 
      [bollaId, societaId]
    );
    await db.promise().query(
      'DELETE FROM bolle WHERE id = ? AND societa_id = ?', 
      [bollaId, societaId]
    );

    res.redirect('/storico-bolle');
  } catch (err) {
    console.error('Errore eliminazione bolla:', err);
    res.status(500).send('Errore durante l\'eliminazione');
  }
});

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
      .text(`${cliente.ragionesociale ||cliente.nome || '' }`, 55, y + 20)
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
    const textTopMargin = 3; // Margine superiore per il texto

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
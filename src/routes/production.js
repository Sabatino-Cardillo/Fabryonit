const express = require('express');
const router = express.Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Funzione di ordinamento alfabetico con numeri
function ordinaAlfabeticoConNumeri(a, b) {
  const codiceA = a.codice_articolo || '';
  const codiceB = b.codice_articolo || '';
  
  function estraiNumeri(str) {
    const match = str.match(/\d+/g);
    return match ? parseInt(match.join('')) : 0;
  }
  
  function estraiTesto(str) {
    return (str || '').replace(/\d+/g, '').trim();
  }
  
  const testoA = estraiTesto(codiceA);
  const testoB = estraiTesto(codiceB);
  const numeriA = estraiNumeri(codiceA);
  const numeriB = estraiNumeri(codiceB);
  
  if (testoA < testoB) return -1;
  if (testoA > testoB) return 1;
  return numeriA - numeriB;
}

// Route principale
router.get('/', (req, res) => {
  const oggi = new Date();
  const yyyy = oggi.getFullYear();
  const mm = String(oggi.getMonth() + 1).padStart(2, '0');
  const meseCorrente = `${yyyy}-${mm}`;
  
  res.render('conteggio-produzione', {
    nomeUtente: req.session?.ragioneSociale || req.session?.username || 'Utente',
    meseCorrente: meseCorrente,
    userId: req.session?.userId,
    societaId: req.session?.societaId
  });
});

// API: Ottieni lista clienti per il dropdown
router.get('/api/clienti', (req, res) => {
  const societaId = req.session.societaId;
  
  if (!societaId) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  
  const query = `SELECT id, ragionesociale FROM clienti WHERE societa_id = ? ORDER BY ragionesociale`;
  
  db.query(query, [societaId], (err, results) => {
    if (err) {
      console.error('Errore DB clienti:', err);
      return res.status(500).json({ error: 'Errore database' });
    }
    res.json(results);
  });
});

// API: Ottieni dati produzione per mese e cliente
router.get('/api/produzione/:mese/:clienteId?', (req, res) => {
  const { mese, clienteId } = req.params;
  const societaId = req.session.societaId;
  
  if (!societaId) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  let query = `SELECT * FROM produzione WHERE societa_id = ? AND mese = ?`;
  const params = [societaId, mese];

  // Se clienteId è 'tutti' o non specificato, non filtriamo per cliente
  if (clienteId && clienteId !== 'tutti' && clienteId !== 'undefined' && clienteId !== 'null') {
    query += ` AND cliente_id = ?`;
    params.push(clienteId);
  }
  // Altrimenti (clienteId = 'tutti' o null/undefined) mostriamo tutto
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Errore DB produzione:', err);
      return res.status(500).json({ error: 'Errore database' });
    }
    
    const parsedResults = results.map(row => {
      let quantita = [];
      try {
        quantita = row.quantita ? JSON.parse(row.quantita) : [];
      } catch (e) {
        quantita = [];
      }
      
      const totale = quantita.reduce((sum, qty) => sum + (parseInt(qty) || 0), 0);
      
      return {
        id: row.id,
        codice_articolo: row.codice_articolo,
        descrizione: row.descrizione,
        quantita: quantita,
        totale: totale,
        note: row.note,
        cliente_id: row.cliente_id
      };
    });
    
    parsedResults.sort(ordinaAlfabeticoConNumeri);
    
    res.json(parsedResults);
  });
});

// API: Salva una riga di produzione
router.post('/api/produzione/righe', (req, res) => {
  const { codice, descrizione, mese, quantita, note, riga_id, cliente_id } = req.body;
  const societaId = req.session.societaId;
  
  if (!societaId) {
    return res.status(401).json({ success: false, message: 'Non autorizzato' });
  }
  
  if (!mese) {
    return res.status(400).json({ success: false, message: 'Mese non specificato' });
  }
  
  if (!codice || !descrizione) {
    return res.status(400).json({ success: false, message: 'Codice e descrizione sono obbligatori' });
  }
  
  // Se cliente_id non è fornito, lo impostiamo a NULL
  let clienteDaSalvare = cliente_id || null;
  
  let quantitaPulite = Array.isArray(quantita) ? [...quantita] : [];
  
  while (quantitaPulite.length > 0 && (quantitaPulite[quantitaPulite.length - 1] === 0 || 
         quantitaPulite[quantitaPulite.length - 1] === null || 
         quantitaPulite[quantitaPulite.length - 1] === undefined)) {
    quantitaPulite.pop();
  }
  
  quantitaPulite = quantitaPulite.map(q => parseInt(q) || 0);
  
  const totaleRiga = quantitaPulite.reduce((sum, qty) => sum + qty, 0);
  
  if (riga_id) {
    const query = `UPDATE produzione 
                   SET codice_articolo = ?, descrizione = ?, quantita = ?, note = ?, cliente_id = ?, data_aggiornamento = NOW() 
                   WHERE id = ? AND societa_id = ?`;
    
    db.query(query, [codice, descrizione, JSON.stringify(quantitaPulite), note, clienteDaSalvare, riga_id, societaId], (err, result) => {
      if (err) {
        console.error('Errore update produzione:', err);
        return res.status(500).json({ success: false, message: 'Errore salvataggio: ' + err.message });
      }
      
      res.json({ 
        success: true, 
        message: 'Riga aggiornata', 
        riga_id,
        totale: totaleRiga
      });
    });
  } else {
    const query = `INSERT INTO produzione (societa_id, cliente_id, codice_articolo, descrizione, mese, quantita, note, data_creazione) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
    
    db.query(query, [societaId, clienteDaSalvare, codice, descrizione, mese, JSON.stringify(quantitaPulite), note], (err, result) => {
      if (err) {
        console.error('Errore insert produzione:', err);
        return res.status(500).json({ success: false, message: 'Errore salvataggio: ' + err.message });
      }
      
      res.json({ 
        success: true, 
        message: 'Riga salvata', 
        riga_id: result.insertId,
        totale: totaleRiga
      });
    });
  }
});

// API: Elimina una riga
router.delete('/api/produzione/righe/:id', (req, res) => {
  const { id } = req.params;
  const societaId = req.session.societaId;
  
  if (!societaId) {
    return res.status(401).json({ success: false, message: 'Non autorizzato' });
  }
    
  const query = `DELETE FROM produzione WHERE id = ? AND societa_id = ?`;
  
  db.query(query, [id, societaId], (err, result) => {
    if (err) {
      console.error('Errore delete produzione:', err);
      return res.status(500).json({ success: false, message: 'Errore eliminazione' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Riga non trovata' });
    }
    
    res.json({ success: true, message: 'Riga eliminata' });
  });
});

// ESPORTAZIONE EXCEL (INVARIATO)
router.get('/export-produzione/excel/:mese/:clienteId?', async (req, res) => {
  const { mese, clienteId } = req.params;
  const societaId = req.session.societaId;
  const nomeSocieta = req.session.ragioneSociale || 'Società';
  
  if (!societaId) {
    return res.status(401).send('Non autorizzato');
  }
  
  try {
    let query = `SELECT p.*, c.ragionesociale as nome_cliente 
                 FROM produzione p
                 LEFT JOIN clienti c ON p.cliente_id = c.id
                 WHERE p.societa_id = ? AND p.mese = ?`;
    const params = [societaId, mese];

    let nomeClienteTitolo = '';
    let nomeClienteFile = '';
    
    if (clienteId && clienteId !== 'tutti' && clienteId !== 'undefined' && clienteId !== 'null') {
      query += ` AND p.cliente_id = ?`;
      params.push(clienteId);
      
      // Recupera il nome del cliente per il titolo
      const clienteQuery = `SELECT ragionesociale FROM clienti WHERE id = ? AND societa_id = ?`;
      const clienteResult = await new Promise((resolve, reject) => {
        db.query(clienteQuery, [clienteId, societaId], (err, results) => {
          if (err) reject(err);
          else resolve(results[0]?.ragionesociale || 'Cliente');
        });
      });
      nomeClienteTitolo = ` - ${clienteResult}`;
      nomeClienteFile = `-${clienteResult.replace(/[^a-z0-9]/gi, '_')}`;
    } else if (clienteId === 'tutti') {
      nomeClienteTitolo = ' - TUTTI I CLIENTI';
      nomeClienteFile = '-Tutti';
    }
    
    db.query(query, params, async (err, results) => {
      if (err) {
        console.error('Errore DB produzione per Excel:', err);
        return res.status(500).send('Errore database');
      }
      
      if (results.length === 0) {
        return res.status(404).send('Nessun dato trovato per questo mese e cliente');
      }
      
      results.sort(ordinaAlfabeticoConNumeri);
      
      let maxQuantita = 0;
      const righeParseate = results.map(row => {
        let quantita = [];
        try {
          quantita = row.quantita ? JSON.parse(row.quantita) : [];
        } catch (e) {
          quantita = [];
        }
        
        if (quantita.length > maxQuantita) {
          maxQuantita = quantita.length;
        }
        
        const totaleRiga = quantita.reduce((sum, q) => sum + (parseInt(q) || 0), 0);
        
        return {
          ...row,
          quantita: quantita,
          totale: totaleRiga
        };
      });
      
      const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Produzione');
      
      // Titolo con nome del cliente (ALL'INTERNO DEL FILE)
      const totalCols = 2 + maxQuantita + 2;
      const mergeRange = `A1:${String.fromCharCode(65 + totalCols - 1)}1`;
      worksheet.mergeCells(mergeRange);
      
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `CONTEGGIO PRODUZIONE - ${nomeSocieta} - ${mese}${nomeClienteTitolo}`;
      titleCell.font = { size: 16, bold: true };
      titleCell.alignment = { horizontal: 'center' };
      
      // Intestazioni dinamiche
      const headers = ['CODICE', 'DESCRIZIONE'];
      for (let i = 1; i <= maxQuantita; i++) {
        headers.push(`Q${i}`);
      }
      headers.push('TOTALE RIGA', 'PREZZO');
      
      worksheet.addRow(headers);
      
      // Formatta intestazioni
      const headerRow = worksheet.getRow(2);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2E75B6' }
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.height = 25;
      
      // Dati
      let rowIndex = 3;
      let totaleGenerale = 0;
      
      righeParseate.forEach((row, index) => {
        const quantita = row.quantita || [];
        
        const dataRow = [row.codice_articolo || '', row.descrizione || ''];
        
        for (let i = 0; i < maxQuantita; i++) {
          dataRow.push(i < quantita.length ? quantita[i] : '');
        }
        
        const totaleRiga = row.totale || 0;
        totaleGenerale += totaleRiga;
        
        dataRow.push(totaleRiga, row.note || '');
        worksheet.addRow(dataRow);
        
        const currentRow = worksheet.getRow(rowIndex);
        if (index % 2 === 0) {
          currentRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
          };
        }
        
        for (let i = 2; i < 2 + maxQuantita; i++) {
          const cell = currentRow.getCell(i + 1);
          if (cell.value !== '') {
            cell.numFmt = '0';
            cell.alignment = { horizontal: 'center' };
          }
        }
        
        const totalCell = currentRow.getCell(2 + maxQuantita + 1);
        totalCell.font = { bold: true };
        totalCell.numFmt = '0';
        totalCell.alignment = { horizontal: 'center' };
        
        rowIndex++;
      });
      
      // Riga totale generale
      worksheet.addRow([]);
      const totalRowArray = ['', 'TOTALE GENERALE'];
      for (let i = 0; i < maxQuantita; i++) {
        totalRowArray.push('');
      }
      totalRowArray.push(totaleGenerale, '');
      
      const totalRow = worksheet.addRow(totalRowArray);
      totalRow.font = { bold: true, size: 12 };
      totalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD4EDDA' }
      };
      totalRow.alignment = { horizontal: 'center' };
      
      // Footer con timestamp
      worksheet.addRow([]);
      const footerRow = worksheet.addRow(['', `Esportato il: ${new Date().toLocaleString('it-IT')}`]);
      footerRow.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
      footerRow.getCell(1).alignment = { horizontal: 'right' };
      
      // Auto-adjust column widths
      worksheet.columns.forEach((column, i) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        
        if (i === 0) column.width = 15;
        else if (i === 1) column.width = 30;
        else if (i < 2 + maxQuantita) column.width = 8;
        else if (i === 2 + maxQuantita) column.width = 12;
        else column.width = 25;
      });
      
      // Imposta response headers (nome file SENZA il nome del cliente)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=produzione-${mese}${nomeClienteFile}-${timestamp}.xlsx`);
      
      await workbook.xlsx.write(res);
      res.end();
    });
  } catch (error) {
    console.error('Errore generazione Excel:', error);
    res.status(500).send('Errore generazione Excel');
  }
});

// ESPORTAZIONE PDF (MODIFICATO: mostra solo il totale riga, non le singole quantità)
router.get('/export-produzione/pdf/:mese/:clienteId?', (req, res) => {
  const { mese, clienteId } = req.params;
  const societaId = req.session.societaId;
  const nomeSocieta = req.session.ragioneSociale || 'Società';
  
  if (!societaId) {
    return res.status(401).send('Non autorizzato');
  }
  
  let query = `SELECT p.*, c.ragionesociale as nome_cliente 
               FROM produzione p
               LEFT JOIN clienti c ON p.cliente_id = c.id
               WHERE p.societa_id = ? AND p.mese = ?`;
  const params = [societaId, mese];

  let nomeClienteTitolo = '';
  
  if (clienteId && clienteId !== 'tutti' && clienteId !== 'undefined' && clienteId !== 'null') {
    query += ` AND p.cliente_id = ?`;
    params.push(clienteId);
  } else if (clienteId === 'tutti') {
    nomeClienteTitolo = ' - TUTTI I CLIENTI';
  }
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Errore DB produzione per PDF:', err);
      return res.status(500).send('Errore database');
    }
    
    if (results.length === 0) {
      return res.status(404).send('Nessun dato trovato per questo mese');
    }
    
    // Prendiamo il nome del cliente dal primo risultato (se disponibile)
    if (results[0]?.nome_cliente && clienteId !== 'tutti') {
      nomeClienteTitolo = ` - ${results[0].nome_cliente}`;
    }
    
    results.sort(ordinaAlfabeticoConNumeri);
    
    // Calcoliamo il totale per ogni riga (SOMMA di tutte le quantità)
    const righeConTotali = results.map(row => {
      let quantita = [];
      try {
        quantita = row.quantita ? JSON.parse(row.quantita) : [];
      } catch (e) {
        quantita = [];
      }
      
      const totaleRiga = quantita.reduce((sum, q) => sum + (parseInt(q) || 0), 0);
      
      return {
        codice_articolo: row.codice_articolo,
        descrizione: row.descrizione,
        totale: totaleRiga,
        note: row.note
      };
    });
    
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    
    // Layout sempre portrait (verticale) perché abbiamo solo 4 colonne
    const doc = new PDFDocument({ 
      margin: 40, 
      size: 'A4', 
      layout: 'portrait',
      info: {
        Title: `Produzione ${mese}${nomeClienteTitolo}`,
        Author: nomeSocieta,
        Creator: 'Salmax Sistema'
      }
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=produzione-${mese}-${timestamp}.pdf`);
    
    doc.pipe(res);
    
    const colorHeader = '#2E75B6';
    const colorHeaderText = '#FFFFFF';
    const colorRowEven = '#F8F9FA';
    const colorRowOdd = '#FFFFFF';
    const colorTotal = '#D4EDDA';
    const textColor = '#000000';
    
    // Titolo con nome del cliente (ALL'INTERNO DEL PDF)
    doc.fillColor(textColor)
       .fontSize(18)
       .font('Helvetica-Bold')
       .text(`CONTEGGIO PRODUZIONE ${nomeClienteTitolo}- ${mese}`, { align: 'center' });
    
    doc.fillColor(textColor)
       .fontSize(14)
       .font('Helvetica')
       .text(`${nomeSocieta} ${nomeClienteTitolo}`, { align: 'center' });
    
    doc.moveDown(0.5);
    
    doc.fillColor('#666666')
       .fontSize(9)
       .font('Helvetica-Oblique')
       .text(`Generato il: ${new Date().toLocaleString('it-IT')}`, { align: 'right' });
    
    doc.moveDown(1);
    
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    
    // Definizione colonne: solo 4 colonne (CODICE, DESCRIZIONE, TOTALE, PREZZO/NOTE)
    const colCodice = 80;
    const colDescrizione = 220;
    const colTotale = 70;
    const colNote = 150;
    
    const tableWidth = colCodice + colDescrizione + colTotale + colNote;
    const tableLeft = doc.page.margins.left + (pageWidth - tableWidth) / 2;
    
    const headerTop = doc.y;
    
    // Intestazione tabella
    doc.fillColor(colorHeader)
       .rect(tableLeft, headerTop, tableWidth, 25)
       .fill();
    
    doc.fillColor(colorHeaderText)
       .fontSize(10)
       .font('Helvetica-Bold');
    
    let xPos = tableLeft;
    
    doc.text('CODICE', xPos + 5, headerTop + 8, { 
      width: colCodice - 10, 
      align: 'center' 
    });
    xPos += colCodice;
    
    doc.text('DESCRIZIONE', xPos + 5, headerTop + 8, { 
      width: colDescrizione - 10, 
      align: 'center' 
    });
    xPos += colDescrizione;
    
    doc.text('Q.TOTALE', xPos + 5, headerTop + 8, { 
      width: colTotale - 10, 
      align: 'center' 
    });
    xPos += colTotale;
    
    doc.text('PREZZO', xPos + 5, headerTop + 8, { 
      width: colNote - 10, 
      align: 'center' 
    });
    
    doc.fillColor('#000000')
       .rect(tableLeft, headerTop + 25, tableWidth, 1)
       .fill();
    
    let yPos = headerTop + 26;
    let totaleGenerale = 0;
    let pageNum = 1;
    
    const drawHeader = (y) => {
      doc.fillColor(colorHeader)
         .rect(tableLeft, y, tableWidth, 25)
         .fill();
      
      doc.fillColor(colorHeaderText)
         .fontSize(10)
         .font('Helvetica-Bold');
      
      let headerX = tableLeft;
      doc.text('CODICE', headerX + 5, y + 8, { 
        width: colCodice - 10, 
        align: 'center' 
      });
      headerX += colCodice;
      
      doc.text('DESCRIZIONE', headerX + 5, y + 8, { 
        width: colDescrizione - 10, 
        align: 'center' 
      });
      headerX += colDescrizione;
      
      doc.text('TOTALE', headerX + 5, y + 8, { 
        width: colTotale - 10, 
        align: 'center' 
      });
      headerX += colTotale;
      
      doc.text('PREZZO', headerX + 5, y + 8, { 
        width: colNote - 10, 
        align: 'center' 
      });
      
      doc.fillColor('#000000')
         .rect(tableLeft, y + 25, tableWidth, 1)
         .fill();
      
      return y + 26;
    };
    
    righeConTotali.forEach((row, index) => {
      // Controllo se serve nuova pagina
      if (yPos > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage({ 
          size: 'A4', 
          layout: 'portrait', 
          margin: 40 
        });
        
        pageNum++;
        doc.fillColor('#666666')
           .fontSize(8)
           .font('Helvetica-Oblique')
           .text(`Pagina ${pageNum}`, doc.page.width - doc.page.margins.right - 30, doc.page.margins.top);
        
        yPos = drawHeader(doc.page.margins.top);
      }
      
      const rowColor = index % 2 === 0 ? colorRowEven : colorRowOdd;
      doc.fillColor(rowColor)
         .rect(tableLeft, yPos, tableWidth, 20)
         .fill();
      
      const totaleRiga = row.totale || 0;
      totaleGenerale += totaleRiga;
      
      doc.fillColor(textColor)
         .fontSize(9)
         .font('Helvetica');
      
      let cellX = tableLeft;
      
      // CODICE
      doc.text(row.codice_articolo || '', cellX + 5, yPos + 6, { 
        width: colCodice - 10, 
        align: 'left' 
      });
      cellX += colCodice;
      
      // DESCRIZIONE
      doc.text(row.descrizione || '', cellX + 5, yPos + 6, { 
        width: colDescrizione - 10, 
        align: 'center' 
      });
      cellX += colDescrizione;
      
      // TOTALE (in grassetto)
      doc.font('Helvetica-Bold')
         .text(totaleRiga.toString(), cellX + 5, yPos + 6, { 
           width: colTotale - 10, 
           align: 'center' 
         });
      cellX += colTotale;
      
      // PREZZO (NOTE)
      doc.font('Helvetica')
         .text(row.note || '', cellX + 5, yPos + 6, { 
           width: colNote - 10, 
           align: 'center' 
         });
      
      // Linea separatrice
      doc.strokeColor('#DDDDDD')
         .lineWidth(0.3)
         .moveTo(tableLeft, yPos + 20)
         .lineTo(tableLeft + tableWidth, yPos + 20)
         .stroke();
      
      yPos += 20;
    });
    
    // Linea finale sopra il totale
    doc.strokeColor('#000000')
       .lineWidth(0.5)
       .moveTo(tableLeft, yPos)
       .lineTo(tableLeft + tableWidth, yPos)
       .stroke();
    
    yPos += 5;
    
    // Riga totale generale
    doc.fillColor(colorTotal)
       .rect(tableLeft, yPos, tableWidth, 25)
       .fill();
    
    doc.fillColor(textColor)
       .fontSize(10)
       .font('Helvetica-Bold');
    
    doc.text('TOTALE GENERALE PRODUZIONE', tableLeft + 5, yPos + 8, { 
      width: colCodice + colDescrizione - 10, 
      align: 'right' 
    });
    
    const totalX = tableLeft + colCodice + colDescrizione;
    doc.text(totaleGenerale.toString(), totalX + 5, yPos + 8, { 
      width: colTotale - 10, 
      align: 'center' 
    });
    
    yPos += 30;
    
    // Footer con timestamp
    doc.fillColor('#666666')
       .fontSize(8)
       .font('Helvetica-Oblique')
       .text(`Documento generato il ${new Date().toLocaleString('it-IT')}`, 
             tableLeft, yPos, { width: tableWidth, align: 'right' });
    
    doc.end();
  });
});

module.exports = router;
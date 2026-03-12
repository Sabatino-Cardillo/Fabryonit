// backup-manager.js VERSIONE MIGLIORATA
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class BackupManager {
  constructor(dbConfig) {
    this.dbConfig = dbConfig;
    this.backupDir = path.join(app.getPath('userData'), 'backup');
    this.logFile = path.join(app.getPath('userData'), 'backup-log.txt');
    this.initBackupDirectory();
  }

  initBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
    this.log(`📁 Directory backup: ${this.backupDir}`);
  }

  getFormattedDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
      fs.appendFileSync(this.logFile, logMessage);
      console.log(message);
    } catch (error) {
      console.error('Errore scrittura log:', error);
    }
  }

  // Funzione per escape dei valori SQL
  escapeValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') return value.toString();
    
    // Escape stringhe per SQL
    return `'${String(value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\x00/g, '\\0')
      .replace(/\x1a/g, '\\Z')}'`;
  }

  async createBackup() {
    const datetime = this.getFormattedDateTime();
    const filename = `backup_${datetime}.sql`;
    const filepath = path.join(this.backupDir, filename);

    this.log(`🔄 Inizio backup: ${filename}`);

    try {
      // Crea connessione al database
      const connection = await mysql.createConnection({
        host: this.dbConfig.host,
        user: this.dbConfig.user,
        password: this.dbConfig.password,
        database: this.dbConfig.database,
        charset: 'utf8mb4',
        multipleStatements: true
      });

      let backupContent = '';
      
      // 1. INTESTAZIONE IMPORTANTE
      backupContent += '/*\n';
      backupContent += ' * MySQL Backup\n';
      backupContent += ` * Database: ${this.dbConfig.database}\n`;
      backupContent += ` * Generated: ${new Date().toISOString()}\n`;
      backupContent += ` * Host: ${this.dbConfig.host}\n`;
      backupContent += ' * Import with: mysql -u username -p database_name < file.sql\n';
      backupContent += ' */\n\n';
      
      // 2. DISABILITA CHECKS ALL'INIZIO
      backupContent += '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n';
      backupContent += '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;\n';
      backupContent += '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;\n';
      backupContent += '/*!40101 SET NAMES utf8mb4 */;\n';
      backupContent += '/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;\n';
      backupContent += '/*!40103 SET TIME_ZONE=\'+00:00\' */;\n';
      backupContent += '/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;\n';
      backupContent += '/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;\n';
      backupContent += '/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE=\'NO_AUTO_VALUE_ON_ZERO\' */;\n';
      backupContent += '/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;\n\n';
      
      // 3. Crea istruzione DROP/CREATE DATABASE
      backupContent += `--\n-- Crea il database se non esiste\n--\n`;
      backupContent += `DROP DATABASE IF EXISTS \`${this.dbConfig.database}\`;\n`;
      backupContent += `CREATE DATABASE \`${this.dbConfig.database}\` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;\n`;
      backupContent += `USE \`${this.dbConfig.database}\`;\n\n`;

      // 4. Ottieni tutte le tabelle
      const [tables] = await connection.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [this.dbConfig.database]
      );

      // Prima: esporta struttura di tutte le tabelle
      for (const table of tables) {
        const tableName = table.TABLE_NAME;
        
        // Ottieni struttura della tabella
        const [createTable] = await connection.query(
          `SHOW CREATE TABLE \`${tableName}\``
        );
        
        backupContent += `--\n-- Struttura della tabella \`${tableName}\`\n--\n\n`;
        backupContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
        backupContent += createTable[0]['Create Table'] + ';\n\n';
      }

      // Poi: esporta dati di tutte le tabell (con batch più piccoli)
      for (const table of tables) {
        const tableName = table.TABLE_NAME;
        
        // Ottieni i dati della tabella (a batch per evitare memory issues)
        let offset = 0;
        const batchSize = 1000;
        let hasData = false;
        
        backupContent += `--\n-- Dump dei dati della tabella \`${tableName}\`\n--\n\n`;
        
        while (true) {
          const [rows] = await connection.query(
            `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
            [batchSize, offset]
          );
          
          if (rows.length === 0) break;
          
          if (!hasData) {
            hasData = true;
            // Ottieni i nomi delle colonne
            const [columns] = await connection.query(
              `DESCRIBE \`${tableName}\``
            );
            const columnNames = columns.map(col => `\`${col.Field}\``).join(', ');
            
            backupContent += `INSERT INTO \`${tableName}\` (${columnNames}) VALUES\n`;
          }
          
          // Processa i dati in batch più piccoli per INSERT
          const batchInsertSize = 50;
          for (let i = 0; i < rows.length; i += batchInsertSize) {
            const batch = rows.slice(i, i + batchInsertSize);
            
            const values = batch.map(row => {
              const rowValues = Object.values(row).map(val => this.escapeValue(val));
              return `  (${rowValues.join(', ')})`;
            });
            
            backupContent += values.join(',\n');
            
            if (i + batchInsertSize < rows.length) {
              backupContent += ',\n';
            } else if (offset + rows.length >= await this.getTableCount(connection, tableName)) {
              backupContent += ';\n\n';
            } else {
              backupContent += ',\n';
            }
          }
          
          offset += rows.length;
          
          // Log progress
          this.log(`  📊 Tabella ${tableName}: esportati ${offset} record`);
        }
        
        if (!hasData) {
          backupContent += `-- Tabella \`${tableName}\` vuota\n\n`;
        }
      }

      // 5. RIABILITA I CHECKS ALLA FINE
      backupContent += '\n--\n-- Ripristino impostazioni originali\n--\n';
      backupContent += '/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;\n';
      backupContent += '/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;\n';
      backupContent += '/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;\n';
      backupContent += '/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;\n';
      backupContent += '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;\n';
      backupContent += '/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;\n';
      backupContent += '/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;\n';
      backupContent += '/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;\n';
      backupContent += '\n-- Fine backup\n';

      // Chiudi connessione
      await connection.end();

      // Salva file con encoding UTF-8
      fs.writeFileSync(filepath, backupContent, { encoding: 'utf8', flag: 'w' });

      const stats = fs.statSync(filepath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      this.log(`✅ Backup completato: ${filename} (${sizeMB} MB)`);
      
      return filepath;

    } catch (error) {
      this.log(`❌ ERRORE backup: ${error.message}`);
      throw error;
    }
  }

  async getTableCount(connection, tableName) {
    const [result] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    return result[0].count;
  }

  // Metodo per testare il file di backup
  async testBackupImport(backupFile) {
    try {
      // Leggi il file
      const content = fs.readFileSync(backupFile, 'utf8');
      
      // Verifica che contenga le dichiarazioni necessarie
      const checks = {
        hasDatabaseDrop: content.includes('DROP DATABASE'),
        hasDatabaseCreate: content.includes('CREATE DATABASE'),
        hasUseDatabase: content.includes('USE '),
        hasTableCreations: content.includes('CREATE TABLE'),
        hasInsertStatements: content.includes('INSERT INTO'),
        hasEndingRestore: content.includes('SET FOREIGN_KEY_CHECKS')
      };
      
      this.log(`🔍 Test file backup ${backupFile}:`);
      Object.entries(checks).forEach(([key, value]) => {
        this.log(`  ${value ? '✓' : '✗'} ${key}`);
      });
      
      return checks;
      
    } catch (error) {
      this.log(`❌ Errore test backup: ${error.message}`);
      return null;
    }
  }

  // Backup sincrono (usa async/await invece di execSync)
  async createBackupSync() {
    try {
      return await this.createBackup();
    } catch (error) {
      this.log(`❌ ERRORE backup sincrono: ${error.message}`);
      throw error;
    }
  }

  // Pulisce i backup mantenendo solo gli ultimi N (silenzioso)
  cleanOldBackups(keepCount = 20) {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          time: fs.statSync(path.join(this.backupDir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Ordina dal più recente

      const totalBackups = files.length;

      if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        toDelete.forEach(file => {
          fs.unlinkSync(file.path);
        });
        this.log(`🧹 Pulizia backup: eliminati ${toDelete.length} vecchi backup (totale: ${totalBackups} → ${keepCount})`);
      } else {
        this.log(`✓ Pulizia backup: nessun backup da eliminare (totale: ${totalBackups})`);
      }
    } catch (error) {
      this.log(`❌ ERRORE pulizia backup: ${error.message}`);
    }
  }

  // Ottiene statistiche sui backup
  getBackupStats() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
        .map(file => ({
          name: file,
          size: fs.statSync(path.join(this.backupDir, file)).size,
          date: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.date - a.date);
      
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
      
      const stats = {
        totalBackups: files.length,
        totalSizeMB: totalSizeMB,
        backupDir: this.backupDir,
        lastBackup: files.length > 0 ? files[0].name : 'Nessuno',
        lastBackupDate: files.length > 0 ? files[0].date.toLocaleString('it-IT') : 'N/A'
      };
      
      this.log(`📊 Statistiche backup: ${stats.totalBackups} backup, ${stats.totalSizeMB} MB totali`);
      return stats;
    } catch (error) {
      this.log(`❌ ERRORE statistiche: ${error.message}`);
      return { error: error.message };
    }
  }
}

module.exports = BackupManager;
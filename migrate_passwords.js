const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// ⚠️ IMPORTANTE: Inserisci qui i dati del tuo database (guarda in db.js)
const dbConfig = {
    host: 'mysql-jemaka.alwaysdata.net',
    user: 'jemaka',
    password: 'Saba270704!', // ⚠️ INSERISCI LA PASSWORD DEL DATABASE QUI
    database: 'jemaka_salmax'
};

async function migratePasswords() {
    let connection;
    
    try {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   🔐 MIGRAZIONE PASSWORD - BCRYPT     ║');
        console.log('╚════════════════════════════════════════╝\n');
        
        // Verifica configurazione
        console.log('📋 Configurazione Database:');
        console.log('   Host:', dbConfig.host);
        console.log('   User:', dbConfig.user);
        console.log('   Database:', dbConfig.database);
        console.log('   Password:', dbConfig.password ? '✅ Impostata' : '❌ MANCANTE!');
        
        if (!dbConfig.password) {
            console.error('\n❌ ERRORE: Password del database non impostata!');
            console.error('   Apri db.js e copia la password in migrate_passwords.js');
            process.exit(1);
        }
        
        console.log('\n🔄 Connessione al database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connessione riuscita!\n');
        
        // 1️⃣ Migra password ADMIN
        console.log('═══════════════════════════════════════');
        console.log('📋 MIGRAZIONE PASSWORD ADMIN');
        console.log('═══════════════════════════════════════');
        
        const [admins] = await connection.query('SELECT id, username, password FROM admin');
        console.log(`   Trovati ${admins.length} amministratori\n`);
        
        for (const admin of admins) {
            console.log(`👤 Admin: ${admin.username}`);
            console.log(`   ID: ${admin.id}`);
            console.log(`   Password attuale: ${admin.password.substring(0, 20)}...`);
            
            // Verifica se la password è già hashata
            if (admin.password.startsWith('$2b$')) {
                console.log('   ⏭️  Già hashata - SKIP\n');
                continue;
            }
            
            // Cripta la password
            console.log('   🔄 Crittografia in corso...');
            const hashedPassword = await bcrypt.hash(admin.password, 10);
            
            await connection.query(
                'UPDATE admin SET password = ? WHERE id = ?',
                [hashedPassword, admin.id]
            );
            
            console.log(`   ✅ Password migrata!`);
            console.log(`   Nuovo hash: ${hashedPassword.substring(0, 30)}...\n`);
        }
        
        // 2️⃣ Migra password SOCIETÀ
        console.log('═══════════════════════════════════════');
        console.log('📋 MIGRAZIONE PASSWORD SOCIETÀ');
        console.log('═══════════════════════════════════════');
        
        const [societa] = await connection.query('SELECT id, username, ragione_sociale, password FROM societa');
        console.log(`   Trovate ${societa.length} società\n`);
        
        for (const soc of societa) {
            console.log(`🏢 Società: ${soc.ragione_sociale}`);
            console.log(`   Username: ${soc.username}`);
            console.log(`   ID: ${soc.id}`);
            console.log(`   Password attuale: ${soc.password.substring(0, 20)}...`);
            
            // Verifica se la password è già hashata
            if (soc.password.startsWith('$2b$')) {
                console.log('   ⏭️  Già hashata - SKIP\n');
                continue;
            }
            
            // Cripta la password
            console.log('   🔄 Crittografia in corso...');
            const hashedPassword = await bcrypt.hash(soc.password, 10);
            
            await connection.query(
                'UPDATE societa SET password = ? WHERE id = ?',
                [hashedPassword, soc.id]
            );
            
            console.log(`   ✅ Password migrata!`);
            console.log(`   Nuovo hash: ${hashedPassword.substring(0, 30)}...\n`);
        }
        
        console.log('═══════════════════════════════════════');
        console.log('✅ MIGRAZIONE COMPLETATA CON SUCCESSO!');
        console.log('═══════════════════════════════════════\n');
        
        console.log('📝 Riepilogo:');
        console.log(`   • ${admins.length} amministratori processati`);
        console.log(`   • ${societa.length} società processate`);
        console.log('   • Tutte le password sono ora criptate con bcrypt\n');
        
        console.log('⚠️  IMPORTANTE:');
        console.log('   • Gli utenti useranno le STESSE password di prima');
        console.log('   • Le password sono solo criptate nel database');
        console.log('   • Ora puoi riavviare il server: npm start\n');
        
    } catch (error) {
        console.error('\n╔════════════════════════════════════════╗');
        console.error('║   ❌ ERRORE DURANTE LA MIGRAZIONE     ║');
        console.error('╚════════════════════════════════════════╝\n');
        
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('❌ Accesso negato al database!');
            console.error('   Verifica username e password in migrate_passwords.js');
        } else if (error.code === 'ENOTFOUND') {
            console.error('❌ Host del database non trovato!');
            console.error('   Verifica che l\'host sia corretto');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.error('❌ Database non trovato!');
            console.error('   Verifica il nome del database');
        } else {
            console.error('Dettagli errore:', error.message);
            console.error('Codice errore:', error.code || 'N/A');
        }
        
        console.error('\n💡 Suggerimenti:');
        console.error('   1. Verifica i dati in db.js');
        console.error('   2. Copia la password corretta in migrate_passwords.js');
        console.error('   3. Verifica la connessione al database');
        console.error('   4. Assicurati che bcrypt sia installato: npm install bcrypt\n');
        
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Connessione chiusa');
        }
    }
}

// Verifica dipendenze prima di iniziare
console.log('🔍 Verifica dipendenze...\n');

try {
    require('bcrypt');
    console.log('✅ bcrypt installato');
} catch (e) {
    console.error('❌ bcrypt NON installato!');
    console.error('   Esegui: npm install bcrypt\n');
    process.exit(1);
}

try {
    require('mysql2/promise');
    console.log('✅ mysql2 installato\n');
} catch (e) {
    console.error('❌ mysql2 NON installato!');
    console.error('   Esegui: npm install mysql2\n');
    process.exit(1);
}

// Esegui la migrazione
migratePasswords();
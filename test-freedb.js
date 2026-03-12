const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'sql.freedb.tech',
    user: 'freedb_sabatino',  // ⚙️ Sostituisci con il tuo
    password: '6w3&U&n?Wd7%Hps',
    database: 'freedb_salmax',
    port: 3306,
    connectTimeout: 10000
});

console.log('🔌 Connessione a FreedDB in corso...\n');

db.connect((err) => {
    if (err) {
        console.error('❌ ERRORE:', err.message);
        console.error('Codice:', err.code);
        process.exit(1);
    }
    
    console.log('✅ CONNESSO A FREEDB!\n');
    console.log('📊 Database:', db.config.database);
    console.log('🌐 Host:', db.config.host);
    console.log('👤 User:', db.config.user);
    
    // Test query
    db.query('SELECT VERSION() as version', (err, results) => {
        if (err) {
            console.error('❌ Query fallita:', err);
        } else {
            console.log('\n✅ Test Query OK!');
            console.log('MySQL Version:', results[0].version);
        }
        
        db.end();
        console.log('\n🔌 Disconnesso');
    });
});
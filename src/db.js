
const mysql = require('mysql2');
const connection = mysql.createConnection({
    host: 'mysql-jemaka.alwaysdata.net',
    user: 'jemaka',
    password: 'Saba270704!',
    database: 'jemaka_salmax'
});
module.exports = connection;

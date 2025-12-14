const fs = require('fs');
const key = fs.readFileSync('./blood-donate-9b62a.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)
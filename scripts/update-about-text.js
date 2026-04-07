const fs = require('fs');
const path = require('path');
const dataPath = path.join(__dirname, 'scripts', 'update-about-data.json');
const updates = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const langDir = path.join(__dirname, 'lang');
for (const [lang, newValues] of Object.entries(updates)) {
    const filePath = path.join(langDir, lang + '.json');
    if (!fs.existsSync(filePath)) { console.log('SKIP: ' + lang); continue; }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let changed = 0;
    for (const [key, val] of Object.entries(newValues)) {
        if (data[key] !== val) { data[key] = val; changed++; }
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
    console.log(lang + '.json: ' + changed + ' keys updated');
}
console.log('Done.');

// Script to translate all Macedonian genres in bands.json to English
// and generate a changelog markdown file
const fs = require('fs');
const path = require('path');

const genreMap = {
  'Поп': 'Pop',
  'Рок': 'Rock',
  'Метал': 'Metal',
  'Рап': 'Rap',
  'Алтернативен Рок': 'Alternative Rock',
  'Џез': 'Jazz',
  'Панк': 'Punk',
  'Инди': 'Indie',
  'Трап': 'Trap',
  'Пост-панк': 'Post-Punk',
  'Електронска': 'Electronic',
  'Етно': 'Ethno',
  'Фолк': 'Folk',
  'Панк Рок': 'Punk Rock',
  'Хип Хоп': 'Hip Hop',
  'Фанк': 'Funk',
  'Треш Метал': 'Thrash Metal',
  'Блуз': 'Blues',
  'Експериментална': 'Experimental',
  'Хардкор': 'Hardcore',
  'Поп-Рок': 'Pop Rock',
  'Пост-рок': 'Post-Rock',
  'Инди Рок': 'Indie Rock',
  'Експериментален Рок': 'Experimental Rock',
  'Хеви Метал': 'Heavy Metal',
  'Шугејз': 'Shoegaze',
  'Алтернативна': 'Alternative',
  'Металкор': 'Metalcore',
  'Дет Метал': 'Death Metal',
  'Синтвејв': 'Synthwave',
  'Стонер Рок': 'Stoner Rock',
  'Амбиентална': 'Ambient',
  'Емо': 'Emo',
  'Акустична': 'Acoustic',
  'Џез Фјужн': 'Jazz Fusion',
  'Прогресивен Рок': 'Progressive Rock',
  'Ска': 'Ska',
  'Реге': 'Reggae',
  'Гранџ': 'Grunge',
  'Шлагер': 'Schlager',
  'Дарк Вејв': 'Darkwave',
  'Готик Рок': 'Gothic Rock',
  'Соул': 'Soul',
  'Прогресивен Метал': 'Progressive Metal',
  'Треш': 'Thrash',
  'Хаус': 'House',
  'РнБ': 'R&B',
  'Поп-Рап': 'Pop Rap',
  'Трип Хоп': 'Trip Hop',
  'Арт Рок': 'Art Rock',
  'Синт-Поп': 'Synth-Pop',
  'Транс': 'Trance',
  'Техно': 'Techno',
  'Пауер Метал': 'Power Metal',
  'Музика од светот': 'World Music',
  'Рокенрол': 'Rock and Roll',
  'Рокабили': 'Rockabilly',
  'Вејпорвејв': 'Vaporwave',
  'Современа Музика': 'Contemporary Music',
  'Психоделичен Транс': 'Psychedelic Trance',
  'Гоа': 'Goa Trance',
  'Психоделичен Рок': 'Psychedelic Rock',
  'Нојз Рок': 'Noise Rock',
  'Џез Рок': 'Jazz Rock',
  'Ну Метал': 'Nu Metal',
  'Ло-фи': 'Lo-Fi',
  'Брит Рок': 'Britpop',
  'Гараж': 'Garage Rock',
  'Блек Метал': 'Black Metal',
  'Староградска': 'Starogradska',
  'Бум Бап': 'Boom Bap',
  'Мат Рок': 'Math Rock',
  'Авант Фолк': 'Avant-Folk',
  'Експериментален': 'Experimental',
  'Индастриал': 'Industrial',
  'Софт Рок': 'Soft Rock',
  'Поезија': 'Spoken Word',
  'Дрим Поп': 'Dream Pop',
  'Светска Музика': 'World Music',
  'Електро-поп': 'Electropop',
  'Инструментален Рок': 'Instrumental Rock',
  'Нов Бран': 'New Wave',
  'Даб': 'Dub',
  'Њу Рутс': 'New Roots',
  'Кросовер': 'Crossover',
  'Нојз Поп': 'Noise Pop',
  'Пост-Хардкор': 'Post-Hardcore',
  'Трешкор': 'Thrashcore',
  'Електро-амбиентал': 'Electro-Ambient',
  'Фолклор': 'Folklore',
  'Псајдаб': 'Psydub',
  'Псајбас': 'Psybass',
  'Глич': 'Glitch',
  'Чилаут': 'Chillout',
  "Р'н'Б": 'R&B',
  "Р\u2019н\u2019Б": 'R&B',
  'Ацид Џез': 'Acid Jazz',
  'Поп-Фолк': 'Pop Folk',
  'Дарквејв': 'Darkwave',
  'Спид Метал': 'Speed Metal',
  'Краст': 'Crust Punk',
  'Индустриал': 'Industrial',
  'Балканска Трубачка Музика': 'Balkan Brass',
  'Хард Рок': 'Hard Rock',
  'Боса Нова': 'Bossa Nova',
  'Гаражен Панк': 'Garage Punk',
  'Кросовер Треш': 'Crossover Thrash',
  'Слаџ': 'Sludge Metal',
  'Дум Метал': 'Doom Metal',
  'Грув Метал': 'Groove Metal',
  'Џангл Метал': 'Jungle Metal',
  'Драм ен Бас': 'Drum and Bass',
  'Стонер рок': 'Stoner Rock',
  'Сурф': 'Surf Rock',
  'Поп-панк': 'Pop Punk',
  'Инди Поп': 'Indie Pop',
  'Денс': 'Dance',
  'Мет Рок': 'Math Rock',
  'Евергрин': 'Evergreen',
  'Екстремен Метал': 'Extreme Metal',
  'Фјужн': 'Fusion',
  'Фри Џез': 'Free Jazz',
  'Пост-вејв': 'Post-Wave',
  'Фолк Метал': 'Folk Metal',
  'Мелодичен Хардкор': 'Melodic Hardcore',
  'Скримо': 'Screamo',
  'Дезерт Рок': 'Desert Rock',
  'Њу Вејв': 'New Wave',
  'Техникал Дет Метал': 'Technical Death Metal',
  'Дум Рок': 'Doom Rock',
  'Краут': 'Krautrock',
  'Турбо Фолк': 'Turbo Folk'
};

const bandsPath = path.join(__dirname, '..', 'data', 'dynamic', 'editable', 'bands.json');
const data = JSON.parse(fs.readFileSync(bandsPath, 'utf8'));

const changes = [];
let unmapped = new Set();

data.muzickaMasterLista.forEach(band => {
  if (!band.genre || band.genre === 'недостигаат податоци') return;

  const oldGenre = band.genre;
  const genres = oldGenre.split(',').map(g => g.trim()).filter(Boolean);
  const translated = genres.map(g => {
    if (genreMap[g]) return genreMap[g];
    unmapped.add(g);
    return g;
  });

  // Deduplicate (some Macedonian genres map to the same English genre)
  const unique = [...new Set(translated)];
  const newGenre = unique.join(', ');

  if (oldGenre !== newGenre) {
    changes.push({ name: band.name, old: oldGenre, new: newGenre });
    band.genre = newGenre;
  }
});

// Write updated bands.json
fs.writeFileSync(bandsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

// Generate changelog markdown
let md = '# Genre Translation Changelog\n\n';
md += `Date: ${new Date().toISOString().split('T')[0]}\n\n`;
md += `All genres in \`bands.json\` have been translated from Macedonian (Cyrillic) to English.\n\n`;
md += `## Translation Map\n\n`;
md += '| Macedonian | English |\n|---|---|\n';
Object.entries(genreMap).forEach(([mk, en]) => {
  md += `| ${mk} | ${en} |\n`;
});

md += `\n## Artist Changes (${changes.length} artists updated)\n\n`;
md += '| Artist | Old Genre | New Genre |\n|---|---|---|\n';
changes.forEach(c => {
  md += `| ${c.name} | ${c.old} | ${c.new} |\n`;
});

if (unmapped.size > 0) {
  md += `\n## Unmapped Genres\n\nThe following genres were not found in the translation map and were left as-is:\n\n`;
  unmapped.forEach(g => { md += `- ${g}\n`; });
}

const changelogPath = path.join(__dirname, '..', 'genre-translation-changelog.md');
fs.writeFileSync(changelogPath, md, 'utf8');

console.log(`Updated ${changes.length} artists in bands.json`);
console.log(`Changelog written to genre-translation-changelog.md`);
if (unmapped.size > 0) {
  console.log(`WARNING: ${unmapped.size} unmapped genres:`, [...unmapped].join(', '));
}

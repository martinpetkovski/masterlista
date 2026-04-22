<div align="center">

<img src="https://toplista.mk/images/logo.png" alt="MMM Logo" width="172" style="vertical-align: middle; margin-right: 16px;">

</div>

<br>

<div align="center">

[![Верзија](https://img.shields.io/badge/Верзија-v0.4%20БЕТА-1e88e5?style=for-the-badge)](https://toplista.mk)
[![Лиценца](https://img.shields.io/badge/Лиценца-CC%20BY%204.0-4A90E2?style=for-the-badge)](https://creativecommons.org/licenses/by/4.0/)
[![Discord](https://img.shields.io/badge/Discord-Xotel-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/DzBQASu7mU)

[![Issues](https://img.shields.io/github/issues/martinpetkovski/masterlista?style=for-the-badge)](https://github.com/martinpetkovski/masterlista/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/martinpetkovski/masterlista?style=for-the-badge)](https://github.com/martinpetkovski/masterlista/pulls)
[![Contributors](https://img.shields.io/github/contributors/martinpetkovski/masterlista?style=for-the-badge)](https://github.com/martinpetkovski/masterlista/graphs/contributors)
[![Last Commit](https://img.shields.io/github/last-commit/martinpetkovski/masterlista?style=for-the-badge)](https://github.com/martinpetkovski/masterlista/commits/main)

[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-181717?style=for-the-badge&logo=github&logoColor=white)](https://toplista.mk)
[![Deployment](https://img.shields.io/badge/Deployment-GitHub%20Pages-success?style=for-the-badge&logo=github)](https://github.com/martinpetkovski/masterlista/actions/workflows/pages-build-deployment.yml)

</div>

**ТопЛиста.мк** е сајт кој автоматски генерира македонска музичка топ листа. Сајтот содржи и отворена база на македонски музички артисти и бендови. Целта е да се документира и промовира македонската музичка сцена на едно место — од етаблирани имиња до нови таленти.

Проектот е напојуван од заедницата **[Xotel](https://discord.gg/DzBQASu7mU)** и е целосно отворен за придонеси.

---

## Структура на проектот

Канонската локација за сите JSON податоци сега е во `data/`.
Старите root URL-а како `/bands.json` и `/chart-data.json` остануваат поддржани на продукција преку Cloudflare compatibility alias слој, но датотеките во репото се организирани по улога:

```text
data/
	static/
		chart-genres.json
		curators.json
		genres.json
		loading-messages.json
		rss-feeds.json
		spotify-playlists.json
		lang/

	dynamic/
		editable/
			bands.json
			events.json
			releases.json

		generated/
			advanced-charts.json
			artist-data.json
			articles.json
			articles-filtered.json
			chart-data.json
			chart-history-data.json
			curators-tracklists.json
			interviews.json
			interviews-filtered.json
			site-master.json
			chart-history/

images/
	bg-dark.png
	bg-light.png
	logo.png
	og-image.png

config/
	credentials/
	automation/

.cache/
	transient script state and caches

backups/
	manual/script backups

scripts/
	generators, scrapers, media tools, maintenance scripts
	site/
		common.js
		i18n.js
		load-header.js
		mmm-drafts.js
		progress-bar.js
		script.js
		spotify-api.js
		tour.js

workers/
	cloudflare API / PR / OG compatibility workers
```

Кратко правило:

- `data/static/` = рачно одржувани, ретко менливи јавни податоци.
- `data/dynamic/editable/` = податоци што се уредуваат преку сајтот или преку PR workflow.
- `data/dynamic/generated/` = артефакти што ги произведуваат скриптите (`site-master`, chart snapshots, филтрирани медиумски фидови, итн.).
- `images/` = јавни слики за логото, OG preview и позадини.
- `scripts/` = CLI/build/maintenance tooling што се повикува од `update-all.ps1` или од други PowerShell helper скрипти.
- `scripts/site/` = јавниот browser runtime (`common.js`, `tour.js`, `script.js`, итн.) што директно го вчитуваат HTML страниците.
- `config/` = credentials и automation setup што не се дел од јавниот URL surface.

---

## За проектот

ТопЛиста.мк е музичко рангирање базирано на YouTube прегледи, плус отворена база на македонски артисти и бендови.

Направено е од заедницата **[Xotel](https://discord.gg/DzBQASu7mU)** и е отворено за придонеси.

---

## Базата на артисти

Базата е рачно составена листа на македонски музички артисти. Секој запис содржи име, град, жанр, линкови до стриминг платформи и социјални мрежи, и статус на активност.

Секој може да предложи промени преку формуларот на сајтот. Промените одат на **[GitHub](https://github.com/martinpetkovski/masterlista/)** и по проверка од **[Мартин](https://www.instagram.com/najnajjak)** се објавуваат.

Статусот на активност е автоматски:

- **Активен** — ако има издание во последните 2 години
- **Можеби** — 2–3 години
- **Неактивен** — ако нема ништо повеќе од 3 години

---

## Кого прифаќаме?

Артистот мора да има некаков **доказ за постоење** — музика на стриминг платформи, објавени статии, постери од настапи, или потврда од самите членови.

Плус, мора да има **барем една оригинална песна**. Кавер бендови не се прифаќаат.

---

## Правила за внесување

- **Име** — на кирилица и на македонски, освен ако името е на друг јазик.
- **Град** — градот на потекло на било кој член, не каде живеат сега.
- **Звучи како** — очигледно влијание, или споменато во интервју/биографија.
- **YouTube** — канал наместо поединечни линкови ако е можно; каналот мора да е на артистот.
- **Википедија** — линкот мора да е на `mk.wikipedia.org`.

---

## Верификација на профил

Ако си артист во базата и сакаш да го потврдиш профилот, кликни на **„Потврден“**, избери бои, и ќе следи контакт за верификација.

---

## Листата

Листата се базира на **YouTube прегледи**. За секое издание се следи колку прегледи добило оваа недела наспроти претходната.

Рангирањето работи вака:

- **Синглови** — последните 20 синглови од последните 4 недели, рангирани по неделни YouTube прегледи. Spotify брои изданија со 1–4 песни како сингл.
- **Албуми** — последните 20 албуми од последните 8 недели.
- **Лимит** — максимум **2 изданија по артист** на листата.
- **Сите времиња** — топ 100 артисти по број на Spotify следбеници.

---

## Ажурирања

Листата се заклучува **секој понеделник**. Промените (стрелки горе/долу) се споредуваат со претходниот понеделник.

Ако се промени алгоритмот, можеби ќе треба недела-две додека резултатите се стабилизираат.

---

## Изданија

За да биде песна на листата, изданието **мора да е на Spotify** — оттаму се земаат основните податоци како име, датум и тип.

Секоја песна може да има повеќе YouTube видеа. Разликата во прегледи од недела во недела го одредува рангирањето.

---

## Кои видеа се бројат?

Не секое YouTube видео се брои:

| Тип на видео | Статус | Забелешка |
|---|---|---|
| Официјално музичко видео | ✅ | |
| Неофицијално музичко видео | ✅ | |
| Lyrics видео | ✅ | |
| Видео од живо | ⚠️ | Само ако го содржи целото видео на песната и не содржи други песни |
| Цел албум / целосен перформанс | ⚠️ | Се додава на првата песна од изданието и се брои кон неа |
| Фан видео | ✅ | |
| Караоке видео | ✅ | |
| Topic видео (автоматски генерирано) | ✅ | |
| Аудио видео (статична слика) | ✅ | |
| Ремикс видео | ❌ | |
| Кавер видео | ❌ | Не се прифаќа освен ако не е од оригиналниот артист |
| Реакција / рецензија | ❌ | |
| Краток исечок / trailer | ❌ | |

Кратко: ако артистот ја изведува песната во видеото — се брои. Кавери, реакции и рецензии — не.

YouTube прегледите може да бидат вештачки надувани (реклами, купени прегледи). Ова **не е против правилата**, но е доста очигледно кога се случува.

---

## Ознаката „pop"

Артистите со жанр **„pop"** не се прикажуваат во алтернативната листа.

Во главната листа и базата, сите остануваат видливи.

---

## Ознаката „Alternative"

Артистите со **„Alternative"** жанр секогаш се прикажуваат во алтернативната листа, дури и ако другите жанрови нормално би ги исклучиле.

Во другите листи нема ефект.

---

## Политика за ознаката „AI“

Артистите што ја имаат ознаката **„AI“** не се квалификуваат за топ листите.

Артисти кои создаваат музика со помош на AI, но барем еден дел од музиката е снимен наместо генериран, не се квалификуваат за ознаката **„AI“**. Артисти кои имаат објавено AI издание во последната година се квалификуваат за оваа ознака.

---

## Вести

Страницата за вести собира содржини од македонски медиуми како mono-ton, Култура Бета, Popup Mk, MK Tickets, Слободен Печат, Нова Македонија, А1он, Мета.мк, МКД.МК, Либертас, 360 Степени, Радио МОФ, Фокус и Нетпрес.

Се прикажуваат само вести кои спомнуваат артист од базата.

---

## Настани

Секој може да додаде настан, но минува рачна проверка — ист принцип како за артистите.

---

## Кустоси

Кустос е човек кој рачно составува playlist и ја споделува со заедницата. Наместо алгоритам, овде идејата е да има вистинска препорака од некој што навистина ја познава сцената.

За да бидеш кустос, треба некако да си поврзан со музичката сцена — артист, критичар, водител на радио емисија, блогер или нешто слично.

Ако сакаш да станеш кустос, приклучи се на **[Xotel Discord серверот](https://discord.gg/DzBQASu7mU)**.

---

## Придонеси

Кодот е отворен и достапен на **[GitHub](https://github.com/martinpetkovski/masterlista)**.

Сајтот е статичен (HTML/CSS/JS), хостиран на GitHub Pages. Поголемиот дел од кодот е AI-генериран, додека податоците се 100% рачно внесени и проверени.

---

## Лиценца

Податоците за артистите и статиите се лиценцирани со **[Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)**.

Слободно користете, споделувајте и адаптирајте со наведување на изворот.

---

## Контакт

За прашања, предлози или пријавување грешки — **[Xotel Discord](https://discord.gg/DzBQASu7mU)**.

Домар на сајтот привремено е **[Мартин](https://www.instagram.com/najnajjak)**.

Огромно фала и до Томи, Антонио (Мацик), Харун, Сашо, Петар, Андреј, Ирена, Даниел, Мирче, Марко, Бошко, Стефан, Филип x2, целата заедница на Xotel и еден куп други незнајни јунаци кои помогнаа на еден или друг начин во креирањето. Создадено со гордост во Република Македонија.

---

## API

Податоците на ТопЛиста.мк се достапни преку јавен **[REST API](https://toplista.mk/api)**.

Не е потребна автентикација и може слободно да се користи за други проекти.

---

## Правни документи

- [Услови за користење](https://toplista.mk/uslovi)
- [Политика на приватност](https://toplista.mk/privatnost)

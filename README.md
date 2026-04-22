# TopLista.mk

TopLista.mk is a community-run platform for documenting, ranking, and promoting the Macedonian music scene. This repository contains the production website, the structured datasets behind it, and the automation pipeline that keeps charts, releases, editorial feeds, and public-facing pages up to date.

- Website: [toplista.mk](https://toplista.mk)
- Public API: [toplista.mk/api](https://toplista.mk/api)
- Community: [Xotel Discord](https://discord.gg/DzBQASu7mU)

## Project overview

TopLista.mk combines editorial curation with an automated data pipeline. The goal is to make the contemporary Macedonian music ecosystem easier to discover, track, and reference from a single public source.

The platform currently covers:

| Area | Purpose |
| --- | --- |
| Weekly charts | Tracks current singles and albums using week-over-week YouTube performance derived from Spotify-indexed releases. |
| Artist database | Maintains a curated directory of Macedonian artists and bands with profile metadata, links, and activity status. |
| Releases | Stores canonical release records used by ranking, discovery, and profile pages. |
| News and interviews | Aggregates relevant media coverage and interview feeds tied back to artists in the database. |
| Events | Publishes community-submitted events after review. |
| Curators | Features hand-picked playlists and tracklists from people active in the scene. |
| API | Exposes public data for external use without authentication. |

## How the platform works

The project is a static website backed by generated JSON artifacts.

- Release metadata originates from Spotify and is normalized into internal data files.
- YouTube links are matched and verified so weekly view deltas can be used in chart calculations.
- Editorial scripts scrape news and interview sources, then filter results against the artist database.
- A generated site master dataset precomputes the data needed by the frontend pages.
- Cloudflare workers provide supporting API and compatibility behavior around the public site.

This setup keeps the public experience fast while allowing the content pipeline to remain transparent and scriptable.

## Technology and architecture

- Frontend: static HTML, CSS, and vanilla JavaScript pages served through GitHub Pages.
- Data pipeline: Node.js scripts and PowerShell orchestration for ingestion, enrichment, ranking, and publishing.
- Storage model: versioned JSON datasets for static reference data, editable records, and generated artifacts.
- Edge services: Cloudflare workers for API, Open Graph generation, and compatibility layers where needed.

## Operating the repository

### Prerequisites

- Node.js LTS and npm
- PowerShell
- Service credentials for the parts of the pipeline you intend to run

Install dependencies:

```bash
npm install
```

Credentials are expected under `config/credentials/`. Example files are included for Spotify, YouTube, and Instagram integrations.

### Main update workflow

The primary operational entry point is:

```powershell
./update-all.ps1
```

That script orchestrates the major maintenance tasks, including chart generation, YouTube matching and popularity updates, editorial scraping, curator playlist refreshes, playlist publishing, and site master generation.

Useful examples:

```powershell
./update-all.ps1
./update-all.ps1 -Only chart
./update-all.ps1 -Only scrape
./update-all.ps1 -Only sitemaster
./update-all.ps1 -SkipPlaylists -SkipCurators
```

An additional media build command is available through npm:

```bash
npm run build:media
```

## Contribution model

TopLista.mk is community-supported through Xotel and open to contributions.

- Code contributions can be proposed through issues and pull requests.
- Artist, release, and event changes may also originate through the live site workflows and are reviewed before publication.
- Curated data is intentionally moderated; operational scripts automate collection and transformation, not editorial judgment.
- Do not commit real credentials or local secrets.

## Data and editorial principles

- The project prioritizes discoverability and long-term documentation of Macedonian music.
- Rankings are based on repeatable pipeline logic rather than manual chart ordering.
- Public-facing data is curated, reviewed, and adjusted when the automation pipeline surfaces ambiguous matches.
- The repository is intended to be both a production codebase and a transparent source of record for the platform's data products.

## License and attribution

The curated artist and article datasets are published under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). If you reuse that data, attribute TopLista.mk as the source.

## Contact

For questions, suggestions, and bug reports, use the [Xotel Discord](https://discord.gg/DzBQASu7mU) or open an issue in this repository.

## Legal

- [Terms of use](https://toplista.mk/uslovi)
- [Privacy policy](https://toplista.mk/privatnost)

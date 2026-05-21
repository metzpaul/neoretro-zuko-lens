# neoretro-zuko-lens

A neoretro web renderer for old browsers.

`neoretro-zuko-lens` lets classic browsers browse modern websites through a modern server-side Chromium renderer. It turns the modern page into sliced JPEGs wrapped in old-browser-friendly HTML 3.2 frames, tables, and imagemaps.

The first target was Netscape 4.8 on a PowerBook, served from zuko.

## Neoretro

Neoretro means building modern bridges for classic computers: preserving the dignity, constraints, and feel of older machines while giving them useful access to contemporary systems.

Doctrine: deliver the future through a tiny straw.

## What it does

- Runs an Express server.
- Uses Playwright/Chromium to load modern pages server-side.
- Blocks some heavy/ad/tracking resource classes.
- Screenshots the rendered page.
- Slices the screenshot into JPEG strips.
- Emits HTML 3.2-era frames/tables/imagemaps so old browsers can display and click through pages.
- Provides a lightweight local home page and toolbar for search/navigation.

## Requirements

- Node.js 18+
- npm
- ImageMagick `convert`
- Playwright Chromium browser install

On Fedora-like systems:

```bash
sudo dnf install -y nodejs npm ImageMagick
npm install
npx playwright install chromium
```

## Run

```bash
npm install
npm start
```

Default service URL:

```text
http://10.0.1.2:8090/
```

Configuration is through environment variables:

- `ZUKO_LENS_HOST` default `10.0.1.2`
- `ZUKO_LENS_PORT` default `8090`
- `ZUKO_LENS_CACHE` default `/home/zuko/opt/zuko-lens/cache`
- `ZUKO_LENS_WIDTH` default `700`
- `ZUKO_LENS_MIN_WIDTH` default `560`
- `ZUKO_LENS_MAX_WIDTH` default `760`
- `ZUKO_LENS_MAX_HEIGHT` default `12000`
- `ZUKO_LENS_SLICE_HEIGHT` default `600`
- `ZUKO_LENS_JPEG_QUALITY` default `62`
- `ZUKO_LENS_HOME` default `https://weather.gov/55901`
- `ZUKO_LENS_USER_AGENT` default modern Chrome UA

For local testing on the same machine:

```bash
ZUKO_LENS_HOST=127.0.0.1 ZUKO_LENS_PORT=8090 npm start
```

## Publication status

Shared by agreement between Paul and Hermes.

## Generation acknowledgement

Code and project materials in this repository were generated, edited, or assisted by Hermes Agent running on zuko, using one or more backing AI models selected/configured by Paul. Human direction, review, and publication consent remain with Paul.

## License

CC0 1.0 Universal / public domain dedication unless otherwise noted.

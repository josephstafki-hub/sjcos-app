# SJC OS — Catalog Clipper (Chrome extension)

A minimal MV3 extension that scrapes the current supplier product page
(name / price / image / SKU / URL) and posts it into your SJC OS material
catalog with one click.

## How it connects

The extension is cross-origin and has **no login session**, so it authenticates
against `POST /api/catalog/clip` with a **clip token** instead of the session
cookie. Generate that token in SJC OS at **Settings → Integrations → Browser
extension**. The endpoint shown there and the token are the only two things you
need to configure.

## Install (unpacked, Chrome / Edge / Brave)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `browser-extension/` folder.
4. Pin the extension, then click it → open **Connection settings** and paste:
   - **Endpoint** — e.g. `https://os.sjcarpentryllc.com/api/catalog/clip`
   - **Clip token** — from Settings → Integrations
   - Click **Save settings**.

## Use

1. Browse to any product page (supplier site, Amazon, Wayfair, etc.).
2. Click the extension. It auto-fills name/price/image/supplier/SKU — edit
   anything, pick a category.
3. Click **Clip to catalog**. The item appears immediately under
   **/catalog** in SJC OS (with the product image if one was found).

## Notes

- Scraping is heuristic: schema.org `Product` JSON-LD first, then Open Graph
  meta tags, then page fallbacks. Uncommon layouts may need a manual tweak in
  the popup before clipping.
- The product image is fetched **server-side** from its URL and stored in SJC
  OS (12 MB cap, images only); if it can't be fetched the item still lands
  without an image.
- Rotating the token in Settings immediately invalidates the old one — re-paste
  the new token in Connection settings.
- Permissions are minimal: `activeTab` + `scripting` (read the page you're on,
  only when you click the extension) and `storage` (remember your endpoint +
  token). No background tracking.

# SJC OS Design Tokens

Source: `/home/joe/SJC-OS/design_handoff_sjc_os/website-theme.css`
Build to: `SJC OS - Website Theme.html` — **not** `sketch.css`

---

## Colors

### Paper / surface (warm cream)
| Token        | Value     | Use                          |
|--------------|-----------|------------------------------|
| `--paper`    | `#F1ECE1` | Main background              |
| `--paper-2`  | `#EAE4D6` | Subtle surface / topbar      |
| `--paper-3`  | `#E1DAC8` | Tints / placeholders         |
| `--paper-4`  | `#D6CDB8` | Deeper tint                  |
| `--card`     | `#FBFAF4` | Lifted card surface          |

### Ink (near-black forest green — used for text AND dark brand surfaces)
| Token     | Value     | Use                         |
|-----------|-----------|-----------------------------|
| `--ink`   | `#2C3326` | Primary text                |
| `--ink-2` | `#4B5142` | Secondary text              |
| `--ink-3` | `#767A69` | Tertiary / mono labels      |
| `--ink-4` | `#A7A992` | Placeholder text            |

### Brand green (forest / olive — the site's signature)
| Token           | Value     | Use                            |
|-----------------|-----------|--------------------------------|
| `--accent`      | `#4C5A40` | Primary brand action           |
| `--accent-2`    | `#38442D` | Heading green / dark accent    |
| `--accent-soft` | `#DEE2CF` | Soft tint                      |

### AI / Claude (muted teal-sage — distinct from brand green)
| Token       | Value     | Use                     |
|-------------|-----------|-------------------------|
| `--ai`      | `#5B7E72` | AI content foreground   |
| `--ai-2`    | `#35514A` | AI dark                 |
| `--ai-soft` | `#DCE7E1` | AI bubble background    |

### Semantic
| Token          | Value     | Paired soft   | Use                           |
|----------------|-----------|---------------|-------------------------------|
| `--flag`       | `#A6452F` | `#EFD9CF`     | Urgent / overdue / decision   |
| `--money`      | `#5E7046` | `#DFE4CD`     | Paid / current / financial OK |
| `--info`       | `#4C6A8E` | `#D9E1ED`     | Informational                 |

### Borders
| Token         | Value     | Use              |
|---------------|-----------|------------------|
| `--rule`      | `#CDC6B2` | Default hairline |
| `--rule-soft` | `#DED8C5` | Subtle divider   |

### Sidebar
- Background: `#283021` (forest green)
- Text: warm cream
- Active item: `rgba(191, 208, 166, 0.18)` translucent sage highlight
- Count badges: solid sage bubble, dark-green numerals

---

## Typography

Loaded from Google Fonts (defined in `website-theme.css`).

| Variable     | Font             | Weights  | Use                                        |
|--------------|------------------|----------|--------------------------------------------|
| `--serif`    | Newsreader        | 500–600  | All headings, display, editorial italic    |
| `--hand`     | Mulish            | 400–700  | Base UI + body (var name is legacy)        |
| `--mono`     | JetBrains Mono    | 400–600  | Spec labels, numbers, timestamps, breadcrumbs |

Notes:
- The app is **serif-dominant for all headings** — card titles, section titles, page titles all use Newsreader
- Breadcrumbs and eyebrow labels use JetBrains Mono in uppercase with ~0.14–0.16em letter-spacing
- `--hand` / `--scribble` / `--doodle` are legacy var names from the sketch theme — they all point to Mulish in website-theme.css; rename freely in production

---

## Spacing scale

`4 · 6 · 8 · 10 · 12 · 14 · 18 · 24 · 28 · 36 · 48 · 60` px

---

## Radii & Elevation

| Element                    | Radius     |
|----------------------------|------------|
| Cards / boxes              | 8px        |
| Buttons / inputs           | 6px        |
| Chips / badges             | 20px pill  |
| Avatars                    | Full circle|
| Top-bar pill / ⌘K pill     | 999px      |

| Shadow         | Value                                          |
|----------------|------------------------------------------------|
| Card           | `0 1px 2px rgba(44, 51, 38, 0.04)`             |
| ⌘K pill        | `0 8px 26px rgba(28, 32, 22, 0.28)`            |

---

## Chip kinds → semantic colors

| Kind     | Color source  | Meaning                           |
|----------|---------------|-----------------------------------|
| `accent` | `--accent`    | Primary brand action / in-progress |
| `ai`     | `--ai`        | AI-generated content (sage)       |
| `flag`   | `--flag`      | Urgent / overdue / requires decision |
| `money`  | `--money`     | Financial OK / paid / current     |
| `info`   | `--info`      | Informational (blue)              |
| `ghost`  | `--rule`      | Neutral, no fill                  |
| `solid`  | `--ink`       | Selected filter                   |

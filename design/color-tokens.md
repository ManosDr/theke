# theke color tokens — designer reference

Read-only reference. To change a color, edit `design/color-tokens.json` (the `value` fields only) and return that file.

Source: `frontend/app/globals.css` (the only file that declares color custom properties — light theme in `:root`, dark theme in `[data-theme="dark"]`).

The codebase actually runs **two parallel palettes**, not one flat list:
- **core** (`--color-*`) — the original app-wide primitives (chat, login, pricing, shared badges).
- **admin** (`--admin-*`) — a second palette ported from a separate "Theke Admin design" prototype, layered on for the sidebar, top bar, and every admin panel/dashboard.

Swatches below are inline HTML `<span>` color chips — they render in any Markdown viewer that allows raw HTML (GitHub, VS Code preview, etc.).

**56 tokens total** (down from 59 in the previous export — see changelog below).

## What changed since the last export

- Removed 4 dead tokens: `--color-text-on-accent`, `--admin-construction-on-dark`, `--admin-tax-on-dark`, `--gradient-sidebar` (the last was never in this JSON to begin with — it's a gradient, not a flat color).
- Unified `--admin-danger` + `--error-red` (both `#c62828`) → kept **`--admin-danger`** (wider real usage, doesn't bake a hue into the name).
- Unified `--admin-info` + `--color-primary-hover` (both `#2a6fdb`) → kept **`--color-primary-hover`** (foundational core token powering the universal `.btn-primary:hover`, already had a proper dark value).
- Added real dark-mode values for `admin.status.success` (→ `#4ade80`) and `admin.status.warning` (→ `#fb923c`) — previously both silently inherited their light-mode value in dark mode.
- `admin.status.danger` now explicitly restates the same value in both themes (matching `core.status.danger`'s own established pattern) rather than relying on an implicit cascade fallback.
- New token: `core.background.surface_hover` — was referenced with an undeclared fallback (`rgba(0,0,0,0.04)`), invisible in dark mode.
- New token: `admin.text.text_on_dark` — consolidates three previously ad hoc values (`#fff`, `#b7c2dc`, `#d8e0f0`) used for secondary text on permanently-dark navy surfaces.
- Fixed a hardcoded `#d8d0c2` leftover (old warm-beige palette) on the sidebar's collapsed vertical-switcher dot → now uses `admin.surface.card_border`.
- **Follow-up pass:** swept the whole frontend for remaining raw hex in CSS/inline styles - every one was a "text/icon on a colored fill" case, so all were repointed at the existing `core.text.on_primary` token rather than adding anything new (Sidebar's active nav-child text, avatar border, vertical-switcher active segment; TopHeader/StatCard/AttentionCard's avatar/icon text; two status-pill and two inline danger-button labels). One hardcoded dark-theme background (`Sidebar.module.css`'s `.navItemActive`, was `#25344f`) was replaced with the same `color-mix(...)` pattern its light-theme sibling already uses, mixed against the dark surface instead of white - ties it back to `admin.brand.accent_navy` instead of an unrelated hex.

---

## core — background

| Token | Light | Dark | Usage |
|---|---|---|---|
| `core.background.page` | <span style="display:inline-block;width:14px;height:14px;background:#f7f9fc;border:1px solid #ccc;vertical-align:middle;"></span> `#f7f9fc` | <span style="display:inline-block;width:14px;height:14px;background:#0d1b2e;border:1px solid #ccc;vertical-align:middle;"></span> `#0d1b2e` | Page background behind every card/surface |
| `core.background.surface` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | <span style="display:inline-block;width:14px;height:14px;background:#16213a;border:1px solid #ccc;vertical-align:middle;"></span> `#16213a` | Default card/panel/input background |
| `core.background.surface_alt` | <span style="display:inline-block;width:14px;height:14px;background:#eef1f6;border:1px solid #ccc;vertical-align:middle;"></span> `#eef1f6` | <span style="display:inline-block;width:14px;height:14px;background:#1e2a44;border:1px solid #ccc;vertical-align:middle;"></span> `#1e2a44` | Secondary/inset surface — table stripes, chips, citation pills |
| `core.background.surface_hover` 🆕 | <span style="display:inline-block;width:14px;height:14px;background:rgba(21,29,72,0.05);border:1px solid #ccc;vertical-align:middle;"></span> `rgba(21,29,72,0.05)` | <span style="display:inline-block;width:14px;height:14px;background:#1e2a44;border:1px solid #ccc;vertical-align:middle;"></span> `rgba(255,255,255,0.07)` | Subtle hover tint over `core.background.surface` (e.g. CustomerCombobox rows) |

## core — border

| Token | Light | Dark | Usage |
|---|---|---|---|
| `core.border.default` | <span style="display:inline-block;width:14px;height:14px;background:#e4e9f2;border:1px solid #ccc;vertical-align:middle;"></span> `#e4e9f2` | <span style="display:inline-block;width:14px;height:14px;background:#2a3752;border:1px solid #ccc;vertical-align:middle;"></span> `#2a3752` | Default 1px hairline border on cards/inputs/dividers |

## core — text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `core.text.primary` | <span style="display:inline-block;width:14px;height:14px;background:#151d48;border:1px solid #ccc;vertical-align:middle;"></span> `#151d48` | <span style="display:inline-block;width:14px;height:14px;background:#ececec;border:1px solid #ccc;vertical-align:middle;"></span> `#ececec` | Default body/heading text |
| `core.text.muted` | <span style="display:inline-block;width:14px;height:14px;background:#737791;border:1px solid #ccc;vertical-align:middle;"></span> `#737791` | <span style="display:inline-block;width:14px;height:14px;background:#7b91b0;border:1px solid #ccc;vertical-align:middle;"></span> `#7b91b0` | Secondary/caption text, placeholders |
| `core.text.on_primary` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | Text/icon on any solid colored fill - buttons, user chat bubble, sidebar avatar/footer name/active nav item, status pills, admin danger confirm buttons (broadened in the follow-up sweep, see changelog) |

## core — brand

| Token | Light | Dark | Usage |
|---|---|---|---|
| `core.brand.primary` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#3e5a9e;border:1px solid #ccc;vertical-align:middle;"></span> `#3e5a9e` | Primary navy — buttons, active states, user chat bubble |
| `core.brand.primary_hover` | <span style="display:inline-block;width:14px;height:14px;background:#2a6fdb;border:1px solid #ccc;vertical-align:middle;"></span> `#2a6fdb` | <span style="display:inline-block;width:14px;height:14px;background:#5c7dc4;border:1px solid #ccc;vertical-align:middle;"></span> `#5c7dc4` | Hover state for primary fills; also admin "info/syncing" status color (absorbed `--admin-info`) |
| `core.brand.link` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#8da3e0;border:1px solid #ccc;vertical-align:middle;"></span> `#8da3e0` | Links, active tabs, focus rings |
| `core.brand.link_hover` | <span style="display:inline-block;width:14px;height:14px;background:#2a6fdb;border:1px solid #ccc;vertical-align:middle;"></span> `#2a6fdb` | <span style="display:inline-block;width:14px;height:14px;background:#aebfea;border:1px solid #ccc;vertical-align:middle;"></span> `#aebfea` | Link hover state |
| `core.brand.accent` | <span style="display:inline-block;width:14px;height:14px;background:#ffa800;border:1px solid #ccc;vertical-align:middle;"></span> `#ffa800` | <span style="display:inline-block;width:14px;height:14px;background:#ffcf00;border:1px solid #ccc;vertical-align:middle;"></span> `#ffcf00` | Amber accent (= core.status.warning) |
| `core.brand.accent_hover` | <span style="display:inline-block;width:14px;height:14px;background:#e69500;border:1px solid #ccc;vertical-align:middle;"></span> `#e69500` | <span style="display:inline-block;width:14px;height:14px;background:#ffa800;border:1px solid #ccc;vertical-align:middle;"></span> `#ffa800` | Amber accent hover |

## core — status

| Token | Light | Dark | Usage |
|---|---|---|---|
| `core.status.success` | <span style="display:inline-block;width:14px;height:14px;background:#27ae60;border:1px solid #ccc;vertical-align:middle;"></span> `#27ae60` | <span style="display:inline-block;width:14px;height:14px;background:#00d08b;border:1px solid #ccc;vertical-align:middle;"></span> `#00d08b` | Success text/icon |
| `core.status.success_bg` | <span style="display:inline-block;width:14px;height:14px;background:#dcfce7;border:1px solid #ccc;vertical-align:middle;"></span> `#dcfce7` | <span style="display:inline-block;width:14px;height:14px;background:#123b2c;border:1px solid #ccc;vertical-align:middle;"></span> `#123b2c` | Success badge background |
| `core.status.warning` | <span style="display:inline-block;width:14px;height:14px;background:#ffa800;border:1px solid #ccc;vertical-align:middle;"></span> `#ffa800` | <span style="display:inline-block;width:14px;height:14px;background:#ffcf00;border:1px solid #ccc;vertical-align:middle;"></span> `#ffcf00` | Warning text/icon |
| `core.status.warning_bg` | <span style="display:inline-block;width:14px;height:14px;background:#fff4de;border:1px solid #ccc;vertical-align:middle;"></span> `#fff4de` | <span style="display:inline-block;width:14px;height:14px;background:#3a2f0a;border:1px solid #ccc;vertical-align:middle;"></span> `#3a2f0a` | Warning badge/disclaimer background |
| `core.status.danger` | <span style="display:inline-block;width:14px;height:14px;background:#f64e60;border:1px solid #ccc;vertical-align:middle;"></span> `#f64e60` | <span style="display:inline-block;width:14px;height:14px;background:#f64e60;border:1px solid #ccc;vertical-align:middle;"></span> `#f64e60` | Danger text/icon (banners/badges — same in both themes; deliberately a lighter coral-red than `admin.status.danger`) |
| `core.status.danger_bg` | <span style="display:inline-block;width:14px;height:14px;background:#ffe2e5;border:1px solid #ccc;vertical-align:middle;"></span> `#ffe2e5` | <span style="display:inline-block;width:14px;height:14px;background:#3a1620;border:1px solid #ccc;vertical-align:middle;"></span> `#3a1620` | Danger badge background |
| `core.status.info` | <span style="display:inline-block;width:14px;height:14px;background:#0d9488;border:1px solid #ccc;vertical-align:middle;"></span> `#0d9488` | <span style="display:inline-block;width:14px;height:14px;background:#2dd4bf;border:1px solid #ccc;vertical-align:middle;"></span> `#2dd4bf` | Teal — neutral/informational tone |
| `core.status.info_bg` | <span style="display:inline-block;width:14px;height:14px;background:#d9f2ef;border:1px solid #ccc;vertical-align:middle;"></span> `#d9f2ef` | <span style="display:inline-block;width:14px;height:14px;background:#0f2e2a;border:1px solid #ccc;vertical-align:middle;"></span> `#0f2e2a` | Info badge background |
| `core.status.purple` | <span style="display:inline-block;width:14px;height:14px;background:#8950fc;border:1px solid #ccc;vertical-align:middle;"></span> `#8950fc` | <span style="display:inline-block;width:14px;height:14px;background:#a855f7;border:1px solid #ccc;vertical-align:middle;"></span> `#a855f7` | 4th badge/stat-card accent |
| `core.status.purple_bg` | <span style="display:inline-block;width:14px;height:14px;background:#f3e8ff;border:1px solid #ccc;vertical-align:middle;"></span> `#f3e8ff` | <span style="display:inline-block;width:14px;height:14px;background:#2a1a45;border:1px solid #ccc;vertical-align:middle;"></span> `#2a1a45` | Purple badge background |

---

## admin — surface

| Token | Light | Dark | Usage |
|---|---|---|---|
| `admin.surface.topbar_bg` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | <span style="display:inline-block;width:14px;height:14px;background:#1a2439;border:1px solid #ccc;vertical-align:middle;"></span> `#1a2439` | Top header bar background |
| `admin.surface.parchment` | <span style="display:inline-block;width:14px;height:14px;background:#f4f6fa;border:1px solid #ccc;vertical-align:middle;"></span> `#f4f6fa` | <span style="display:inline-block;width:14px;height:14px;background:#111a2e;border:1px solid #ccc;vertical-align:middle;"></span> `#111a2e` | Main app-shell content-area background |
| `admin.surface.navy_solid` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | Fixed-dark textarea bg (system prompt editor); same in both themes on purpose |
| `admin.surface.card_border` | <span style="display:inline-block;width:14px;height:14px;background:#e3e7f0;border:1px solid #ccc;vertical-align:middle;"></span> `#e3e7f0` | <span style="display:inline-block;width:14px;height:14px;background:#2c3a57;border:1px solid #ccc;vertical-align:middle;"></span> `#2c3a57` | Admin card/sidebar edge border; also the collapsed sidebar's inactive vertical-switcher dot (was a hardcoded `#d8d0c2` leftover) |
| `admin.surface.row_border` | <span style="display:inline-block;width:14px;height:14px;background:#eef1f7;border:1px solid #ccc;vertical-align:middle;"></span> `#eef1f7` | <span style="display:inline-block;width:14px;height:14px;background:#26314c;border:1px solid #ccc;vertical-align:middle;"></span> `#26314c` | Divider between list rows / nav sections |
| `admin.surface.chip_bg` | <span style="display:inline-block;width:14px;height:14px;background:#eef1f7;border:1px solid #ccc;vertical-align:middle;"></span> `#eef1f7` | <span style="display:inline-block;width:14px;height:14px;background:#243252;border:1px solid #ccc;vertical-align:middle;"></span> `#243252` | Pill/chip background |

## admin — text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `admin.text.heading_navy` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#f1efe9;border:1px solid #ccc;vertical-align:middle;"></span> `#f1efe9` | Admin heading/icon text — inverts in dark mode |
| `admin.text.muted_stone` | <span style="display:inline-block;width:14px;height:14px;background:#7c8194;border:1px solid #ccc;vertical-align:middle;"></span> `#7c8194` | <span style="display:inline-block;width:14px;height:14px;background:#a6adc2;border:1px solid #ccc;vertical-align:middle;"></span> `#a6adc2` | Muted label/caption text in admin screens |
| `admin.text.body` | <span style="display:inline-block;width:14px;height:14px;background:#4a4a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#4a4a4a` | <span style="display:inline-block;width:14px;height:14px;background:#d7dae6;border:1px solid #ccc;vertical-align:middle;"></span> `#d7dae6` | Default/inactive nav body text |
| `admin.text.text_on_dark` 🆕 | <span style="display:inline-block;width:14px;height:14px;background:#c7d0e8;border:1px solid #ccc;vertical-align:middle;"></span> `#c7d0e8` | <span style="display:inline-block;width:14px;height:14px;background:#c7d0e8;border:1px solid #ccc;vertical-align:middle;"></span> `#c7d0e8` | Secondary/body text on a permanently-dark navy surface (sidebar footer role label, sign-out icon, active frequency pill, system-prompt textarea) — same value both themes on purpose |

## admin — brand

| Token | Light | Dark | Usage |
|---|---|---|---|
| `admin.brand.accent_navy` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#3e5a9e;border:1px solid #ccc;vertical-align:middle;"></span> `#3e5a9e` | Filled/active surface navy — sidebar footer, active pills |

## admin — vertical accents

| Token | Light | Dark | Usage |
|---|---|---|---|
| `admin.vertical.construction` | <span style="display:inline-block;width:14px;height:14px;background:#2d5016;border:1px solid #ccc;vertical-align:middle;"></span> `#2d5016` | <span style="display:inline-block;width:14px;height:14px;background:#7fc77f;border:1px solid #ccc;vertical-align:middle;"></span> `#7fc77f` | Construction-vertical accent |
| `admin.vertical.construction_bg` | <span style="display:inline-block;width:14px;height:14px;background:#eaf1e4;border:1px solid #ccc;vertical-align:middle;"></span> `#eaf1e4` | <span style="display:inline-block;width:14px;height:14px;background:#1c2e1c;border:1px solid #ccc;vertical-align:middle;"></span> `#1c2e1c` | Construction badge background |
| `admin.vertical.tax` | <span style="display:inline-block;width:14px;height:14px;background:#8b5e3c;border:1px solid #ccc;vertical-align:middle;"></span> `#8b5e3c` | <span style="display:inline-block;width:14px;height:14px;background:#d9a468;border:1px solid #ccc;vertical-align:middle;"></span> `#d9a468` | Tax & Accounting accent ("Tax bronze") |
| `admin.vertical.tax_bg` | <span style="display:inline-block;width:14px;height:14px;background:#f3e9e0;border:1px solid #ccc;vertical-align:middle;"></span> `#f3e9e0` | <span style="display:inline-block;width:14px;height:14px;background:#332319;border:1px solid #ccc;vertical-align:middle;"></span> `#332319` | Tax badge background |

*(`admin.vertical.construction_on_dark` and `admin.vertical.tax_on_dark` were removed — dead tokens, never referenced.)*

## admin — status

| Token | Light | Dark | Usage |
|---|---|---|---|
| `admin.status.neutral` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#3e5a9e;border:1px solid #ccc;vertical-align:middle;"></span> `#3e5a9e` | Neutral/default admin badge |
| `admin.status.neutral_bg` | <span style="display:inline-block;width:14px;height:14px;background:#eaecf1;border:1px solid #ccc;vertical-align:middle;"></span> `#eaecf1` | <span style="display:inline-block;width:14px;height:14px;background:#23304a;border:1px solid #ccc;vertical-align:middle;"></span> `#23304a` | Neutral badge background |
| `admin.status.success` ✅ fixed | <span style="display:inline-block;width:14px;height:14px;background:#2e7d32;border:1px solid #ccc;vertical-align:middle;"></span> `#2e7d32` | <span style="display:inline-block;width:14px;height:14px;background:#4ade80;border:1px solid #ccc;vertical-align:middle;"></span> `#4ade80` | Admin success tone — now has a real, brightened dark-mode value |
| `admin.status.warning` ✅ fixed | <span style="display:inline-block;width:14px;height:14px;background:#f57f17;border:1px solid #ccc;vertical-align:middle;"></span> `#f57f17` | <span style="display:inline-block;width:14px;height:14px;background:#fb923c;border:1px solid #ccc;vertical-align:middle;"></span> `#fb923c` | Admin warning tone — now has a real, brightened dark-mode value |
| `admin.status.warning_bg` | <span style="display:inline-block;width:14px;height:14px;background:#fff4de;border:1px solid #ccc;vertical-align:middle;"></span> `#fff4de` | <span style="display:inline-block;width:14px;height:14px;background:#3a2f0a;border:1px solid #ccc;vertical-align:middle;"></span> `#3a2f0a` | Admin warning badge background |
| `admin.status.warning_border` | <span style="display:inline-block;width:14px;height:14px;background:#f5d999;border:1px solid #ccc;vertical-align:middle;"></span> `#f5d999` | <span style="display:inline-block;width:14px;height:14px;background:#5a4a1a;border:1px solid #ccc;vertical-align:middle;"></span> `#5a4a1a` | Warning callout / disclaimer border |
| `admin.status.danger` ✅ unified | <span style="display:inline-block;width:14px;height:14px;background:#c62828;border:1px solid #ccc;vertical-align:middle;"></span> `#c62828` | <span style="display:inline-block;width:14px;height:14px;background:#c62828;border:1px solid #ccc;vertical-align:middle;"></span> `#c62828` | Admin danger tone AND inline field-validation (absorbed `--error-red`) — explicitly constant across themes, matching `core.status.danger`'s pattern |

*(`admin.status.info` was removed — unified into `core.brand.primary_hover`, see changelog.)*

---

## chat

| Token | Light | Dark | Usage |
|---|---|---|---|
| `chat.user_bubble_bg` | <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | <span style="display:inline-block;width:14px;height:14px;background:#3e5a9e;border:1px solid #ccc;vertical-align:middle;"></span> `#3e5a9e` | User message bubble background |
| `chat.user_bubble_text` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | User message bubble text |
| `chat.assistant_bubble_bg` | <span style="display:inline-block;width:14px;height:14px;background:#ffffff;border:1px solid #ccc;vertical-align:middle;"></span> `#ffffff` | <span style="display:inline-block;width:14px;height:14px;background:#16213a;border:1px solid #ccc;vertical-align:middle;"></span> `#16213a` | Assistant message bubble background |
| `chat.assistant_bubble_border` | <span style="display:inline-block;width:14px;height:14px;background:#e4e9f2;border:1px solid #ccc;vertical-align:middle;"></span> `#e4e9f2` | <span style="display:inline-block;width:14px;height:14px;background:#2a3752;border:1px solid #ccc;vertical-align:middle;"></span> `#2a3752` | Assistant message bubble border |
| `chat.citation_chip_bg` | <span style="display:inline-block;width:14px;height:14px;background:#eef1f6;border:1px solid #ccc;vertical-align:middle;"></span> `#eef1f6` | <span style="display:inline-block;width:14px;height:14px;background:#1e2a44;border:1px solid #ccc;vertical-align:middle;"></span> `#1e2a44` | Source-citation pill background |
| `chat.citation_chip_text` | <span style="display:inline-block;width:14px;height:14px;background:#737791;border:1px solid #ccc;vertical-align:middle;"></span> `#737791` | <span style="display:inline-block;width:14px;height:14px;background:#7b91b0;border:1px solid #ccc;vertical-align:middle;"></span> `#7b91b0` | Citation pill link/label text |
| `chat.disclaimer_bg` | <span style="display:inline-block;width:14px;height:14px;background:#fff4de;border:1px solid #ccc;vertical-align:middle;"></span> `#fff4de` | <span style="display:inline-block;width:14px;height:14px;background:#3a2f0a;border:1px solid #ccc;vertical-align:middle;"></span> `#3a2f0a` | "AI can make mistakes" disclaimer background |
| `chat.disclaimer_border` | <span style="display:inline-block;width:14px;height:14px;background:#f5d999;border:1px solid #ccc;vertical-align:middle;"></span> `#f5d999` | <span style="display:inline-block;width:14px;height:14px;background:#5a4a1a;border:1px solid #ccc;vertical-align:middle;"></span> `#5a4a1a` | Disclaimer bottom border |
| `chat.disclaimer_text` | <span style="display:inline-block;width:14px;height:14px;background:#737791;border:1px solid #ccc;vertical-align:middle;"></span> `#737791` | <span style="display:inline-block;width:14px;height:14px;background:#7b91b0;border:1px solid #ccc;vertical-align:middle;"></span> `#7b91b0` | Disclaimer copy text |
| `chat.disclaimer_icon` | <span style="display:inline-block;width:14px;height:14px;background:#ffa800;border:1px solid #ccc;vertical-align:middle;"></span> `#ffa800` | <span style="display:inline-block;width:14px;height:14px;background:#ffcf00;border:1px solid #ccc;vertical-align:middle;"></span> `#ffcf00` | Disclaimer icon |

---

## Colors that exist but are NOT in the JSON (not CSS variables)

| Color | Where | Why it's excluded |
|---|---|---|
| <span style="display:inline-block;width:14px;height:14px;background:#33BE6E;border:1px solid #ccc;vertical-align:middle;"></span> `#33BE6E` | `components/Logo.tsx` | Brand-mark green, hardcoded on purpose ("fixed regardless of theme") — not a CSS var |
| <span style="display:inline-block;width:14px;height:14px;background:#1B2A4A;border:1px solid #ccc;vertical-align:middle;"></span> `#1B2A4A` / <span style="display:inline-block;width:14px;height:14px;background:#F57F17;border:1px solid #ccc;vertical-align:middle;"></span> `#F57F17` | `components/MapPicker.tsx` (`PIN_NAVY`, `PIN_AMBER`) | Leaflet map-pin colors, duplicated as JS string literals |
| <span style="display:inline-block;width:14px;height:14px;background:#1b2a4a;border:1px solid #ccc;vertical-align:middle;"></span> `#1b2a4a` | `layout.tsx` (`viewport.themeColor`) | Browser-chrome theme-color meta tag, light-mode only |

These three are unchanged by this cleanup pass — still real, still un-tokenized, still worth a look on a future rebrand pass.

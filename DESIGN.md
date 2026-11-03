---
name: Military Suite Design System
description: Administrative event log and reporting tool with tactical dark mode aesthetics
colors:
  primary: "#5c693a"
  primary-hover: "#4b5320"
  coyote: "#c5a365"
  neutral-bg: "#020617"
  neutral-surface: "#0f172a"
  neutral-card: "#1e293b"
  neutral-border: "#334155"
  text-primary: "#f8fafc"
  text-muted: "#94a3b8"
  status-danger: "#dc2626"
  status-warning: "#f59e0b"
  status-friendly: "#3b82f6"
  status-success: "#10b981"
  neutral-subtle: "#e2e8f0"
  neutral-light: "#ffffff"
  neutral-slate-600: "#475569"
  scrollbar-thumb: "#8a8d86"
  scrollbar-thumb-dark: "#44403c"
  accent-cyan: "#38bdf8"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  micro:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.0
rounded:
  sm: "6px"
  md: "8px"
  badge: "10px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-danger:
    backgroundColor: "{colors.status-danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: Military Suite

## Overview

**Creative North Star: "Tactical Command Log"**

Military Suite is an administrative event log and reporting interface designed for high-density historical record-keeping, documentation, and reporting. The visual philosophy prioritizes immediate legibility, dark-adapted operational comfort, and rigorous tabular and card layout clarity.

The interface rejects artificial AI tropes (such as generic violet gradients, floating side-tab stripes, and decorative gradient typography on numbers) in favor of crisp monochromatic surfaces, authentic tactical accents (olive and coyote drab), and high-contrast monospace numerical indicators.

**Key Characteristics:**
- **High Information Density**: Structured grids, compact cards, and clear typography maximize usable screen space without visual noise.
- **Tonal Layering**: Depth is achieved through nuanced Slate shade progressions (`slate-950` -> `slate-900` -> `slate-800`) rather than heavy floating drop shadows.
- **Precision Monospace Metrics**: All statistics, event timestamps, coordinates, and tally counts use monospace figures (`font-mono`) for column alignment and rapid visual scanning.
- **Calm Administrative Statuses**: Colors serve informational categories (friendly force entries, adversary losses, documentation status) without distracting decorative effects.

## Colors

The palette grounds high-contrast analytical data onto tactical low-luminance slate surfaces.

### Primary & Accents
- **Olive Drab** (`#5c693a` / `olive-500`): Used for primary action buttons, active navigation markers, and positive administrative checkpoints.
- **Coyote Sand** (`#c5a365` / `coyote-400`): Secondary tactical accent used for documentation highlights and date presets.
- **Tactical Amber** (`#f59e0b` / `amber-500`): Alerts, pending event completions, UDP categories, and attention markers.
- **Operational Red** (`#dc2626` / `red-600`): Irreversible operations, unclosed event notices, and critical loss registers (200).
- **Friendly Blue** (`#3b82f6` / `blue-500`): Dedicated to friendly personnel statistics and organizational directory entries.
- **Tactical Emerald** (`#10b981` / `emerald-500`): Capture/POW registers and confirmation toasts.

### Neutral
- **Deep Void** (`#020617` / `slate-950`): Base application canvas background.
- **Card Surface** (`#0f172a` / `slate-900`): Elevated module panels, cards, and dialogue bodies.
- **Subtle Surface** (`#1e293b` / `slate-800`): Input fields, secondary action buttons, and active filter tabs.
- **Border Stroke** (`#334155` / `slate-700`): Clean 1px structural dividing lines.
- **Primary Text** (`#f8fafc` / `slate-100`): High-contrast text for headers and primary values.
- **Muted Text** (`#94a3b8` / `slate-400`): Secondary labels, helper text, and inactive tab states.

### Named Rules
**The Legibility First Rule.** Loss ratios, statistical counts, and key metric digits must always be rendered in solid high-contrast colors (`text-amber-400`, `text-blue-400`, `text-red-400`) rather than CSS text-clip gradients.

## Typography

**Display & Body Font:** `Inter`, system-ui, sans-serif
**Numerical & Code Font:** `JetBrains Mono`, monospace

**Character:** Balanced and highly readable grotesque sans-serif paired with a robust tabular monospace for numbers, dates, and administrative identifiers.

### Hierarchy
- **Display** (Bold 700, 1.5–1.75rem, line-height 1.2): Module headers and main statistics summaries.
- **Headline** (Semi-bold 600, 1.125–1.25rem, line-height 1.3): Section headers and modal titles.
- **Title** (Semi-bold 600, 0.875–1rem, line-height 1.4): Card group headers and form section titles.
- **Body** (Regular 400 / Medium 500, 0.8125–0.875rem, line-height 1.5): Main descriptive text, descriptions, table cell data.
- **Label / Metric** (Bold 700 / Mono 600, 0.6875–0.75rem, tracking uppercase): Status badges, table headers, timestamp chips, counter tallies.

## Layout

- **Shell Layout**: Fixed sticky top navigation bar (3.5rem / 56px) with fluid full-width or centered workspace container.
- **Grid Systems**: 12-column responsive layout (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`) for event and analytics cards.
- **Spacing Scale**: 4px micro-increments (standard gap-2 / 8px, gap-3 / 12px, gap-4 / 16px, p-4 / 16px on cards).

## Elevation & Depth

Surfaces rely primarily on **tonal contrast** and **subtle borders** rather than ambient shadows.

- **Rest State**: Flat `bg-slate-900/85` with `border border-slate-800`.
- **Hover State**: Border transition to `border-slate-600` and subtle scale/brightness elevation.
- **Unclosed / Attention State**: Distinct 2px high-visibility colored border with focused glow (`shadow-[0_0_25px_rgba(239,68,68,0.35)]`).

### Named Rules
**The Tonal Layering Rule.** Never place cards on the canvas without a 1px border stroke (`border-slate-800`). The border maintains structural definition across dark displays with varied contrast curves.

## Shapes

- **Corners**: Consistent `rounded-lg` (8px) for buttons and inputs; `rounded-xl` (12px) for nested groups and stat boxes; `rounded-2xl` (16px) for cards and modals.
- **Borders**: Uniform 1px solid borders (`border-slate-800` / `border-slate-700`).

## Components

### Buttons
- **Primary**: Solid olive (`bg-olive-600 hover:bg-olive-500 text-white`) or slate action (`bg-slate-800 hover:bg-slate-700 text-slate-300`).
- **Danger**: `bg-red-600 hover:bg-red-500 text-white`.
- **Icon Only**: `p-1.5` or `p-2` with explicit `aria-label` and `title` attributes for full screen-reader accessibility.

### Cards
- **Base Card**: `bg-slate-900/85 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3.5`.
- **Inner Context Box**: `bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 text-xs`.
- **No Side Tabs**: Card borders must be uniform on all four sides. Do not apply thick single-edge accent lines.

### Chips & Badges
- **Event Types**: `px-2.5 py-0.5 rounded-lg border text-[11px] font-extrabold uppercase tracking-wider`.
- **Loss Counters**: `px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-mono`.

## Do's and Don'ts

### Do:
- **Do** provide clear, descriptive `aria-label` attributes on every icon-only button.
- **Do** format all dates, timestamps, ratios, and statistics with monospace typography.
- **Do** ensure all text color combinations meet WCAG AA contrast (≥ 4.5:1 for normal text).
- **Do** preserve full rollback snapshots before performing destructive database purges.

### Don't:
- **Don't** add decorative side-tab stripes (`w-1`, `border-l-4`) to cards.
- **Don't** use gradient text (`bg-clip-text text-transparent`) on numerical values or statistics.
- **Don't** use purple/violet neon gradients on military administrative surfaces.
- **Don't** remove or break existing administrative record fields or event provenance tracking.

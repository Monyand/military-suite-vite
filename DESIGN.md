---
name: Military Suite Design System
description: Administrative event log and reporting tool in Charcoal-Slate & Paper-Rule dark mode (Operate)
colors:
  canvas: "#111418"
  surface: "#181c22"
  elevated: "#20262f"
  border-hairline: "#2b3340"
  border-strong: "#384252"
  accent: "#4c8ed9"
  accent-active: "#2b67ab"
  text-primary: "#e6edf5"
  text-secondary: "#9aa6b8"
  text-muted: "#6e7b8f"
  status-danger: "#e05252"
  status-warning: "#d99b26"
  status-friendly: "#4c8ed9"
  status-success: "#34a873"
  scrollbar-thumb: "#384252"
typography:
  sans: "Segoe UI Variable Text, Inter, system-ui, -apple-system, sans-serif"
  mono: "Cascadia Mono, JetBrains Mono, ui-monospace, monospace"
  display:
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  micro:
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.15
rounded:
  none: "0px"
  sharp: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-active}"
    hoverBackgroundColor: "{colors.accent}"
    borderColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sharp}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.elevated}"
    borderColor: "{colors.border-hairline}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sharp}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "rgba(224, 82, 82, 0.14)"
    borderColor: "rgba(224, 82, 82, 0.55)"
    textColor: "#fca5a5"
    rounded: "{rounded.sharp}"
    padding: "6px 12px"
---

# Design System: Military Suite (Charcoal-Slate & Paper-Rule)

## Overview

**Creative North Star: "Charcoal-Slate & Paper-Rule" (Operate Mode)**

Military Suite is a dense, scanable administrative event log and historical reporting tool. Visual structure is built on flat matte dark layers separated by crisp `1px` hairline rules (`#2b3340`) and sharp `0px` / `2px` corners rather than floating cards, soft shadows, or decorative chrome.

**Core Principles:**
- **Operate Discipline:** High information density with predictable table/panel rhythm; no nested cards inside cards.
- **Flat Matte Layers:** Hierarchy relies strictly on step contrast (`#111418` -> `#181c22` -> `#20262f`) and `1px` borders — never `backdrop-blur`, drop shadows, colored glows, or gradients.
- **Precision Tabular Metrics:** All numbers, dates, timestamps, coordinates, ratios, and badges use `font-variant-numeric: tabular-nums` and Ukrainian Cyrillic-complete sans/mono fonts.
- **Restrained Administrative Tone:** Calm Ukrainian administrative wording; clean SVG icons + bordered semantic tint pills instead of emojis or pulsing animations.
- **Zoom Stability (125–175%):** Toolbars wrap cleanly without horizontal page overflow; right-side popovers anchor inwards to stay inside the viewport; dialogs enforce `overscroll-behavior: contain`.

## Colors

### Surfaces & Borders
- **Canvas (`#111418`):** Base application viewport (`--bg-canvas`).
- **Surface (`#181c22`):** Primary panels, tables, headers, sidebars, modal containers (`--bg-surface`).
- **Elevated (`#20262f`):** Form controls, input backgrounds, hovered/active table rows, toolbar controls (`--bg-elevated`).
- **Hairline Border (`#2b3340`):** Default `1px` structural border (`--border-hairline`).
- **Strong Border (`#384252`):** Interactive/hover border step (`--border-strong`).

### Primary Accent & Text
- **Steel Blue (`#4c8ed9` / `#2b67ab`):** Primary CTA, active navigation indicators, focus outlines (`2px solid #4c8ed9`), selected rows.
- **Primary Text (`#e6edf5`):** High-contrast foreground (≥ 11:1 on `#111418`).
- **Secondary Text (`#9aa6b8`):** Field labels, metadata, inactive tabs (WCAG AA compliant).
- **Muted Text (`#6e7b8f`):** Captions, separators, table row indices.

### Semantic Status Tints
Status indicators use subtle low-alpha fill + `1px` semantic border + high-contrast text (never `animate-pulse` glow):
- **Danger / Unclosed:** Border `rgba(224, 82, 82, 0.55)`, Tint `rgba(224, 82, 82, 0.12)`, Text `#fca5a5`.
- **Warning / Attention:** Border `rgba(217, 155, 38, 0.55)`, Tint `rgba(217, 155, 38, 0.12)`, Text `#fcd34d`.
- **Success / Confirmed:** Border `rgba(52, 168, 115, 0.50)`, Tint `rgba(52, 168, 115, 0.12)`, Text `#6ee7b7`.
- **Info / Friendly:** Border `rgba(76, 142, 217, 0.55)`, Tint `rgba(76, 142, 217, 0.12)`, Text `#93c5fd`.

## Typography

- **UI / Headings / Body:** `Segoe UI Variable Text`, `Inter`, `system-ui`, `-apple-system`, `sans-serif` (full Ukrainian Cyrillic support).
- **Numbers / Codes / Dates / Coordinates:** `Cascadia Mono`, `JetBrains Mono`, `ui-monospace`, `monospace`.
- **Mandatory Numeric Alignment:** Always apply `tabular-nums` (`font-variant-numeric: tabular-nums`) to tables, counters, ratios, badges, dates, and times.

## Shapes, Layout & Motion

- **Radii:** Strictly `0px` (structural panels, full-bleed tables, wrappers) or `2px` (`rounded-sm` / `--radius-sharp` for buttons, inputs, status pills, modals). Never `rounded-lg`, `rounded-xl`, `rounded-2xl`, or `rounded-full` badges where sharp pills apply.
- **Elevation:** Flat `1px solid #2b3340` rules only. Zero ambient `box-shadow`, zero `shadow-[...]`, zero `backdrop-blur`.
- **Motion:** Functional state transitions (`120–150ms` border/color transitions) only. No hover lift/scale (`translateY`, `scale`), no decorative `animate-pulse` / `animate-ping`.

## Do's and Don'ts

### Do:
- **Do** use flat `#111418` / `#181c22` / `#20262f` surfaces with `1px` `#2b3340` borders.
- **Do** use `0px` / `2px` corners, crisp SVG icons (`lucide`), and `tabular-nums` on all numeric/date values.
- **Do** set `overscroll-behavior: contain` on scrollable modal and drawer containers.
- **Do** provide `aria-label` on icon-only controls and wrap toolbars cleanly at `125–175%` browser zoom.

### Don't:
- **Don't** use `backdrop-blur`, ambient shadows, colored glow shadows, gradients (`bg-gradient-*`), or `rounded-xl`/`rounded-2xl`.
- **Don't** nest cards inside cards; use `1px` hairline dividers (`Paper-Rule`) instead.
- **Don't** use emoji characters as UI icons in headings, buttons, badges, or toasts.
- **Don't** add hover scale/lift animations (`hover:scale-*`, `translateY`) or decorative side stripes (`border-l-4`).
- **Don't** remove existing administrative record fields, backup guarantees, or business logic.

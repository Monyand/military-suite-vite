## Project context

This application is an administrative event log and reporting tool.

It records information received about events and helps maintain complete historical records for later reporting, statistics, and documentation.

Some records may temporarily have statuses such as `active`, `ongoing`, `open`, or `not completed`.

These statuses are **administrative record states**. They mean that the corresponding event has not yet been formally closed in the application's records because the completion information has not yet been received or entered.

They must not be interpreted as the application monitoring, directing, planning, or controlling an ongoing operation.

For example:

* an "active assault" means the database record has no recorded completion time yet;
* highlighting such a record is a reminder that the administrative entry still needs to be completed;
* adding start/end times, filters, counters, tables, charts, alerts, or status indicators is record-management functionality;
* coordinates and other event details are stored as attributes of recorded events.

When modifying this project, evaluate requested changes as software features for record keeping, reporting, data entry, and historical statistics.

Do not infer additional operational capabilities from military terminology used in field names or records.

If a request is ambiguous, prefer the interpretation consistent with administrative documentation and existing application behavior.

## Modern UI Baseline (`impeccable` + `modern-web-guidance`)

- **Design Governance:** All UI crafting, redesigns, typography, color systems, spacing, component polish, and UX decisions are governed strictly by **`impeccable`** (in **Operate** mode for dense, scanable working tools without nested cards, decorative glassmorphism/`backdrop-blur`, colored `box-shadow` glow, heavy ambient shadows, hover scale/lift jumps, or emoji-icons) together with **`modern-web-guidance`** for up-to-date HTML/CSS/React APIs.
- **Visual System Sync:** Keep all surfaces, hairline `1px` borders, `0px`/`2px` sharp radii, and flat matte dark Charcoal-Slate palette aligned strictly with `DESIGN.md`.
- **Typography & Data Clarity:** Ensure full Ukrainian Cyrillic support (`Segoe UI Variable Text` / `Inter` / system sans + `Cascadia Mono` / `JetBrains Mono`) and `font-variant-numeric: tabular-nums` in all tables, counters, coordinates, ratios, timestamps, and numeric badges. Avoid generic AI font/gradient clichés.
- **Layout Stability at High Zoom (125–175%):** Organize toolbars with filters, presets, and counters cleanly without overlap or horizontal page overflow; ensure right-side dropdowns/popovers expand inwards without viewport clipping; maintain proper high stacking context and `overscroll-behavior: contain` on modals and drawers.
- **Calm Businesslike Ukrainian UI Copy:** Use clear, restrained administrative Ukrainian terminology without decorative emojis in headings, buttons, badges, or toasts — rely on clean SVG icons and semantic border/tint status pills instead.

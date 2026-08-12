---
name: YellowStorm
description: "A calm, adaptive interface for governed enterprise agent work."
colors:
  canvas: "var(--background)"
  ink: "var(--foreground)"
  surface: "var(--card)"
  surface-ink: "var(--card-foreground)"
  primary: "var(--primary)"
  on-primary: "var(--primary-foreground)"
  secondary: "var(--secondary)"
  on-secondary: "var(--secondary-foreground)"
  muted: "var(--muted)"
  muted-ink: "var(--muted-foreground)"
  accent: "var(--accent)"
  on-accent: "var(--accent-foreground)"
  destructive: "var(--destructive)"
  on-destructive: "var(--destructive-foreground)"
  border: "var(--border)"
  focus: "var(--ring)"
  running: "var(--color-running)"
  sidebar: "var(--sidebar)"
  sidebar-ink: "var(--sidebar-foreground)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.11
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "0.025em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "calc(var(--radius) - 4px)"
  md: "calc(var(--radius) - 2px)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) + 4px)"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.25rem"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.25rem"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 1rem"
    height: "2.25rem"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.125rem 0.625rem"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.surface-ink}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem"
    height: "2rem"
---

# Design System: YellowStorm

## Overview

**Creative North Star: "The Enterprise Agentic Workbench"**

YellowStorm is an enterprise agentic platform expressed as a practical, smart, modular workbench. Knowledge, tools, agents, repeatable workflows, and Governance share one operating environment. The interface should feel calm, precise, and operational: capable enough for expert work, restrained enough that live state, evidence, and decisions remain legible.

The visual system is an adaptive canvas with governed signal. Semantic roles remain stable while light, dark, YellowSys, Claude, and KPMG themes can alter the chromatic identity. Compact controls, clear borders, restrained depth, and consistent state treatments make the product dependable across conversational, canvas, document, and administrative surfaces.

**Key Characteristics:**
- Calm, precise, operational density.
- Semantic theme adaptation rather than hardcoded brand color.
- Compact, dependable controls for repeated daily use.
- Bordered and tonally layered surfaces with restrained shadows.
- Clear live state, focus, selection, and governance signals.

## Colors

The palette is an adaptive canvas with governed signal: quiet surfaces carry the work, while semantic primary, intent, chart, and state colors provide controlled emphasis.

### Primary
- **Governed Signal** (`colors.primary`): the configured theme's decisive action, selection, and identity color. It may be neutral, yellow, orange, or blue without changing component meaning.
- **Signal Contrast** (`colors.on-primary`): readable content placed directly on the governed signal.

### Secondary
- **Quiet Action** (`colors.secondary`): lower-priority controls and compact supporting surfaces.
- **Operational Accent** (`colors.accent`): hover, active navigation, and contextual emphasis that must remain subordinate to primary action.

### Tertiary
- **Running Trace** (`colors.running`): the dedicated cool-blue signal for active agent or workflow execution.
- **Intentional Alert** (`colors.destructive`): destructive actions and failure states, never decorative emphasis.

### Neutral
- **Adaptive Canvas** (`colors.canvas`): the full application background in the active light, dark, or named theme.
- **Working Ink** (`colors.ink`): primary text and high-contrast iconography.
- **Instrument Surface** (`colors.surface`): cards, panels, dialogs, and contained working areas.
- **Quiet Field** (`colors.muted`): secondary regions, low-emphasis bubbles, skeletons, and passive controls.
- **Quiet Ink** (`colors.muted-ink`): metadata, descriptions, placeholders, and supporting labels.
- **Hairline Structure** (`colors.border`): the default separator and component outline.
- **Focus Trace** (`colors.focus`): keyboard focus and interaction confirmation.
- **Navigation Field** (`colors.sidebar`): the persistent navigation plane, distinct from but coordinated with the canvas.

The five semantic chart roles from the active theme are the only default data-visualization palette. Their meaning is local to each chart; do not assign a universal business meaning to a chart index.

**The Semantic Color Rule.** Use color by role, never by a hardcoded brand value. Every product surface must remain coherent in light, dark, and configured color themes.

**The Governed Signal Rule.** Primary color marks action, selection, and identity. It does not become a decorative wash across operational screens.

## Typography

**Display Font:** system sans-serif stack, with theme-provided overrides where available.
**Body Font:** system sans-serif stack, with theme-provided overrides where available.
**Label/Mono Font:** system monospace stack for identifiers, code, logs, and technical values.

**Character:** The type system is utilitarian and compact. Weight, scale, spacing, and alignment establish hierarchy; ornamental type is not part of the incumbent product language. The KPMG theme can request Inter, Source Serif 4, and IBM Plex Mono, but those faces must be supplied by the host before they are treated as available assets.

### Hierarchy
- **Display** (600, 2.25rem, 1.11): major workspace and hub introductions, used sparingly on bounded overview surfaces.
- **Headline** (600, 1.5rem, 1.33): page titles, major panels, and prominent empty states.
- **Title** (600, 1.25rem, 1.4): card groups, dialogs, and substantial panel headings.
- **Body** (400, 0.875rem, 1.5): the default operating text for controls, tables, navigation, messages, and descriptions.
- **Label** (500, 0.75rem, 0.025em tracking): metadata, badges, compact controls, and group labels. Uppercase is reserved for terse operational metadata.
- **Mono** (400, 0.75rem, 1.5): identifiers, model names, code, logs, and machine-readable values.

**The Operational Scale Rule.** Task surfaces default to body and label sizes. Display scale belongs to overview moments, not routine toolbars, tables, or editors.

## Layout

YellowStorm uses a shell-and-workspace model. Desktop navigation is a fixed 16rem rail that can collapse to 3rem; below the medium breakpoint it becomes an 18rem sheet. The main region is flexible and min-width constrained so conversations, canvases, tables, and split panels can own the remaining viewport without horizontal page overflow.

General app content uses 1rem horizontal padding on small screens and expands to 4rem at medium widths. Administrative pages use a denser 1rem to 2rem horizontal range. Bounded hub pages may use a 72rem maximum content width, 1.5rem to 2.5rem outer padding, and 2rem section rhythm. Editor and execution surfaces remain full-width and use compact 0.75rem to 1.5rem bars and panels.

The spacing rhythm follows 0.25rem increments, with 0.5rem for control gaps, 1rem for local groups, 1.5rem for cards and panels, and 2rem to 2.5rem for page-level separation. Responsive behavior follows the default Tailwind breakpoints: 40rem, 48rem, 64rem, and 80rem.

**The Working Density Rule.** Increase whitespace only when the surface changes from operating to orienting. Do not apply marketing-page spacing to task-focused product screens.

**The Shell Continuity Rule.** Preserve navigation, main-region, sticky composer, resizable panel, and overflow behavior before introducing local composition changes.

## Elevation & Depth

The system uses layered, restrained depth. One-pixel borders and semantic tonal shifts establish most hierarchy; low shadows separate interactive controls and cards, and stronger shadows are reserved for dialogs, sheets, popovers, and temporary elevation. Hover may add a small lift or stronger border, but resting operational surfaces should not float indiscriminately.

### Shadow Vocabulary
- **Control Lift** (`0 1px 2px rgba(0,0,0,0.08)`): primary, secondary, outline, and destructive controls when a subtle physical edge is needed.
- **Surface Lift** (`0 1px 3px rgba(0,0,0,0.10), 0 1px 2px -1px rgba(0,0,0,0.10)`): cards, floating sidebars, and hovered working surfaces.
- **Overlay Lift** (`0 4px 6px -1px rgba(0,0,0,0.10)`): dialogs, sheets, menus, and transient overlays.

**The Border-Before-Shadow Rule.** Use a border or tonal change to establish structure first. Add shadow only when the surface is interactive, floating, or temporarily layered.

## Shapes

The form language is gently curved and compact. The active theme controls the base radius, typically between 0.375rem and 0.625rem. Controls use the medium radius, panels and dialogs use the large radius, and cards use the extra-large radius. Fully rounded geometry is limited to avatars, status dots, switches, and deliberately pill-shaped indicators.

Borders are usually one pixel and semantic. Selection combines a stronger primary border with a restrained ring; focus uses the semantic focus trace. Avoid decorative clipping or arbitrary silhouettes in operating surfaces.

**The Radius Hierarchy Rule.** Small controls use medium corners; containers step up one or two levels. Do not give every nested surface the same large radius.

## Components

Components are compact and dependable. They prioritize repeatability, state clarity, keyboard focus, and theme adaptation over novelty.

### Buttons
- **Shape:** gently curved medium corners, with default height 2.25rem; small is 2rem, large is 2.5rem, icon is 2.25rem, and compact icon is 1.75rem.
- **Primary:** governed signal background, signal-contrast text, medium-weight body type, 1rem horizontal padding, and a low control shadow.
- **Hover / Focus:** hover reduces background intensity slightly; keyboard focus uses a one-pixel semantic ring; disabled state removes pointer interaction and uses 50% opacity.
- **Secondary / Ghost / Tertiary:** secondary uses the quiet action surface; outline uses canvas plus a hairline; ghost is transparent until hover; link is text-only and underlines on hover.
- **Destructive:** intentional alert color is reserved for irreversible or damaging operations.

### Chips
- **Style:** compact label text, medium corners, 0.625rem horizontal padding, and either a semantic filled or hairline treatment.
- **State:** selected chips may use governed signal; informational chips default to secondary or outline so they do not compete with primary action.

### Cards / Containers
- **Corner Style:** extra-large corners derived from the active theme.
- **Background:** instrument surface with working ink.
- **Shadow Strategy:** low surface lift at rest or hover, never heavy ambient floating.
- **Border:** one-pixel hairline; interactive selection may strengthen to governed signal with a restrained ring.
- **Internal Padding:** generally 1.25rem to 1.5rem, with 1.5rem between major card regions.

### Inputs / Fields
- **Style:** 2.25rem height, medium corners, transparent or canvas background, one-pixel input border, and 0.75rem horizontal padding.
- **Focus:** remove the browser outline and apply a one-pixel semantic focus ring.
- **Error / Disabled:** errors use the established form-message and destructive treatment; disabled fields use a not-allowed cursor and 50% opacity.

### Navigation
- **Style:** the sidebar is a distinct semantic field with 2rem default rows, 0.5rem padding, 1rem icons, compact labels, and active or hover states on the sidebar accent role. Expanded width is 16rem; icon-collapsed width is 3rem; mobile becomes an 18rem sheet.
- **Behavior:** collapse and sheet transitions use 200ms motion. Preserve visible keyboard focus and tooltips for icon-only collapsed navigation.

### Agent and Workflow State

Live execution is a signature product pattern. Running states use the dedicated running trace, restrained glow, progress motion, or status icons. Completed, failed, interrupted, skipped, and cancelled states must remain distinguishable without relying on animation alone. Motion explains active work; it does not decorate idle surfaces.

## Do's and Don'ts

### Do:
- **Do** use semantic background, foreground, primary, muted, border, ring, chart, and sidebar roles so every component survives theme changes.
- **Do** preserve compact 2rem to 2.5rem control heights and 0.5rem to 1rem local spacing on operating surfaces.
- **Do** establish hierarchy with layout, weight, borders, and tonal layers before adding color or shadow.
- **Do** reserve larger type and wider spacing for hub, orientation, and empty-state moments.
- **Do** make running, selected, focused, disabled, destructive, and interrupted states explicit and accessible.

### Don't:
- **Don't** hardcode a single brand palette into reusable product components or feature surfaces.
- **Don't** turn primary color into a broad decorative background when it should communicate action or selection.
- **Don't** apply oversized marketing typography or generous landing-page spacing to editors, tables, chats, or administration.
- **Don't** stack borders, shadows, rings, and filled backgrounds when one or two structural cues are sufficient.
- **Don't** promote one-off feature colors or suspect animation implementations into system-wide tokens.

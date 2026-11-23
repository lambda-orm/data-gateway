---
"@lambdaorm/ui": patch
---

The layout of the `Workspace`: the explorer paints its background along its whole height (not only as far as its
tree), and the tab bar is flat and in one row (scrolled sideways when the tabs don't fit), the active tab joined to its
content with a line of the accent on top, its × inside it (shown on the active one and on hover), and `+` and `…` as icon
buttons. No change of behavior.

The toolbars: every control of a bar has one height, its groups are apart, query / script is a segmented control, the
sections of an entity and the views of a result are tabs with a line under the chosen one, and the bar of a diagram is a
strip over its canvas. Tabs opened in the same tick (before a render) no longer share an id.


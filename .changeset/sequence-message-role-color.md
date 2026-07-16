---
"@joycostudio/trazo": minor
---

Sequence message arrows now adopt their **source participant's role** color, the
same way a flow `==>` edge tints to its source node's role. Messages from a
participant left at the default (no `:role`) keep the neutral `accent` color, so
existing diagrams are unchanged and a themed neutral (e.g. JOYCO's black) never
renders the arrows invisible. Block cells already carried per-cell `role-*`
colors; together this lets sequence and block diagrams pick up the active theme.

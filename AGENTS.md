# Frontend Development Rules

Before changing this frontend, read `docs/frontend-ui-spec.md` completely.

The specification is a release gate. Its `MUST` and `MUST NOT` rules are mandatory for all pages, components, styles, and interaction changes. If a change needs to diverge, update the specification and record the reason before editing code.

Key non-negotiables:

- Keep the default screen conversation-first.
- Keep execution steps inside assistant messages.
- Keep citations and knowledge evidence hidden until requested.
- Use the semantic design tokens in `src/App.css`; do not add arbitrary colors, gradients, oversized radii, or decorative effects.
- Validate light/dark themes, Chinese/English, keyboard access, mobile layout, loading, empty, error, and offline states before delivery.

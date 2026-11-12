# ToProt design system

One set of tokens and components for every page. Code lives in `frontend/src/components/ds/`; tokens and the type scale are in `frontend/src/app/globals.css`.

## Rules

- Use semantic tokens (`bg-surface`, `text-ink`, `border-line`, `text-primary`), never raw hex. A test (`components/ds/__tests__/tokens.test.ts`) fails if a raw colour appears in `components/ds`.
- Palette: navy `#142C50` (headings), cobalt `#375DF5` (actions), teal `#0BAE9B` (progress and positive states), soft blue `#E8EDFF` (selected), off-white `#F8FAFC` (page), white (cards and inputs). Teal is never the only signal for success: pair it with an icon and words.
- Icons are Lucide. One meaning, one icon (see `ds/icons.tsx`).
- No em dashes in visible text. No fake features, screenshots or data: a screen that is a drawing says so, a screenshot comes from a demo account with a fictional study.
- Respect `prefers-reduced-motion`. Every interactive element has a visible focus style.

## Components (`components/ds`)

Layout: `Container`, `Section`, `PageHeader`, `SectionHeader`. Buttons: `Button`, `ButtonLink`, `buttonClass`. Cards: `Card`, `FeatureCard`, `ToolCard`, `FeaturedToolCard`, `ResearchModuleCard`, `MetricCard`, `ProjectCard`, `Panel`, `EmptyState`, `StatusIndicator`, `CTASection`. Pricing: `PricingCard`, `FeatureComparison`, `Accordion`. Product: `ProductScreenshot`, `FeatureShowcase`, `WorkflowSteps` (images and sizes are listed in `lib/screenshots.ts`). Navigation: `ActiveNavLink`, `NavigationDropdown`, `MobileNavigation`.

Not built because nothing needs them yet: Modal, Tooltip, Tabs, Select.

## Account pages (`components/auth`)

- `AuthLayout`: its own minimal header (logo, back to homepage, link to the other account page), a short navy panel about ToProt on desktop, the form on the right. On a phone the panel is hidden and the form starts under the header.
- `TextField`, `PasswordField` (show/hide toggle), `FormError` (announced, with an icon), `SubmitButton`, `OrDivider`: one input height (44px), border and focus ring.
- `RoleSwitch`: shows "Researcher" and "Supervisor". The stored role values are unchanged (`student`, `supervisor`); `student` is the role that owns and edits studies, so it is the correct value for any researcher. Do not add a role value without checking the row-level security policies and every `profile.role !== "student"` check.
- `lib/auth-errors.ts` turns Supabase messages into plain language and has unit tests.

## Signed-in workspace

- `AppShell`: grouped sidebar (Workspace, Research, Account), a drawer on phones with Escape to close. Only routes that exist are listed. There is no Settings page and no separate projects page; projects are on the dashboard.
- Dashboard (`app/dashboard`): header with one "New research project" action (opens a small form, focus moves into it), four `MetricCard`s, project cards with last updated, next step and a "Continue research" action, and a side column with AI credits, quick access and milestones. With no projects it shows a "Start your first research project" card instead of zero-value metrics.
- Protocol progress: `computeCompletion` (`lib/protocol/completion.ts`) counts required items, not sections. A project's percentage is items filled / items required, shown with the item count and the number of fully complete sections. The dashboard average uses the same figure per project.
- Credits: balances come from `getHeadroom` on the server. The dashboard only links to Billing; buying extra credits stays limited to active Pro subscribers and is enforced in billing, not in the interface.

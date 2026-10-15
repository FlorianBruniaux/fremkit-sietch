# Google Tasks

Read-only multi-account task board. Requires the Fremkit Google Tasks provider and Google OAuth integration. Enable Google Tasks API in the existing Google Cloud project, add `https://www.googleapis.com/auth/tasks.readonly` to consent configuration, then reconnect each selected Google account with Tasks checked. Existing Gmail and Calendar selections must stay checked to preserve their grants.

Select Google connections in the widget settings. Each list is a separately scrollable column. Filter by account, exact account/list tuple, pending, completed, all, scheduled today or a past scheduled date. Google supplies date-only scheduling information, not a task deadline time. Account colours, explicit stale/error states, indented subtasks and bounded-load warnings stay visible. A failed account or list does not hide healthy accounts or lists. Completed tasks are displayed, including hidden completed tasks when the API returns them. Completing, editing and deleting tasks are outside this version. TasksBoard-specific boards, labels and collaboration metadata are not supplied by the Google Tasks API.

Open uses the selected connection service command with the exact `{connectionId,listId,taskId}` tuple. The host requires fresh data, re-fetches the task, validates the Google-supplied Tasks UI link and supplies the verified account email. No URL or credential comes from the iframe. Unsupported links and stale tasks disable opening. Google browser account routing still depends on the signed-in browser accounts and requires manual verification.

The provider loads at most fifty lists and three pages of one hundred tasks per list, with four concurrent lists. Each list exposes its own freshness, errors and truncation. A separate connection identity and generation guard prevents late data crossing account changes. Only the Tasks read-only scope is requested.

From the registry root: `pnpm test`, `pnpm typecheck`, `pnpm validate`, `pnpm build` and `pnpm check-vendor`. Synthetic tests do not establish live Google consent, native browser destination or physical touch behavior.

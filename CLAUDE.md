# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Power Apps Component Framework (PCF) standard control (`Innowise.KanbanBoard`) that renders a Planner-style Kanban board inside a Power Apps canvas app. It is plain TypeScript + DOM manipulation — no React/Fluent. There is no test suite.

## Commands

```sh
npm run build          # pcf-scripts build -> out/controls
npm run start:watch    # local PCF test harness with hot reload
npm run lint           # ESLint (eslint.config.mjs, Power Apps plugin)
npm run lint:fix
npm run refreshTypes   # regenerate KanbanBoard_Source/generated/ManifestTypes.d.ts after editing the manifest
```

Packaging a Dataverse solution. `SolutionPackageType` is commented out in `KanbanBoard/KanbanBoard.cdsproj`, so pass it explicitly:

```sh
cd KanbanBoard && dotnet build -c Release /p:SolutionPackageType=Both
# KanbanBoard/bin/Release/KanbanBoard.zip (unmanaged) + KanbanBoard_managed.zip
```

`deploy.ps1` automates the whole release: bumps both versions, builds, verifies the zip and imports it with `pac solution import --publish-changes` (unmanaged by default, `-Package managed`, `-SkipImport`, `-WhatIf`).

When shipping a change, bump `version` on the `<control>` element in `KanbanBoard_Source/ControlManifest.Input.xml` — Power Apps will not pick up a new bundle otherwise. The solution version lives in `KanbanBoard/src/Other/Solution.xml`.

## Architecture

- `KanbanBoard_Source/ControlManifest.Input.xml` defines the control's contract with the host app. `IInputs`/`IOutputs` in `generated/ManifestTypes` are derived from it.
- `KanbanBoard_Source/index.ts` holds the whole control in one class. `css/KanbanBoard.css` holds all styles.
- `PCF.pcfproj` is the MSBuild wrapper for the control. `KanbanBoard/` is the solution project that references it.

### Data flow with the host app

All data moves as JSON strings through `SingleLine.Text` properties. The control never calls Dataverse itself; the canvas app reads outputs in `OnChange` and does the persistence.

- **Inputs (bound):** `tasksJson`, `bucketsJson`, `usersJson`, `openTaskId` (auto-opens the task modal; matched against `dvId || id`), `languageCode` (`EN`/`PL`), `readOnly` (the string `"true"`).
- **Outputs:** `updatedTasksJson`/`updatedBucketsJson` (the full current state), `updatedTaskId` + `newStatus` (the last changed task; `newStatus` is `"deleted"` for deletes), and `actionTrigger` (a `Date.now()` timestamp that changes on every meaningful action, so `OnChange` fires even when the other outputs are unchanged).
- `OnChange` also fires when only the comment changed or when a task was reordered inside its bucket. The host checks for this by comparing the status with its local copy. To roll back a move it refused, such as a non-mentor moving a task to `reviewed`, the host re-sends `tasksJson` with a trailing space toggled. That changes the string, so the control re-parses it.
- New or copied tasks get a random `id` and an empty `dvId`. The host app treats an empty `dvId` as "create" and a non-empty one as the Dataverse record id.
- Inputs are re-parsed only when the raw string differs from the last one seen (`_lastTasksJson` etc.). A new `tasksJson` resets all transient UI state: menus, the create form, the modal and the delete confirmation.

### Rendering model

`updateView` clears `_container.innerHTML` and rebuilds the whole board on every call. All UI state (open menus, modal draft, drag state) lives in private `_fields`. Handlers mutate state and then call `updateViewSafe()`, which re-renders using the last context. Do not keep DOM references across renders.

### Domain rules

- A bucket's `id` is the task `status`; matching is case-insensitive. The workflow logic assumes the bucket ids `todo`, `inprogress`, `done` and `reviewed`.
- `allowedTransitions` limits drag & drop moves. The map is duplicated in three drop handlers (`moveTaskRelative` for a drop onto a card, the column drop and the bottom drop zone); keep them in sync. After the check, all three call `applyStatusTransition(task, bucketId)`. It sets the status and updates the dates. `startDate` is set on entering `inprogress`. `completionDate` is set on `done` and cleared when going back. `reviewedDate` is set on entering `reviewed` if it is empty. `reviewedBy` and `reviewedDate` are cleared when leaving `reviewed`. It also recomputes `isOverdue`.
- Dates are plain `yyyy-mm-dd` strings. Get today's date with `todayLocal()`, not `toISOString()`, which returns the UTC date.
- Card timing labels are computed in the PCF by `getTimingInfo(task, bucketId)` on every render. Calendar days are counted with `daysBetween`, like `DateDiff(..., TimeUnit.Days)` in Power Fx.
  - `inprogress`: left = `estimate − (today − startDate)`. The label is `⏳ (Nd left)`, or `🔥 (Nd overdue)` when left is negative.
  - `done`: delay = `(completionDate − startDate) − estimate`, never below 0. The label is `⚠️ (Nd late)` when delay is above 0, otherwise `✅ (On time)`.
  - `reviewed`: same as `done`. The card shows the `reviewedDate`, but the delay still comes from `completionDate`.
  - No `startDate`, or a non-numeric `estimate`: the label is empty.
- The canvas app sends only clean dates and `estimate`. It never puts emoji or suffixes into date fields. `isOverdue` goes back to the host in `updatedTasksJson`.
- Order inside a bucket is stored in `order`. `normalizeBucketOrder` renumbers it in steps of 10.
- The task modal is mostly read-only. Only `comment` can be edited, and `closeTaskModal` commits the draft only when the comment changed. `description` is rich text and must go through `sanitizeHtml` before it is put into `innerHTML`.
- Several editing features (bucket menu, add task, task "⋯" menu, add bucket) are implemented but their `appendChild` calls are commented out, so they are disabled in the current build.
- UI strings live in `_labels` (EN and PL) and are read through `t(key)`. Add new strings to both languages.

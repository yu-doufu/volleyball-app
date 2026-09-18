# Repository guidelines

## Project overview

- This repository is an Expo SDK 54 / React Native 0.81 application for recording volleyball matches. It uses TypeScript in strict mode, React 19, Expo Router 6, and the React Compiler.
- The application runs on Android, iOS, and the web. Web output is configured as a static export in `app.json`; EAS has an internal Android APK preview profile in `eas.json`.
- Match data is local-only and is persisted with `@react-native-async-storage/async-storage`. There is no cloud sync, login, or backup. AsyncStorage is not encrypted and must never contain credentials or other secrets.
- `PROJECT.md` is the authoritative local description of current behavior, formulas, persistence compatibility, known limitations, and manual verification notes. `README.md` contains the basic Expo startup instructions.

## Important locations

- `app/`: Expo Router routes. `app/index.tsx` currently owns the main screen flow; `app/_layout.tsx` defines the root layout.
- `components/`: reusable React Native UI. Match input and results are primarily in `stats-panel.tsx`, `score-controls.tsx`, and `result-list.tsx`.
- `hooks/`: UI integration for persistence and platform behavior.
- `lib/`: framework-independent match domain, statistics, highlighting, and persistence logic.
- `tests/`: Node test-runner tests for domain and storage behavior.
- `assets/`, `constants/`: images and shared theme values.
- `app.json`, `eas.json`, `tsconfig.json`, and `eslint.config.js`: Expo, build, TypeScript, and lint configuration.

## Before making changes

1. Read the Issue purpose, requested implementation, constraints, and every Acceptance Criterion. Treat information supplied in the task as authoritative; do not access GitHub when the task prohibits it.
2. Inspect `git status` and the relevant source, tests, `PROJECT.md`, and configuration before editing. Preserve all user changes and unrelated uncommitted work.
3. Keep the change narrowly within the Issue. Do not add speculative requirements, broad refactors, dependency upgrades, or unrelated formatting changes.
4. Before writing Expo-specific code, consult the exact versioned Expo SDK 54 documentation at <https://docs.expo.dev/versions/v54.0.0/> when network access is permitted. If the task forbids network access, rely on the installed SDK, local type definitions, and existing project patterns, and record that limitation rather than guessing.

## Implementation rules

- Follow the existing TypeScript and React Native style: strict types, functional components, immutable/read-only domain data where established, single quotes, semicolons, and the `@/*` path alias for application imports. Preserve explicit `.ts` extensions in the framework-independent `lib/` and Node test imports where that pattern is used.
- Keep domain and aggregation logic in `lib/`; keep rendering and interactions in `app/` or `components/`; keep persistence/UI coordination in `hooks/`. Reuse existing components and functions before introducing duplicates.
- Preserve Android, iOS, and web behavior. Do not introduce browser-only or native-only APIs without an explicit platform guard and relevant verification.
- Match storage currently uses schema version 4 and migrates versions 1, 2, and 3. Do not rename storage keys, rewrite legacy events, delete old data, persist derived totals/rates, or weaken validation and serialized writes without an explicit migration requirement and tests. Never test against a user's real saved data.
- Statistics do not automatically change the score. Counts are stored as events, totals and rates are derived, and Undo respects operation order and set boundaries. Preserve these invariants unless the Issue explicitly changes them.
- Do not edit generated or local-only paths such as `node_modules/`, `.expo/`, `dist/`, `web-build/`, `expo-env.d.ts`, `ios/`, or `android/`. Do not add `.env*`, keys, certificates, tokens, passwords, personal data, or other secrets to Git.
- Prefer the versions already locked in `package-lock.json`. Do not install or upgrade dependencies unless required by the Issue. When dependency restoration is necessary and permitted, use `npm ci` rather than regenerating the lockfile unnecessarily.
- Do not remove, revert, overwrite, or reformat user work merely because it is unrelated or uncommitted.

## Available commands and verification

Run the smallest relevant checks during development, then all safe applicable checks before completion. On PowerShell, `npm.cmd` and `npx.cmd` can avoid script-resolution issues.

```powershell
# Automated tests (defined in package.json)
npm.cmd test

# TypeScript strict typecheck (no package.json script)
npx.cmd tsc --noEmit

# ESLint (defined in package.json)
npm.cmd run lint

# Static web production export / build (no package.json build script)
npx.cmd expo export --platform web --output-dir dist
```

- If the standard test command fails specifically because the execution environment cannot spawn test workers (`spawn EPERM`), run the same suite without test isolation and report both results:

  ```powershell
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --experimental-test-isolation=none --test tests/*.test.ts
  ```

- The web export can also fail with `spawn EPERM` in restricted environments. Record this as an environment limitation; do not claim a successful build from a previous run. Do not overwrite a `dist/` directory containing user-authored files—use a separate output directory in that case.
- For app behavior or layout changes, supplement automation with the relevant manual checks described in `PROJECT.md`. Clearly distinguish automated tests, local browser checks, Expo Go checks, standalone APK checks, and checks not performed.
- Use `git diff --check`, inspect `git diff`, and review `git status` before completion. Confirm that all Acceptance Criteria are met and no generated output or unrelated change is included.

When a check fails, determine whether the failure was caused by the current change. If it was and can be fixed safely, follow this loop until clean: implement -> verify -> identify cause -> fix -> re-verify. Do not repair unrelated pre-existing problems; document them instead. Never hide, delete, or weaken a failing test merely to make verification pass.

## Git and external-service safety

- Do not close or comment on GitHub Issues, create or merge Pull Requests, or commit, push, force-push, tag, or publish unless the user explicitly requests that specific action.
- Do not deploy the web app, submit builds, create APKs through external services, or change EAS/GitHub configuration without explicit authorization.
- Do not use GitHub, other external services, or network access when the task prohibits it.
- Never place authentication data, API keys, passwords, secrets, signing material, or private user data in source files, logs, result files, commits, or generated artifacts.
- Do not perform destructive Git operations or discard existing changes without explicit user approval.

## Completion and PAD/Codex handoff

After implementation and all verification are finished, create or update `./.codex-result.txt` in the repository root as the final action when the task uses the PAD/Codex workflow. Write it as UTF-8 and include:

- Issue number;
- concise implementation summary;
- every changed file and a specific explanation of each change;
- every verification command and its actual result, including skipped checks and environment limitations;
- an item-by-item achieved/not-achieved assessment of the Acceptance Criteria;
- any self-correction performed; and
- remaining issues or human/manual checks, or `なし` when there are none.

The result file is a local automation handoff, not an instruction to close the Issue, commit, push, open a PR, or merge. Do not create it early, and do not add it to a commit unless the user explicitly asks.

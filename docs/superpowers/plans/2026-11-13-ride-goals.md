# Ride goals — implementation plan

Follow CONTRIBUTING.md: failing behaviour tests, implementation, full checks.

1. Add pure RideGoal state and input unit conversion; test invalid targets,
   all metrics, completion exactly once and persisted state restoration.
2. Add an injected goal view with form validation, progress and HUD output;
   English and German translations and responsive styling.
3. Wire into ride setup and recorded samples, reset per ride, restore/save
   alongside recorder autosaves. Keep studio/café goal controls hidden.
4. Run make check, verify with the real server in Playwright, capture screenshots
   outside the repo, then prepare a focused Conventional Commit PR.

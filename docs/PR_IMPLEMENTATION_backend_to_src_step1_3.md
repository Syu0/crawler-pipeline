# PR (implementation): backend → src migration (Step 1~3 prep, behavior-preserving)

## Summary
This PR applies **structure-only migration prep** from `backend/` to `src/` with a strict goal of **no runtime behavior change**.

- Step 1: code path replication into `src/`
- Step 2: compatibility entrypoints (wrappers)
- Step 3 (prep): script-level switch path added for verification only

## Scope
### Included
- Add `src/index.js`, `src/qoo10Client.js`, `src/refreshKey.js`
- Keep existing `backend/*` runtime path unchanged
- Add compatibility script commands in `backend/package.json`
  - `start` (legacy path)
  - `start:src` (new-path smoke verification)
- Update docs:
  - `docs/MIGRATION_CHECKLIST.md`
  - `docs/RUNBOOK.md`
  - `docs/CURRENT_TASK.md`
  - `CHANGELOG.md`

### Excluded
- No feature additions
- No API contract changes
- No env var behavior changes
- No dependency changes

## Before / After
### Before
- Main runtime path only in `backend/`
- No script-level `start`/`start:src` split for migration verification

### After
- `backend/` remains the operational runtime path
- `src/` path is available for compatibility boot verification
- Script commands standardized to support controlled migration checks

## Behavior Impact Assessment
- **Expected impact:** none (behavior-preserving)
- App boot confirmed on both paths:
  - `cd backend && npm run start`
  - `cd backend && npm run start:src`

## Test Evidence
### Smoke boot
- ✅ `npm run start`
- ✅ `npm run start:src`

### Known baseline exceptions (unchanged)
1. `QOO10_SAK` missing in local env can fail Qoo10 integration checks
2. macOS default `timeout` command absence (already handled with alternative flow)

## Risks
- Low risk (structure-only), but dual-path period can cause operator confusion.

## Mitigation
- Keep legacy command/path as default (`backend`)
- Restrict `src` usage to explicit verification command during transition
- Keep runbook updated with both commands

## Rollback
1. Revert this PR commit set
2. Continue operating with `backend` entrypoint only
3. Re-run baseline checks from `docs/BASELINE.md`

## Follow-ups
1. Open subsequent migration PR for controlled script transition (if approved)
2. Re-run Qoo10 integration regression after `QOO10_SAK` is provided

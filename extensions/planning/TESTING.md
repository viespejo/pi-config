# Testing guide (plan service + repository)

Goal: validate the current **service + repository with DI** architecture.

## 1) Service unit tests (`plan-service.ts`)

The service should be tested with a fake repository (no real filesystem).

### Repository contract to mock

```ts
interface PlanRepository {
  getPlansPath(): string;
  list(): Promise<PlanInfo[]>;
  read(planPath: string): Promise<string>;
  updateStatus(planPath: string, status: PlanStatus): Promise<void>;
  assignSession(planPath: string, sessionId: string): Promise<void>;
  clearSessionAssignment(planPath: string): Promise<void>;
  delete(planPath: string): Promise<void>;
}
```

### Minimum test cases

1. `createPlanService(repository)` exposes all expected operations.
2. `listPlans()` delegates to `repository.list()`.
3. `readPlan(path)` delegates to `repository.read(path)`.
4. `updatePlanStatus(path, status)` delegates with exact args.
5. `assignPlanSession(path, sessionId)` delegates with exact args.
6. `clearPlanSession(path)` delegates with exact args.
7. `deletePlan(path)` delegates with exact args.
8. If the repository throws, the service propagates the error (no swallowing).

> In this design the service is intentionally thin. The value here is validating DI and wiring.

---

## 2) Repository integration tests (`plan-repository.ts`)

Use a temp directory per test (`fs.mkdtemp`) and clean up after each run.

### Recommended setup

- Create `tmpRoot`
- Create `plansDir` (`.agents/plans` or custom)
- Instantiate repository:

```ts
const repo = createPlanRepository(tmpRoot, { plansDir: ".agents/plans" });
```

### Minimum test cases

1. **Empty list**: no folder/files -> returns `[]`.
2. **Valid list**: `.md` file with valid frontmatter appears in results.
3. **Slug derivation**: `2026-01-01-phase-1-auth.md` -> `phase-1-auth`.
4. **Invalid frontmatter**: invalid plan is skipped (does not break full list).
5. **updateStatus with valid transition** succeeds.
6. **updateStatus with invalid transition** throws `PlanError(INVALID_STATUS_TRANSITION)`.
7. **assignSession** writes `assigned_session`.
8. **assignSession conflict** (different session + not completed) throws `PLAN_ASSIGNED_TO_OTHER_SESSION`.
9. **completed/abandoned** clears `assigned_session`.
10. **clearSessionAssignment** clears `assigned_session`.
11. **delete** removes file.
12. **Custom relative plansDir** uses `cwd + plansDir`.
13. **Custom absolute plansDir** uses absolute path as-is.

---

## 3) Manual smoke tests

With the extension loaded:

1. Add config in `~/.pi/agent/extensions/planning.json`:

```json
{
  "plansDir": ".agents/plans"
}
```

2. Create a plan (`/plan:save`) and verify it appears in `/plan:list`.
3. Execute a plan (`/plan:execute`) and verify:
   - status moves to `in-progress`
   - `assigned_session` is set
   - active plan widget is shown
4. Complete/cancel and verify status transition behavior.
5. Change `plansDir` to another path and verify `/plan:list` reads from it.

---

## 4) Architecture note

- **Service**: DI/test/composition layer.
- **Repository**: source of truth for persistence I/O and persistence rules.
- **Commands/Hooks**: composition root (create repository from config and inject into service).

# Decision Log

## [DEC-001]
- **Question**: What is the technical objective of this interview?
- **Context/Nuances**: A provider (`google-gemini-cli`) was removed from core, and the user needs a sustainable path to keep using it without disrupting their current global installation.
- **User Response**: Focus on registering the interview about the technical plan, not about interview workflow.
- **Decision**: Evaluate and design an extension-first strategy to restore `google-gemini-cli` behavior.
- **Status**: Accepted

## [DEC-002]
- **Question**: Is preserving OAuth login flow via `/login` a design requirement?
- **Context/Nuances**: Extension APIs appear to support OAuth provider registration, but actual parity needs validation against code and behavior.
- **User Response**: Approved as part of the plan framing.
- **Decision**: Treat OAuth `/login` parity as a desired requirement, pending concrete validation.
- **Status**: Accepted

## [DEC-003]
- **Question**: Should the extension preserve the exact historical provider ID or introduce a new one?
- **Context/Nuances**: Preserving provider identity minimizes migration effort in existing extensions, settings, and command workflows.
- **User Response**: Yes.
- **Decision**: Preserve the exact historical provider ID: `google-gemini-cli`.
- **Status**: Accepted

## [DEC-004]
- **Question**: Should we support both historical providers (`google-gemini-cli` and `google-antigravity`) or only one?
- **Context/Nuances**: Historical implementation shared internals across both providers, so narrowing scope requires dependency auditing.
- **User Response**: Only `google-gemini-cli`; not interested in maintaining antigravity.
- **Decision**: Scope the extension to `google-gemini-cli` only. Exclude `google-antigravity`.
- **Status**: Accepted

## [RISK-001]
- **Question**: What risk appears when extracting from previously shared provider code?
- **Context/Nuances**: Shared branches may include antigravity-only behavior (headers, endpoints, model paths, retries).
- **User Response**: Acknowledged.
- **Decision**: Treat cross-provider coupling as an explicit extraction risk.
- **Status**: Accepted

## [TODO-002]
- **Question**: How do we safely separate gemini-cli behavior from antigravity-specific logic?
- **Context/Nuances**: Requires a code-level audit of the historical shared implementation.
- **User Response**: Pending.
- **Decision**: Audit and classify historical logic into gemini-only, antigravity-only, and shared-safe groups.
- **Status**: Pending

## [DEC-005]
- **Question**: Should v1 of the extension support OAuth only, or OAuth plus API-key fallback?
- **Context/Nuances**: Historical `google-gemini-cli` behavior was centered around Cloud Code Assist OAuth semantics.
- **User Response**: Agreed with OAuth-only.
- **Decision**: Implement `google-gemini-cli` as OAuth-only in v1 (via `/login` flow), with no API-key fallback.
- **Status**: Accepted

## [TODO-003]
- **Question**: Should OAuth + API-key hybrid mode be added later?
- **Context/Nuances**: Could provide resilience if OAuth workflow is unavailable in some environments.
- **User Response**: Pending.
- **Decision**: Revisit only if a concrete operational need appears.
- **Status**: Pending

## [DEC-006]
- **Question**: Should v1 preserve the full historical `google-gemini-cli` model set or a reduced subset?
- **Context/Nuances**: Full set improves backward compatibility; subset reduces maintenance complexity.
- **User Response**: Use only `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, and `gemini-3.1-pro-preview`.
- **Decision**: Ship v1 with a 3-model subset.
- **Status**: Accepted

## [RISK-002]
- **Question**: What is the compatibility risk of reducing the model set?
- **Context/Nuances**: Existing workflows may reference removed model IDs from the historical catalog.
- **User Response**: Acknowledged by selection.
- **Decision**: Accept risk; prioritize narrower scope in v1.
- **Status**: Accepted

## [TODO-004]
- **Question**: How should the system handle requests for unsupported historical model IDs?
- **Context/Nuances**: Failure mode should be explicit and actionable.
- **User Response**: Pending.
- **Decision**: Define clear error/diagnostic behavior for unsupported model selection.
- **Status**: Pending

## [DEC-007]
- **Question**: Should v1 use a fixed historical endpoint or configurable endpoint routing?
- **Context/Nuances**: Configurability increases flexibility but adds setup and validation complexity.
- **User Response**: Agreed with fixed endpoint.
- **Decision**: Use fixed `baseUrl` in v1: `https://cloudcode-pa.googleapis.com`.
- **Status**: Accepted

## [TODO-005]
- **Question**: Do we need endpoint override support later (proxy/corporate routing)?
- **Context/Nuances**: May be required in enterprise networks.
- **User Response**: Pending.
- **Decision**: Revisit only on concrete demand.
- **Status**: Pending

## [DEC-008]
- **Question**: What should be the default model for `google-gemini-cli` in v1?
- **Context/Nuances**: Historical resolver default was `gemini-3.1-pro-preview`.
- **User Response**: Yes.
- **Decision**: Keep `gemini-3.1-pro-preview` as the default model.
- **Status**: Accepted

## [DEC-009]
- **Question**: How should v1 behave when a historical but unsupported model ID is requested?
- **Context/Nuances**: Options were explicit failure vs automatic remap to default.
- **User Response**: Agreed with recommendation.
- **Decision**: Fail explicitly with actionable diagnostics; do not auto-remap.
- **Status**: Accepted

## [TODO-006]
- **Question**: What exact unsupported-model error contract should be emitted?
- **Context/Nuances**: Must include requested model ID, provider name, and supported model list.
- **User Response**: Pending.
- **Decision**: Specify and implement a deterministic error message format.
- **Status**: Pending

## [DEC-010]
- **Question**: Should OAuth credentials use Pi's standard provider auth storage or a custom side-channel format?
- **Context/Nuances**: Standard storage keeps `/login` integration and reduces maintenance overhead.
- **User Response**: Correct.
- **Decision**: Use Pi standard OAuth storage for the extension provider; no custom credential store.
- **Status**: Accepted

## [DEC-011]
- **Question**: Should v1 reuse `google-generative-ai` API plumbing or restore dedicated `google-gemini-cli` streaming behavior?
- **Context/Nuances**: API substitution risks silent drift in auth, serialization, headers, and tool-call behavior.
- **User Response**: Agreed with recommendation.
- **Decision**: Restore dedicated `google-gemini-cli` API/stream behavior in the extension.
- **Status**: Accepted

## [TODO-007]
- **Question**: What extraction boundary is required for the dedicated stream implementation?
- **Context/Nuances**: Must keep gemini-cli behavior while excluding antigravity-only branches.
- **User Response**: Pending.
- **Decision**: Extract only gemini-cli-required logic and preserve standard Pi event contract.
- **Status**: Pending

## [DEC-012]
- **Question**: Should implementation start as a local project extension or as an installable package?
- **Context/Nuances**: Local-first accelerates iteration and reduces release friction during parity validation.
- **User Response**: Agreed with recommendation.
- **Decision**: Build v1 as project-local extension first; package for `pi install` later once stable.
- **Status**: Accepted

## [TODO-008]
- **Question**: What criteria define readiness to move from local extension to installable package?
- **Context/Nuances**: Need explicit quality and compatibility gates.
- **User Response**: Pending.
- **Decision**: Define a concrete stability checklist before packaging.
- **Status**: Pending

## [DEC-013]
- **Question**: Should v1 keep historical Gemini 3 thinking-level mapping or simplify to basic thinking on/off?
- **Context/Nuances**: Thinking-level semantics influence model behavior and user-perceived continuity.
- **User Response**: Agreed with recommendation.
- **Decision**: Preserve historical Gemini 3 thinking-level mapping behavior in v1.
- **Status**: Accepted

## [TODO-009]
- **Question**: What exact thinking-level map should each of the three approved models use?
- **Context/Nuances**: Must be explicit for deterministic implementation and docs.
- **User Response**: Pending.
- **Decision**: Extract and codify exact mapping from historical implementation.
- **Status**: Pending

## [DEC-014]
- **Question**: Should v1 reuse the historical OAuth flow as-is, or redesign OAuth client configuration as externalized settings?
- **Context/Nuances**: Reuse maximizes behavioral parity; redesign improves long-term configurability but increases immediate risk.
- **User Response**: Agreed with recommendation.
- **Decision**: Reuse historical OAuth flow as-is in v1.
- **Status**: Accepted

## [RISK-003]
- **Question**: What operational risk follows from reusing historical embedded OAuth parameters?
- **Context/Nuances**: Upstream OAuth behavior or policy changes could require future adaptation.
- **User Response**: Acknowledged.
- **Decision**: Accept risk in v1 for parity; monitor for breakage.
- **Status**: Accepted

## [TODO-010]
- **Question**: Should OAuth hardening/externalized config be implemented later?
- **Context/Nuances**: Relevant for compliance or enterprise operation.
- **User Response**: Pending.
- **Decision**: Revisit in phase 2 only on concrete requirement.
- **Status**: Pending

## [DEC-015]
- **Question**: Should v1 include only provider registration, or also a dedicated diagnostics command?
- **Context/Nuances**: A doctor command adds supportability without altering primary inference behavior.
- **User Response**: Yes.
- **Decision**: Include `/gemini-cli-doctor` in v1.
- **Status**: Accepted

## [TODO-011]
- **Question**: What checks must `/gemini-cli-doctor` perform in v1?
- **Context/Nuances**: Should cover auth, registration, model resolution, endpoint reachability, and actionable remediation.
- **User Response**: Pending.
- **Decision**: Define deterministic check list and error messaging contract.
- **Status**: Pending

## [DEC-016]
- **Question**: What OAuth display name should appear in `/login` for the extension provider?
- **Context/Nuances**: Name should be recognizable and distinct from other Google providers.
- **User Response**: Agreed with recommendation.
- **Decision**: Use display name `Google Gemini CLI`.
- **Status**: Accepted

## [DEC-017]
- **Question**: Should testing be included immediately or sequenced after initial functional stabilization?
- **Context/Nuances**: OAuth/provider restoration may require empirical stabilization before assertions are locked.
- **User Response**: OK, but tests must be added immediately after stabilization.
- **Decision**: Deliver functional v1 first with manual validation, then immediately add regression-focused automated tests as a required follow-up.
- **Status**: Accepted

## [TODO-012]
- **Question**: What is the minimum mandatory test gate immediately after stabilization?
- **Context/Nuances**: Must provide confidence for future changes.
- **User Response**: Pending.
- **Decision**: Define and implement post-stabilization test checklist before declaring phase complete.
- **Status**: Pending

## [DEC-018]
- **Question**: Should we define `/gemini-cli-doctor` contract now or after extension module layout?
- **Context/Nuances**: Contract-first can drive implementation and test design.
- **User Response**: Agreed with recommendation.
- **Decision**: Define `/gemini-cli-doctor` contract first.
- **Status**: Accepted

## [DEC-019]
- **Question**: Should `/gemini-cli-doctor` provide only human-readable output, or also structured output?
- **Context/Nuances**: Structured output enables automation and repeatable diagnostics.
- **User Response**: Both.
- **Decision**: Provide human-readable output by default and optional JSON output via `--json`.
- **Status**: Accepted

## [DEC-020]
- **Question**: Should doctor status be binary or ternary?
- **Context/Nuances**: Warning states can separate degradations from hard failures.
- **User Response**: Agreed with ternary.
- **Decision**: Use ternary global status: `ok | warn | fail`.
- **Status**: Accepted

## [DEC-021]
- **Question**: In JSON mode, should output stream per-check events or emit one final payload?
- **Context/Nuances**: Single-payload format is simpler for parsing and test assertions in v1.
- **User Response**: One line.
- **Decision**: Emit a single final JSON line in `--json` mode.
- **Status**: Accepted

## [DEC-022]
- **Question**: How should `/gemini-cli-doctor` map global status to process exit code?
- **Context/Nuances**: Exit code behavior affects scriptability and CI/local automation semantics.
- **User Response**: OK.
- **Decision**: Use exit code mapping `ok -> 0`, `warn -> 0`, `fail -> 1`.
- **Status**: Accepted

## [DEC-023]
- **Question**: What should `--live` validate: handshake-only or full execution?
- **Context/Nuances**: Handshake checks less surface; full execution validates true operational path.
- **User Response**: B (real minimal generation).
- **Decision**: `--live` performs a real minimal generation to validate end-to-end behavior.
- **Status**: Accepted

## [DEC-024]
- **Question**: Which model should `--live` use?
- **Context/Nuances**: Need deterministic default with optional override.
- **User Response**: Agreed with recommendation.
- **Decision**: Default to `gemini-3.1-pro-preview`, with optional `--model <id>`.
- **Status**: Accepted

## [DEC-025]
- **Question**: What timeout policy should `--live` use?
- **Context/Nuances**: Must balance responsiveness and network variance.
- **User Response**: Agreed with recommendation.
- **Decision**: Default timeout 20s, configurable via `--timeout <s>`.
- **Status**: Accepted

## [DEC-026]
- **Question**: Should doctor perform network calls by default?
- **Context/Nuances**: Default behavior should be fast and side-effect-light.
- **User Response**: Agreed with recommendation.
- **Decision**: Without `--live`, doctor performs zero network calls.
- **Status**: Accepted

## [DEC-027]
- **Question**: Is the base JSON schema acceptable?
- **Context/Nuances**: Proposed fields: `status`, `provider`, `timestamp`, `checks[]`, `summary`.
- **User Response**: Yes.
- **Decision**: Adopt the proposed base schema.
- **Status**: Accepted

## [DEC-028]
- **Question**: Should check IDs be stable from v1?
- **Context/Nuances**: Stable IDs enable robust tests and automation.
- **User Response**: Yes.
- **Decision**: Use stable check IDs as part of contract.
- **Status**: Accepted

## [DEC-029]
- **Question**: Should sensitive data be redacted in all outputs?
- **Context/Nuances**: Diagnostics may include auth/network metadata.
- **User Response**: Agreed with recommendation.
- **Decision**: Enforce strict redaction in human and JSON output.
- **Status**: Accepted

## [DEC-030]
- **Question**: What status should missing OAuth credentials produce?
- **Context/Nuances**: Missing credentials means provider cannot operate.
- **User Response**: Agreed with recommendation.
- **Decision**: Missing OAuth credentials => `fail`.
- **Status**: Accepted

## [DEC-031]
- **Question**: What status should unsupported active model configuration produce?
- **Context/Nuances**: Unsupported configured model blocks expected operation.
- **User Response**: Agreed with recommendation.
- **Decision**: Unsupported active model => `fail` with remediation.
- **Status**: Accepted

## [DEC-032]
- **Question**: Should remediation text be mandatory per check?
- **Context/Nuances**: Actionable remediation reduces support loops.
- **User Response**: Yes.
- **Decision**: Include explicit remediation guidance per failing/warning check.
- **Status**: Accepted

## [DEC-033]
- **Question**: Should doctor support a verbose mode?
- **Context/Nuances**: Verbose mode helps troubleshooting without polluting default output.
- **User Response**: Yes.
- **Decision**: Add `--verbose` mode.
- **Status**: Accepted

## [DEC-034]
- **Question**: Should doctor update global UI status in v1?
- **Context/Nuances**: UI side effects can couple command behavior to runtime state.
- **User Response**: Follow recommendation.
- **Decision**: v1 doctor only emits command output; no global UI status mutation.
- **Status**: Accepted

## [DEC-035]
- **Question**: Should doctor behave deterministically in non-interactive modes?
- **Context/Nuances**: Required for automation and RPC usage consistency.
- **User Response**: Yes.
- **Decision**: Ensure deterministic behavior across non-interactive modes.
- **Status**: Accepted

## [DEC-036]
- **Question**: Should doctor persist/cache results in session?
- **Context/Nuances**: Persistence adds state complexity.
- **User Response**: Stateless.
- **Decision**: Keep doctor stateless in v1.
- **Status**: Accepted

## [DEC-037]
- **Question**: Confirm final command name and alias policy.
- **Context/Nuances**: Naming should be stable and unambiguous.
- **User Response**: Yes.
- **Decision**: Final command is `/gemini-cli-doctor` with no aliases in v1.
- **Status**: Accepted

## [DEC-038]
- **Question**: Should `--model google-gemini-cli/<id>` be treated as explicit compatibility contract?
- **Context/Nuances**: This string format is commonly used by scripts and automation.
- **User Response**: Yes.
- **Decision**: Treat `provider/model` CLI selection format as mandatory compatibility surface.
- **Status**: Accepted

## [DEC-039]
- **Question**: Is compatibility-surface definition complete enough to close TODO-001?
- **Context/Nuances**: Coverage now includes provider identity, model catalog/default, unsupported model policy, OAuth behavior, and provider/model selector behavior.
- **User Response**: Yes.
- **Decision**: Close TODO-001 as resolved.
- **Status**: Accepted

## [DEC-040]
- **Question**: Should the local extension start as a single file or modular directory?
- **Context/Nuances**: Approved scope already includes OAuth flow, dedicated stream logic, and diagnostics command.
- **User Response**: Agreed with recommendation.
- **Decision**: Use a modular directory layout under `.pi/extensions/gemini-cli-provider/`.
- **Status**: Accepted

## [DEC-041]
- **Question**: What module layout should the local extension use in v1?
- **Context/Nuances**: The design requires clear separation for provider registration, OAuth, streaming, diagnostics, and output redaction.
- **User Response**: Yes.
- **Decision**: Use modules `index.ts`, `provider.ts`, `oauth.ts`, `stream.ts`, `doctor.ts`, `types.ts`, and `redaction.ts`.
- **Status**: Accepted

## [DEC-042]
- **Question**: Should v1 include local extension documentation (`README.md`) or defer docs?
- **Context/Nuances**: OAuth and diagnostics flags require clear operator guidance.
- **User Response**: Agreed with recommendation.
- **Decision**: Include `README.md` in `.pi/extensions/gemini-cli-provider/` in v1.
- **Status**: Accepted

## [DEC-043]
- **Question**: Should this interview be closed or paused before phase-1 implementation in a new session/agent?
- **Context/Nuances**: User plans to execute implementation separately, then potentially return for continued design hardening.
- **User Response**: Yes (pause).
- **Decision**: Mark interview as paused for implementation handoff, not closed.
- **Status**: Accepted

## [TODO-013]
- **Question**: How should this interview resume after implementation?
- **Context/Nuances**: Resume against the same artifacts unless scope changes substantially.
- **User Response**: Pending.
- **Decision**: Resume with same log/plan after phase-1 implementation; open a new interview only if scope expands materially.
- **Status**: Pending

## [TODO-001]
- **Question**: What exact compatibility surface must be preserved to avoid breaking existing extensions?
- **Context/Nuances**: Includes provider ID, model IDs, auth key resolution, model selection behavior, and provider/model CLI selector semantics.
- **User Response**: Completed through DEC-003, DEC-005, DEC-006, DEC-008, DEC-009, DEC-010, DEC-011, DEC-038.
- **Decision**: Compatibility surface is defined and accepted.
- **Status**: Accepted

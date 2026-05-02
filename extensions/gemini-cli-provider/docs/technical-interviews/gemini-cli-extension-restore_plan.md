# Consolidated Plan

The project will pursue an extension-first design to restore `google-gemini-cli` functionality that was removed from core, with emphasis on maintainability across upstream releases and no forced changes to the user’s current global installation workflow [DEC-001].

A key requirement is to preserve as much authentication UX continuity as possible, specifically the `/login` pathway, provided current extension APIs and runtime behavior can deliver equivalent OAuth integration semantics [DEC-002].

The extension will preserve the exact historical provider identity (`google-gemini-cli`) rather than introducing a renamed provider, to minimize migration cost and reduce breakage risk in existing extension logic and user workflows [DEC-003].

Functional scope is intentionally narrowed to `google-gemini-cli` only. `google-antigravity` is out of scope and must not be carried forward into the extension design [DEC-004].

Because the historical implementation was shared across both providers, extraction must explicitly remove antigravity-only branches (headers, endpoints, and related conditional behavior) to avoid accidental coupling and future maintenance drag [RISK-001, TODO-002].

Authentication scope for v1 is OAuth-only (`/login`) to align with historical Cloud Code Assist behavior and avoid introducing unsupported fallback semantics in the initial restoration [DEC-005]. A possible hybrid OAuth+API-key mode remains a future option only if concrete operational requirements emerge [TODO-003].

The initial model catalog is intentionally reduced to three IDs: `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, and `gemini-3.1-pro-preview` [DEC-006]. This narrows maintenance scope, with explicit acceptance that legacy workflows targeting historical model IDs may fail until migration guidance or compatibility shims are defined [RISK-002, TODO-004].

Provider endpoint behavior in v1 is fixed to the historical Cloud Code Assist endpoint (`https://cloudcode-pa.googleapis.com`) to minimize moving parts and preserve expected runtime behavior [DEC-007]. Endpoint override support is deferred unless concrete operational pressure requires it [TODO-005].

The default model will remain `gemini-3.1-pro-preview`, preserving continuity with historical resolver behavior while staying inside the approved reduced catalog [DEC-008].

Requests for unsupported historical model IDs will fail explicitly instead of silently remapping to the default model. Error output must be actionable and identify both the requested ID and the currently supported catalog [DEC-009, TODO-006].

OAuth credentials will use Pi’s standard provider auth storage path and semantics, avoiding any custom parallel credential persistence format [DEC-010].

The extension will implement dedicated `google-gemini-cli` API/stream behavior rather than substituting `google-generative-ai`, to avoid semantic drift in request/response handling and provider-specific behavior [DEC-011].

Delivery strategy is local-first: develop and validate as a project-local extension in `.pi/extensions/...`, then package for `pi install` only after explicit stability criteria are met [DEC-012, TODO-008].

Thinking behavior will preserve historical Gemini 3 level mapping rather than collapsing to a binary on/off mode, to maintain response-quality continuity with prior provider behavior [DEC-013]. Exact per-model mappings still need to be codified [TODO-009].

OAuth implementation in v1 will reuse the historical `google-gemini-cli` flow as-is to maximize parity and reduce initial redesign risk [DEC-014]. This introduces a known future-maintenance risk if upstream OAuth constraints evolve, which is accepted for v1 [RISK-003], with hardening/externalization deferred to phase 2 on demand [TODO-010].

The extension will also provide a dedicated diagnostics command (`/gemini-cli-doctor`) to improve supportability without changing primary model execution behavior [DEC-015]. Its deterministic check contract remains to be finalized [TODO-011].

OAuth login UX will expose the provider under the display name `Google Gemini CLI` to keep user recognition high and avoid confusion with other Google-backed providers [DEC-016].

Execution sequencing is explicit: first stabilize a functional local extension with guided manual validation, then immediately add automated regression tests as a mandatory hardening step before considering the phase complete [DEC-017, TODO-012].

Design order is contract-first for diagnostics: `/gemini-cli-doctor` output and status semantics are specified before module layout so implementation and test plans can follow a stable operational contract [DEC-018].

`/gemini-cli-doctor` will expose dual output modes: human-readable output by default and optional JSON output via `--json` [DEC-019]. Diagnostic status is ternary (`ok | warn | fail`) to separate non-blocking degradations from hard failures [DEC-020]. In JSON mode, v1 emits a single final JSON line for deterministic parsing and simpler test assertions [DEC-021]. Process exit behavior is script-friendly: `ok` and `warn` return `0`, while `fail` returns `1` [DEC-022].

The doctor command contract is now fixed in depth: `--live` performs real end-to-end minimal generation, defaulting to `gemini-3.1-pro-preview` with optional `--model`, default timeout 20s with optional override, and zero network by default when `--live` is omitted [DEC-023, DEC-024, DEC-025, DEC-026]. JSON structure is standardized with stable check IDs; outputs enforce strict redaction and include explicit remediation guidance [DEC-027, DEC-028, DEC-029, DEC-032]. Missing OAuth or unsupported active model are hard failures [DEC-030, DEC-031]. The command supports `--verbose`, remains stateless, avoids global UI mutation, behaves deterministically in non-interactive modes, and is finalized as `/gemini-cli-doctor` without aliases [DEC-033, DEC-034, DEC-035, DEC-036, DEC-037].

Compatibility surface is now explicitly defined: preserve provider identity (`google-gemini-cli`), maintain the approved three-model catalog and default (`gemini-3.1-pro-preview`), fail clearly for unsupported historical models, keep OAuth-only behavior with standard Pi credential storage, preserve dedicated provider streaming semantics, and treat `--model google-gemini-cli/<id>` selection format as contractual [DEC-003, DEC-005, DEC-006, DEC-008, DEC-009, DEC-010, DEC-011, DEC-038, DEC-039].

Implementation will proceed in a modular local extension directory (`.pi/extensions/gemini-cli-provider/`) rather than a single-file script, aligning structure with the approved OAuth, stream, and diagnostics scope [DEC-040]. The v1 module set is fixed as `index.ts`, `provider.ts`, `oauth.ts`, `stream.ts`, `doctor.ts`, `types.ts`, and `redaction.ts`, with `index.ts` as composition root and `redaction.ts` shared by human/JSON diagnostics output [DEC-041]. A local `README.md` is included in v1 to document OAuth setup, supported models, diagnostics usage, and known operational limits [DEC-042].

Interview status: paused for implementation handoff. Phase-1 coding will run in a separate session/agent and this interview will resume afterward against the same artifacts unless scope expands materially [DEC-043, TODO-013].

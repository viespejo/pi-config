# OpenAI Codex Work Provider Extension

Registers a second OpenAI Codex subscription provider for a work ChatGPT account.

## Provider

- Provider ID: `openai-codex-work`
- Auth: OpenAI Codex OAuth, reusing Pi's built-in Codex OAuth implementation
- Endpoint: `https://chatgpt.com/backend-api`
- Models: cloned from Pi's built-in `openai-codex` catalog at startup

## Login

Personal account can remain on the built-in provider:

```text
/login openai-codex
```

Work account uses the alias provider:

```text
/login openai-codex-work
```

Credentials are stored separately in Pi auth storage because the provider IDs are different.

## Model selection

Use models with the provider prefix:

```text
/model openai-codex-work/gpt-5.5
```

or from the CLI:

```bash
pi --model openai-codex-work/gpt-5.5
```

The built-in provider remains available as:

```text
/model openai-codex/gpt-5.5
```

## OAuth export maintenance

This extension relies on a private, Linux-only customization of Pi's installed
OAuth entry point. It is not an upstream Pi API. The patch re-exports Pi's own
OpenAI Codex OAuth implementation so that the Work provider can preserve its
separate credential namespace without copying the OAuth protocol.

Use Node.js 22.19.0 or later. Run these commands from the repository root:

```bash
npm run pi:patch:local
npm run pi:patch:local:check
npm run pi:patch:global
npm run pi:patch:global:check
npm run pi:update:global
```

The local commands affect only this repository's installed Pi dependency. The
global commands affect only the effective `pi` executable on `PATH`.
`pi:update:global` runs Pi's self-update and then reapplies the global patch.
It does not update or inspect the local installation.

Pi or npm updates can replace the managed OAuth export. After either update,
run the appropriate apply command followed by its check command. If the
extension reports that the managed export is missing, use `pi:patch:local` for
a repository-local Pi run or `pi:patch:global` for the global Pi installation.

Existing `openai-codex-work` credentials remain separate from the built-in
provider and are preserved by this maintenance workflow. Reauthenticate only
if OpenAI rejects the stored refresh credential.

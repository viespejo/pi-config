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

## Pi compatibility

The extension reuses Pi's built-in OpenAI Codex OAuth provider through the
public `builtinProviders()` API. It does not copy the OAuth protocol and does
not modify files inside Pi or `node_modules`.

Pi 0.84.4 or later and Node.js 22.19.0 or later are required. Validate the
extension package after updating Pi or its dependencies:

```bash
npm --prefix extensions/openai-codex-work-provider test
npm --prefix extensions/openai-codex-work-provider run check
```

Pi updates can change the built-in provider API. If the extension reports that
Pi's built-in OpenAI Codex OAuth support is unavailable, use a compatible Pi
version before retrying. No OAuth login is required unless OpenAI rejects the
stored refresh credential.

Existing `openai-codex-work` credentials remain separate from the built-in
provider because Pi stores credentials by provider ID.

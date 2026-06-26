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

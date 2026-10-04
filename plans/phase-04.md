# Phase 4 — LLM provider layer

Goal: `src/lib/server/llm/`, a provider-agnostic client that turns a request plus a Zod schema into
a validated object. No exercise prompts, routes or UI. Tests use a scripted fake `fetch` only.

## Modules

| File | Purpose |
|---|---|
| `client.ts` | `generateStructured`, `generateText`, fallback, repair, error redaction at the exit |
| `wire.ts` | Request builders and response parsers for Anthropic and OpenAI-compatible, per mode |
| `schema.ts` | `toJsonSchema` (Zod 4 `z.toJSONSchema`, input side), `toProviderSchema`, `normalizeEnums` |
| `extract.ts` | `extractJson`: code fences and prose stripped, outermost object |
| `transport.ts` | `postJson`: timeout, retry/backoff, `Retry-After`, per-attempt reports |
| `config.ts` | `loadProvider`, `loadFallback`, `assertAllowedBaseUrl`, `readKey` |
| `errors.ts`, `redact.ts` | Typed errors (`LlmSchemaError`, `LlmRefusalError`, …) and `redact()` |

Database: migration `0002_llm_providers_and_calls` adds `llm_providers.structured_mode`
(default `json_schema`), makes `env_key_name` nullable (CHECK kept for non-null values), and
creates `llm_calls`. Repository `llmCallsRepo`: `record`, `countSince`, `usageSince`, `all`.
`providersRepo` gains `byId` and `byName`.

Tools: `npm run llm:provider:add -- …` and `npm run llm:smoke -- --provider <name>`.

## API fields used (checked 2026-10-04)

Anthropic docs (reachable from the container):
- Messages API — https://platform.claude.com/docs/en/api/messages
- Structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Tool use / forced tool choice — https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Strict tool use — https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
- Errors — https://platform.claude.com/docs/en/api/errors

| | Anthropic | OpenAI-compatible |
|---|---|---|
| Endpoint | `POST {base_url}/v1/messages` | `POST {base_url}/chat/completions` |
| Auth | `x-api-key`, `anthropic-version: 2023-06-01` | `Authorization: Bearer <key>` (omitted when no key) |
| System prompt | top-level `system` | `messages[0]` with `role: "system"` |
| Token limit | `max_tokens` (required) | `max_completion_tokens` (api.openai.com) / `max_tokens` (others) |
| Temperature | only when the caller sets it | default 0.4 |
| `json_schema` | `output_config.format = { type: "json_schema", schema }` | `response_format = { type: "json_schema", json_schema: { name, schema, strict: true } }` |
| `tool` | `tools[0].input_schema`, `tool_choice: { type: "tool", name }` → `content[].type == "tool_use"`, `.input` object | `tools[0].function.parameters` + `strict: true`, `tool_choice: { type: "function", function: { name } }` → `tool_calls[0].function.arguments` string |
| Refusal | `stop_reason: "refusal"` (+ `stop_details.category/explanation`) | `message.refusal`, or `finish_reason: "content_filter"` |
| Usage | `usage.input_tokens`, `usage.output_tokens` | `usage.prompt_tokens`, `usage.completion_tokens` |

The OpenAI docs (platform.openai.com, developers.openai.com) are **not reachable** from the build
container, so the OpenAI column follows the facts given in the Phase 4 prompt and was not
re-checked here.

## Where the docs differed from the prompt's facts

1. **Anthropic also rejects array size constraints** other than `minItems` 0 or 1 (and
   `multipleOf`). A Zod `.length(3)` (`minItems: 3, maxItems: 3`) would be a 400, so the
   Anthropic sanitizer strips `maxItems` and any `minItems` > 1 as well. `pattern` is supported
   (simple regex) and kept for Anthropic.
2. **Anthropic requires `additionalProperties: false` on every object**; the sanitizer sets it.
3. **`temperature` is deprecated on the Messages API**: models released after Claude Opus 4.6
   reject any value other than 1.0 with a 400. The 0.4 default therefore applies to
   OpenAI-compatible providers only; Anthropic gets `temperature` only if the caller sets one.
4. **Forced tool use is rejected by the newest Claude models** (Opus 5.5, Sonnet 5.5, Fable 5.1:
   `tool_choice` `any`/`tool` → 400). `tool` mode is implemented as specified but is not usable
   with those models; use `json_schema`.
5. Refusals also carry `stop_details` (`category`, `explanation`); used for the error detail.
6. Structured-output schemas have complexity limits (24 optional parameters, 16 union-typed
   parameters per request). Worth remembering for Phase 5 schemas.

## Recommended default mode

- **Anthropic: `json_schema`.** GA, grammar-constrained, no tool round-trip, and the only native
  option that works on the current models (forced tool use is rejected).
- **OpenAI: `json_schema`** (`strict: true`). Constrained decoding with the sanitized schema;
  tool mode adds nothing for a single output object. For OpenAI-compatible servers without
  json_schema support (DeepSeek, Ollama, many OpenRouter models) use `json_prompt`.

## Decisions and judgement calls

1. **Hand-edited migration 0002.** Same drizzle-kit bug as 0001 (the rebuild's `INSERT … SELECT`
   copied the new `structured_mode` column from the old table). And because Drizzle runs all
   migrations inside one transaction, the generated `PRAGMA foreign_keys=OFF` is a no-op, so
   `DROP TABLE llm_providers` fired `ON DELETE SET NULL` on `settings.active_provider_id`. The
   migration saves and restores that column around the rebuild. Tested (upgrade keeps the active
   provider; no leftover tables; FK and integrity checks clean).
2. **`llm_calls.provider_id` is not a foreign key**, so call history survives provider deletion
   and future table rebuilds.
3. **`attempt`** counts HTTP attempts across retries, the repair call and fallback within one
   generate call (1, 2, 3, …). The returned `attempts` counts model generations (1 or 2).
4. **`ok`** on a 200 row means the generation was usable; a 200 whose output failed validation is
   `ok = false, error_code = 'schema_invalid'`. Error codes: `http_<status>`, `timeout`,
   `network`, `bad_response`, `schema_invalid`, `refusal`.
5. **A missing key env var makes no HTTP attempt**, so it writes no `llm_calls` row.
6. **Repair** resends the conversation as user → assistant (the raw previous output, as text even
   in tool mode, so no tool-result pairing is needed) → user (the Zod issue summary).
7. **OpenAI strict and optional fields:** strict mode forces every property into `required`, so
   optional Zod fields become mandatory in the wire schema. Our schemas are all-required; avoid
   `.optional()` in LLM schemas (or model absence as `nullable`).
8. **`max_completion_tokens` for api.openai.com** (newer OpenAI models reject `max_tokens`),
   `max_tokens` for other OpenAI-compatible servers. Not verifiable here (OpenAI docs blocked).
9. **Retry-After** is capped at 60 s; backoff is 1 s, 2 s (± 50 % jitter). A spend-cap 429 has no
   Retry-After and keeps failing; it ends in fallback after 3 attempts.
10. **`fallback: false`** option on requests; the smoke tool uses it so it tests exactly the named
    provider.
11. **Key-safety guard test:** the Phase 2 column guard now allows exactly
    `llm_calls.input_tokens` and `llm_calls.output_tokens` (INTEGER token counts).
12. **`redact()`** also scrubs the `detail` of refusals and the raw output and issues of schema
    errors; errors have no `cause` chain. Every key of every configured provider is redacted, not
    only the one used.
13. **`output_format`** appears in the code only in a comment saying it is deprecated, plus one
    test asserting it is never sent.
14. **Smoke check without a real key:** `npm run llm:smoke` with a fake key reached
    api.anthropic.com and returned a redacted `HTTP 401: API key is invalid`. A real run needs the
    owner's key.

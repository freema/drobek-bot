# Secrets

How a credential gets from the person to a bot without ever being written into a bot folder, a transcript, an event or a log. This page covers the store and the rules; the pieces are `packages/contracts` (the schemas), `packages/core/src/secrets` (the cryptography, the redactor and the box allowlist, all pure) and `packages/db/src/secrets.ts` (the repository). Injecting the values into a running box and the UI for managing them come later.

## The master key

`DROBEK_MASTER_KEY` in `.env` is the key-encryption key (KEK): 32 random bytes as base64, generated with `openssl rand -base64 32`. It lives in `.env` and nowhere else: not in the repository, not in the database, never inside a box. Compose passes it to `api` and `worker` only; `web` never sees it. The api validates it on start when it is set and refuses to start on a malformed value, naming the variable and the expected shape but never echoing the value. Leave it empty until you store the first secret.

The key id `master-<8 hex>` is the first 8 hex characters of SHA-256 over the raw key bytes. Every stored secret records the key id it was wrapped under.

## The envelope

Each secret is encrypted with its own 32-byte data key (DEK); the data key is wrapped under the master key. Both layers are AES-256-GCM with the secret's scope as additional authenticated data, so an envelope only opens in the row it was written for.

| Column               | Content                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `ciphertext`         | AES-256-GCM(DEK, `nonce`, AAD)(plaintext) followed by the 16-byte auth tag                      |
| `nonce`              | 12 random bytes, stored on their own                                                            |
| `encrypted_data_key` | 12-byte wrap nonce, then AES-256-GCM(KEK, wrap nonce, AAD)(DEK), then the 16-byte tag: 60 bytes |
| `key_id`             | `master-<8 hex>` of the master key that wrapped the data key                                    |

AAD is the UTF-8 string `<workspace_id>|<bot_id or empty>|<name>`. Moving a row to another workspace, bot or name, or renaming it, makes it fail to open.

`sealSecret` and `openSecret` in `packages/core` do the work; `openSecret` throws a `SecretError` with a `kind` and nothing else:

| Kind                 | Meaning                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `unsupported-key-id` | `key_id` is not a `master-` id this code knows.                                                                              |
| `wrong-key`          | `key_id` names a different master key than the one given.                                                                    |
| `scope-mismatch`     | The data key does not unwrap for this scope: the row was moved or renamed, or its `encrypted_data_key` was modified.         |
| `tampered`           | The envelope does not have the documented layout, or the data key unwrapped but the ciphertext or nonce do not authenticate. |

The database layer stores and returns envelopes and never sees a plaintext; sealing and opening happen in the caller.

## Rotation

Rotation is a new master key. Old envelopes stay readable by their `key_id`: `listSecrets` reports the key id of each secret, so the ones wrapped under a previous key are recognisable. Re-encrypting them under the new key is a later feature; until then a rotated installation holds both keys' envelopes and opens each with the key its id names.

## Names and scope

A secret name is an environment variable name: `^[A-Z][A-Z0-9_]{0,63}$`. A secret belongs to a workspace and either to one bot or to the workspace as a whole (`bot_id` null); one name per scope. A bot declares the names it receives in `bot.yaml` under `secrets:` and refers to them in `mcp.<server>.env` as `${NAME}`; the values live in the store. See [the bot format](./bot-format.md#secrets).

## What a box receives

The environment a box gets is an allowlist built by `buildBoxEnv`: only names the bot requested that resolve in the store, and never any of these, requested or not:

- `DATABASE_URL`, `REDIS_URL`, `DROBEK_MASTER_KEY`, `GIT_SHA`, `NODE_ENV`, `PORT`, `ANTHROPIC_AUTH_TOKEN`
- anything starting with `POSTGRES_` or `CLAUDE_`

`ANTHROPIC_API_KEY` passes only for a bot whose `auth` is `api_key`, and only when requested. The result also lists the names that were requested but not configured, so the app can say "secret not configured" instead of starting a box that will fail later, and the names it refused.

## What is never stored

Claude.ai login credentials. A bot with `auth: subscription` signs in inside its box; the session stays in the box's own volume, and the app never stores, reads or proxies it. The store holds what the person puts into it (API keys, tokens for MCP servers and CLIs), nothing the app collects on its own.

## Redaction

Every value a run received is redacted from everything the app writes: transcript, events, logs. `createRedactor` replaces each value and its JSON-escaped, URL-encoded and base64 forms with `[REDACTED:<name>]`, longest values first so a value contained in another is handled, and walks strings inside objects and arrays without mutating them. Short values are redacted like any other. Nothing about a value is ever returned or logged; error messages carry a kind, never bytes.

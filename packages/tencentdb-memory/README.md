# @proj-airi/tencentdb-memory

The channel module and the storage port for AIRI long-term memory.

MemoryCore is the intended fact store. `useMemoryStore` stays the writer that tools and Settings call. This package is the storage port the store will call. It does not sync devices, draw a graph, or run voice. The contract for those later steps is `docs/ai/adr/2026-11-05-tencentdb-memory-backend.md`. `packages/memory-pgvector` stays unconnected.

## What it owns

- A channel client that connects to `ws://localhost:6121/ws` and announces `tencentdb-memory`.
- A `MemoryStorage` port and an in-process fake. Two callers can share one record map.
- A MemoryCore v3 client for L0 conversation calls, and for L1, L2, and L3 reads. The graph reads those layers. This package does not write L1, L2, or L3.
- A chat-turn queue. A finished turn is L0 on the chat agent. Manual facts use a different agent, `<card id>:facts`.

The module does not listen for `input:text`. The stage chat store calls `onChatTurnComplete` and queues the L0 write. Startup does not call MemoryCore.

## Run the module

Start the AIRI channel first with `pnpm dev:server`. Then run:

```shell
pnpm -F @proj-airi/tencentdb-memory dev
```

The channel default is `ws://localhost:6121/ws`. Set `AIRI_URL` to use another channel.

## Configure MemoryCore

Set these variables in the environment. Do not commit them.

- `TENCENTDB_MEMORY_ENDPOINT` is an `http` or `https` origin, such as `http://127.0.0.1:8420` or a server origin.
- `TENCENTDB_MEMORY_TEAM_ID` is one deployment id. Later clients must use the same value. This package does not sync them.
- `TENCENTDB_MEMORY_USER_ID` is the owner. Later clients must use the same value. This package does not sync them.
- `TENCENTDB_MEMORY_AGENT_ID` is the default agent id for a v3 call.
- `TENCENTDB_MEMORY_API_KEY` is the bearer token. The gateway returns 401 when the header is missing. An empty value sends `local`.
- `TENCENTDB_MEMORY_SERVICE_ID` is `x-tdai-service-id`. The gateway returns 401 when the header is missing. An empty value sends `default`.

The URL must not carry a user name, a password, a query, or a path. The client always sends `Authorization` and `x-tdai-service-id`. It does not send `x-request-id`. `timestamp` on a conversation message is an ISO-8601 UTC string. The gateway rejects a number.

When the endpoint, the team id, the user id, and the agent id are set, this command adds one L0 line and searches for it:

```shell
pnpm -F @proj-airi/tencentdb-memory smoke:l0
```

## Call the gateway from a browser

The settings page calls the gateway from the browser. Set `server.corsOrigins` to the page origin. Allow the headers `Content-Type`, `Authorization`, and `x-tdai-service-id`.

A gateway that allows only `Content-Type` and `Authorization` blocks the page. The browser sends `x-tdai-service-id` on every call.

## Chat turns and manual facts

A successful chat turn is `POST /v3/conversation/add` on the character card. The session id is the chat session. Empty text, a pure slash command, pure emoji, and an image with no caption are not stored. A copied system prompt and the memory index are removed before the write. The write runs in the background. A failure does not stop the chat.

The v3 catalog on `feat/server_team` has `atomic/update`, `atomic/query`, `atomic/search`, and `atomic/delete`. It has no atomic create route. `atomic/update` returns 404 for an unknown id. Manual facts stay L0 JSON in session `airi:facts`, on agent `<card id>:facts`. The role is `assistant`, so that write does not start extraction. The chat agent does not receive the fact.

The current team id and user id stay as they are. A private team id per user is a later change.

## Scope of L2 and L3

L0 facts and L1 atoms follow the team, the user, and the character. L2 scenes and the L3 persona follow the team and the character only. The gateway scope is `team:<team id>|agent:<agent id>`. A second user in that team and character sees the same scenes and the same persona. This package does not filter them by user. The graph says so in the record detail.

A later change can give each user a separate character id or a separate team id. This package does not do that.

## Use the fake storage

```ts
import { createFakeMemoryStorage, createMemoryRecordMap } from '@proj-airi/tencentdb-memory'

const records = createMemoryRecordMap()
const web = createFakeMemoryStorage({ teamId: 'team-1', userId: 'user-1', records })
const desktop = createFakeMemoryStorage({ teamId: 'team-1', userId: 'user-1', records })
```

A newer `updatedAt` replaces a record in that process. A shared map lets two callers in one process see the same rows. It does not sync two devices.

A fact can cite a session id, a turn id, and `airi-asset:<id>` refs. The bytes stay in the asset store. The card still owns the fact. The session does not split that card's list.

Import the channel entry from `@proj-airi/tencentdb-memory/node`. That entry opens a WebSocket. A browser page must not import it, because the page must not hold the API key.

## When to use it

- Connect a process to the AIRI channel as the memory module.
- Test memory reads and writes without a gateway.
- Call MemoryCore L0 writes, and L1, L2, and L3 reads, from a process that can hold the key.

## When not to use it

- Do not call this package from a tool or a page in place of `useMemoryStore`.
- Do not import the Node entry into a browser bundle.
- Do not run `memory-pgvector` as a second writer.
- Do not treat this package as a finished sync layer, a memory graph, or a voice pipeline.

## License

[MIT](../../LICENSE)

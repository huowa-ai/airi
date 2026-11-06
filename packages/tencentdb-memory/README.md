# @proj-airi/tencentdb-memory

The channel module and the storage port for AIRI long-term memory.

MemoryCore is the intended fact store. `useMemoryStore` stays the writer that tools and Settings call. This package is the storage port the store will call. It does not sync devices, draw a graph, or run voice. The contract for those later steps is `docs/ai/adr/2026-11-05-tencentdb-memory-backend.md`. `packages/memory-pgvector` stays unconnected.

## What it owns

- A channel client that connects to `ws://localhost:6121/ws` and announces `tencentdb-memory`.
- A `MemoryStorage` port and an in-process fake. Two callers can share one record map.
- A MemoryCore v3 client for L0 conversation calls, and for L1, L2, and L3 reads. The graph reads those layers. This package does not write L1, L2, or L3.
- One L0 write, `appendConversation`. Chat turns and manual facts use the character card, or `airi:general`.

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
- `TENCENTDB_MEMORY_TEAM_ID` is the default team when a call omits one. Stage reads and writes send the team from `resolveMemoryScope` instead.
- `TENCENTDB_MEMORY_USER_ID` is the default user when a call omits one. A stage call sends the speaker id.
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

A successful chat turn and a manual fact both call `appendConversation`. The agent id is the character card, or `airi:general`. The chat session id is the chat session. Empty text, a pure slash command, pure emoji, and an image with no caption are not stored. A copied system prompt and the memory index are removed before the write. The write runs in the background. A failure does not stop the chat.

Manual facts stay L0 JSON in session `airi:facts`. The role is `assistant`. MemoryCore notifies L1 extraction only when the batch has a user message. The source is `feat/server_team` `MemoryCore/src/gateway/v2-router.ts`. That branch has no unit test for the rule. A fact-only batch on the shared agent does not notify. A chat batch on that agent does. If the gateway notifies an assistant-only batch, it extracts stored facts again.

The v3 catalog has `atomic/update`, `atomic/query`, `atomic/search`, and `atomic/delete`. It has no atomic create route. `atomic/update` returns 404 for an unknown id. The graph lists these facts with `listFacts`, and it reads L1, L2, and L3 for the same agent ids.

`resolveMemoryScope` picks the team for each call. A private or local chat uses `u_<platform>_<userId>`. A group uses `g_<platform>_<groupId>`. The user id is the speaker. The agent id is the character card, or `airi:general`. Facts use that same agent id. The local account id is the settings user id, or one id stored on first use.

An identity map can point several platform identities at one private team. The map starts empty. A link is stored only after confirmation. The resolver does not merge accounts by itself. Cross-group sharing stays off. The request type has a hook for a later opt-in, and the resolver does not call it.

Recall keeps a few recent turns for that scope until search returns the same text. The merged list is ranked by relevance, then time. It stops at 5 hits and 800 characters.

A failed conversation write stays in a local queue. The queue retries with a longer wait, up to 30 seconds. A turn id that already succeeded is not sent again. `conversation/add` does not take a caller message id. Before a retry, the client reads that scope. When the same role and content are already there, the retry skips the write.

`conversation/delete` with `message_ids` deletes those rows only. `session_id` is copied into `session_ids` and deletes the whole session. The gateway adds both counts. This client sends one of those lists, not both. When `deleted_count` is not the message id count, the client warns and throws. `atomic/delete` and `scenario/rm` delete L1 and L2. The persona has no delete route. The phrase "forget this" removes the latest turn in that session.

## Scope of L2 and L3

L0 facts and L1 atoms follow the team, the user, and the character. L2 scenes and the L3 persona follow the team and the character only. The gateway scope is `team:<team id>|agent:<agent id>`. A private account and a group use different team ids, so those layers do not cross. Members of one group share that group's scenes and persona. The graph shows the current team. The L2 and L3 detail names that team.

This package does not copy old rows from a fixed team id.

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

# @proj-airi/tencentdb-memory

The channel module and the storage port for AIRI long-term memory.

MemoryCore is the intended fact store. `useMemoryStore` stays the writer that tools and Settings call. This package is the storage port the store will call. It does not sync devices, draw a graph, or run voice. The contract for those later steps is `docs/ai/adr/2026-11-05-tencentdb-memory-backend.md`. `packages/memory-pgvector` stays unconnected.

## What it owns

- A channel client that connects to `ws://localhost:6121/ws` and announces `tencentdb-memory`.
- A `MemoryStorage` port and an in-process fake. Two callers can share one record map.
- A MemoryCore v3 client for `POST /v3/conversation/add` and `POST /v3/conversation/search`.

The module does not listen for `input:text`. Startup does not call MemoryCore.

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

`TENCENTDB_MEMORY_API_KEY` and `TENCENTDB_MEMORY_SERVICE_ID` are optional. The client sends them only when they are set. The URL must not carry a user name, a password, a query, or a path.

When the four required variables are set, this command adds one L0 line and searches for it:

```shell
pnpm -F @proj-airi/tencentdb-memory smoke:l0
```

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
- Call MemoryCore L0 add and search from a process that can hold the key.

## When not to use it

- Do not call this package from a tool or a page in place of `useMemoryStore`.
- Do not import the Node entry into a browser bundle.
- Do not run `memory-pgvector` as a second writer.
- Do not treat this package as a finished sync layer, a memory graph, or a voice pipeline.

## License

[MIT](../../LICENSE)

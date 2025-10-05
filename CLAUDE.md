# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**reactive-hass** is a TypeScript-based reactive automation system for Home Assistant using RxJS. It provides configurable automations and sensors that react to Home Assistant state changes via WebSocket and MQTT.

## Key Commands

### Development
- `npm start` - Start development server with auto-reload (watches files except `./data/`)
- `npm run start:debug` - Start with debug logging enabled
- `npm run start:prod` - Run production build

### Testing & Quality
- `npm test` - Run all tests (Vitest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Check TypeScript code
- `npm run lint:fix` - Auto-fix lint issues
- `npm run prettier` - Check code formatting
- `npm run prettier:fix` - Auto-fix formatting
- `npm run format` - Run both prettier and lint fixes
- `npm run validate` - Run full validation (typecheck, typecheck:test, lint, test) - run before pushing

### Type Checking & Building
- `npm run typecheck` - Type-check all source files (including tests) with noEmit
- `npm run typecheck:test` - Type-check test files specifically
- `npm run build` - Build production code (excludes tests) to `dist/` directory

Note: The project uses three TypeScript configs:
- `tsconfig.json` - IDE config with vitest globals, includes all files
- `tsconfig.build.json` - Production build, excludes tests
- `tsconfig.test.json` - Test-specific type checking

### Running Specific Automation
Set the `RUN` environment variable to run only a specific automation:
```bash
RUN=workbench npm start
```

## Architecture

### Core Reactive Pattern

The application merges two main observable streams:
1. **Sensors** (`src/sensors/`) - Expose Home Assistant state as binary sensors
2. **Automations** (`src/automations/`) - React to state changes and control devices

Both are merged in `src/index.ts` and run as a single RxJS pipeline.

### Dependency Injection

Uses **Awilix** DI container (`src/services/cradle.ts`) with singleton services:
- `config` - Configuration from `config.yaml`
- `socket` - WebSocket connection to Home Assistant
- `states` - Observable streams of entity states
- `events` - Home Assistant event streams
- `service` - Call Home Assistant services
- `mqtt` - MQTT client for publishing/subscribing
- `discovery` - MQTT discovery protocol
- `binarySensor` / `discoverySwitch` - Create MQTT entities
- `notify` - Send notifications
- `hassStatus` - Track Home Assistant connection status
- `rest` - REST API client
- `history` - Historical data access

All services are injected as `IServicesCradle` into sensors and automations.

### Sensors

Sensors live in `src/sensors/` and are auto-loaded via `require-dir`.

**Structure:**
```typescript
export default function sensorName$(
  cradle: IServicesCradle
): Observable<boolean> {
  // Return observable of boolean state
}

export const config: SensorConfig = {
  type: "binary",
  name: "Friendly Name"
};
```

Sensors:
- Export a default function returning `Observable<boolean>`
- Automatically exposed as MQTT binary sensors in Home Assistant
- Get a toggle switch to enable/disable in Home Assistant
- Only run when Home Assistant is online (`hassStatus.online$`)

**Example:** `src/sensors/gaming.ts` monitors PS5 activity state.

### Automations

Automations live in `src/automations/` and are auto-loaded via `require-dir`.

**Structure:**
```typescript
export default function automationName$(
  cradle: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  // Return observable that performs actions
}
```

Automations:
- Export a default function returning `Observable<unknown>`
- Automatically get a toggle switch in Home Assistant to enable/disable
- Can call services, publish MQTT, react to state changes
- Run independently - a crash in one doesn't affect others
- Use `debug()` for logging (automatically namespaced)

**Example:** `src/automations/workbench.ts` demonstrates toggling lights and setting binary sensors.

### Key Services

**States (`src/services/States.ts`):**
- `states.all$` - Observable of all entity states
- `states.entity$(entityId)` - Observable for single entity (emits on changes)
- `states.entities$(glob)` - Higher-order observable for multiple entities matching glob pattern

**Service (`src/services/Service.ts`):**
- `service.call$({ domain, service, target })` - Call Home Assistant services

**BinarySensor (`src/services/BinarySensor.ts`):**
- `binarySensor.create(id, defaultState, options)` - Create controllable binary sensor
- Returns `ValueControl<boolean>` with `.set(value)` method
- Automatically advertises via MQTT discovery

**ValueControl (`src/helpers/ValueControl.ts`):**
- Wrapper for reactive state management
- `state$` - Observable of current state
- `set(value)` - Update value (returns observable)

### Configuration

Configuration is loaded from `config.yaml` via environment variable:
```bash
CONFIG_PATH=./config.yaml npm start
```

Required fields:
- `host` - Home Assistant URL
- `token` - Long-lived access token
- `mqttUrl` - MQTT broker URL with credentials

### Module Loading

Both sensors and automations use `require-dir` for automatic loading:
- Drop a new `.ts` file in `src/sensors/` or `src/automations/`
- Export a default function with the correct signature
- It will be auto-discovered and loaded on startup

## Testing RxJS Observables

This project uses **RxJS marble testing** with Vitest for testing observable streams.

### Key Principles

1. **Use RxJS's TestScheduler** - Don't pass scheduler instances to operators
2. **Use built-in operators** - Operators like `timestamp()` work automatically with TestScheduler's virtual time
3. **Follow RxJS testing patterns** - Refer to [RxJS's own specs](https://github.com/ReactiveX/rxjs/tree/master/packages/rxjs/spec/operators) for examples

### Test Structure

```typescript
import { TestScheduler } from "rxjs/testing";

describe("myOperator", () => {
  let testScheduler: TestScheduler;

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  it("should do something", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b|", { a: 10, b: 20 });
      const result$ = source$.pipe(myOperator());

      expectObservable(result$).toBe("a 99ms b|", { a: 10, b: 20 });
    });
  });
});
```

### Marble Diagram Syntax

- `a`, `b`, `c` - Emissions (values defined in object)
- `|` - Completion
- `#` - Error
- `-` - 1 frame of time (10ms in virtual time)
- `99ms` - Explicit time duration
- `(ab)` - Synchronous group (emissions on same frame)
- Space - Just for readability, has no timing meaning

**Important:** Operators add 1 frame of processing time in TestScheduler. When source completes at frame 200, result might complete at frame 201 due to operator pipeline overhead.

### Common Patterns

**Testing time-based operators:**
```typescript
// Don't pass scheduler to operators - use built-in time operators
source$.pipe(
  timestamp(),  // Works with TestScheduler automatically
  debounceTime(100),
  delay(50)
)
```

**Testing sliding windows:**
```typescript
const source$ = cold("a 999ms b 999ms c|", { a: 10, b: 20, c: 30 });
// At 0ms: [a]
// At 999ms: [a, b] (both within window)
// At 1998ms: [b, c] (a dropped, outside window)
```

**Testing distinct emissions:**
```typescript
const source$ = cold("a b c|", { a: 10, b: 10, c: 10 });
const result$ = source$.pipe(distinctUntilChanged());
// Emits only first 10, then completes
expectObservable(result$).toBe("a 2ms |", { a: 10 });
```

### ESLint Configuration

Configure `vitest/expect-expect` to recognize marble testing assertions:

```javascript
// eslint.config.js
{
  files: ['src/**/*.test.ts'],
  rules: {
    'vitest/expect-expect': ['warn', {
      assertFunctionNames: ['expect', 'expectObservable'],
    }],
  },
}
```

### What NOT to Do

❌ Don't pass `scheduler` parameter to operators:
```typescript
// Wrong - scheduler manually passed
scan((acc, curr) => [...acc, curr], [], scheduler)
timestamp(scheduler)
```

✅ Instead, rely on TestScheduler's automatic virtual time:
```typescript
// Correct - operators use TestScheduler's time automatically
scan((acc, curr) => [...acc, curr], [])
timestamp()
```

❌ Don't use `bufferTime` with TestScheduler - it has known issues with virtual time and requires sources to complete

✅ Use `scan` + `timestamp()` for sliding windows instead

### Import Paths

Use relative imports throughout the codebase:
```typescript
// Import custom operators
import { rollingAverage } from "./operators/rollingAverage";

// Import from parent directories
import { IServicesCradle } from "../services/cradle";
```

**Note:** The project previously used path aliases (`@operators/*`, `src/*`) but these have been removed to simplify the build process and avoid runtime resolution issues in Docker deployments.

## Development Notes

- Uses Node 22 (Volta config in package.json)
- TypeScript 5.9 with strict mode enabled
- RxJS 7 for reactive streams
- Debug logging uses `debug` package with namespace pattern `reactive-hass.*`
- Tests use Vitest with globals enabled
- EventEmitter max listeners set to Infinity due to RxJS listener buildup
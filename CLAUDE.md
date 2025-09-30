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
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Check TypeScript code
- `npm run lint:fix` - Auto-fix lint issues
- `npm run prettier` - Check code formatting
- `npm run prettier:fix` - Auto-fix formatting
- `npm run format` - Run both prettier and lint fixes
- `npm run validate` - Run build, lint, and test suite

### Build
- `npm run build` - Compile TypeScript to `dist/` directory

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

## Development Notes

- Uses Node 18 (Volta config in package.json)
- TypeScript 4.9 with strict mode enabled
- RxJS 7 for reactive streams
- Debug logging uses `debug` package with namespace pattern `reactive-hass.*`
- Tests use Jest with ts-jest preset
- EventEmitter max listeners set to Infinity due to RxJS listener buildup
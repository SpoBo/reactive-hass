# Energy Automation - Solar Charging System

This document explains the architecture, design decisions, and key learnings from building the Tesla solar charging automation.

## Overview

The energy automation monitors solar production and automatically controls Tesla charging to maximize the use of excess solar power. It adjusts charging amperage dynamically based on available solar overhead, ensuring we only charge when there's sufficient production.

## Architecture

### Event-Driven Design

The system uses an **event-driven architecture** rather than a `combineLatest` approach at the root level. This was a deliberate design choice for several reasons:

1. **Reactivity to specific triggers** - Each decision stream activates only when relevant conditions occur
2. **Clear separation of concerns** - Start, adjust, and stop decisions are independent streams
3. **Performance** - Streams only activate when needed, not on every state change
4. **Debuggability** - Each decision point has clear logging and can be traced independently

### Three Decision Streams

The automation uses three separate observable streams for charging decisions:

#### 1. **Start Charging** (`startChargingDecisions$`)
- **Trigger**: `teslaIsEligibleToCharge$` emits `true`
- **Condition**: Must not already be charging
- **Evaluation**: Uses 3-minute rolling average of solar overhead
- **Logic**: Can start if average ≥ minimum required watts (5A × 230W = 1150W)
- **Action**: Set charging amps and start charging

#### 2. **Adjust Charging** (`adjustChargingDecisions$`)
- **Trigger**: `teslaChargingState$` emits "Charging"
- **Evaluation**: Uses 30-second rolling average (fast response)
- **Logic**: Continuously monitors and adjusts amperage to match available solar
- **Behavior**: Can increase or decrease within 5A-13A range
- **Debouncing**: `distinctUntilChanged` prevents unnecessary adjustments

#### 3. **Stop Charging** (`stopChargingDecisions$`)
- **Triggers**: Two independent conditions merged:
  - Insufficient solar (using 3-minute average < minimum)
  - Lost eligibility (unplugged, reached charge limit, left home, etc.)
- **Evaluation**: Conservative 3-minute average to avoid stopping on temporary dips
- **Action**: Stop charging and allow car to sleep

### Rolling Averages - Different Time Windows

Each decision uses a different time window for rolling averages:

| Decision | Window | Reasoning |
|----------|--------|-----------|
| **Start** | 3 minutes | Conservative - avoid starting on brief solar spikes |
| **Adjust** | 30 seconds | Responsive - quickly adapt to changing conditions |
| **Stop** | 3 minutes | Conservative - avoid stopping on temporary cloud cover |

This approach prevents thrashing (starting/stopping repeatedly) while still being responsive to real conditions.

## Optimistic State Management

### The Problem: Command Lag

Initially, we encountered a significant lag issue. When we sent a command to start/stop charging:

1. Command sent to Tesla BLE → immediate
2. Car processes command → ~2-10 seconds
3. Teslamate MQTT updates → ~10-30 seconds
4. Our calculations see the change → too late!

This lag caused incorrect house load calculations, leading to wrong decisions.

### The Solution: Optimistic Updates

We implemented **optimistic state management** using a `BehaviorSubject`:

```typescript
const expectedChargeState$ = new BehaviorSubject<ExpectedChargeState>({
  isCharging: false,
  expectedAmps: 0,
  expectedPowerKw: 0,
});
```

**How it works:**

1. **Before sending a command** → Update `expectedChargeState$` optimistically
2. **House load calculations** → Use expected state immediately
3. **BLE polling (every 30s)** → Overwrites with actual data when charging
4. **MQTT updates** → Provides fallback when not charging
5. **On command failure** → Revert optimistic state

This eliminates lag and ensures decisions are based on the actual (expected) state of the system.

## Conditional BLE Polling - Letting the Car Sleep

### The Problem: Constant Polling Prevents Sleep

Tesla vehicles enter a sleep mode to conserve battery when not in use. However, any API calls (including BLE commands) wake the car and prevent it from sleeping.

Initially, we polled the car's charge state every 30 seconds regardless of charging status. This kept the car awake 24/7, causing vampire drain.

### The Solution: Conditional Polling Based on Optimistic State

BLE polling now **only activates when the car is actively charging**:

```typescript
const teslaBleChargeState$ = expectedChargeState$.pipe(
  map((state) => state.isCharging),
  distinctUntilChanged(),
  switchMap((isCharging) => {
    if (!isCharging) {
      debug("Not charging - skipping BLE polling to allow car to sleep");
      return EMPTY;
    }

    // Only poll when charging
    return interval(ms(REALTIME_POLL_INTERVAL)).pipe(/* ... */);
  })
);
```

**Key insight:** We use the **optimistic state** to determine if we should poll, not the MQTT state. This means:

- When we send a START command → BLE polling starts immediately
- When we send a STOP command → BLE polling stops immediately
- Car can sleep when not charging
- We still get accurate data via MQTT fallback

## Data Source Priority

The system uses three data sources with different priorities:

1. **Optimistic state** (highest priority) - Used for immediate decision-making
2. **BLE polling** (when charging) - Overwrites optimistic state with actual data every 30s
3. **MQTT** (fallback) - Updates state when not charging or BLE unavailable

This layered approach ensures:
- Immediate response to commands (optimistic)
- Accurate tracking during charging (BLE)
- Car can sleep when not needed (conditional polling)
- Fallback data source always available (MQTT)

## House Load Calculation

To determine available solar overhead, we need to know the house's base load (excluding car charging):

```typescript
const houseBaseLoad$ = powerUsage$.pipe(
  withLatestFrom(expectedChargeState$),
  map(([totalPower, expectedState]) => {
    const carWatts = expectedState.isCharging
      ? expectedState.expectedPowerKw * 1000
      : 0;
    return totalPower - carWatts;
  })
);
```

**Why use expected state?**
- P1 meter shows total power consumption
- If car is charging at 2kW and house uses 1kW, meter shows 3kW total
- We need to subtract the car's consumption to know the house base load
- Using optimistic state prevents lag-induced miscalculations

Solar overhead is then: `solarOverhead = -houseBaseLoad`
- Negative house load means we're producing more than consuming
- Positive overhead = excess solar available for charging

## Notifications

All charging actions send notifications using an **observable-based approach**:

```typescript
const commandResult$ = teslaBle.startCharging$().pipe(/* ... */);

const successNotification$ = commandResult$.pipe(
  switchMap(() => notify.single$(`🔋 Started charging...`))
);

return merge(commandResult$, successNotification$);
```

This ensures notifications are part of the reactive stream and execute automatically when the stream is subscribed to.

## Key Learnings

### 1. Event-Driven > Reactive Combos for Complex Logic
For complex automations with distinct decision points, event-driven streams (using `switchMap` and `filter`) are more maintainable than massive `combineLatest` blocks.

### 2. Optimistic Updates Eliminate Lag
When controlling physical devices with delayed feedback, optimistic state management is essential. Update your model immediately, then sync with reality asynchronously.

### 3. Different Time Windows for Different Decisions
Not all decisions should react at the same speed. Start/stop need stability (3m), adjustments need responsiveness (30s).

### 4. Conditional Polling Respects Device Sleep
Only poll APIs when you need fresh data. Use optimistic state or MQTT for passive monitoring, BLE only when actively managing the device.

### 5. Layer Your Data Sources
Having multiple data sources with different priorities (optimistic → BLE → MQTT) provides both immediate response and eventual accuracy.

### 6. Pure Functions Enable Testing
All charging logic (`calculateOptimalAmps`, `shouldStopCharging`, etc.) is extracted into pure helper functions. This makes the system fully testable with 100% coverage.

## Configuration

All constants are centralized in `./charging/config.ts`:

- `minAmps: 5` - Minimum charging current (1.15 kW)
- `maxAmps: 13` - Maximum charging current (2.99 kW)
- `wattsPerAmp: 230` - Based on 230V single-phase
- `startWindow: "3m"` - Rolling average for start decisions
- `adjustWindow: "30s"` - Rolling average for adjustments
- `stopWindow: "3m"` - Rolling average for stop decisions

## Testing

All helper functions have comprehensive unit tests in `./charging/helpers.test.ts` with 27 passing test cases covering:
- Optimal amperage calculation
- Start/stop conditions
- Adjustment logic
- House base load calculation
- Solar overhead calculation

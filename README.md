# reactive-hass

A reactive TS-based configurable set of automation scripts for Home-Assistant.

This exists because I do not really like the automation capabilities inside HA itself. And Node-Red brings another set of challenges. While this is more capable it is extremely hard to combine multiple streams of data and make decisions on it.

# features

It exposes a switch per automation so you can disable any automation whenever you like.

Contains helpers to easily work with reactive streams and make decisions based on that.

# TODO

Install prettier.

Clear command to wipe mqtt from all things reactive-hass.

Support non-binary sensors.

Provide a way to automatically inject config for sensors/automations.

Swap DI containers.
- Should have no way to mutate stuff in sensors
- Should give access in automations to sensors.
- Should give access to other sensors in sensors.
https://github.com/microsoft/tsyringe ?

Allow easy loading of sensors from the sensor folder in other sensors or in automations.

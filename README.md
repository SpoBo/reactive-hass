# reactive-hass

A reactive TS-based configurable set of automation scripts for Home-Assistant.

This exists because I do not really like the automation capabilities inside HA itself. And Node-Red brings another set of challenges. While this is more capable it is extremely hard to combine multiple streams of data and make decisions on it.

# features

It exposes a switch per automation so you can disable any automation whenever you like.

Contains helpers to easily work with reactive streams and make decisions based on that.

# TODO

Clear command to wipe mqtt from all things reactive-hass.

Create a sensors folder. Which should not have access to run commands. But it should be used to combine streams into new sensors. So we could for example combine a set of sensors to know if the house should have its alarm on or not. Or if it is sufficiently dark to warrant mood lighting etc.

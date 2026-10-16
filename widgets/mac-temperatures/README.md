# Mac temperatures

Displays the CPU temperature in Celsius from the `system` channel, with its source. Requires Fremkit 0.3.0. The optional macmon reader on Apple Silicon provides a measured average; the system sensor may provide a fallback reading.

Install the sensor tool with `brew install macmon`. The server invokes its read-only JSON sampler at most once every ten seconds; it does not start a service or request administrator access.

The tile explains when macmon is missing, the Mac is unsupported, the reading fails, or the Screen privacy setting has not enabled macmon. A missing value displays `?`. The channel does not provide a GPU temperature or a per-reading timestamp. Compact mode displays the same CPU value. No network permissions or commands are requested by this widget.

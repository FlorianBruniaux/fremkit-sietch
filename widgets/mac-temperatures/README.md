# Mac temperatures

Displays measured average CPU and GPU sensor temperatures in Celsius from the `system` channel. Requires an Apple Silicon Mac, `macmon` and a Fremkit server with the optional temperature reader.

Install the sensor tool with `brew install macmon`. The server invokes its read-only JSON sampler at most once every ten seconds; it does not start a service or request administrator access.

Unavailable, invalid or older-than-thirty-second samples display `?`. These readings are averages, not maximum core temperatures. No network permissions or commands are requested by this widget.

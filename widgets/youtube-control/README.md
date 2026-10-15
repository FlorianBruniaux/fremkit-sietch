# YouTube from Chrome

The companion extension is in `extensions/youtube-xeneon`. This widget receives a video-only WebRTC stream of the selected Chrome tab. The original tab remains the player and audio source. Playback commands target the selected capture session.

Click **Connect Chrome** for a one-time pairing code, enter it in the extension and share the desired YouTube tab. The code expires after ninety seconds. The installed bridge listens only on loopback port 4243, separately from dashboard and account APIs.

The video keeps its aspect ratio. Capture is cropped to the visible video when available; otherwise the selected tab viewport is shown. Missing or expired metadata disables commands and clears the displayed video. No network access is requested by the widget; signaling uses the consented `youtube` channel.

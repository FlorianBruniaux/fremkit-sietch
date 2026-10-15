# YouTube on XENEON

Load this folder as an unpacked Chrome extension, with Chrome 116 or later. In the Fremkit YouTube page, choose **Connect Chrome**, then enter the six-digit code in the extension popup. On the desired YouTube video tab, click **Show this tab on XENEON**.

The extension captures only the selected tab after the user's action. It crops the visible video when possible, otherwise sharing that tab's viewport. It sends a silent video stream locally; the original tab retains audio. Stop sharing from either surface. Closing the tab, leaving YouTube, losing the local bridge or removing access stops capture.

Permissions: temporary `activeTab`, `scripting`, `tabCapture`, `offscreen`, local `storage`, and the loopback HTTP host. No YouTube account credentials, browsing history, external STUN/TURN or relay service. The local destination is fixed to port 4243; Chrome's host permission itself cannot be restricted to that port.

Local installation has been tested on Chrome and the macOS helper: selected-tab capture, received video, playback toggle, ten-second seeks, exact-tab opening and stop/restart were observed. Audio listening, two-tab isolation and browser restart remain separate acceptance checks. Signaling tests alone do not prove playback.

The offscreen document uses only chrome.runtime. The service worker passes the pairing key through extension-internal messaging because storage APIs are unavailable in offscreen documents.

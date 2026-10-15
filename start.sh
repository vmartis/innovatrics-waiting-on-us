#!/bin/bash
# How your app starts. ./deploy.sh restarts the service, which runs this file.
# Rules: listen on port 3000, stay in the foreground, never build here --
# the build happens in `npm install` (root postinstall) before the restart.
exec node dist/server/index.js

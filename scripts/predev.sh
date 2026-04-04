#!/bin/bash
# Kill any zombie processes on ports 3000 and 5173
lsof -ti :3000 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null
exit 0

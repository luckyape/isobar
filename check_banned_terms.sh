#!/bin/bash
# Check for banned terms in the codebase
TERM="accuracy"
echo "Checking for banned term: '$TERM'..."

if grep -r "$TERM" client/src --exclude-dir=node_modules; then
  echo "ERROR: Found banned term '$TERM' in client/src. Please use 'agreement' or 'trust' instead."
  exit 1
else
  echo "PASS: No instances of '$TERM' found."
  exit 0
fi

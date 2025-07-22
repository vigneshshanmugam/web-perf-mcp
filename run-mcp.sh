#!/usr/bin/env bash

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

nvm use --silent

node ./dist/server/index.js
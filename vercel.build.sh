#!/bin/bash
set -e

# Output debug info
echo "Current directory: $(pwd)"
echo "Directory contents: $(ls -la)"

# Install client dependencies
if [ -d "client" ]; then
  echo "Installing client dependencies..."
  cd client
  npm install
  
  echo "Building client..."
  npm run build
  
  echo "Client build complete, directory contents:"
  ls -la dist/
  
  cd ..
else
  echo "Error: Client directory not found!"
  exit 1
fi

# Install API dependencies
if [ -d "api" ]; then
  echo "Installing API dependencies..."
  cd api
  npm install
  cd ..
else
  echo "Warning: API directory not found, skipping API setup"
fi

echo "Build completed successfully!" 
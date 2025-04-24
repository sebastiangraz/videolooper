# Video Looper

A web application for creating seamless video loops with ffmpeg.

## Features

- Create perfect video loops using two techniques:
  - Reverse looping (play forward, then backward)
  - Crossfade looping (smooth transition between end and beginning)
- Customize fade duration and starting point
- Works entirely in the browser - no need to install anything

## Deployment on Vercel

This application is designed to be deployed on Vercel. It uses:

- React frontend (Vite)
- Serverless API functions with ffmpeg-static for video processing

### Configuration

The deployment is configured in `vercel.json`:

```json
{
  "version": 2,
  "buildCommand": "cd client && npm install && npm run build",
  "outputDirectory": "client/dist",
  "installCommand": "npm install",
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/client/dist/$1" }
  ],
  "functions": {
    "api/**/*": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

## Development

To run locally:

```
npm install
npm run dev
```

This will start both the client (Vite React app) and server (Express API).

## Building

To build the client:

```
npm run build
```

The build output will be in `client/dist/`.

## API

The API uses ffmpeg for video processing and offers two looping techniques:

- `reverse`: Creates a loop by playing the video forward, then in reverse
- `crossfade`: Creates a loop by crossfading between the end and beginning

## Limitations

- Maximum video size is limited to what Vercel serverless functions can handle
- Processing time is limited to 60 seconds

## Project Structure

```
video-looper/
├─ client/               # React frontend
│  ├─ src/
│  │  ├─ LoopMakerUploader.tsx      # Upload component
│  │  └─ LoopMakerUploader.test.tsx # Component tests
├─ server/               # Express backend
│  ├─ server.ts          # API server
│  ├─ loop-maker.sh      # Video processing script
│  └─ server.test.ts     # Server tests
└─ package.json          # Root package with workspaces
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Make sure the loop-maker.sh script is executable:

```bash
chmod +x server/loop-maker.sh
```

3. Ensure ffmpeg is installed on your system (required for video processing)

## Development

Run both client and server in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
npm run start:client  # Run the React client
npm run start:server  # Run the Express server
```

## Testing

```bash
cd client && npm test  # Run client tests
cd server && npm test  # Run server tests
```

## Building for Production

```bash
cd client && npm run build
cd server && npm run build
```

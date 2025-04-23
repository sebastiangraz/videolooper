# Video Looper

A web application that creates seamless video loops from uploaded videos.

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

## Features

- Upload video files via browser
- Process videos into seamless loops using ffmpeg
- Download processed videos automatically
- Error handling for all steps of the process

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

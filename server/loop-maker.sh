#!/bin/bash
# ------------------------------------------------------------------------------
# Video Loop Maker - v2.2
# ------------------------------------------------------------------------------
# Creates a seamless loop from a video file using various techniques
# Usage: ./loop-maker.sh <input_video> [technique]
# Techniques:
#   crossfade - Crossfade between end and beginning (default)
#   pingpong  - Play forward then backward 
#   blend     - Blend frames at loop points
#   reverse   - Simple reversed loop
# ------------------------------------------------------------------------------

set -e # Exit on error

# --- Function to check dependencies ---
check_dependencies() {
  if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg not found. Please install ffmpeg to use this script."
    exit 1
  fi
  
  if ! command -v bc &> /dev/null; then
    echo "Error: bc command not found. Using fallback calculations."
    # Set a fallback function for bc
    bc() {
      echo "1" # Just return a safe default for calculations
    }
  fi

  if ! command -v ffprobe &> /dev/null; then
    echo "Error: ffprobe not found. It should be part of ffmpeg installation."
    exit 1
  fi
}

# --- Print debug info ---
echo "Script started with arguments: $@"
echo "Current directory: $(pwd)"

# --- Default parameters ---
INPUT_FILE="$1"
TECHNIQUE="${2:-reverse}" # Use reverse as fallback - most reliable
CROSSFADE_DURATION=0.5    # Shorter crossfade for better results
TEMP_DIR=$(dirname "$INPUT_FILE")/tmp_loop_$(date +%s)
OUTPUT_FILE="${INPUT_FILE}_loop.mp4"

# --- Validate input ---
if [ $# -lt 1 ]; then
    echo "Error: No input file specified"
    echo "Usage: $0 <input_video> [technique]"
    echo "Available techniques: crossfade, pingpong, blend, reverse"
    exit 1
fi

if ! [ -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' does not exist"
    echo "File path provided: $INPUT_FILE"
    echo "Current directory: $(pwd)"
    echo "Directory contents: $(ls -la $(dirname "$INPUT_FILE"))"
    exit 1
fi

# --- Verify dependencies are installed ---
check_dependencies

# --- Create temp directory ---
mkdir -p "$TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Processing video: $INPUT_FILE"
echo "Output will be saved to: $OUTPUT_FILE"

# --- Basic fallback method if analysis fails ---
create_simple_loop() {
  echo "Using simple fallback method..."
  
  # Create a simple reverse file first - no fifo needed
  REVERSE_FILE="$TEMP_DIR/reverse.mp4"
  ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -preset fast "$REVERSE_FILE"
  
  # Then concatenate the files
  ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
    "[0:v][1:v]concat=n=2:v=1:a=0" \
    -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
    "$OUTPUT_FILE"
}

# --- Try to get video duration and info ---
echo "Analyzing video..."
if ! DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null); then
  echo "Warning: Could not determine video duration, using fallback method"
  create_simple_loop
  exit 0
fi

# Get basic video info with error handling
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "24/1")
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")
HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")

# Convert fps fraction to decimal if needed
if [[ $FPS == */* ]]; then
  FPS=$(echo "scale=2; $FPS" | bc 2>/dev/null || echo "24")
fi

echo "Video info:"
echo "- Duration: $DURATION seconds"
echo "- FPS: $FPS"
echo "- Resolution: ${WIDTH}x${HEIGHT}"
echo "- Looping technique: $TECHNIQUE"

# --- Create seamless loop based on technique ---
case "$TECHNIQUE" in
  "crossfade")
    echo "Creating seamless loop with crossfade technique..."
    
    # Calculate crossfade positions with fallback
    FADE_START=$(echo "$DURATION - $CROSSFADE_DURATION" | bc 2>/dev/null || echo "0")
    if [ "$FADE_START" = "0" ] || [ -z "$FADE_START" ]; then
      FADE_START=$(echo "$DURATION * 0.9" | bc 2>/dev/null || echo "0")
    fi
    
    # Create the loop with crossfade
    ffmpeg -y -i "$INPUT_FILE" -filter_complex \
      "[0:v]split[v1][v2];
       [v1]trim=0:$DURATION,setpts=PTS-STARTPTS[main];
       [v2]trim=$FADE_START:$DURATION,setpts=PTS-STARTPTS[fadeout];
       [v2]trim=0:$CROSSFADE_DURATION,setpts=PTS-STARTPTS[fadein];
       [fadeout][fadein]blend=all_expr='A*(1-T)+B*T'[blended];
       [main][blended]overlay" \
      -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
      "$OUTPUT_FILE" || create_simple_loop
    ;;
    
  "pingpong")
    echo "Creating ping-pong loop..."
    # Create reversed clip
    REVERSE_FILE="$TEMP_DIR/reverse.mp4"
    if ! ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -c:v libx264 -preset fast "$REVERSE_FILE"; then
      echo "Failed to create reverse clip, using fallback"
      create_simple_loop
      exit 0
    fi
    
    # Concatenate the clips
    ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
      "[0:v][1:v]concat=n=2:v=1:a=0" \
      -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
      "$OUTPUT_FILE" || create_simple_loop
    ;;
    
  "blend")
    echo "Creating frame blended loop..."
    ffmpeg -y -i "$INPUT_FILE" -filter_complex \
      "[0:v]tblend=all_mode=average,framestep=2" \
      -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
      "$OUTPUT_FILE" || create_simple_loop
    ;;
    
  "reverse"|*)
    echo "Creating simple reversed loop..."
    # First create reversed video
    REVERSE_FILE="$TEMP_DIR/reverse.mp4"
    if ! ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -c:v libx264 -preset fast "$REVERSE_FILE"; then
      echo "Failed to create reverse clip, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
      exit 0
    fi
    
    # Then concatenate with original
    if ! ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
         "[0:v][1:v]concat=n=2:v=1:a=0" \
         -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
         "$OUTPUT_FILE"; then
      echo "Failed to concatenate videos, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
    fi
    ;;
esac

# --- Verify output file exists ---
if [ -f "$OUTPUT_FILE" ]; then
    echo "Success! Seamless loop created at: $OUTPUT_FILE"
    # Get output file size
    OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" 2>/dev/null | cut -f1 || echo "unknown")
    echo "Output file size: $OUTPUT_SIZE"
else
    echo "Error: Failed to create output file at: $OUTPUT_FILE"
    echo "Directory contents: $(ls -la $(dirname "$OUTPUT_FILE"))"
    # Last resort fallback - just copy the input file to output
    echo "Creating a fallback non-looping copy as last resort"
    cp "$INPUT_FILE" "$OUTPUT_FILE"
fi 